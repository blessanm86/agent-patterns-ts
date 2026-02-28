# One Tool Call to Rule Them All — Declarative Plan Execution for AI Agents

[Agent Patterns — TypeScript](../../README.md) · Concept 21

> **Previous concept:** [Cost Tracking & Model Tier Selection](../cost-tracking/README.md) — routing requests to the cheapest model that can handle them. This concept tackles a different kind of cost: the unnecessary LLM round-trips between tool calls when the agent already knows the full sequence it needs.

---

Your monitoring agent needs to check if CPU usage is above 80%. Simple, right? Three steps: list the metrics, query CPU, check the threshold. But watch what happens with a standard ReAct loop:

```
User: "List compute metrics, query CPU usage, and check if it's above 80%"

┌─ ReAct Loop ───────────────────────────────────────────────┐
│                                                             │
│  LLM call #1: "I'll list the compute metrics first."       │
│  → tool call: list_metrics(category="compute")              │
│  → result: [cpu_usage, memory_usage]                        │
│                                                             │
│  LLM call #2: "Now I'll query cpu_usage."                  │
│  → tool call: query_metric(name="cpu_usage")                │
│  → result: { current: 72.5, ... }                           │
│                                                             │
│  LLM call #3: "Let me check if 72.5 > 80."                │
│  → tool call: check_threshold(metric="cpu_usage",           │
│                                threshold=80, op="gt")       │
│  → result: { exceeded: false }                              │
│                                                             │
│  LLM call #4: "CPU usage is 72.5%, below the 80%           │
│                threshold."                                  │
│                                                             │
│  Total: 4 LLM calls, 3 tool calls                          │
└─────────────────────────────────────────────────────────────┘
```

Four LLM calls for a sequence the agent could have planned in one shot. LLM calls #2 and #3 are pure overhead — the model isn't making decisions, it's just relaying data from step N to step N+1. The "reasoning" between steps is "now I'll do the obvious next thing."

This is the **round-trip tax**: every intermediate LLM call adds latency (often 500ms–2s for local models, more for cloud APIs) and burns tokens restating what it already knows.

## The Insight: Plans as Data, Not Conversations

The key observation from the ReWOO paper (Xu et al., 2023): when the agent already knows the full sequence, you can decouple planning from execution entirely. The LLM emits a declarative plan — a data structure — and a deterministic runtime executes it.

The innovation over basic Plan+Execute (which this repo already covers in [`src/plan-execute/`](../plan-execute/README.md)) is **cross-step data references**. In the trip planner, all steps are independent — search flights, search hotels, find restaurants. But in the monitoring scenario above, step 2 depends on step 1's output. The `$ref` syntax makes this dependency explicit:

```json
{
  "goal": "Check if CPU usage exceeds 80%",
  "steps": [
    {
      "tool": "list_metrics",
      "args": { "category": "compute" },
      "description": "Get available compute metrics"
    },
    {
      "tool": "query_metric",
      "args": { "name": { "$ref": "steps[0].result.metrics[0].name" } },
      "description": "Query the first compute metric"
    },
    {
      "tool": "check_threshold",
      "args": {
        "metric_name": { "$ref": "steps[0].result.metrics[0].name" },
        "threshold": "80",
        "operator": "gt"
      },
      "description": "Check if above 80%"
    }
  ]
}
```

The `$ref` placeholders are resolved at runtime by a deterministic executor — no LLM needed between steps.

```
┌─ Declarative Plan Execution ──────────────────────────────┐
│                                                            │
│  LLM call #1: emit plan with $ref placeholders             │
│  → execute_plan({plan: "..."})                             │
│                                                            │
│    Runtime resolves $ref, runs all 3 tools:                │
│      Step 1: list_metrics → [cpu_usage, memory_usage]      │
│      Step 2: query_metric(name="cpu_usage") → 72.5%        │
│      Step 3: check_threshold(72.5 > 80) → false            │
│                                                            │
│  LLM call #2: "CPU usage is 72.5%, below threshold."      │
│                                                            │
│  Total: 2 LLM calls, 1 meta-tool call (3 steps inside)    │
└────────────────────────────────────────────────────────────┘
```

Two LLM calls instead of four. The savings grow with chain length — a 5-step chain drops from 6 LLM calls to 2.

## The Pattern: `execute_plan` as a Meta-Tool

The `execute_plan` tool is a meta-tool — a tool whose job is to run other tools. The LLM sees it alongside the regular domain tools and chooses when to use it:

```typescript
// tools.ts — the meta-tool definition
export const executePlanTool: ToolDefinition = {
  type: "function",
  function: {
    name: "execute_plan",
    description: `Execute a multi-step plan in a single call...`,
    parameters: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description: "The full plan as a JSON string",
        },
      },
      required: ["plan"],
    },
  },
};
```

The plan is passed as a JSON string (not a nested object) because Ollama models handle flat string parameters more reliably than deeply nested schemas.

When the agent runs in `"individual"` mode, the meta-tool is simply excluded from the tool list — the LLM only sees the three domain tools and must call them one at a time through the normal ReAct loop.

## `$ref` Resolution: The Core Innovation

The reference resolver walks a JSONPath-like string against collected step results:

```typescript
// executor.ts
export function resolveRef(ref: string, stepResults: StepResult[]): string {
  // Parse: "steps[0].result.metrics[2].name" → index=0, path="metrics[2].name"
  const rootMatch = ref.match(/^steps\[(\d+)\]\.result\.(.+)$/);
  const stepIndex = parseInt(rootMatch[1], 10);
  const path = rootMatch[2];

  // Walk the dot-path with array index support
  const segments = path.split(".");
  let current: unknown = stepResults[stepIndex].result;

  for (const segment of segments) {
    const arrayMatch = segment.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      current = (current as Record<string, unknown>)[arrayMatch[1]];
      current = (current as unknown[])[parseInt(arrayMatch[2], 10)];
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }

  return typeof current === "string" ? current : JSON.stringify(current);
}
```

The path `steps[0].result.metrics[0].name` means: take step 0's result, access its `.metrics` array, grab index 0, and read the `.name` field. The resolved string becomes a regular tool argument — the downstream tool never knows it came from a reference.

## Validation: Catching Bad Plans Before Execution

The LLM might produce invalid plans — wrong tool names, forward references, malformed JSON. Zod schemas with `.refine()` catch these before any tool runs:

```typescript
// executor.ts
const DeclarativePlanSchema = z
  .object({
    goal: z.string(),
    steps: z.array(PlanStepSchema),
  })
  .refine(
    // All tool names must be in the allowed set
    (plan) => plan.steps.every((step) => ALLOWED_TOOL_NAMES.includes(step.tool)),
    (plan) => {
      const bad = plan.steps.filter((s) => !ALLOWED_TOOL_NAMES.includes(s.tool));
      return { message: `Unknown tools: ${bad.map((s) => s.tool).join(", ")}` };
    },
  )
  .refine(
    // $ref indices can only reference earlier steps
    (plan) => {
      for (let i = 0; i < plan.steps.length; i++) {
        for (const val of Object.values(plan.steps[i].args)) {
          if (typeof val === "object" && "$ref" in val) {
            const match = val.$ref.match(/^steps\[(\d+)\]/);
            if (match && parseInt(match[1], 10) >= i) return false;
          }
        }
      }
      return true;
    },
    { message: "Forward references not allowed" },
  );
```

Two invariants enforced:

1. **Tool allowlist** — the plan can only reference tools the executor knows how to dispatch
2. **No forward references** — step N can only reference steps 0..N-1 (no cycles, no crystal balls)

If validation fails, the error message goes back to the LLM as a tool result, giving it a chance to correct the plan.

## Dual Return: Summary for LLM, Artifact for UI

When the plan executes, two things come back:

1. **Summary string** → pushed into messages as the tool result (what the LLM sees)
2. **PlanArtifact** → stored separately (what the UI renders)

```typescript
// agent.ts — after plan execution
const summary = artifact.steps.map((s, i) => `Step ${i + 1} (${s.tool}): ${s.summary}`).join("\n");

// LLM gets the concise summary
messages.push({
  role: "tool",
  content: `Plan executed: ${artifact.stepsSucceeded}/${artifact.steps.length} succeeded.\n${summary}`,
});

// UI gets the full artifact with resolved args, timing, raw results
return { messages, artifact };
```

This follows the [Dual Return Pattern](../dual-return/README.md) — the LLM doesn't need the raw time-series data or per-step timing to formulate a response. It just needs to know what happened.

## Running the Demo

```bash
# Declarative mode (default) — execute_plan meta-tool available
pnpm dev:declarative-plan

# Individual mode — tool-by-tool ReAct, no meta-tool
pnpm dev:declarative-plan:individual
```

Try: `"List all compute metrics, query CPU usage, and check if it's above 80%"`

In declarative mode, watch for the plan artifact box showing resolved args and per-step timing. In individual mode, count the LLM calls — you'll see more round-trips for the same result.

## When to Use This Pattern

**Good fit:**

- Discover-then-query chains where the output of step N feeds into step N+1
- Batch operations where you'd otherwise make N identical LLM calls to invoke N tools
- Latency-sensitive workflows where every LLM round-trip matters

**Bad fit:**

- Steps that require judgment between them ("if the error rate is high, check logs; if low, check latency")
- Single-step operations (the overhead of planning exceeds the overhead of just calling the tool)
- When the LLM doesn't know the full sequence upfront (exploration, debugging)

The key question: **does the LLM need to think between steps?** If yes, use ReAct. If no, use a declarative plan.

## Model Capability Requirements

The `$ref` object syntax is demanding. The LLM must:

1. Produce valid JSON inside a tool argument string
2. Use the `{ "$ref": "steps[N].result.path" }` syntax correctly
3. Get array indices and field names right based on expected (not seen) tool outputs

Larger models handle this well. Smaller models (7B parameters) may struggle — they might flatten the `$ref` into a string literal or get the path wrong. The system prompt includes a concrete example to help, but this is inherently a model capability floor. If your model can't reliably produce the `$ref` syntax, fall back to individual mode — the agent still works, just with more round-trips.

## Key Takeaways

1. **The round-trip tax is real.** Every intermediate LLM call in a predictable chain is pure waste — latency and tokens spent on "now I'll do the obvious next thing."

2. **`$ref` turns plans into pipelines.** Cross-step data references let the runtime resolve dependencies without LLM involvement. The LLM plans; the runtime executes.

3. **Validation is non-negotiable.** Zod `.refine()` catches bad tool names and forward references before any tool runs. Fail fast, fail clearly.

4. **The meta-tool is opt-in.** The LLM _chooses_ to use `execute_plan` — it's not forced. For simple queries, it can still call tools individually. The pattern adds capability without removing flexibility.

5. **Dual return keeps context lean.** The LLM gets a one-line summary per step; the UI gets the full artifact with resolved args, timing, and raw results.

## Sources & Further Reading

- [ReWOO: Decoupling Reasoning from Observations for Efficient Augmented Language Models](https://arxiv.org/abs/2305.18323) — Xu et al., 2023. Formalized the single declarative plan with `#E1`/`#E2` placeholder resolution.
- [An LLM Compiler for Parallel Function Calling](https://arxiv.org/abs/2312.04511) — Kim et al., ICML 2024. DAG of tasks with `$node_id` placeholder variables resolved by a Task Fetching Unit.
- [Plan-and-Solve Prompting](https://arxiv.org/abs/2305.04091) — Wang et al., ACL 2023. Academic origin of the plan-then-execute paradigm.
- [Plan-and-Execute Agents](https://blog.langchain.com/planning-agents/) — LangChain, 2024. Framework documentation of the Planner/Executor split.
- [Plan+Execute (this repo)](../plan-execute/README.md) — The predecessor pattern without cross-step references.
- [Dual Return Pattern (this repo)](../dual-return/README.md) — The summary-for-LLM, artifact-for-UI split used in this concept.
