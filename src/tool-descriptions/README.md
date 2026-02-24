# Tool Description Engineering

> Part of [Agent Patterns — TypeScript](../../README.md)

---

## "We spent more time optimizing our tools than the overall prompt."

That's Anthropic, describing their work on the SWE-bench code repair benchmark. The result: state-of-the-art performance — not from a better model, not from a smarter loop, but from rewriting tool descriptions.

Here are the numbers from across the industry:

- **Claude 3 Haiku: 11% → 75% tool call accuracy** just from adding 3-shot examples to tool descriptions (LangChain, 2024)
- **36% → 78% accuracy** from schema and description improvements alone (Composio GPT-4 analysis)
- **SWE-agent achieved 12.5% pass@1 on SWE-bench** — attributed primarily to Agent-Computer Interface (ACI) design, not model improvements (Yang et al., NeurIPS 2024)

The tool description is not documentation. It is the API contract between your code and the model's reasoning. Every word shapes whether the model calls the right tool, with the right arguments, in the right order.

---

## The Agent-Computer Interface

SWE-agent introduced the term **Agent-Computer Interface (ACI)** as a parallel to Human-Computer Interface (HCI). The argument:

> "Think about how much effort goes into human-computer interfaces (HCI), and plan to invest just as much effort in creating good agent-computer interfaces (ACI)." — Anthropic

Where HCI design asks "can a person figure out how to use this?", ACI design asks "can the model figure out how to use this?" The design principles are similar:

1. **Simplicity** — simple tools with concise, clear documentation
2. **Efficiency** — consolidate related operations; fewer tools that do more
3. **Informative feedback** — tool results give meaningful state, not just success/failure
4. **Error prevention** — build guardrails into descriptions and error messages

This demo applies all four to a customer support agent.

---

## The Five Techniques

The same 5 tools are defined twice in `tools.ts`: as `weakTools` (minimal descriptions) and `strongTools` (engineered descriptions). The implementations are **identical**. Only the descriptions change.

### 1. Unambiguous Parameter Names

The single most-cited concrete rule from Anthropic's engineering post:

```ts
// Weak — what type is "customer"? A name? An ID? An email?
{ name: "customer", description: "The customer to search for" }

// Strong — the name encodes the type and role
{ name: "customer_email", description:
  "The customer's email address, e.g. jane@example.com. " +
  "Must be a valid email — do NOT pass a name or phone number." }
```

With the weak description, a user message like "refund for customer John Smith" causes the model to pass `"John Smith"` as the customer argument. The search fails. The model either hallucinates a fix or gives up.

With the strong description, the model knows it needs an email. If the user hasn't provided one, it asks. If it has the email from a previous tool result, it passes that.

OpenAI's version of this rule: use `user_id` not `user`, `date_iso8601` not `date`. The parameter name should encode its type and expected format.

### 2. Verb-First Descriptions with Inline Format Examples

```ts
// Weak — describes what the tool is, not what it does
{
  description: "Order details.";
}

// Strong — verb-first, states the return value, shows format
{
  description: "Fetches full details for a specific order by its ID (item, amount, " +
    "purchase date, customer email, status). " +
    "Always call this BEFORE issue_refund or escalate_to_human.";
}
```

OpenAI's recommended pattern for parameter descriptions: **type + inline example**.

```ts
// Weak
{
  description: "The order ID";
}

// Strong
{
  description: "The order ID, e.g. ORD-001. Must start with 'ORD-'.";
}
```

The inline example does two things: it shows the expected format, and it anchors the model's understanding to a concrete value rather than an abstraction.

### 3. When-NOT-to-Use Clauses

This is where providers disagree — and it's worth surfacing.

**LangChain** explicitly endorses putting counter-examples in descriptions:

> "A good description can also provide space to provide short examples (or counter examples) if needed."

**OpenAI** says the opposite: keep descriptions concise, put when-not-to-use in the system prompt:

> "Use the system prompt to describe when (and when not) to use each function."

**Anthropic** says both.

For this demo we put guards directly in descriptions, since it's more visible and teaches the technique. In production, the right answer depends on your provider, model size, and how many tools you have.

```ts
// Weak — no guard; model escalates for anything
{
  description: "Escalate to a human agent.";
}

// Strong — explicit when-not-to-use
{
  description: "Escalates a support case to a human agent. " +
    "Only use this when: (1) the customer explicitly requests a human, " +
    "(2) the issue cannot be resolved with available tools, " +
    "or (3) the refund amount exceeds $500. " +
    "Do NOT use for routine refund requests, status checks, or simple " +
    "questions — handle those with issue_refund or send_message.";
}
```

### 4. Edge Case Coverage

Bugs in agent behavior often come from edge cases the description didn't anticipate. Document them upfront:

```ts
// Weak — no mention of already-refunded case
{
  description: "Issue a refund.";
}

// Strong — the dangerous cases are stated explicitly
{
  description: "Issues a refund and updates order status to 'refunded'. " +
    "Only call this AFTER get_order_details confirms the order exists. " +
    "Do NOT call this if the order status is already 'refunded' — it will fail. " +
    "Do NOT call this if the order is 'cancelled' — not eligible. " +
    "Amount must be a plain number (no currency symbol), e.g. 89.99.";
}
```

### 5. Actionable Error Messages

Error messages are runtime documentation. When a tool call fails, the model reads the error and decides what to do next. A generic error (`{ error: "Invalid input" }`) tells the model nothing. An actionable error shows the correct format and suggests the next step:

```ts
// Weak error
{
  error: "Invalid customer";
}

// Strong error
{
  error: "customer_email must be a valid email address, e.g. jane@example.com. " +
    "Received: 'John Smith'. Ask the customer for their email address.";
}
```

Anthropic calls this "prompt-engineering your error responses." It's the runtime equivalent of the poka-yoke principle from manufacturing: making the wrong path visibly wrong and the correct path obvious.

---

## The Poka-Yoke Principle

Poka-yoke (mistake-proofing) is a lean manufacturing concept: redesign the interface so errors are impossible or immediately visible, rather than adding checks after the fact.

Anthropic's most concrete example of poka-yoke applied to tools:

> "We found that the model would make mistakes with tools using relative filepaths after the agent had moved out of the root directory. To fix this, we changed the tool to always require absolute filepaths — and we found that the model used this method flawlessly."

The fix wasn't a system prompt instruction ("always use absolute paths"). The fix was renaming the parameter from `path` to `absolute_path` — the name itself enforced the constraint.

The same principle applies everywhere:

- `customer` → `customer_email` (enforces type)
- `amount` with description "do not include currency symbol" → prevents `$89.99`
- `order_id` with description "starts with ORD-" → prevents UUIDs or names

---

## Running the Demo

```bash
# Strong descriptions (default)
pnpm dev:tool-descriptions

# Weak descriptions (for comparison)
pnpm dev:tool-descriptions:weak
```

Try the same prompt in both modes:

```
"I want a refund for customer John Smith on order ORD-001"
```

**Weak mode:** The model passes `"John Smith"` to `search_orders`. The tool returns an error. The model may hallucinate a fix or fail to recover.

**Strong mode:** The model knows `customer_email` requires an email. It either asks for it, or looks it up via `get_order_details` using the order ID.

Other revealing prompts:

- `"Give me a refund on ORD-001"` — does it call `get_order_details` first?
- `"I already got a refund on ORD-002, but I want another"` — does it avoid calling `issue_refund`?
- `"I just have a quick question about ORD-003"` — does it avoid `escalate_to_human`?

---

## Running the Evals

```bash
pnpm eval
```

The evals run each of the 4 failure scenarios against both tool sets. Look for the "Weak" vs "Strong" pairs in the evalite UI. The score difference is the argument for spending time on descriptions.

| Scenario         | What weak descriptions get wrong                   |
| ---------------- | -------------------------------------------------- |
| Param ambiguity  | Passes customer name instead of email              |
| Call order       | Skips `get_order_details` before `issue_refund`    |
| Already refunded | Calls `issue_refund` on a refunded order           |
| Over-escalation  | Triggers `escalate_to_human` for a simple question |

---

## In Production Frameworks: Zod

In this repo we define tools as raw JSON Schema objects. In production TypeScript projects you'll often see Zod instead — it's a schema validation library that lets you write the same definition with type inference built in.

The strong `get_order_details` tool from this demo, written with Zod:

```ts
import { z } from "zod";
import { tool } from "ai"; // Vercel AI SDK

const getOrderDetails = tool({
  description:
    "Fetches full details for a specific order by its ID. " +
    "Always call this BEFORE issue_refund or escalate_to_human.",
  parameters: z.object({
    order_id: z.string().describe("The order ID, e.g. ORD-001. Must start with 'ORD-'."),
  }),
  execute: async ({ order_id }) => {
    // order_id is typed as `string` — no casting needed
    return getOrder(order_id);
  },
});
```

The AI SDK converts the Zod schema to JSON Schema before sending it to the model — the model sees exactly the same thing either way. Zod's advantages are TypeScript type inference in `execute` (no `args as Record<string, string>`) and runtime validation of the model's arguments before your function runs.

This repo uses raw JSON Schema to keep the structure visible — you can see exactly what gets sent to the model. If you're building with the Vercel AI SDK, Zod is the idiomatic choice and all the description engineering techniques here apply identically: parameter names, when-not-to-use clauses, inline format examples. Just write them in `.describe()` calls instead of `description:` fields.

One gotcha: `.describe()` must be the **last** method in a Zod chain or the description is silently dropped from the emitted JSON Schema:

```ts
z.string().min(1).describe("Order ID"); // ✅ description included
z.string().describe("Order ID").min(1); // ❌ description dropped silently
```

---

## What NOT to Do

Some anti-patterns that compound rather than solve description problems:

**Don't stuff examples into descriptions** (OpenAI's guidance): if a tool is complex enough to need usage examples, put them in the system prompt as an `# Examples` section. Keep the description field itself concise. Bloated descriptions increase token usage and can obscure the key information.

**Don't over-expose parameters.** If your code already knows a value (say, an `order_id` retrieved in a previous step), don't make the model re-specify it as a parameter. Pass it in code. The model filling in values it already retrieved is unnecessary work and a source of drift:

```ts
// Anti-pattern: model must repeat order_id it already retrieved
issue_refund({ order_id, amount, reason });

// Better (when context allows): no order_id param, pass it in the executor
submit_refund({ amount, reason }); // order_id threaded through code
```

**Don't use overlapping tool names** without disambiguation lines. Research confirms that editing just a tool's description — without changing its functionality — significantly shifts which tool gets chosen when two tools compete. If you have two similar tools, both descriptions need an explicit "use X for A, use Y for B" line.

---

## Key Takeaways

- **The description is a behavioral input, not documentation.** It directly controls tool selection and argument construction. Treat it with the same care as the system prompt.

- **Parameter names encode type and role.** `customer_email` not `customer`. `order_id` not `id`. `days_since_purchase` not `days`. The name tells the model what to put there before the description is even read.

- **"When NOT to use" clauses prevent over-calling.** Especially for tools with similar signatures or powerful side effects. Either in the description or the system prompt — both work; pick one approach and be consistent.

- **Error messages are runtime tool documentation.** Make them actionable: show the expected format, state what was wrong, suggest the fix. The model reads errors the same way it reads descriptions.

- **Measure the difference.** Intuition about what makes a better description is unreliable. Run evals against both versions. The score diff is the only objective signal.

---

## Further Reading

- [Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents) — Anthropic, 2025 — the primary source; covers ACI, parameter naming, return value design, and error messages
- [Building Effective Agents — Appendix 2: Prompt Engineering Your Tools](https://www.anthropic.com/research/building-effective-agents) — Anthropic, 2024 — the poka-yoke principle and the "junior developer" mental model
- [SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering](https://arxiv.org/abs/2405.15793) — Yang et al., NeurIPS 2024 — the paper that formalized ACI and achieved 12.5% pass@1 on SWE-bench
- [Few-shot prompting to improve tool-calling performance](https://blog.langchain.com/few-shot-prompting-to-improve-tool-calling-performance/) — LangChain, 2024 — the 11% → 75% accuracy result for Claude Haiku
- [OpenAI Function Calling Guide](https://platform.openai.com/docs/guides/function-calling) — the "intern test" heuristic and when-not-to-use placement guidance
