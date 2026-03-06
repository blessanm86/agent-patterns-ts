# Ordered Precondition Evaluation

> A Tier 5 pattern that upgrades trajectory evals from "did the agent call the right tools?" to "did it call them in a logically valid order?" This post builds a stateful simulation harness that catches reasoning failures simple presence-checking misses entirely.

---

## Your Trajectory Eval Has a Blind Spot

You wrote your first trajectory eval. It checks that the agent called `search_orders`, `get_order_details`, and `check_shipping_status`. All three tools present? Score: 1.0. Ship it.

But the agent called `get_order_details` _before_ `search_orders`. It guessed an order ID instead of discovering it through search. In your test environment it worked — the mock data happened to contain that ID. In production, with real customers and real order databases, it would fail on every novel input.

Presence-based evaluation didn't catch this because it asks the wrong question. "Were the right tools called?" is necessary but not sufficient. The real question is: **"Were they called in a logically valid sequence?"**

That's what ordered precondition evaluation solves.

---

## The Core Idea: A State Machine Over Tool Calls

The pattern is simple. Instead of checking tool names against a list, you maintain a **simulation state** — a set of boolean flags representing what the agent has accomplished so far. Each tool has:

- **Preconditions:** flags that must be `true` before the call is valid
- **Postconditions:** flags to set after the call executes

```
                    ┌─────────────┐
                    │  State: {}  │  (empty — nothing done yet)
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │search_orders│  preconditions: none
                    └──────┬──────┘  postconditions: [orders_searched]
                           │
              ┌────────────▼────────────┐
              │  State: {               │
              │    orders_searched: true │
              │  }                      │
              └────────────┬────────────┘
                           │
                   ┌───────▼────────┐
                   │get_order_details│  preconditions: [orders_searched]
                   └───────┬────────┘  postconditions: [order_details_retrieved]
                           │
         ┌─────────────────▼───────────────────┐
         │  State: {                            │
         │    orders_searched: true,            │
         │    order_details_retrieved: true     │
         │  }                                   │
         └──────────┬───────────────┬───────────┘
                    │               │
       ┌────────────▼──┐    ┌──────▼────────┐
       │check_shipping │    │process_refund │
       │_status        │    │               │
       └───────────────┘    └───────────────┘
       pre: [order_        pre: [order_
             details_            details_
             retrieved]          retrieved]
```

When the agent calls a tool, the harness checks: are this tool's preconditions satisfied in the current state? If yes, the call is **valid** — score it. If no, the call is an **ordering violation** — flag it.

This is the [QuickCheck state machine pattern](https://propertesting.com/book_state_machine_properties.html) applied to agent evaluation: preconditions filter invalid actions, postconditions update state, and the harness records everything for scoring.

---

## The Simulation Harness

The star of this demo is `simulation.ts`. It creates an executor that wraps every tool call with precondition checking:

```typescript
// simulation.ts — the core pattern
export function createSimulationExecutor(
  rules: Record<string, ToolSimulationRule>,
  expectedTools: string[],
): { executor: ToolExecutorFn; getReport: () => SimulationReport } {
  const state: Record<string, boolean> = {};
  const calls: RecordedCall[] = [];

  const executor: ToolExecutorFn = (name, args) => {
    const rule = rules[name];

    // Check preconditions against current state
    const violated = rule.preconditions.filter((pre) => !state[pre.flag]);

    const valid = violated.length === 0;

    // Record this call with its validity
    calls.push({ tool: name, args, valid /* ... */ });

    // Update state — always, so the agent can continue
    for (const flag of rule.postconditions) {
      state[flag] = true;
    }

    return rule.mockResponse(args);
  };

  // After the run, get the full analysis
  const getReport = (): SimulationReport => {
    /* ... */
  };

  return { executor, getReport };
}
```

Three important design decisions:

**1. The harness always returns a response.** Even when preconditions are violated, the mock response is returned so the agent can continue its run. The harness records the violation but doesn't interrupt execution. This means you get the full trajectory for analysis, not just the first failure.

**2. State updates happen even for invalid calls.** If the agent calls `get_order_details` without first searching, the harness flags the violation but still sets `order_details_retrieved = true`. This prevents cascading false violations — a single out-of-order call shouldn't make every subsequent call invalid.

**3. Rules are declarative and composable.** Each tool's simulation rule is a plain object with preconditions, postconditions, and a mock response factory. You define the dependency graph once and the harness does the rest.

---

## Defining Precondition Rules

The dependency graph for our e-commerce demo:

```typescript
// simulation.ts
export function createOrderInvestigationRules(): Record<string, ToolSimulationRule> {
  return {
    search_orders: {
      preconditions: [], // Entry point — no prerequisites
      postconditions: ["orders_searched"],
      mockResponse: () =>
        JSON.stringify({
          found: true,
          orders: [{ orderId: "ORD-1001", status: "shipped" }],
        }),
    },
    get_order_details: {
      preconditions: [
        { flag: "orders_searched", description: "Must search before getting details" },
      ],
      postconditions: ["order_details_retrieved"],
      mockResponse: (args) =>
        JSON.stringify({
          orderId: args.order_id,
          customerName: "Alice Chen" /* ... */,
        }),
    },
    check_shipping_status: {
      preconditions: [
        {
          flag: "order_details_retrieved",
          description: "Must get details before checking shipping",
        },
      ],
      postconditions: ["shipping_checked"],
      mockResponse: (args) =>
        JSON.stringify({
          orderId: args.order_id,
          carrier: "FedEx",
          status: "in_transit",
        }),
    },
    process_refund: {
      preconditions: [
        {
          flag: "order_details_retrieved",
          description: "Must get details before processing refund",
        },
      ],
      postconditions: ["refund_processed"],
      mockResponse: (args) =>
        JSON.stringify({
          success: true,
          refundId: "REF-SIM-001",
          amount: 115.97,
        }),
    },
  };
}
```

Each rule is self-documenting. The `description` field in preconditions appears in the simulation report when violations occur — you don't just know _that_ a violation happened, you know _why_.

---

## Scoring: Precision and Recall

The simulation report includes two key metrics:

**Precision** = valid calls / total calls

> "Of all the tool calls the agent made, what fraction respected preconditions?"

An agent that calls the right tools in the right order with no extras scores 1.0. An agent that adds an out-of-order call or an unknown tool drops below 1.0.

**Recall** = valid expected tools / total expected tools

> "Of all the tools we expected the agent to call, what fraction were called with preconditions satisfied?"

An agent that skips a required step has recall < 1.0. An agent that calls all expected tools in order has recall = 1.0.

Together, these two metrics tell you different things:

| Scenario                           | Precision | Recall | What happened                                            |
| ---------------------------------- | --------- | ------ | -------------------------------------------------------- |
| Perfect run                        | 1.0       | 1.0    | All tools called in correct order                        |
| Skipped search, rest correct       | 0.5       | 0.67   | `get_order_details` flagged as invalid                   |
| Correct order + extra unknown tool | 0.75      | 1.0    | Unknown tool penalized, but all expected steps completed |
| Jumped straight to refund          | 0.0       | 0.33   | Only refund called, and it violated preconditions        |

---

## The Eval: Presence vs. Precondition

The first eval file (`1-precondition-order.eval.ts`) makes the key comparison explicit. The same agent run is scored both ways:

```typescript
evalite("Precondition — shipping inquiry (full chain)", {
  task: async (input) => {
    const expectedTools = ["search_orders", "get_order_details", "check_shipping_status"];
    const rules = createOrderInvestigationRules();
    const { executor, getReport } = createSimulationExecutor(rules, expectedTools);

    const history = await runOrderAgent(input, [], { executorFn: executor });
    const toolNames = extractToolCallNames(history);
    const report = getReport();

    return { toolNames, report };
  },
  scorers: [
    // Presence-based: did it call all three tools? (the old way)
    createScorer({
      name: "Presence — all tools called",
      scorer: ({ output }) =>
        ["search_orders", "get_order_details", "check_shipping_status"].every((t) =>
          output.toolNames.includes(t),
        )
          ? 1
          : 0,
    }),

    // Precondition-based: were all calls valid? (the new way)
    createScorer({
      name: "Precondition — all calls valid",
      scorer: ({ output }) => (output.report.invalidCalls === 0 ? 1 : 0),
    }),

    // Continuous scores for finer-grained feedback
    createScorer({
      name: "Precondition — precision",
      scorer: ({ output }) => output.report.precision,
    }),
    createScorer({
      name: "Precondition — recall",
      scorer: ({ output }) => output.report.recall,
    }),
  ],
});
```

An agent that calls all three tools but in the wrong order would score:

- Presence: **1.0** (all tools present)
- Precondition: **0.0** (ordering violated)

That's the blind spot this pattern catches.

---

## Testing the Harness Itself

The second eval file (`2-violation-detection.eval.ts`) does something different — it tests the _simulation harness_, not the _agent_. By calling the executor directly with known sequences (no LLM involved), we get deterministic tests:

```typescript
function simulateSequence(
  toolCalls: Array<{ tool: string; args: Record<string, string> }>,
  expectedTools: string[],
): SimulationReport {
  const rules = createOrderInvestigationRules();
  const { executor, getReport } = createSimulationExecutor(rules, expectedTools);

  for (const call of toolCalls) {
    executor(call.tool, call.args);
  }

  return getReport();
}

// Test: skipping search_orders should flag get_order_details
const report = simulateSequence(
  [
    { tool: "get_order_details", args: { order_id: "ORD-1001" } }, // No search first!
    { tool: "check_shipping_status", args: { order_id: "ORD-1001" } },
  ],
  ["search_orders", "get_order_details", "check_shipping_status"],
);
// report.precision < 1.0  (get_order_details was invalid)
// report.recall < 1.0     (search_orders never called)
// report.violations[0].description === "Must search for orders before getting details"
```

Why test the harness? A precondition evaluator that can't detect violations is worse than no evaluator — it gives false confidence. These deterministic tests verify:

1. Correct order scores 100% precision and recall
2. Skipping search flags `get_order_details` as invalid
3. Jumping straight to refund flags the violation and shows low recall
4. Extra unknown tools reduce precision without affecting recall

---

## The Trajectory vs. Outcome Debate

Not everyone agrees that checking tool ordering is the right approach.

**Anthropic's position** leans toward outcome evaluation: "Grade what the agent produced, not the path it took." They warn that strict trajectory checking creates brittle tests because agents regularly find valid alternative paths that eval designers didn't anticipate.

**OpenAI's position** is more nuanced. For well-defined tasks, they recommend explicitly outlining tool call sequences and even suggest combining tools that are always called together. They evaluate at multiple layers: reasoning, action, execution.

**The emerging consensus** is a layered approach:

1. Always check outcomes (did the final state match expectations?)
2. Layer in ordering checks only where preconditions are **genuinely required** — authentication before data access, search before booking, read before edit
3. Use the loosest matching mode that catches real errors

This demo sits in category 2: the dependency between "search for orders" and "get order details" is a genuine precondition, not a stylistic preference. An agent that gets order details without searching first is reasoning incorrectly, even if it happens to produce the right output with test data.

---

## Where Eval Frameworks Stand

The major eval frameworks have converged on similar approaches to tool ordering, though with different APIs:

| Framework                                                                           | Ordering Support                            | Score Type         | Default  |
| ----------------------------------------------------------------------------------- | ------------------------------------------- | ------------------ | -------- |
| [LangChain AgentEvals](https://github.com/langchain-ai/agentevals)                  | `strict`, `unordered`, `subset`, `superset` | Boolean            | `strict` |
| [DeepEval](https://deepeval.com/docs/metrics-tool-correctness)                      | `should_consider_ordering` flag             | 0.0-1.0 ratio      | `False`  |
| [Ragas](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/agents/) | `strict_order` flag                         | 0.0-1.0            | `True`   |
| [Braintrust](https://www.braintrust.dev/articles/ai-agent-evaluation-framework)     | Execution path validity                     | Deterministic      | N/A      |
| Our harness                                                                         | Precondition state machine                  | Precision + Recall | Strict   |

Notice the split: LangChain and Ragas default to strict ordering, while DeepEval defaults to unordered. This reflects the tension between catching ordering bugs and avoiding brittle tests. Our approach sidesteps this by using **preconditions** instead of **sequence matching** — the harness doesn't care about the exact position of each call, only that its prerequisites were met.

---

## In the Wild: Coding Agent Harnesses

Ordered precondition enforcement is arguably the most universal pattern in production coding agents. Every harness that edits files must solve the same problem: the agent needs to understand a file before modifying it. How they enforce this varies dramatically.

**Claude Code and OpenCode use hard tool gates** — the strictest enforcement. Claude Code's Edit tool returns `"File has not been read yet. Read it first before writing to it."` if you attempt an edit without a prior Read. The harness tracks which files have been read in the current session as a per-file boolean flag. OpenCode does the same with timestamp-based validation — checking whether a read operation occurred for that file path before allowing writes. The tradeoff is real: [GitHub issue #16546](https://github.com/anthropics/claude-code/issues/16546) on Claude Code reports that "every Claude Code user is affected by this on nearly every session" — the model frequently attempts edits without reading first, receives the hard error, reads, then retries, wasting tokens and adding latency. This is exactly the pattern our simulation harness models: a boolean flag (`orders_searched`) that must be true before the next step is valid.

**OpenCode surfaced a fascinating failure mode: models gaming preconditions.** [Issue #1348](https://github.com/sst/opencode/issues/1348) documented Claude reading only the first 5 lines of a file (`limit=5`) to technically satisfy the read requirement without actually understanding the content. This shows that preconditions need to be semantically meaningful, not just procedurally checked — a lesson for anyone building evaluation harnesses. A tool call that satisfies preconditions in form but not in substance is a more subtle failure than outright ordering violations.

**Cline takes state tracking further** with a `FileContextTracker` class that maintains per-file metadata: when Cline last read the file, when it last edited it, and when the _user_ last edited it. When external modifications are detected (user edits outside Cline), the system injects a critical alert: _"N files have been externally modified since your last interaction. Your cached understanding of these files is now stale and unreliable."_ All write operations flow through a single `DiffViewProvider` bottleneck that enforces a lifecycle: `open()` (read baseline + capture pre-edit diagnostics) → `update()` (stream content) → `saveChanges()`. Out-of-order calls fail naturally because the provider hasn't been initialized.

**Cursor and Roo Code rely on prompt-level enforcement** — softer but more flexible. Cursor's system prompt instructs: _"Unless you are appending some small easy to apply edit, you MUST read the contents of what you're editing before editing it."_ Roo Code goes further with an explicit search ordering rule: _"ALWAYS use the `codebase_search` tool FIRST before using search_files or other file exploration tools"_ — establishing a mandatory discovery hierarchy before any file interaction. Both also enforce one-tool-per-turn, which naturally creates sequential ordering with human validation between steps.

**Manus represents the theoretical ceiling** with a context-aware state machine that constrains tool selection through **logit masking** at decode time. Rather than removing tools from the prompt (which breaks KV-cache), the system prevents specific action tokens from being generated based on the current state. The model literally cannot select tools that violate preconditions because those tokens are masked during generation. This is the most sophisticated enforcement mechanism — preconditions are woven into the decoding process itself.

The enforcement spectrum across harnesses maps cleanly to our simulation model:

| Mechanism                                    | Harnesses                 | Our Equivalent                            |
| -------------------------------------------- | ------------------------- | ----------------------------------------- |
| Hard tool gate (refuses execution)           | Claude Code, OpenCode     | `valid: false` + violation logged         |
| Lifecycle bottleneck (single write provider) | Cline                     | Postcondition flags gate downstream calls |
| Logit masking (decode-time constraint)       | Manus                     | State machine controls available actions  |
| Prompt instruction ("must read first")       | Cursor, Copilot, Roo Code | System prompt + eval verification         |

Our simulation harness evaluates from the outside what these harnesses enforce from the inside. The same precondition state machine that Claude Code uses to reject edits at runtime, we use to score whether an agent _would have_ violated those preconditions — without interrupting the run.

---

## Running the Demo

```bash
# Prerequisites
ollama pull qwen2.5:7b

# Interactive CLI with simulation reports
pnpm dev:ordered-precondition-eval

# Run the evals
pnpm eval src/ordered-precondition-eval/evals/1-precondition-order.eval.ts
pnpm eval src/ordered-precondition-eval/evals/2-violation-detection.eval.ts
```

The CLI shows a simulation report after each agent turn:

```
You: Hi, I'm Alice Chen. Where is my order?

Agent: Let me look that up for you...

┌─ Simulation Report ─────────────────────────────────────┐
│  Tools called: search_orders → get_order_details → check_shipping_status
│  Total: 3  Valid: 3  Invalid: 0
│  Precision: 100%  Recall: 100%
└─────────────────────────────────────────────────────────┘
```

---

## Key Takeaways

- **Presence-based trajectory evals have a blind spot.** They check _which_ tools were called but not _whether the ordering was logically valid_. An agent that calls tools out of order can score 100% on presence checks.

- **A state machine over boolean flags catches ordering violations.** Define preconditions (what must be true before a call) and postconditions (what becomes true after). The simulation harness checks preconditions on every intercepted call and records violations.

- **Score with precision and recall, not binary pass/fail.** Precision catches out-of-order calls. Recall catches skipped steps. Together they give you a complete picture of the agent's reasoning quality.

- **Use preconditions, not sequence matching.** Strict sequence matching is brittle — it rejects valid alternative paths. Precondition checking is more flexible: it only requires that prerequisites are met, not that calls happen in a specific position.

- **Test the harness itself.** A precondition evaluator that can't detect violations gives false confidence. Use deterministic simulations (no LLM) to verify the harness catches the violations it should.

- **Layer ordering checks on top of outcome checks.** Outcome evaluation is the primary metric. Precondition evaluation is diagnostic — it tells you _why_ the outcome was wrong, not just _that_ it was wrong.

---

## Sources & Further Reading

- [tau-bench (arXiv:2406.12045)](https://arxiv.org/abs/2406.12045) -- stateful task evaluation comparing database state against annotated goals
- [TPS-Bench (arXiv:2511.01527)](https://arxiv.org/abs/2511.01527) -- evaluates tool planning with strict dependency chains
- [TRAJECT-Bench (arXiv:2510.04550)](https://arxiv.org/abs/2510.04550) -- trajectory-level metrics for tool selection, arguments, and dependency satisfaction
- [AgentBench (ICLR 2024)](https://github.com/THUDM/AgentBench) -- multi-environment stateful benchmark
- [DiGiT-TC (arXiv:2601.19914)](https://arxiv.org/abs/2601.19914) -- ordered dependency tracking in simulation without a live backend
- [Anthropic -- Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) -- outcome-first eval guidance
- [OpenAI -- Testing Agent Skills Systematically](https://developers.openai.com/blog/eval-skills/) -- process goals and tool ordering
- [LangChain AgentEvals](https://github.com/langchain-ai/agentevals) -- trajectory match evaluator with strict/unordered modes
- [DeepEval -- Tool Correctness](https://deepeval.com/docs/metrics-tool-correctness) -- `should_consider_ordering` flag
- [Ragas -- Agent Metrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/agents/) -- `ToolCallAccuracy` with strict_order
- [Property Testing -- State Machine Properties](https://propertesting.com/book_state_machine_properties.html) -- the QuickCheck pattern this harness is based on

---

[Agent Patterns -- TypeScript](../../README.md) | Builds on: [Evaluation with Mocked Tools](../evaluation-patterns/README.md)
