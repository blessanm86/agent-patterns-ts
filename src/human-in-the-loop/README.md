# Your Agent Shouldn't Delete Things Without Asking

[Agent Patterns — TypeScript](../../README.md) · Builds on [Guardrails & Circuit Breakers](../guardrails/README.md)

---

Imagine asking your project management agent to "clean up the backlog." It interprets that as "delete everything marked open" and wipes four tasks off the board in a single tool call. No confirmation, no undo, no audit trail.

The [guardrails demo](../guardrails/README.md) added circuit breakers that stop runaway agents — iteration limits, token budgets, timeouts. But those are about preventing the agent from _doing too much_. Human-in-the-loop is about preventing it from _doing the wrong thing_: pausing execution to ask a human before taking high-impact actions.

## The Spectrum of Control

Not every action needs human approval. Researchers and practitioners converge on a 5-level autonomy scale:

| Level | Name                           | Agent Behavior                             | Example                          |
| ----- | ------------------------------ | ------------------------------------------ | -------------------------------- |
| L1    | Human does, AI suggests        | Agent recommends, human executes           | "You could delete TASK-3"        |
| L2    | Human approves, AI executes    | Agent proposes, human confirms, agent acts | "Delete TASK-3? [y/n]"           |
| L3    | AI executes, human monitors    | Agent acts freely, human reviews after     | Auto-delete + audit log          |
| L4    | Full autonomy, exception-based | Agent acts, escalates only on edge cases   | Delete unless it's the last task |
| L5    | Full autonomy                  | Agent acts with no oversight               | Fully autonomous                 |

**L3 (Conditional Autonomy) is the production default** across the 30+ deployed agents analyzed in the 2025 AI Agent Index. L4+ remains rare for anything with real-world side effects.

This demo implements L2-L3 as a sliding scale: you choose how much the agent can do on its own using three approval modes.

## The Core Pattern: Post-Decision Interception

The architecture is one addition to the standard ReAct loop. After the model decides to call a tool but _before_ the tool executes, we intercept and check whether this tool needs human approval:

```
┌─────────────────────────────────────────────────────────────┐
│                     ReAct while(true)                       │
│                                                             │
│  User message → LLM → tool call decision                   │
│                           │                                 │
│                    ┌──────┴──────┐                          │
│                    │ needsApproval│                          │
│                    │  (tool, mode)│                          │
│                    └──────┬──────┘                          │
│                     yes/  │  \no                            │
│                     ┌─────┘   └─────┐                      │
│              ┌──────┴──────┐   executeTool()                │
│              │  Prompt User │        │                      │
│              └──────┬──────┘   tool result → LLM            │
│               /     |     \                                 │
│          approved denied modified                           │
│            │       │       │                                │
│       executeTool  │   execute w/                           │
│            │       │   new args                             │
│       tool result  │       │                                │
│            │   denial as   │                                │
│            │  tool result  │                                │
│            └───────┴───────┘                                │
│                    │                                        │
│              LLM reasons about result                       │
└─────────────────────────────────────────────────────────────┘
```

The key insight: **denial is fed back as a tool result**, not thrown as an error. The model sees `{"error": "Action denied by user", "reason": "..."}` and can adapt — suggest an alternative, ask for clarification, or explain why the action was needed.

Here's the interception point in the tool execution loop:

```typescript
// Inside the ReAct while(true) loop, for each tool call:
for (const toolCall of assistantMessage.tool_calls) {
  const { name, arguments: args } = toolCall.function;

  if (needsApproval(name, mode)) {
    const result = await requestApproval({ toolName: name, args, risk, description }, rl);

    if (result.decision === "denied") {
      // Feed denial back so the model can adapt
      messages.push({
        role: "tool",
        content: JSON.stringify({
          error: "Action denied by user",
          reason: result.reason,
        }),
      });
      continue; // Skip execution, let model reason about denial
    }

    if (result.decision === "modified") {
      // User edited the args before approving
      args = result.modifiedArgs;
    }
  }

  // Execute (either auto-approved or human-approved)
  const toolResult = executeTool(name, args);
  messages.push({ role: "tool", content: toolResult });
}
```

## Risk Classification

Every tool gets a risk level. The level, combined with the current approval mode, determines whether the agent can auto-execute:

| Risk Level  | Description                     | Examples in this demo                 |
| ----------- | ------------------------------- | ------------------------------------- |
| `read-only` | No side effects                 | `list_tasks`, `get_task_detail`       |
| `low`       | Creates data, easily reversible | `create_task`                         |
| `medium`    | Modifies existing data          | `update_task_status`, `reassign_task` |
| `high`      | Destructive, single item        | `delete_task`                         |
| `critical`  | Destructive, batch operation    | `bulk_delete_tasks`                   |

The mapping is declarative — a plain object:

```typescript
const TOOL_RISK_MAP: Record<string, RiskLevel> = {
  list_tasks: "read-only",
  get_task_detail: "read-only",
  create_task: "low",
  update_task_status: "medium",
  reassign_task: "medium",
  delete_task: "high",
  bulk_delete_tasks: "critical",
};
```

## Three Approval Modes

The mode slides the autonomy dial by changing which risk levels require approval:

| Mode       | Auto-approved                | Needs approval              | When to use                              |
| ---------- | ---------------------------- | --------------------------- | ---------------------------------------- |
| `auto`     | read-only, low, medium, high | critical only               | Trusted environments, experienced users  |
| `balanced` | read-only, low, medium       | high, critical              | **Default** — safe for most cases        |
| `strict`   | read-only only               | low, medium, high, critical | New deployments, untested domains, demos |

The decision logic is a one-liner:

```typescript
const GATED_LEVELS: Record<ApprovalMode, Set<RiskLevel>> = {
  auto: new Set(["critical"]),
  balanced: new Set(["high", "critical"]),
  strict: new Set(["low", "medium", "high", "critical"]),
};

function needsApproval(toolName: string, mode: ApprovalMode): boolean {
  const risk = TOOL_RISK_MAP[toolName] ?? "high"; // unknown tools default to high
  return GATED_LEVELS[mode].has(risk);
}
```

Unknown tools default to `high` risk — fail closed, not open.

## Handling Denial Gracefully

When the user denies an action, it's returned as a regular tool result:

```json
{ "error": "Action denied by user", "reason": "Don't delete tasks that are in progress" }
```

The model sees this as a tool failure and adapts. In practice, it typically:

1. Acknowledges the denial
2. Explains what it was trying to do
3. Asks how the user would like to proceed

This works because the ReAct loop already handles tool errors — a denied action is just another kind of failed tool call. No special handling needed in the agent logic.

## The Approval Prompt

When approval is required, the user sees a formatted banner:

```
  ┌──────────────────────────────────────────────────
  │  🔒 APPROVAL REQUIRED
  │  Tool: delete_task  |  Risk: HIGH
  │  Action: Delete task TASK-3
  │
  │  [y] Approve  [n] Deny  [m] Modify args
  └──────────────────────────────────────────────────
  Decision: _
```

Three options:

- **Approve (y)** — execute as planned
- **Deny (n)** — reject with an optional reason
- **Modify (m)** — edit the args before executing (the "edit-before-continue" pattern from LangGraph)

The modify option handles cases where the agent has the right idea but wrong parameters — e.g., deleting the wrong task ID.

## The Audit Trail

Every tool execution gets logged, whether auto-approved or human-decided:

```typescript
interface AuditEntry {
  timestamp: Date;
  toolName: string;
  args: Record<string, string>;
  risk: RiskLevel;
  decision: "auto-approved" | "approved" | "denied" | "modified";
  reason?: string;
}
```

View it anytime with `/audit`:

```
  📜 Audit Trail:
  10:32:15  ⚡ auto  [READ-ONLY]  list_tasks({})
  10:32:18  ✅ yes   [HIGH]       delete_task({"task_id":"TASK-3"})
  10:33:01  ❌ no    [CRITICAL]   bulk_delete_tasks({"status":"open"})
           └─ Too many tasks would be affected

  Total: 3 | Auto: 1 | Human: 1 | Denied: 1 | Modified: 0
```

Silent rejections — denying without logging the reason — are an anti-pattern. The reason captures _why_ the user disagreed with the agent, which is signal for improving prompts, tool descriptions, or risk classifications.

## The Permission Fatigue Problem

This is the #1 practical failure of HITL systems, backed by empirical data:

> Anthropic measured that 84% fewer approval prompts (via sandboxing) produced _better_ security outcomes. Users trained by too many low-risk prompts stop reading and rubber-stamp everything.

The three-mode system addresses this directly:

- `balanced` mode only prompts for destructive actions (high + critical), keeping reads and creates automatic
- Even in `strict` mode, `read-only` operations are never gated — there's nothing to approve when no state changes
- The `/auto` escape hatch is there for experienced users who know the domain

Practitioners report that tiered approaches reduce false positives by 78% while catching 96% of problematic actions before impact.

## Where the Frameworks Disagree

Every major framework implements HITL differently. The disagreements reveal real architectural tradeoffs:

**Pause mechanism:**

- **OpenAI Agents SDK**: Returns `result.interruptions` array; state is fully serializable JSON. Survives process restarts, can wait hours or days.
- **Vercel AI SDK**: Stream sends `approval-requested` part; state lives in React `useChat` hook. Optimized for real-time chat where the user is actively watching.
- **LangGraph**: `interrupt()` function callable anywhere in code; checkpointer persists state. The entire node re-executes on resume (requires idempotent tool calls).
- **Anthropic Claude Code**: Layered permission pipeline (hooks → deny rules → allow rules → ask rules → mode → callback). Not binary approve/deny but a tiered evaluation.

**Durability:**

- OpenAI assumes long-lived workflows (manager signs off tomorrow)
- Vercel assumes the user is present (approve in seconds)
- LangGraph + Temporal assume persistent storage (checkpoint to DB)
- This demo assumes the user is present (CLI readline prompt)

**Primary safety layer:**

- Most frameworks treat per-action approval as the primary safety mechanism
- Anthropic argues sandboxing + bounded autonomy is more effective, with HITL as a trust/UX mechanism

The right choice depends on your deployment context. This demo uses the simplest approach — synchronous readline prompts — because it's a CLI tool where the user is always present. A production web app would need async state persistence.

## Running the Demo

```bash
pnpm dev:human-in-the-loop
```

**Try these interactions:**

1. **Auto-approved reads** — "Show me all tasks" (no prompt, just executes)
2. **Approval gate** — "Delete task TASK-3" (approval prompt appears)
3. **Denial handling** — deny the delete, watch the model adapt
4. **Bulk operation** — "Delete all done tasks" (critical risk, always prompts)
5. **Mode switching** — `/strict` then "Create a task for login page" (low-risk now gated)
6. **Audit trail** — `/audit` to see all decisions with timestamps
7. **Reset** — `/reset` to restore the task board

**Slash commands:**

| Command     | Effect                                    |
| ----------- | ----------------------------------------- |
| `/auto`     | Only critical actions need approval       |
| `/balanced` | High + critical need approval (default)   |
| `/strict`   | Everything except reads needs approval    |
| `/audit`    | Display the audit trail                   |
| `/reset`    | Restore task board, clear history + audit |

## Key Takeaways

1. **Post-decision interception** is the core pattern — intercept between "model decides" and "tool executes," then check risk level against approval mode.

2. **Denial as tool result** lets the model adapt naturally. No special error handling — the ReAct loop already handles tool failures.

3. **Risk stratification prevents approval fatigue.** The biggest HITL failure is prompting too often for low-risk actions, training users to rubber-stamp everything.

4. **Unknown tools should fail closed** — default to `high` risk, not `read-only`. Safer to over-prompt than to auto-execute something unexpected.

5. **Log everything, especially denials.** Silent rejections lose the signal about why the agent's judgment diverged from the user's intent.

6. **The right autonomy level depends on context.** New deployments start strict, established systems earn trust. Anthropic's data shows experienced users interrupt _more_ strategically, not less.

## Sources & Further Reading

- [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) — Anthropic, 2024. The "human-in-the-loop" workflow as a core agentic pattern.
- [Human-in-the-Loop Agents — LangGraph](https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/) — Breakpoints, approval nodes, and edit-before-continue patterns.
- [OpenAI Agents SDK — Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/) — Guardrails that trigger human approval on specific tool calls.
- [Vercel AI SDK — Human in the Loop](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-with-tool-usage#human-in-the-loop) — Frontend-centric HITL with streaming tool confirmations.
- [2025 AI Agent Index](https://arxiv.org/abs/2502.05868) — Academic survey of 30+ deployed agents; L3 autonomy as production default.
- [Designing AI Agent UX Patterns](https://www.smashingmagazine.com/2025/03/designing-ai-agent-ux-patterns/) — Six UX patterns for approval prompts, with measured impact data.
- [Evaluating AI Agents in Financial Services](https://arxiv.org/abs/2502.05812) — Confidence-based escalation and tiered HITL in production.
