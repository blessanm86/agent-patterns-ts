import { z } from "zod";
import ollama from "ollama";

import { MODEL } from "../shared/config.js";

// ─── Schema ───────────────────────────────────────────────────────────────────
//
// BookingIntentSchema is the single source of truth for the booking structure:
//
//   z.infer<typeof BookingIntentSchema>
//     → TypeScript type (BookingIntent)
//
//   BookingIntentSchema.safeParse(parsed)
//     → runtime validation in all three approaches
//
//   z.toJSONSchema(BookingIntentSchema)
//     → JSON Schema object for Ollama's constrained decoding (approach c)
//
// One schema definition drives types, validation, and the format constraint.
// No schema drift: if you add a field here, all three update automatically.

export const BookingIntentSchema = z.object({
  guest_name: z.string().min(1),
  room_type: z.enum(["single", "double", "suite"]),
  check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().min(1).max(10),
  special_requests: z.string(),
});

export type BookingIntent = z.infer<typeof BookingIntentSchema>;

// Derived once at module load — reused for every schema-mode call.
// z.toJSONSchema() emits: { $schema, type: "object", properties, required,
// additionalProperties: false }. Ollama accepts this directly as `format`.
export const BOOKING_JSON_SCHEMA = z.toJSONSchema(BookingIntentSchema);

// ─── Result Type ──────────────────────────────────────────────────────────────
//
// ExtractionResult carries what happened at each parsing layer:
//   rawResponse     — the string the model actually returned (may be markdown-wrapped)
//   jsonParseError  — set if JSON.parse() failed (approach a failure mode)
//   validationError — set if Zod found schema violations (approach b failure mode)
//   data            — only present when both layers succeeded

export type Approach = "prompt" | "json-mode" | "schema";

export interface ExtractionResult {
  approach: Approach;
  rawResponse: string;
  jsonParseError: string | null;
  validationError: string | null;
  data: BookingIntent | null;
}

// ─── Approach A: Prompt-Only ──────────────────────────────────────────────────
//
// No format constraint. A minimal system prompt asks for JSON but provides
// no field names and no schema. The model decides everything.
//
// Failure modes this approach is prone to:
//   - Wrapping output in markdown code fences: ```json { ... } ```
//   - Using different field names: "name" vs "guest_name", "type" vs "room_type"
//   - Wrong date format: "March 15" instead of "2026-03-15"
//   - Python-style booleans (True/False) or trailing commas
//   - Adding prose before/after the JSON: "Here are the details: { ... }"

export async function extractWithPromptOnly(userMessage: string): Promise<ExtractionResult> {
  const response = await ollama.chat({
    model: MODEL,
    // @ts-expect-error — system is not in ChatRequest types but works at runtime
    system: "Extract booking details from the user's message and return as JSON.",
    messages: [{ role: "user", content: userMessage }],
    // No format constraint — output format is entirely up to the model
  });

  return parseResult("prompt", response.message.content);
}

// ─── Approach B: JSON Mode ─────────────────────────────────────────────────────
//
// format: "json" forces the model to emit valid JSON syntax at the token level.
// The system prompt lists the required fields to guide the model's structure.
//
// What IS guaranteed: valid JSON syntax — JSON.parse() will always succeed.
// What is NOT guaranteed: correct field names, correct types, all required fields.
//
// If the model uses "name" instead of "guest_name", JSON.parse() succeeds
// but Zod validation fails — the field exists in the JSON but not the schema.

export async function extractWithJsonMode(userMessage: string): Promise<ExtractionResult> {
  const response = await ollama.chat({
    model: MODEL,
    // @ts-expect-error — system is not in ChatRequest types but works at runtime
    system: `Extract hotel booking details from the user's message.
Return a JSON object with exactly these fields:
- guest_name (string, required)
- room_type (one of: "single", "double", "suite")
- check_in (date string in YYYY-MM-DD format, e.g. 2026-03-15)
- check_out (date string in YYYY-MM-DD format, e.g. 2026-03-20)
- adults (integer, 1 to 10)
- special_requests (string, empty string "" if none)`,
    messages: [{ role: "user", content: userMessage }],
    format: "json", // Guarantees valid JSON syntax; does not guarantee schema compliance
  });

  return parseResult("json-mode", response.message.content);
}

// ─── Approach C: Schema Mode (Constrained Decoding) ───────────────────────────
//
// format: BOOKING_JSON_SCHEMA passes a JSON Schema object to Ollama.
// Ollama compiles this into a GBNF grammar and applies it during token generation:
// at each position, only tokens that keep generation on a valid grammar path
// are available. The model cannot emit a token that violates the schema.
//
// What IS guaranteed: valid JSON + correct field names + correct types +
//   room_type is one of the enum values + all required fields present.
// What is still up to the model: correctly reading dates and names from the text.
//
// Available since Ollama v0.5. The format parameter accepts string | object —
// passing BOOKING_JSON_SCHEMA directly requires no casting.

export async function extractWithSchemaMode(userMessage: string): Promise<ExtractionResult> {
  const response = await ollama.chat({
    model: MODEL,
    // @ts-expect-error — system is not in ChatRequest types but works at runtime
    system:
      "Extract hotel booking details from the user's message. Dates must be in YYYY-MM-DD format.",
    messages: [{ role: "user", content: userMessage }],
    format: BOOKING_JSON_SCHEMA, // Constrained decoding — model cannot violate this schema
  });

  return parseResult("schema", response.message.content);
}

// ─── Parse Helper ─────────────────────────────────────────────────────────────
//
// Shared by all three approaches. Two-layer parsing:
//
//   Layer 1 — JSON.parse(): Did the model return parseable JSON?
//     On failure: set jsonParseError. Approach (a) often fails here.
//     First tries stripping markdown code fences — a common approach (a) pattern.
//
//   Layer 2 — Zod safeParse(): Does the JSON match the schema?
//     On failure: set validationError. Approach (b) sometimes fails here.
//     Approach (c) almost never fails here (constrained decoding prevents it).

function parseResult(approach: Approach, raw: string): ExtractionResult {
  // Attempt to strip markdown code fences before parsing:
  //   ```json\n{ ... }\n```  →  { ... }
  let jsonString = raw.trim();
  const fenceMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonString = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    return {
      approach,
      rawResponse: raw,
      jsonParseError: (e as SyntaxError).message,
      validationError: null,
      data: null,
    };
  }

  const result = BookingIntentSchema.safeParse(parsed);
  if (!result.success) {
    return {
      approach,
      rawResponse: raw,
      jsonParseError: null,
      validationError: result.error.issues
        .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
        .join("; "),
      data: null,
    };
  }

  return {
    approach,
    rawResponse: raw,
    jsonParseError: null,
    validationError: null,
    data: result.data,
  };
}

// ─── Run All Three ─────────────────────────────────────────────────────────────
//
// Fires three concurrent requests to Ollama. With a local model serving
// requests sequentially on the GPU, these will queue — total latency is
// roughly 3× a single call, not 1×. Still faster than waiting for each result
// before starting the next.

export async function extractAll(userMessage: string): Promise<ExtractionResult[]> {
  return Promise.all([
    extractWithPromptOnly(userMessage),
    extractWithJsonMode(userMessage),
    extractWithSchemaMode(userMessage),
  ]);
}
