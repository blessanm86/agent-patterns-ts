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

## In the Wild: Coding Agent Harnesses

The choice of structured output format turns out to be one of the most consequential architectural decisions in coding agent design. You might expect every harness to use JSON tool calls — the standard approach promoted by model providers. In practice, the field has splintered into three competing paradigms: JSON tool calls, structured text, and executable code. The disagreements reveal something fundamental about how different models respond to different output constraints.

**Aider** provides the most empirical evidence. Over multiple benchmark cycles, Aider has accumulated a zoo of [seven-plus edit formats](https://aider.chat/docs/more/edit-formats.html) — `whole`, `diff`, `diff-fenced`, `udiff`, `editor-diff`, `editor-whole`, and more — because no single format works well across all models. Gemini models perform best with `diff-fenced` (filepath inside the fence). GPT-4 prefers `diff` (search/replace blocks). GPT-3.5 needs the simplest `whole` format (return the entire file). Most strikingly, when Aider [benchmarked OpenAI's function-calling API](https://aider.chat/docs/benchmarks.html) — the JSON Schema-validated structured output mechanism — against plain text formats, **function calls performed worse across every model tested**. GPT-3.5 in particular produced inferior code through function calls and frequently mangled the JSON Schema, stuffing entire Python files into the `arguments` field rather than following the structured parameter format. Aider's conclusion: plain text edit formats worked best, and they explicitly rejected JSON tool calls for file edits despite their theoretical reliability advantages.

**OpenAI's Codex CLI** took this insight further by inventing an entirely new structured text format — the [V4A diff format](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide/) — and training GPT-4.1 directly on it. The format uses `*** Begin Patch` / `*** End Patch` markers with `*** Update File:` headers, context lines for anchoring, and `+`/`-` markers for additions and deletions. This is not JSON. It is not a standard unified diff. It is a purpose-built structured text format that GPT-4.1 was trained to produce reliably. The key insight is that constrained decoding guarantees syntactic validity, but training the model on a specific output structure produces better _semantic_ results — the model doesn't just emit valid patches, it emits correct ones.

**Manus** went in a third direction entirely with the [CodeAct approach](https://arxiv.org/abs/2402.01030): instead of having the model emit JSON tool-call payloads or structured text patches, the model writes executable Python code that calls tools directly. The ICML 2024 paper behind this approach showed up to 20% higher success rates on complex multi-tool tasks compared to JSON baselines, with up to 30% fewer interaction turns. The token efficiency gains are dramatic — research on CodeAct-style frameworks reports up to 87% reduction in input tokens versus natural language prompting. The tradeoff is that you need a sandboxed code execution environment and the model must be strong enough at code generation for the approach to work.

**Claude Code**, by contrast, uses standard JSON tool calls with strict schema validation — the closest thing to the schema-mode approach covered in this post. Each tool (Read, Edit, Bash, Glob, Grep, etc.) has a JSON Schema definition, and the model's tool-call outputs are validated against those schemas. This is the most conventional approach but also the most portable: it works with any model that supports the tool-calling protocol, and the schema validation catches malformed calls before they execute. The simplicity is deliberate — Claude Code's design philosophy is ["the runtime is dumb; the model is CEO"](https://vrungta.substack.com/p/claude-code-architecture-reverse), so the harness trusts the model to produce correct structured output rather than building elaborate format-specific parsing.

The pattern that emerges is counterintuitive for anyone who has read this far in the post: **constrained decoding (schema mode) guarantees structure, but it doesn't guarantee the best results for every task.** For data extraction — pulling a `BookingIntent` from natural language — schema mode is clearly superior. But for code editing, where the "structured output" is a set of file modifications, the optimal format depends on the model, the task complexity, and whether the model was specifically trained on that format. Aider's experience with seven formats across dozens of models is the strongest evidence that structured output is not a solved problem — it is a per-model, per-task engineering decision.

---

## Key Takeaways

- **Prompt-only output is unreliable at scale.** Field names, date formats, and JSON syntax vary between calls. Any regex you write to fix it is technical debt.

- **JSON mode guarantees syntax, not schema.** `format: "json"` eliminates parse errors but doesn't prevent wrong field names, wrong types, or missing required fields. You still need schema validation.

- **Schema mode (constrained decoding) eliminates an entire error class.** By compiling the schema to a grammar and filtering tokens at generation time, the model cannot produce an invalid response. Failures drop from 40–60% to near zero.

- **Zod is the single source of truth.** One Zod schema definition drives the TypeScript type (`z.infer<>`), runtime validation (`.safeParse()`), and the JSON Schema passed to Ollama (`z.toJSONSchema()`). No drift between representations.

- **Two layers, two failure modes.** JSON syntax (layer 1) and schema compliance (layer 2) are separate concerns. JSON mode handles layer 1. Schema mode handles both. Zod validates layer 2 regardless of which format approach you use.

---

[Agent Patterns — TypeScript](../../README.md)
