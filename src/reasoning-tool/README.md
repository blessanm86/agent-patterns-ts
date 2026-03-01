# The Reasoning Tool Pattern

> Building on [Plan+Execute](../plan-execute/README.md) and [ReAct](../react/README.md) from [Agent Patterns — TypeScript](../../README.md)

---

## Why "think step by step" isn't enough

If you've added `"think step by step"` to a system prompt, you've already discovered its main limitation: the model might think step by step, or it might not. You can't tell from the outside. And when the chain of reasoning breaks down, you have no programmatic way to detect it.

Here's the second problem. Standard ReAct exits when the model makes no tool calls. That's an inference: "no tool call means the model is done." It's fragile. The model might be done, or it might have gotten confused. You're reading silence as a signal.

The reasoning tool pattern solves both problems with one idea: make the thinking explicit and structured by wrapping it in a tool call.

---

## The Core Idea

Create a tool called `think` — or `reasoning`, or anything you like — that has no side effects. It doesn't call an API, doesn't write to a database, doesn't do anything. It just accepts a structured argument and returns an acknowledgement string.

The minimal version (from Anthropic's implementation):

```ts
{
  name: "think",
  description: "Use this to reason before taking an action.",
  parameters: {
    type: "object",
    properties: {
      thought: { type: "string" }
    },
    required: ["thought"]
  }
}
```

Our extended version adds a typed exit signal:

```ts
{
  name: "think",
  description:
    "Use this BEFORE every other tool call. Set should_continue to 'false' " +
    "when you have enough information to give a final answer.",
  parameters: {
    type: "object",
    properties: {
      thought: { type: "string" },
      should_continue: {
        type: "string",
        enum: ["true", "false"]
      }
    },
    required: ["thought", "should_continue"]
  }
}
```

The model calls this tool like any other. The arguments end up in the message history, where they're visible and inspectable. And `should_continue: "false"` is a clean, typed signal that the agent is ready to give its final answer — no text parsing required.

---

## Two Exit Paths

Standard ReAct has one exit: model makes no tool calls. This loop has two:

```
while (true):
  response = model.chat(messages, tools: allTools)
  push assistantMessage

  ── Path 1 (fallback): no tool calls ──────────────────
  if no tool_calls → break

  ── Process all tool calls in this turn ───────────────
  readyToRespond = false

  for each toolCall:
    if name === "think":
      log thought
      push { role: "tool", content: "Thought recorded." }
      if should_continue === "false" → readyToRespond = true
    else:
      result = executeTool(name, args)
      push { role: "tool", content: result }

  ── Path 2 (primary): structured exit signal ──────────
  if readyToRespond:
    finalResponse = model.chat(messages)  // no tools param
    push finalResponse.message
    break
```

The key detail in Path 2: when `should_continue` is `"false"`, we don't break immediately. We finish processing any remaining tool calls in that turn, then make a final call with **no tools parameter**. This forces the model to produce a plain text response instead of another tool call.

Here's the implementation in `agent.ts`:

```ts
for (const toolCall of assistantMessage.tool_calls) {
  const { name, arguments: args } = toolCall.function;

  if (name === "think") {
    const thought = args.thought ?? "";
    const shouldContinue = args.should_continue;

    console.log(`\n  💭 Think: ${thought}`);

    messages.push({ role: "tool", content: "Thought recorded." });

    if (shouldContinue === "false") {
      readyToRespond = true;
    }
  } else {
    const result = executeTool(name, args);
    messages.push({ role: "tool", content: result });
  }
}

if (readyToRespond) {
  const finalResponse = await ollama.chat({
    model: MODEL,
    system: SYSTEM_PROMPT,
    messages,
    // No tools — forces plain text
  });
  messages.push(finalResponse.message);
  break;
}
```

---

## Two Benefits of Structured Reasoning

### 1. Visible in Message History

Every `think` call is a message in the conversation history with the full reasoning text. You can log it, store it, display it, search it. Compare this to a chain-of-thought in a system prompt instruction — you can only observe _that_ the model thought, not _what_ it thought.

This is valuable for debugging. If the agent makes a wrong decision, you can inspect exactly what it was thinking at each step:

```
💭 Think: The user wants a refund on ORD-001. I need to look up
   the order first before I can check whether it's eligible.

💭 Think: ORD-001 is a Laptop Stand for $89, purchased 13 days ago.
   Under 30 days, under $500 — this should be straightforward.
   Let me check the policy to confirm.

💭 Think: Policy confirms eligible, auto-approved. I'll process the
   refund now and set should_continue to false since I'm done.
```

That's a complete audit trail. Standard ReAct would show you the tool calls but not the reasoning connecting them.

### 2. Typed Exit Signal

In standard ReAct, you infer the agent is done from silence — no tool calls means it's responding. With the reasoning tool, the agent explicitly declares it's done:

```ts
{ thought: "I have all the information I need.", should_continue: "false" }
```

`should_continue === "false"` is a boolean check. You're not parsing "DONE" or "FINISHED" out of free text. This is more reliable and easier to test.

---

## Provider Comparison: Forcing Tool Use

In a production environment, you'd use `tool_choice` to guarantee the model calls `think` before anything else. Here's how every major provider handles it:

| Provider          | Force any tool                 | Force specific tool                                               |
| ----------------- | ------------------------------ | ----------------------------------------------------------------- |
| **Anthropic**     | `tool_choice: { type: "any" }` | `tool_choice: { type: "tool", name: "think" }`                    |
| **OpenAI**        | `tool_choice: "required"`      | `tool_choice: { type: "function", function: { name: "think" } }`  |
| **Gemini**        | `tool_config: { mode: "ANY" }` | `tool_config: { mode: "ANY", allowed_function_names: ["think"] }` |
| **Vercel AI SDK** | `toolChoice: "required"`       | `toolChoice: { type: "tool", toolName: "think" }`                 |
| **Ollama**        | ❌ Not supported               | ❌ Not supported                                                  |

With Anthropic, you'd add this to every chat call:

```ts
const response = await anthropic.messages.create({
  model: "claude-opus-4-6",
  tools,
  tool_choice: { type: "tool", name: "think" }, // guaranteed first call
  messages,
});
```

With OpenAI:

```ts
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  tools,
  tool_choice: { type: "function", function: { name: "think" } },
  messages,
});
```

---

## The Ollama Gotcha

Ollama does not implement `tool_choice`. This was a [deliberate decision](https://github.com/ollama/ollama/issues/4614) — the issue is closed as NOT_PLANNED.

This means the model is never _forced_ to call `think` first. It might call a real tool directly, or it might not call any tool and just respond with text. Our workaround is a strong system prompt:

```
IMPORTANT: You MUST call the "think" tool before every other tool call and before giving your final answer.
```

This works reasonably well with capable models like `qwen2.5:7b`. But it's best-effort:

- **What breaks:** The model may occasionally skip `think` and call `lookup_order` directly. Or it may think once but not think before processing the refund.
- **What doesn't break:** Correctness. If the model skips `think` but calls the right tools in the right order, the refund decision is still correct. The `think` calls are for visibility and structured exit, not for the logic itself.
- **Real fix:** Use the Anthropic or OpenAI API with `tool_choice` if you need guaranteed enforcement. The pattern is identical — just add the parameter.

Path 1 in the loop (break on no tool calls) handles the fallback case gracefully: if the model skips `think` entirely and responds in plain text, we still return correctly.

---

## The `should_continue` Pattern and Its Relatives

The `should_continue: boolean` field in `think` is one instance of a broader pattern: using an LLM tool call to signal control flow.

**This demo:** `should_continue: "false"` means "I'm ready to respond." The agent loop exits.

**MemGPT / Letta:** Uses the inverse — `request_heartbeat: true` means "keep going." The agent continues looping when it requests a heartbeat. Silence (no heartbeat) means done. This is well-suited to long-running memory management agents that need to decide whether to do more work.

**LangGraph:** `should_continue()` is a **conditional edge function** at the orchestration layer, not a tool argument. It reads the current graph state and returns a node name to route to. The LLM isn't involved — a Python function makes the routing decision based on what's in the state object.

**Anthropic's original think tool:** No exit signal at all — just `{ thought: string }`. The loop exits naturally when the model stops calling tools. This is simpler and works well in practice. Our `should_continue` extension adds explicit control for teaching purposes.

The common thread across all of these: control flow decisions are made structurally, not by parsing free text.

---

## When to Use This vs. Alternatives

### Use the reasoning tool when:

- **Policy decisions with multiple steps.** Refund eligibility, loan approval, content moderation — anywhere the agent needs to gather facts, apply rules, and make a structured decision. The reasoning tool ensures each step is explicit.

- **You need an audit trail.** If you need to answer "why did the agent do X?", the think tool gives you a record of the reasoning at each step. This matters for regulated industries.

- **Complex multi-tool flows.** If the correct order of tool calls isn't obvious from the conversation alone, forcing the model to reason before each call helps it plan.

### Skip it when:

- **Simple, single-tool tasks.** If the agent almost always calls exactly one tool and responds, adding think doubles the latency for minimal benefit.

- **Latency-sensitive applications.** Each think call is an additional tool invocation — the model has to generate arguments, you push them to history, the model reads them on the next iteration. For fast-path queries, this overhead matters.

- **Production on Anthropic/OpenAI.** Consider using built-in extended thinking (Anthropic) or `reasoning_effort` (OpenAI o-series models) instead. These are handled at the model level, have better integration, and don't require a fake tool.

### Anthropic's benchmarks

From Anthropic's evaluation of the think tool:

- **tau-bench airline:** 54% accuracy — a substantial improvement on a challenging multi-step task benchmark
- **SWE-bench verified:** +1.6% improvement in code repair tasks

The improvements are largest on tasks that require following complex, multi-step rules — exactly the use case this demo targets.

---

## Implementation Walkthrough

The agent in `agent.ts` follows this flow for a refund request on ORD-001:

**Turn 1:**

- Model calls `think` with `should_continue: "true"`: "The user wants a refund on ORD-001. I need to look up the order first."
- Model also calls `lookup_order("ORD-001")` in the same turn.
- We push both results and loop.

**Turn 2:**

- Model sees order details: Laptop Stand, $89, 13 days old.
- Model calls `think` with `should_continue: "true"`: "Order is 13 days old and under $500. Should be eligible. Let me check policy."
- Model calls `check_refund_policy(days: "13", amount: "89")`.
- We push results and loop.

**Turn 3:**

- Policy confirms: eligible, auto-approved.
- Model calls `think` with `should_continue: "true"`: "Policy says approve. I'll process the refund."
- Model calls `process_refund(order_id: "ORD-001", approved: "true", reason: "...")`.
- We push results and loop.

**Turn 4:**

- Model calls `think` with `should_continue: "false"`: "Refund processed. Ready to respond."
- `readyToRespond = true`.
- We finish the loop, make a final no-tools call, get plain text.
- Break.

The model never sees "what should I say?" — it's only making decisions at each step about what to do next. The final no-tools call is where it synthesizes all the results into a human response.

---

## Running the Demo

```bash
pnpm dev:reasoning-tool
```

Try these inputs:

- `"I want a refund on order ORD-001"` — auto-approved (13 days, $89)
- `"Can I get a refund for ORD-002?"` — denied (44 days, too old)
- `"Process a refund for ORD-003"` — auto-approved (3 days, $45)
- `"I'd like to return my order ORD-004"` — flagged for manager ($580)

Watch the `💭 Think:` lines in the console. You're seeing the model's reasoning at each step, captured structurally rather than inferred.

---

## In the Wild: Coding Agent Harnesses

The reasoning tool pattern — separating "thinking about what to do" from "doing it" — turns out to be one of the most consequential architectural decisions in production coding agents. Every major harness has independently converged on some version of this split, though they implement it in strikingly different ways.

**Aider's Architect/Editor split** is the clearest example, and it comes with measured results. In [architect mode](https://aider.chat/2024/09/26/architect.html), Aider routes the user's request to an "Architect" model (typically a strong reasoning model like o1-preview or DeepSeek R1) whose only job is to _describe_ the solution in natural language. The Architect never touches a file. Its output is then passed to an "Editor" model (like Claude Sonnet or o1-mini) that translates the description into properly formatted code edits. This separation pushed Aider's code editing benchmark from 79.7% to 85.0% — a +5.3 percentage point improvement — because each model can focus entirely on its strength. As the Aider team put it: "The Architect can focus on solving the coding problem and describe the solution however comes naturally to it. Similarly, the Editor can focus all of its attention on properly formatting the edits without needing to reason." The reasoning model reasons; the editing model edits. Neither wastes capacity on the other's job.

**Cursor takes the same principle into the edit application layer.** Their [Instant Apply](https://cursor.com/blog/instant-apply) architecture uses a powerful frontier model (like GPT-4o or Claude) to reason about what changes are needed through the chat interface — the planning phase. A separate, purpose-trained fast-apply model then takes those planned changes and writes them into the file at roughly 1,000 tokens per second on a 70B model, a 13x speedup over vanilla inference. The reasoning model never needs to produce syntactically perfect diffs. The apply model never needs to understand the problem. Cursor also supports a dedicated [Plan Mode](https://docs.cursor.com/guides/selecting-models) (Shift+Tab) where the agent creates an editable Markdown plan before writing any code, further separating the reasoning step from execution.

**Claude Code builds the pattern directly into the agent loop.** Its core architecture is a TAOR loop — Think, Act, Observe, Repeat — where the model reasons in a [thinking block](https://www.anthropic.com/engineering/claude-think-tool) before selecting tools. When using extended thinking, Claude Code allocates a configurable thinking budget (triggered by keywords like "think," "think hard," or "ultrathink") that scales the reasoning depth before any tool calls execute. The think tool and extended thinking serve different purposes in this context: the think tool is a structured scratchpad for analyzing tool outputs mid-chain, while extended thinking handles upfront deep reasoning before the response begins. Both enforce the same principle — reason first, then act — but at different points in the agent loop. Anthropic's benchmarks show this matters: the think tool alone improved tau-bench airline accuracy from 37.0% to 40.4%, and with an optimized prompt reached 58.4%.

The pattern shows up even in harnesses that don't make it explicit. **Windsurf** runs a planning agent concurrently alongside its execution agent — reasoning and acting happen in parallel rather than sequentially, but they're still separate processes with separate responsibilities. **Manus** uses its reasoning phase to decide between fundamentally different execution strategies (generating Python code vs. making structured tool calls), a higher-level version of the same separation.

What unifies all of these is the insight that reasoning and execution compete for the same cognitive budget. When a model must simultaneously figure out _what_ to do and produce _correctly formatted output_, both suffer. Every harness that separates these concerns — whether through two models, two phases, or an explicit thinking tool — sees measurable quality improvements. The reasoning tool pattern in this demo is the minimal version of that idea: a single no-op tool that carves out structured space for thinking before acting. Production harnesses scale it up, but the core mechanism is identical.

---

## Key Takeaways

- **The reasoning tool is a no-op that does real work.** It has no side effects, but it forces structured reasoning into the message history where you can inspect, log, and test it.

- **Structured exit beats text parsing.** `should_continue: "false"` is more reliable than looking for "DONE" or inferring completion from silence.

- **Ollama doesn't support `tool_choice`** — use system prompt instructions as a workaround, but expect occasional deviations with small models.

- **Every major provider has `tool_choice` support** — Anthropic, OpenAI, and Gemini all let you force a specific tool. The pattern is identical; just add the parameter.

- **Use it for complex, multi-step decisions.** For simple queries, the overhead isn't worth it. For policy evaluation, compliance checks, or anything with an audit requirement, the reasoning tool pays for itself.

---

## Further Reading

- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629) — Yao et al., 2022 — foundational paper establishing interleaved reasoning + actions
- [The "think" tool: Enabling Claude to stop and think](https://www.anthropic.com/engineering/claude-think-tool) — Anthropic, 2025 — describes this exact pattern with benchmarks (tau-bench, SWE-bench)
- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560) — Packer et al., 2023 — the `request_heartbeat` pattern for long-running agents
- [tau-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains](https://arxiv.org/abs/2406.12045) — Yao et al., 2024 — the benchmark Anthropic used to evaluate the think tool
