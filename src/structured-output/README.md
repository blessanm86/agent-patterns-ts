# Structured Output (JSON Mode)

> A Tier 1 foundation. Many later concepts (Multi-Agent Routing, Plan+Execute, Reasoning Tool) depend on getting reliable structured data from an LLM. This post covers the core technique.

---

## The Parse Tax

Your hotel booking agent needs to extract a guest name, room type, and dates from a user message. You ask the model to return JSON. Sometimes it does:

```json
{ "guest_name": "Alice Smith", "room_type": "double", "check_in": "2026-03-15" }
```

But often it doesn't:

````
Sure! Here are the extracted booking details:

```json
{
  "name": "Alice Smith",
  "type": "dbl",
  "checkIn": "March 15",
  "checkOut": "March 20",
  "guests": 2
}
````

Let me know if you need anything else!

````

That response is:

- Wrapped in a markdown code fence your parser didn't expect
- Using `name` instead of `guest_name`, `type` instead of `room_type`
- Formatting dates as `"March 15"` instead of `"2026-03-15"`
- Including prose before and after the JSON

Now you're writing regex to strip the fences, normalizing field names, parsing natural language dates, and retrying on failure. This is the **parse tax** — the hidden cost of treating free-text LLM output as structured data.

The alternative is to stop hoping the model returns JSON and start *constraining* it to do so.

---

## Three Approaches, Three Reliability Tiers

Every provider has converged on the same three-tier spectrum for structured output:

| Approach | Mechanism | Reliability |
|---|---|---|
| **Prompt-only** | Ask nicely in the system prompt | ~40–60% |
| **JSON mode** | `format: "json"` | ~90%+ |
| **Schema mode** | `format: { ...jsonSchema }` | ~95–100% |

This demo implements all three as `extractWithPromptOnly()`, `extractWithJsonMode()`, and `extractWithSchemaMode()`. Each takes the same natural language input and attempts to produce the same structured output — a `BookingIntent`:

```typescript
interface BookingIntent {
  guest_name: string;         // "Alice Smith"
  room_type: "single" | "double" | "suite";
  check_in: string;           // "2026-03-15"
  check_out: string;          // "2026-03-20"
  adults: number;             // 2
  special_requests: string;   // "" if none
}
````

---

## Approach A: Prompt-Only

The weakest approach. A vague system prompt asks for JSON; no format constraint is applied:

```typescript
await ollama.chat({
  model: MODEL,
  system: "Extract booking details from the user's message and return as JSON.",
  messages: [{ role: "user", content: userMessage }],
  // No format constraint
});
```

The model is free to output anything. Common failure modes:

**Markdown wrapping** — the model treats its context as a chat and formats code:

````
Here are the booking details:
```json
{ "guest_name": "Alice Smith", ... }
````

````
`JSON.parse()` throws immediately. You'd need to strip the fences first.

**Wrong field names** — the model invents its own schema:
```json
{ "name": "Alice", "type": "double", "checkIn": "March 15", "guests": 2 }
````

The JSON is technically valid, but `BookingIntent` wants `guest_name`, `room_type`, `check_in`, and `adults`. Four fields wrong.

**Wrong date format** — natural language input produces natural language output:

```json
{ "check_in": "March 15th, 2026" }
```

The Zod schema expects `^\d{4}-\d{2}-\d{2}$`. Validation fails.

Reliability at scale degrades further because failures compound: a model that returns wrong field names also tends to return wrong date formats.

---

## Approach B: JSON Mode

Adding `format: "json"` constrains the model's output at the token level. The model cannot emit a character that would produce invalid JSON — no markdown fences, no prose, no trailing commas, no Python-style `True`/`False`. Every response is parseable by `JSON.parse()`.

```typescript
await ollama.chat({
  model: MODEL,
  system: `Extract hotel booking details. Return a JSON object with exactly these fields:
- guest_name (string)
- room_type (one of: "single", "double", "suite")
- check_in (YYYY-MM-DD)
- check_out (YYYY-MM-DD)
- adults (integer, 1–10)
- special_requests (string, "" if none)`,
  messages: [{ role: "user", content: userMessage }],
  format: "json",
});
```

`JSON.parse()` now always succeeds. But the model still decides the structure. The system prompt lists the fields, but if the model decides `"room_type"` should be `"roomType"` — or returns `"dbl"` instead of `"double"` — JSON mode doesn't stop it:

```json
{ "guest_name": "Alice", "roomType": "dbl", "checkIn": "2026-03-15", ... }
```

Valid JSON. Wrong schema. `BookingIntentSchema.safeParse()` fails with:

```
room_type: Required; adults: Required
```

This is where Zod becomes essential: it catches the gap between "valid JSON" and "correct schema."

---

## Approach C: Schema Mode (Constrained Decoding)

The most reliable approach. Instead of a format string, you pass a JSON Schema object:

```typescript
await ollama.chat({
  model: MODEL,
  system: "Extract hotel booking details from the user's message.",
  messages: [{ role: "user", content: userMessage }],
  format: BOOKING_JSON_SCHEMA, // A JSON Schema object, not the string "json"
});
```

Ollama compiles this schema into a **GBNF grammar** — a Generalized Backus-Naur Form rule set derived from the schema's structure. During generation, Ollama applies a bitmask over the model's vocabulary at each token position, masking out any token that would violate the grammar. The model literally cannot emit an invalid token.

This means:

- `guest_name` is guaranteed to exist and be a string
- `room_type` is guaranteed to be `"single"`, `"double"`, or `"suite"` — nothing else
- `adults` is guaranteed to be an integer between 1 and 10
- `special_requests` is guaranteed to exist (empty string if not specified)

The model cannot output `"roomType": "dbl"` because the grammar requires the key `"room_type"` and the value to be one of the three enum options. At the token level, after emitting `"room_type": `, the only valid next tokens are `"single"`, `"double"`, or `"suite"`.

The academic foundation is Willard & Louf's 2023 paper [_Efficient Guided Generation for Large Language Models_](https://arxiv.org/abs/2307.09702), which showed how to compile arbitrary schemas to FSMs and apply them during sampling with no quality loss and ~50% speed improvement over naïve grammar-constrained decoding.

---

## Parsing as Two Separate Layers

All three approaches run through the same two-layer validation:

```
Raw string
    ↓
JSON.parse()  ──── fail ──→  jsonParseError (approach a failure mode)
    ↓
Zod.safeParse() ── fail ──→  validationError (approach b failure mode)
    ↓
BookingIntent ✓
```

This is important: JSON syntax validity and schema compliance are **separate concerns**. JSON mode only handles layer 1. Zod handles layer 2. Schema mode makes layer 2 failures almost impossible by constraining the model before it generates.

In `agent.ts`, the `parseResult()` helper runs both layers for all three approaches. The `ExtractionResult` type carries what failed at which layer:

```typescript
interface ExtractionResult {
  approach: Approach;
  rawResponse: string;
  jsonParseError: string | null; // Layer 1 failure
  validationError: string | null; // Layer 2 failure
  data: BookingIntent | null; // Present only when both succeed
}
```

When you run `/all` in the demo and compare the three columns, you're watching these two layers independently. A common observation:

```
Approach     JSON Parse   Zod Schema   Outcome
──────────   ──────────   ─────────    ─────────────────────────────
prompt       FAILED       (skipped)    ✗ JSON parse error
json-mode    ok           FAILED       ✗ room_type: Invalid enum value
schema       ok           ok           ✓ Alice Smith / double / 2026-03-15
```

---

## Zod as the Single Source of Truth

A common anti-pattern in TypeScript codebases is maintaining three separate representations of the same structure:

```typescript
// ❌ Three places to keep in sync
interface BookingIntent { ... }         // TypeScript type
const bookingJsonSchema = { ... };      // JSON Schema for the LLM
const validateBooking = (x) => { ... }; // Runtime validation
```

Change one and forget the others, and your types, LLM constraints, and validators drift apart.

Zod eliminates this. One schema definition drives all three:

```typescript
// ✅ Single source of truth
export const BookingIntentSchema = z.object({
  guest_name: z.string().min(1),
  room_type: z.enum(["single", "double", "suite"]),
  check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().min(1).max(10),
  special_requests: z.string(),
});

export type BookingIntent = z.infer<typeof BookingIntentSchema>; // TypeScript type
export const BOOKING_JSON_SCHEMA = z.toJSONSchema(BookingIntentSchema); // JSON Schema for Ollama
// Runtime validation: BookingIntentSchema.safeParse(parsed)
```

`z.toJSONSchema()` is built into Zod v4 — no extra package needed. It emits a standard JSON Schema object with `type`, `properties`, `required`, and `additionalProperties: false`. Ollama's schema-mode `format` parameter accepts this directly.

If you add a field to `BookingIntentSchema`, the TypeScript type updates automatically, the JSON Schema passed to Ollama updates automatically, and the Zod validation catches any missing field automatically.

---

## When to Use Which Approach

**Prompt-only** is acceptable for:

- Development and prototyping — fast iteration, exact schema doesn't matter yet
- Human-readable outputs — if a person reads the response, strict JSON isn't needed
- One-off scripts — when the failure rate is acceptable and retry logic is cheap

**JSON mode** is a good default for production when:

- The schema is stable and the model is large/capable
- JSON syntax failures are the primary concern (not schema compliance)
- Slight latency overhead from schema mode matters

**Schema mode** is the right choice when:

- Schema compliance must be guaranteed (downstream code parses specific fields)
- The model is small or unreliable (smaller models benefit most from constraints)
- You want to eliminate an entire class of parsing errors without retry logic

**A note on regex patterns:** The `check_in` and `check_out` fields use `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`. This compiles to a `"pattern"` constraint in the JSON Schema and Ollama attempts to enforce it via GBNF. On capable models this works; on very small models, complex regex patterns can occasionally cause constrained decoding to stall. If you see unusually slow responses in schema mode, try replacing the regex fields with `z.string()` and validating date format at the application layer instead.

**Free text for free text:** Never use JSON mode for user-facing responses. The constraint degrades response quality — the model can't use natural language when forced to emit JSON tokens. Use JSON mode only for internal decision-making calls, not for responses the user will read.

---

## Running the Demo

Prerequisites: [Ollama running](https://ollama.com) with `qwen2.5:7b` pulled.

```bash
pnpm dev:structured-output
```

The demo starts in `/schema` mode. Try these prompts:

| Prompt                                                      | What to look for                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `"Book a double room for John Smith, March 15 to March 20"` | Dates may vary by mode — schema mode enforces YYYY-MM-DD                             |
| `"Suite for Alice Wong, April 1st to April 5th, 2 adults"`  | Enum constraint: schema mode guarantees `"suite"`, not `"Suite"` or `"presidential"` |
| `"single room 2026-06-01 to 2026-06-03 for Ben Lee"`        | Clean input — all three may succeed; run `/all` to compare                           |

Switch modes and observe where each fails:

```
/prompt     — watch for JSON parse failures or wrong field names
/json-mode  — JSON always parses, but room_type or date format may fail Zod
/schema     — structure is guaranteed; observe what the model still gets wrong semantically
/all        — compare all three on the same input side-by-side
```

---

## Key Takeaways

- **Prompt-only output is unreliable at scale.** Field names, date formats, and JSON syntax vary between calls. Any regex you write to fix it is technical debt.

- **JSON mode guarantees syntax, not schema.** `format: "json"` eliminates parse errors but doesn't prevent wrong field names, wrong types, or missing required fields. You still need schema validation.

- **Schema mode (constrained decoding) eliminates an entire error class.** By compiling the schema to a grammar and filtering tokens at generation time, the model cannot produce an invalid response. Failures drop from 40–60% to near zero.

- **Zod is the single source of truth.** One Zod schema definition drives the TypeScript type (`z.infer<>`), runtime validation (`.safeParse()`), and the JSON Schema passed to Ollama (`z.toJSONSchema()`). No drift between representations.

- **Two layers, two failure modes.** JSON syntax (layer 1) and schema compliance (layer 2) are separate concerns. JSON mode handles layer 1. Schema mode handles both. Zod validates layer 2 regardless of which format approach you use.

---

[Agent Patterns — TypeScript](../../README.md)
