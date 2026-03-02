# Agent Middleware Pipeline

**Express.js for AI Agents — Composable Middleware for Agent Execution Loops**

Every production agent accumulates cross-cutting concerns: logging, PII redaction, token budgets, error retry, model fallback, content filtering. Without a principled way to compose these, they end up tangled inside the agent loop as ad-hoc if-statements. The middleware pipeline pattern extracts them into independent, reorderable interceptors — the same pattern that made Express.js and Koa successful in web servers, applied to agent execution.

```
User message
     │
     ▼
┌──────────────────────────────────────────┐
│  beforeAgentLoop                         │  ← init counters, validate input
├──────────────────────────────────────────┤
│  while (true) {                          │
│    ┌──────────────────────────────────┐  │
│    │  beforeLLMCall                   │  │  ← swap model, inject context
│    │  ollama.chat()                   │  │
│    │  afterLLMCall                    │  │  ← track tokens, validate
│    ├──────────────────────────────────┤  │
│    │  for each tool call:             │  │
│    │    beforeToolExecution           │  │  ← log, validate args
│    │    executeTool()                 │  │
│    │    afterToolExecution            │  │  ← retry, redact PII, log
│    └──────────────────────────────────┘  │
│  }                                       │
├──────────────────────────────────────────┤
│  afterAgentLoop                          │  ← stats, cleanup
└──────────────────────────────────────────┘
     │
     ▼
  Agent result
```

This demo builds a middleware-aware ReAct agent with five middleware implementations that plug into six hook points. The key teaching moment: **middleware order changes behavior**. Put PII redaction before logging and logs are clean. Reverse them and raw PII leaks into your log output.

> Part of [Agent Patterns — TypeScript](../../README.md). Builds on the [ReAct Loop](../react/README.md).

---

## The Core Idea: 6 Hook Points, Sequential Execution

An agent loop has six natural interception points — moments where you'd want to inspect, modify, or short-circuit the flow:

| Hook                  | When It Fires                                  | Example Use                              |
| --------------------- | ---------------------------------------------- | ---------------------------------------- |
| `beforeAgentLoop`     | After user message added, before `while(true)` | Initialize counters, validate input      |
| `beforeLLMCall`       | Before `ollama.chat()`                         | Swap model, inject context into messages |
| `afterLLMCall`        | After LLM response arrives                     | Track tokens, validate response          |
| `beforeToolExecution` | Before each `executeTool()`                    | Log arguments, validate tool call        |
| `afterToolExecution`  | After each `executeTool()`                     | Retry on error, redact PII, log results  |
| `afterAgentLoop`      | After the loop breaks                          | Print stats, cleanup resources           |

Each middleware implements only the hooks it needs:

```typescript
export interface Middleware {
  name: string;
  beforeAgentLoop?(ctx: AgentContext): Promise<void>;
  afterAgentLoop?(ctx: AgentContext): Promise<void>;
  beforeLLMCall?(ctx: AgentContext): Promise<void>;
  afterLLMCall?(ctx: AgentContext, response: LLMResponse): Promise<void>;
  beforeToolExecution?(ctx: AgentContext, toolCall: ToolCallContext): Promise<void>;
  afterToolExecution?(ctx: AgentContext, toolCall: ToolCallContext): Promise<void>;
}
```

All middleware share a single mutable `AgentContext` — the messages array, the model name, the tool definitions, and a `metadata` bag for cross-middleware communication. Any middleware can set `ctx.abort` to short-circuit the entire loop with a reason and optional final message.

## The Pipeline Runner

The pipeline runner replaces `runAgent()` with `runAgentWithMiddleware()`. It's the same ReAct while-loop, but every natural interception point fires hooks through the middleware array:

```typescript
export async function runAgentWithMiddleware(
  userMessage: string,
  history: Message[],
  config: AgentConfig,
): Promise<AgentResult> {
  const middlewares = config.middlewares ?? [];
  const ctx: AgentContext = { /* ... shared mutable state ... */ };

  await runHook(middlewares, "beforeAgentLoop", ctx);  // ← lifecycle
  if (ctx.abort) return buildAbortResult(ctx);

  while (true) {
    await runLLMHook(middlewares, "beforeLLMCall", ctx);  // ← per-call
    const response = await ollama.chat({ model: ctx.model, ... });
    await runLLMHook(middlewares, "afterLLMCall", ctx, response);

    if (!response.message.tool_calls?.length) break;

    for (const tc of response.message.tool_calls) {
      await runToolHook(middlewares, "beforeToolExecution", ctx, toolCallCtx);
      toolCallCtx.result = ctx.executeTool(name, args);
      await runToolHook(middlewares, "afterToolExecution", ctx, toolCallCtx);
      // ↑ middleware can mutate toolCallCtx.result before it enters history
    }
  }

  await runHook(middlewares, "afterAgentLoop", ctx);  // ← lifecycle
  return { messages: ctx.messages, metadata: ctx.metadata };
}
```

With zero middleware, this behaves identically to the vanilla ReAct loop. Every middleware added is additive — you never need to modify the core loop.

## Five Middleware Implementations

### 1. TokenBudgetMiddleware

Tracks cumulative prompt + completion tokens across LLM calls. When the budget is exceeded, sets `ctx.abort` with a human-readable message. This is the guardrails concept's token circuit breaker, extracted as a composable middleware.

```typescript
async afterLLMCall(ctx, response) {
  const total = (ctx.metadata.totalTokens as number)
    + response.promptTokens + response.completionTokens;
  ctx.metadata.totalTokens = total;
  if (total > maxTokens) {
    ctx.abort = {
      reason: "token-budget-exceeded",
      finalMessage: `Used ${total} tokens (budget: ${maxTokens}). Stopping.`,
    };
  }
}
```

### 2. ToolRetryMiddleware

Retries tool calls when the result contains an `error` field, using exponential backoff (`delay * 2^attempt`). The retry happens inside `afterToolExecution` — it re-executes the tool and overwrites `toolCall.result` before the result enters the message history.

```typescript
async afterToolExecution(ctx, toolCall) {
  let retries = 0;
  while (retries < maxRetries) {
    const parsed = JSON.parse(toolCall.result);
    if (!parsed.error) break;
    retries++;
    await sleep(baseDelayMs * 2 ** (retries - 1));
    toolCall.result = ctx.executeTool(toolCall.name, toolCall.args);
  }
  if (retries > 0) ctx.metadata.toolRetries += retries;
}
```

### 3. PIIRedactionMiddleware

Scans tool results for email addresses, phone numbers, and SSNs using regex patterns. Replaces matches with `[EMAIL REDACTED]`, `[PHONE REDACTED]`, `[SSN REDACTED]` before the result enters the message history. This means **the model never sees raw PII** — it reasons over redacted data.

### 4. ModelFallbackMiddleware

Swaps to a fallback model when the primary model fails. The pipeline runner stores LLM errors in `ctx.metadata.llmError` and re-runs `beforeLLMCall`, giving this middleware a chance to change `ctx.model` before the retry.

### 5. LoggingMiddleware

Logs tool name, arguments, and a result preview to the console. Its purpose is to make the **ordering demo** visible — the same `afterToolExecution` hook fires for both logging and PII redaction, but **which runs first** determines whether logs contain PII.

## Ordering Matters: The Key Insight

The middleware array is executed **sequentially, first to last**, for all hooks. This is the "waterfall" model. The order you specify middleware determines behavior:

```typescript
// Safe: PII redacted BEFORE logging sees the data
const SAFE = [toolRetry, piiRedaction, logging, tokenBudget, modelFallback];

// Unsafe: logging sees raw PII because it runs BEFORE redaction
const UNSAFE = [toolRetry, logging, piiRedaction, tokenBudget, modelFallback];
```

With the safe stack, when `get_guest_info` returns `{"email": "john@example.com", "phone": "555-123-4567"}`:

1. **ToolRetry** → no error, passes through
2. **PIIRedaction** → rewrites to `{"email": "[EMAIL REDACTED]", "phone": "[PHONE REDACTED]"}`
3. **Logging** → prints the redacted version

With the unsafe stack:

1. **ToolRetry** → no error, passes through
2. **Logging** → prints `john@example.com` and `555-123-4567` to console
3. **PIIRedaction** → redacts, but the damage is done — PII is already in logs

This is the same class of bug that web developers encounter with Express middleware ordering (CORS before auth, body parsing before validation). The pattern is universal.

## Waterfall vs. Onion: Two Execution Models

This demo uses the **waterfall model** — all hooks run forward (first to last), both before and after. LangChain 1.0, Microsoft Agent Framework, and Google ADK use the **onion model** instead, where before-hooks run forward and after-hooks run in reverse:

```
Waterfall (this demo):            Onion (LangChain/Koa):
  before: A → B → C                before: A → B → C
  [action]                          [action]
  after:  A → B → C                after:  C → B → A
```

The onion model mirrors Koa's `next()` pattern, where each middleware wraps the inner execution. It's more natural for concerns like "measure total time" (start timer in before, stop in after — the outermost middleware sees the full duration). The waterfall model is simpler to understand — hooks always run in the order you see them in the array.

For most agent middleware, the distinction doesn't matter. It becomes important for timing/tracing middleware (where you want symmetric nesting) or when middleware needs to see the final result of all inner middleware. This demo chooses waterfall for pedagogical clarity.

## Running the Demo

```bash
pnpm dev:middleware-pipeline
```

### Slash Commands

| Command    | Effect                                 |
| ---------- | -------------------------------------- |
| `/safe`    | PII redacted before logging (default)  |
| `/unsafe`  | Logging sees raw PII                   |
| `/minimal` | No middleware — vanilla ReAct behavior |
| `/stack`   | Print current middleware stack         |

### Try These

1. **PII redaction**: `"Look up John Smith's contact info"` — watch tool results get redacted
2. **Ordering difference**: Switch to `/unsafe`, repeat the same query — PII appears in logs
3. **Full booking**: `"Book a suite for Alice Johnson from 2026-03-01 to 2026-03-05"` — see multiple middleware firing across the full flow
4. **Minimal mode**: `/minimal` then any query — same pipeline runner, zero middleware overhead

## In the Wild: Coding Agent Harnesses

The middleware pipeline is the most universally adopted pattern across coding agent harnesses. Every major harness has independently converged on lifecycle hooks that let users intercept agent actions — they just disagree on the execution model and configuration format.

**Claude Code** has the richest hook taxonomy with 16 events (`PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, etc.) and four handler types: shell commands, HTTP endpoints, single-turn LLM evaluation (prompt hooks), and full subagent verification (agent hooks). Its `PreToolUse` hook can modify tool arguments before execution — the same `toolCall.result` mutation our demo uses, but applied to inputs. Claude Code runs all matching hooks **in parallel** rather than sequentially, prioritizing latency over ordering guarantees.

**Cursor** takes a similar approach with 17+ events but makes a key architectural choice: **fail-closed hooks** for security-sensitive operations. Its `beforeMCPExecution` and `beforeReadFile` hooks block the operation if the hook crashes or times out, rather than defaulting to allow. This is a security guarantee that sequential middleware doesn't provide — a crashed PII redaction middleware in our demo would silently pass through raw data. Cursor also splits tool events into granular categories (`beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile`) rather than one unified `PreToolUse`.

**OpenCode** takes the most developer-friendly approach with a TypeScript plugin system. Plugins are actual code modules (not shell scripts) that subscribe to events like `tool.execute.before` and `tool.execute.after`. Plugins can define new tools or override built-in ones — going beyond the intercept-only model into full extension. OpenCode also exposes experimental hooks for system prompt transformation (`experimental.chat.system.transform`), which is closer to our `beforeLLMCall` hook than any other harness offers.

**Cline** (VS Code extension) implements a Rules system where `.clinerules` files act as middleware for prompt injection — they're prepended to the system prompt on every request, effectively a `beforeLLMCall` hook. For tool-level interception, Cline uses a Mode + Permission architecture: Auto, Normal, and Ask modes determine which tools require human approval, functioning as a configurable `beforeToolExecution` gate.

The convergence across harnesses validates the middleware model: **the six hook points in this demo map directly to the events every harness exposes**. The primary differences are in execution semantics (parallel vs. sequential), failure modes (fail-open vs. fail-closed), and configuration format (JSON vs. code).

## Key Takeaways

1. **Six natural hook points** cover every interception need in an agent loop: before/after the loop, before/after each LLM call, before/after each tool execution.

2. **Middleware order is behavior.** The same set of middleware produces different results depending on array order. This is a feature, not a bug — it gives operators precise control over data flow.

3. **Shared mutable context** (`AgentContext`) is the communication channel. Middleware reads and writes `ctx.metadata` to share state, mutates `toolCall.result` to transform data, and sets `ctx.abort` to short-circuit execution.

4. **Zero middleware = zero overhead.** The pipeline runner with an empty middleware array behaves identically to a vanilla ReAct loop. Middleware is purely additive.

5. **The waterfall model is simpler; the onion model is more powerful.** For most agent middleware, waterfall (all hooks forward) is sufficient. Use the onion model when you need symmetric nesting (timing, tracing) or when after-hooks need to see the result of all inner middleware.

## Sources & Further Reading

- [LangChain 1.0 Prebuilt Middleware](https://docs.langchain.com/oss/python/langchain/middleware/built-in) — LangChain, 2025 — 16+ composable middleware hooks for agent execution
- [LangChain and LangGraph 1.0 Announcement](https://blog.langchain.com/langchain-langgraph-1dot0/) — LangChain, 2025 — middleware as a first-class agent framework primitive
- [Vercel AI SDK 6 — DevTools Middleware](https://vercel.com/blog/ai-sdk-6) — Vercel, 2025 — middleware for agent debugging and observability
- [Mastra Changelog — ToolSearchProcessor](https://mastra.ai/blog/changelog-2026-02-04) — Mastra, 2026 — middleware-like tool filtering processors
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) — Anthropic — 16 lifecycle events with 4 handler types
- [Cursor Hooks Documentation](https://cursor.com/docs/agent/hooks) — Cursor — fail-closed security hooks for coding agents
- [OpenCode Plugins Documentation](https://opencode.ai/docs/plugins/) — OpenCode — TypeScript plugin system with tool override capability
