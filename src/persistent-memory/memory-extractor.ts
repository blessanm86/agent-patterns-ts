// ─── Memory Extraction ──────────────────────────────────────────────────────
//
// Secondary LLM call (post-conversation) that extracts memory-worthy facts
// from the last exchange. Follows the same pattern as
// src/post-conversation-metadata/metadata.ts: Zod schema → constrained
// decoding → safeParse validation.
//
// The extractor also detects explicit forget requests ("forget that I like
// sushi", "I'm no longer vegetarian") and returns them separately.

import { z } from "zod";
import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import type { Message } from "../shared/types.js";
import type { MemoryCategory } from "./memory-store.js";

// ─── Schema ──────────────────────────────────────────────────────────────────

const ExtractedFactSchema = z.object({
  content: z
    .string()
    .min(1)
    .describe("The fact to remember, stated as a concise declarative sentence"),
  category: z
    .enum(["dietary", "cuisine", "restaurant", "location", "dining-style", "personal"])
    .describe("Category of the memory fact"),
  importance: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("How important this fact is for future recommendations (1=trivial, 10=critical)"),
});

const ExtractionResultSchema = z.object({
  facts: z
    .array(ExtractedFactSchema)
    .describe("New facts worth remembering from this exchange. Empty array if nothing new."),
  forgetRequests: z
    .array(z.string())
    .describe(
      "Things the user explicitly asked to forget or corrected. E.g. 'vegetarian' if user said 'I'm no longer vegetarian'. Empty array if none.",
    ),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;

const EXTRACTION_JSON_SCHEMA = z.toJSONSchema(ExtractionResultSchema);

// ─── Message Filtering ──────────────────────────────────────────────────────

function filterForExtraction(messages: Message[]): Message[] {
  return messages.filter((m) => {
    if (m.role === "tool") return false;
    if (m.role === "assistant") {
      const hasToolCalls = m.tool_calls && m.tool_calls.length > 0;
      const hasContent = m.content && m.content.trim().length > 0;
      if (hasToolCalls && !hasContent) return false;
    }
    return true;
  });
}

// ─── Extraction ─────────────────────────────────────────────────────────────

export interface ExtractionCallResult {
  result: ExtractionResult | null;
  error: string | null;
}

export async function extractMemories(
  messages: Message[],
  existingMemories: string[],
): Promise<ExtractionCallResult> {
  // Only send last 2 filtered messages (user + assistant) to minimize tokens
  const filtered = filterForExtraction(messages);
  const recentMessages = filtered.slice(-2);

  if (recentMessages.length === 0) {
    return { result: { facts: [], forgetRequests: [] }, error: null };
  }

  const existingList =
    existingMemories.length > 0
      ? `\n\nExisting memories (do NOT re-extract these):\n${existingMemories.map((m) => `- ${m}`).join("\n")}`
      : "";

  const systemPrompt = `You are a memory extraction system for a restaurant recommendation assistant. Analyze the conversation and extract facts worth remembering about the user for future sessions.

Rules:
- Extract ONLY new facts not already in existing memories
- Facts should be concise declarative sentences about the user ("User is vegetarian", "User lives near Midtown")
- Rate importance: dietary restrictions = 8-9, cuisine preferences = 7-8, location = 7-8, restaurant visits = 5-6, dining style = 6-7, personal facts = 4-6
- If the user corrects a previous fact (e.g., "I'm no longer vegetarian"), add it to forgetRequests
- If the user asks to forget something (e.g., "forget that I like sushi"), add the relevant keyword to forgetRequests
- Only extract facts explicitly stated or strongly implied by the user — do not infer
- Return empty arrays if nothing is worth remembering (e.g. greetings, small talk)${existingList}`;

  try {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: systemPrompt,
      messages: recentMessages,
      format: EXTRACTION_JSON_SCHEMA,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.message.content);
    } catch {
      return { result: null, error: "JSON parse error on extraction response" };
    }

    const validated = ExtractionResultSchema.safeParse(parsed);
    if (!validated.success) {
      const errors = validated.error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
      );
      return { result: null, error: `Schema validation failed: ${errors.join("; ")}` };
    }

    return { result: validated.data, error: null };
  } catch (e) {
    return { result: null, error: (e as Error).message };
  }
}

// Re-export the category type for convenience
export type { MemoryCategory };
