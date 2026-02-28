# Trust But Verify — Teaching Your Agent to Check Its Own Work

[Agent Patterns — TypeScript](../../README.md)

Your LLM agent just generated a 50-line JSON config. It looks plausible. The field names seem right. But is the `chartType` actually one of the five valid options? Is the price a positive number? Did it invent a dietary tag that doesn't exist in your system?

Without validation, you won't know until something breaks downstream. With a **self-validation tool**, the agent checks its own output before you ever see it — and fixes what's broken.

---

## The Core Idea

Self-validation is a dedicated tool the agent calls to verify artifacts it generated before delivering them. The tool applies deterministic checks — JSON parsing, schema validation, semantic rules — and returns structured pass/fail feedback. When validation fails, the agent sees the exact errors and corrects them in the next loop iteration.

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Generate   │────>│   Validate   │────>│   Deliver    │
│  (LLM call)  │     │  (tool call) │     │  (to user)   │
└─────────────┘     └──────────────┘     └──────────────┘
                          │ fail
                          │
                    ┌─────▼──────┐
                    │    Fix     │
                    │ (LLM call) │──── loop back to Validate
                    └────────────┘
```

This is distinct from [LLM Error Recovery](../error-recovery/README.md) (concept #7), where an _external_ tool fails and the agent retries. Here, the agent _proactively_ checks its own generation against a known-good schema.

## Why This Matters: Intrinsic vs. Tool-Augmented Correction

Research on LLM self-correction reveals a critical distinction:

**Intrinsic self-correction** (asking the LLM "is this correct?") is unreliable. Huang et al. (ICLR 2024) showed that LLMs _cannot_ reliably self-correct reasoning without external feedback — and sometimes _degrade_ performance by "correcting" correct answers. The Self-Correction Bench (2025) measured a **64.5% blind spot rate**: LLMs fail to fix their own errors but succeed at fixing identical errors presented as external text.

**Tool-augmented validation** (running the output through a deterministic checker) works. When the LLM gets structured feedback from an external tool — "field `chartType` has invalid value `area`, expected one of: line, bar, gauge, table, stat" — it can fix the specific error. This is the approach Anthropic calls the "Evaluator-Optimizer" pattern, and it's what frameworks like LangGraph, AWS, and the OpenAI Agents SDK implement.

The takeaway: **don't ask the LLM if its output is correct. Run it through a validator and tell it what's wrong.**

## The Implementation

Our demo: a **restaurant menu configuration assistant** that generates structured JSON menu configs. The agent has three tools:

| Tool                  | Purpose                                                         |
| --------------------- | --------------------------------------------------------------- |
| `list_ingredients`    | Shows available ingredients and allergen info                   |
| `list_existing_menus` | Shows existing menus for reference                              |
| `validate_menu`       | **The QA gate** — validates generated JSON against a Zod schema |

### The Schema (Single Source of Truth)

The Zod schema defines exactly what a valid menu looks like. It drives both TypeScript types and runtime validation:

```typescript
const MenuItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  price: z.number().min(0.5).max(500),
  dietaryTags: z.array(z.enum(["vegetarian", "vegan", "gluten-free", "nut-free", "spicy"])),
  prepTime: z.number().int().min(1).max(180),
});

const MenuCategorySchema = z.object({
  category: z.enum(["appetizers", "mains", "desserts", "drinks"]),
  items: z.array(MenuItemSchema).min(1).max(20),
});

export const MenuSchema = z.object({
  restaurantName: z.string().min(1),
  cuisine: z.string().min(1),
  categories: z.array(MenuCategorySchema).min(1).max(4),
  currency: z.enum(["USD", "EUR", "GBP"]),
  lastUpdated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
```

The constraints are deliberately tight — LLMs frequently trip over enum values (inventing `"pie"` chart types or `"dairy-free"` dietary tags), price boundaries, and date formats.

### Three-Layer Validation

The `validate_menu` tool runs three layers of checks:

```typescript
function validateMenu(args: { menu_json: string }): string {
  // Layer 1: JSON syntax — did the LLM produce parseable JSON?
  let parsed: unknown;
  try {
    parsed = JSON.parse(args.menu_json);
  } catch (e) {
    return JSON.stringify({ valid: false, errors: [`JSON parse error: ${error.message}`] });
  }

  // Layer 2: Schema validation — does the JSON match the Zod schema?
  const result = MenuSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return JSON.stringify({ valid: false, errors });
  }

  // Layer 3: Semantic validation — business rules Zod can't express
  // e.g., no duplicate items, drinks can't exceed $50, etc.
  const semanticErrors = checkSemanticRules(result.data);
  if (semanticErrors.length > 0) {
    return JSON.stringify({ valid: false, errors: semanticErrors });
  }

  return JSON.stringify({ valid: true, menu: result.data });
}
```

**Layer 1** catches malformed JSON — markdown code fences, trailing commas, Python-style booleans. **Layer 2** catches schema violations — wrong field names, invalid enum values, out-of-range numbers. **Layer 3** catches business logic — duplicate categories, price limits per category, threshold ordering.

Each layer is cheaper than the next. Most errors are caught by Zod (Layer 2) before the semantic checks even run.

### The Tool Description Does the Heavy Lifting

The agent knows to validate because the tool description says so:

```
IMPORTANT: You MUST call this tool to validate your menu configuration
BEFORE delivering it to the user. If validation fails, fix the errors
and re-validate until it passes.
```

This is instruction via tool description — the same pattern from [Tool Description Engineering](../tool-descriptions/README.md) (concept #16). The system prompt reinforces it, but the tool description is what the model actually references during tool selection.

### Two Modes: Validated vs. One-Shot

Run both modes to see the difference:

```bash
pnpm dev:self-validation          # validated mode (generate → validate → fix)
pnpm dev:self-validation:one-shot # one-shot mode (generate → deliver)
```

In **validated mode**, the agent calls `validate_menu` after generating the config. If it fails, the agent sees structured error messages and fixes them. Stats show validation attempts and whether it passed on the first try.

In **one-shot mode**, the `validate_menu` tool isn't available. The agent generates the config and delivers it directly. You'll see the raw output — sometimes valid, sometimes not.

## What the Agent Actually Does

Here's a typical validated-mode interaction:

```
You: Create an Italian restaurant menu with appetizers and mains

  🔧 Tool call: list_ingredients
  🔧 Tool call: list_existing_menus
  🔧 Tool call: validate_menu    ← first attempt
     Result: { valid: false, errors: ["categories.0.items.0.dietaryTags: Invalid enum value..."] }
  🔧 Tool call: validate_menu    ← second attempt (fixed)
     Result: { valid: true }

Menu: Here's the validated Italian restaurant menu configuration: { ... }

  📊 Stats: 4 LLM calls, 4 tool calls | 2 validation attempts, PASSED [validated mode]
```

The agent generated a menu, validated it, discovered it used an invalid dietary tag, fixed it, and re-validated. The user only sees the corrected version.

## When Self-Validation Is Worth It (And When It's Not)

### Worth the extra tool call

- **Structured output that feeds downstream systems** — API configs, database schemas, CI/CD pipelines. A single invalid field breaks everything.
- **Multi-field configs with enum constraints** — the more constrained fields, the more likely the LLM trips. Validation catches what constrained decoding can't (semantic rules).
- **User-facing artifacts** — menus, reports, schedules. The cost of one validation call is tiny compared to the cost of delivering broken output.

### Probably overkill

- **Free-form text** — summaries, explanations, creative writing. No schema to validate against.
- **Single-field extraction** — if the output is one enum value, constrained decoding (see [Structured Output](../structured-output/README.md)) handles it directly.
- **Latency-critical paths** — each validation attempt is an extra LLM call. For real-time applications, consider constrained decoding instead.

### The cost equation

Self-Refine research (Madaan et al., NeurIPS 2023) shows that most improvement comes in **1-2 iterations**. Beyond that, returns diminish sharply. Cap your validation loop at 2-3 attempts — if the agent can't fix it by then, the schema or prompt needs work, not more retries.

## Key Takeaways

1. **Don't ask the LLM if its output is correct.** Run it through a deterministic validator with structured error feedback. Intrinsic self-correction has a 64.5% blind spot; tool-augmented validation works.

2. **Three layers of validation**: JSON syntax → schema (Zod) → semantic rules. Each layer catches different errors, and earlier layers are cheaper.

3. **The tool description is the instruction.** Tell the agent to always validate before delivering. Reinforce in the system prompt, but the tool description is what drives tool selection.

4. **Cap the loop.** 1-2 correction iterations capture most value. Infinite loops are a real failure mode — always have a hard stop.

5. **Schema is the single source of truth.** One Zod schema drives TypeScript types, runtime validation, and error messages. No drift between what's expected and what's checked.

---

## Sources & Further Reading

- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366) — Shinn et al., NeurIPS 2023 — the Actor/Evaluator/Self-Reflection triad; foundational paper for agent self-evaluation
- [Self-Refine: Iterative Refinement with Self-Feedback](https://arxiv.org/abs/2303.17651) — Madaan et al., NeurIPS 2023 — single-model generate/feedback/refine loop; ~20% average improvement across 7 tasks
- [LLMs Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798) — Huang et al., ICLR 2024 — the critical counterpoint: intrinsic self-correction fails for reasoning tasks
- [Self-Correction Bench](https://arxiv.org/abs/2507.02778) — 2025 — 64.5% blind spot rate; LLMs fix external errors but not their own
- [CRITIC: Large Language Models Can Self-Correct with Tool-Interactive Critiquing](https://arxiv.org/abs/2305.11738) — Gou et al., ICLR 2024 — tool-augmented validation beats intrinsic self-critique
- [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) — Anthropic, 2024 — the "Evaluator-Optimizer" workflow
- [Evaluator Reflect-Refine Loop Patterns](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/evaluator-reflect-refine-loop-patterns.html) — AWS Prescriptive Guidance — named reusable pattern with retry limits and failure modes
- [Reflection Agents](https://blog.langchain.com/reflection-agents/) — LangChain — three tiers of reflection (basic, Reflexion, LATS)
- [Guardrails — OpenAI Agents SDK](https://openai.github.io/openai-agents-python/guardrails/) — input/output/tool guardrails with tripwire mechanism
