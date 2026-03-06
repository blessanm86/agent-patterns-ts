# Your Agent's Invisible Backpack: Dependency Injection for AI Agents

[Agent Patterns -- TypeScript](../../README.md)

Your `lookup_order` tool needs a database connection. Your `process_refund` tool needs an audit logger. Your `check_loyalty_points` tool needs to know which user is asking. But the LLM doesn't need to know about any of these things -- it just needs to decide _when_ to call the tool and _what arguments_ to pass.

This is the core tension that dependency injection solves in agent systems: **tools need runtime state that the LLM shouldn't see.**

## The Problem: Module Globals and Ad-Hoc Parameters

Without a formal DI pattern, agent tools tend to get their dependencies through one of five anti-patterns:

```typescript
// Anti-pattern 1: Module-level globals
const db = new Database(process.env.DATABASE_URL);
const currentUser = getAuthenticatedUser(); // from where?

function lookupOrder(args: { order_id: string }): string {
  return db.query(
    "SELECT * FROM orders WHERE id = ? AND user_id = ?",
    args.order_id,
    currentUser.id,
  ); // global state!
}
```

```typescript
// Anti-pattern 2: Ad-hoc parameter threading
function executeTool(name: string, args: Record<string, string>,
  db: Database, user: User, logger: Logger,  // grows with every dependency
  featureFlags: FeatureFlags, metrics: Metrics  // keeps growing...
): string { ... }
```

Both approaches create the same problems:

- **Testing is painful** -- you can't easily swap a mock database without mocking module-level state
- **Concurrent requests break** -- two users sharing the same global `currentUser` causes data leaks
- **Signatures drift** -- every new dependency adds a parameter to every function in the chain
- **The LLM boundary blurs** -- it's not clear what the LLM sees vs. what tools need internally

## The Solution: `RunContext<T>`

The pattern that PydanticAI and OpenAI Agents SDK independently converged on is a **typed context carrier**: a generic wrapper that bundles all tool dependencies into a single object, created once at the run boundary and threaded through every tool call.

```
    Run Boundary (CLI, HTTP handler, test)
    │
    │  const ctx = createRunContext({
    │    db: createDatabase(),
    │    user: authenticatedUser,
    │    logger: createLogger(),
    │  });
    │
    ▼
┌─────────────────────────────────────────┐
│          runAgent(input, history, ctx)    │
│                                          │
│  ┌─────────────┐    ┌────────────────┐  │
│  │  LLM Call    │───▶│ Tool Dispatch  │  │
│  │             │    │                │  │
│  │ Sees: tools, │    │ executeTool(   │  │
│  │ messages,    │    │   name,        │  │
│  │ system prompt│    │   args,        │  │
│  │             │    │   ctx  <────── runtime deps  │
│  │ Does NOT see:│    │ )              │  │
│  │ ctx, db,     │    │                │  │
│  │ logger, user │    └────────────────┘  │
│  └─────────────┘                        │
└─────────────────────────────────────────┘
```

The context is **invisible to the LLM** -- it never appears in messages, tool schemas, or system prompts (unless you deliberately surface parts of it, like the user's name for personalization).

## How This Demo Works

This demo builds an **order support agent** for an electronics store. Four tools all need access to the same runtime dependencies: a database, an authenticated user, and a logger.

### The Dependency Container

```typescript
// context.ts -- what tools need, bundled into a typed interface
interface Deps {
  db: Database; // Order queries, refund processing
  user: UserInfo; // Authenticated user (id, name, tier)
  logger: Logger; // Audit logging for refunds, access attempts
}

interface RunContext<T> {
  deps: T;
  runId: string; // Correlate logs across a session
  toolCallCount: number; // Track tool usage
}
```

### Tools Receive Context -- The LLM Doesn't

The tool _definitions_ (what the LLM sees) contain only the arguments the LLM needs to provide:

```typescript
// What the LLM sees:
{
  name: "lookup_order",
  parameters: {
    order_id: { type: "string", description: "The order ID to look up" }
  }
}
```

The tool _implementations_ receive the full context as a second argument:

```typescript
// What actually runs:
function lookupOrder(args: { order_id: string }, ctx: RunContext<Deps>): string {
  const { db, user, logger } = ctx.deps;

  logger.info("Looking up order", { orderId: args.order_id, userId: user.id });

  const order = db.getOrderById(args.order_id);

  // User scoping: can only see your own orders
  if (order.userId !== user.id) {
    logger.warn("Unauthorized access attempt", { orderId: args.order_id });
    return JSON.stringify({ error: "Order not found" });
  }

  return JSON.stringify(order);
}
```

The dispatcher threads context to every tool:

```typescript
export function executeTool(
  name: string,
  args: Record<string, string>,
  ctx: RunContext<Deps>, // <-- the only change from the base pattern
): string {
  ctx.toolCallCount++;
  switch (name) {
    case "lookup_order":
      return lookupOrder(args, ctx);
    case "process_refund":
      return processRefund(args, ctx);
    // ...
  }
}
```

### Same Agent, Different Dependencies

The CLI demonstrates the key benefit of DI -- run the same agent with different injected contexts:

```bash
# Alice: standard tier, 3 orders
pnpm dev:dependency-injection --user=alice

# Bob: VIP tier, 2 orders, 3x loyalty points
pnpm dev:dependency-injection --user=bob
```

Same agent code, same tools, same system prompt template. Only the `Deps` instance changes. Alice sees her orders; Bob sees his. Alice gets 1x loyalty points; Bob gets 3x. The refund logger records different user IDs. None of this logic is in the LLM's prompts -- it's all in the injected dependencies.

### Dynamic System Prompts

The system prompt itself can reference injected context for personalization:

```typescript
function buildSystemPrompt(ctx: RunContext<Deps>): string {
  const { user } = ctx.deps;
  return `You are a helpful order support agent.
Current customer: ${user.name} (${user.tier} tier member)`;
}
```

This is the "dynamic system prompt" pattern: the LLM sees the user's name and tier (so it can say "Hello Alice" and mention VIP benefits), but never sees the database connection or logger that tools use behind the scenes.

## The Framework Convergence

Three major agent SDKs independently arrived at the same pattern:

|                      | PydanticAI                 | OpenAI Agents SDK         | Google ADK                       |
| -------------------- | -------------------------- | ------------------------- | -------------------------------- |
| **Type**             | `RunContext[Deps]`         | `RunContextWrapper[T]`    | `ToolContext`                    |
| **Declared on**      | `Agent[Deps, Output]`      | `Agent[T]`                | Signature detection              |
| **Passed at**        | `agent.run(deps=...)`      | `Runner.run(context=...)` | `agent.invoke(..., context=...)` |
| **Tool injection**   | First param, auto-detected | First param, convention   | Named param, auto-detected       |
| **LLM visible?**     | No                         | No                        | No                               |
| **Handoff behavior** | Explicit pass (`ctx.deps`) | Shared mutable instance   | Hierarchical context             |
| **Test override**    | `agent.override(deps=...)` | Pass different context    | Pass different context           |

The convergence is striking. All three:

1. Define deps as a generic type parameter on the agent
2. Pass an instance at the run boundary
3. Auto-inject it as a tool function parameter
4. Strip it from the LLM-facing tool schema
5. Support swapping deps for testing

### Where They Disagree: Handoff Semantics

The most interesting divergence is what happens when Agent A hands off to Agent B:

- **PydanticAI**: Explicit. You must manually pass `ctx.deps` and `ctx.usage` to the child agent's `run()`. No implicit propagation.
- **OpenAI Agents SDK**: Shared. The same mutable `RunContextWrapper` passes to the receiving agent. Mutations in Agent A's tools are visible to Agent B.
- **Google ADK**: Hierarchical. `InvocationContext` > `ReadonlyContext` > `CallbackContext` > `ToolContext`, each layer adding capabilities.

PydanticAI's explicit approach prevents accidental state sharing; OpenAI's shared approach is simpler for common cases but requires discipline around mutable state.

### What About TypeScript? The Closure Alternative

Vercel AI SDK takes a fundamentally different approach: **no formal DI**. Tools are plain objects with an `execute` function, and developers use closures to capture dependencies:

```typescript
// Vercel AI SDK: closures as DI
function createOrderTools(db: Database, user: UserInfo) {
  return {
    lookupOrder: tool({
      parameters: z.object({ orderId: z.string() }),
      execute: async ({ orderId }) => {
        // db and user captured by closure -- no RunContext needed
        return db.getOrderById(orderId);
      },
    }),
  };
}
```

This works well in TypeScript where closures are ergonomic and type inference flows naturally through them. The tradeoff: you lose a single declared dependency type per agent, built-in test override mechanisms, and explicit discoverability of what a tool depends on. It's the "zero-framework" approach -- simpler, but less structured.

## In the Wild: Coding Agent Harnesses

Coding agent harnesses are the densest concentration of DI patterns in production. Every tool call crosses the LLM-to-tool boundary, and harnesses must thread working directory, git state, file permissions, editor APIs, and user preferences to tool implementations -- without any of it appearing in the LLM's context.

**Aider** uses a "god object" pattern. The `Coder` class is a central hub that owns all runtime state -- `self.repo` (git), `self.io` (terminal I/O), `self.root` (working directory). Tool-like operations (editing files, running linters, generating repo maps) access everything through instance attributes on this object. Simple and debuggable, but the class grows large over time.

**Cline** follows the same god-object approach with its `Task` class but adds a crucial abstraction: `HostProvider`. Tool implementations never import VS Code APIs directly. Instead, they access file system, terminal, and editor functionality through the host interface, which can be swapped for VS Code, standalone gRPC, or CLI modes. This is DI for the execution environment itself.

**OpenCode** takes the most structured approach among CLI harnesses. An `App` struct acts as a composition root, injecting specific service interfaces (`permission.Service`, `session.Service`, `history.Service`) into tools at initialization. Each tool gets only the services it needs -- not the entire god object. This is the closest a harness gets to the `RunContext<Deps>` pattern.

**Claude Code** inverts the model entirely. Built-in tools are essentially shell commands that inherit the user's environment (cwd, PATH, git state). The "dependency injection" is the shell environment itself. For richer context, the hooks system passes JSON on stdin with session ID, cwd, permission mode, and tool details. It's the zero-framework approach -- no typed containers, just environment variables and process I/O.

The pattern across harnesses mirrors the framework landscape: structured DI (OpenCode) vs. god objects (Aider, Cline) vs. environment-as-DI (Claude Code). Nobody uses a formal DI container (InversifyJS, tsyringe). Agent tool dependency graphs are flat enough that constructor injection or closures suffice.

## Key Takeaways

1. **The LLM-to-tool boundary is the natural DI seam.** The LLM emits a tool name and arguments. The harness intercepts this and calls the implementation with both LLM arguments AND runtime context the LLM never sees. Every framework and harness implements this seam.

2. **Typed context carriers beat ad-hoc threading.** `RunContext<Deps>` gives you: a single place to declare all tool dependencies, type safety across the entire agent, testability via dependency swapping, and a clean separation between what the LLM controls and what the runtime controls.

3. **PydanticAI + OpenAI independently converged.** When two major SDKs arrive at the same design (`RunContext[T]` / `RunContextWrapper[T]`), it's a strong signal the pattern solves a real problem.

4. **TypeScript can use closures instead.** Closures are idiomatic DI in JS/TS. The explicit container pattern shown in this demo is more structured (and maps directly to the Python SDK patterns), but factory functions that capture deps in closures are equally valid.

5. **DI enables same-agent-different-behavior.** The most practical benefit: one agent codebase serves multiple users, environments, and test scenarios. Swap the database for a mock. Change the user for a VIP. Replace the logger with a recorder. The agent code doesn't change.

## Sources & Further Reading

- [PydanticAI -- Dependencies](https://ai.pydantic.dev/dependencies/) -- `RunContext[Deps]` with full type safety
- [OpenAI Agents SDK -- Context](https://openai.github.io/openai-agents-python/context/) -- `RunContextWrapper[T]` with `ToolContext` extension
- [Google ADK -- ToolContext](https://google.github.io/adk-docs/context/) -- hierarchical context objects
- [Vercel AI SDK -- Tools and Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) -- closure-based approach
- [LangGraph -- Runtime Context](https://docs.langchain.com/oss/python/langchain/runtime) -- `InjectedToolArg` / `ToolRuntime`
- [FastAPI -- Dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/) -- the web framework pattern that inspired PydanticAI
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) -- JSON context threading for tool hooks
- [Cline Architecture (DeepWiki)](https://deepwiki.com/cline/cline) -- HostProvider abstraction for IDE tools
- [OpenCode Tool System (DeepWiki)](https://deepwiki.com/opencode-ai/opencode/3.4-tool-system) -- service container DI

---

_Builds on: [ReAct Loop](../react/README.md), [Multi-Agent Routing](../multi-agent-routing/README.md)_
