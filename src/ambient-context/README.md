# Your Agent Already Knows What You're Looking At — Ambient Context Injection

[Agent Patterns — TypeScript](../../README.md) · Builds on [Structured Entity Tags](../entity-tags/README.md)

---

You're on a product page staring at a $79.99 pair of headphones. You ask the assistant: _"Is this good for music production?"_

Without ambient context, the agent has no idea what "this" is. It asks you to clarify. You paste the product name, maybe the URL. The agent calls a tool to look it up. Three round-trips before it can answer a question about something _already on your screen_.

With ambient context, the product page **registered** its data when you navigated to it. The agent's system prompt already contains `<Product id="P001" name="Studio Monitor Headphones" price="79.99" category="electronics" />`. It answers immediately, in context, with zero clarification needed.

This is the **ambient context store** pattern: application views automatically register contextual data that gets serialized into the agent's prompt. The agent always knows what the user is looking at — without manual pasting, without tool calls, without asking.

## The Core Idea

```
User navigates to Product Page
         │
         ▼
┌─────────────────────┐     ┌──────────────────────┐
│   Page Component     │────▶│  Ambient Context      │
│   register(product)  │     │  Store                │
│                      │     │                       │
│   [on leave]         │     │  product:P001 ref=1   │
│   unregister(product)│     │  user:profile  ref=2  │
└─────────────────────┘     └──────────┬───────────┘
                                       │ serialize()
                                       ▼
                            ┌──────────────────────┐
                            │  System Prompt        │
                            │                       │
                            │  Base instructions    │
                            │  +                    │
                            │  <AmbientContext>     │
                            │    <Product ... />    │
                            │    <User ... />       │
                            │  </AmbientContext>    │
                            └──────────────────────┘
```

The store tracks **what's on screen** with reference counting. When a view mounts, it registers contexts. When it unmounts, it unregisters them. When the user asks a question, active contexts are serialized as XML and injected into the system prompt — before the LLM ever sees the user's message.

## Why Not Just Use Tool Calls?

The alternative is letting the agent discover context reactively: user says "tell me about this product," agent calls `get_current_page()`, then `get_product_details(id)`, then finally answers. This works, but:

| Approach                | Latency                          | Token cost                     | UX                          |
| ----------------------- | -------------------------------- | ------------------------------ | --------------------------- |
| **Tool-call discovery** | 2-3 extra LLM round-trips        | High (tool calls + results)    | Agent asks "which product?" |
| **Ambient injection**   | Zero — context already in prompt | Low (static prefix, cacheable) | Agent answers immediately   |
| **Manual paste**        | Zero round-trips                 | Low                            | User does the work          |

The latency difference is significant in practice. Each tool call round-trip adds 1-3 seconds of model inference time. Ambient context trades a few hundred tokens of prompt space for eliminating those round-trips entirely.

There's a deeper reason too: ambient context enables **prompt caching**. Because the context is injected as a stable prompt prefix (it only changes on navigation, not on every message), LLM providers can cache the KV computations for that prefix. Every message on the same page reuses the cache. Tool-call discovery can't benefit from this — each discovery sequence is different.

## Reference Counting — The Mount/Unmount Lifecycle

The context store uses reference counting to handle shared contexts — the same technique React uses for effect cleanup, and the same reason `useCopilotReadable` works correctly in nested component trees.

Consider a sidebar that shows user profile info on every page. The sidebar registers `user:profile` with refCount 1. When the user navigates to the Account page, that page _also_ registers `user:profile` — refCount becomes 2. When the user leaves Account, the page unregisters its reference — refCount drops to 1. The sidebar's reference keeps it alive.

```typescript
function register(type, identifier, data, source): void {
  const id = `${type}:${identifier}`;
  const existing = contexts.get(id);

  if (existing) {
    existing.refCount++; // another view references this context
    existing.temporary = false; // reclaimed from persistence
    existing.data = { ...existing.data, ...data };
  } else {
    contexts.set(id, { id, type, data, refCount: 1, excluded: false, temporary: false, source });
  }
}

function unregister(type, identifier, source): void {
  const id = `${type}:${identifier}`;
  const existing = contexts.get(id);
  if (!existing) return;

  existing.refCount--;
  if (existing.refCount <= 0) {
    contexts.delete(id); // no more references — remove from store
  }
}
```

Without reference counting, shared contexts break. The sidebar registers user info, the account page registers it again, the user leaves account — and suddenly the sidebar's user context vanishes because unregister did a hard delete. Reference counting prevents this class of bugs entirely.

## XML Serialization — Structured Tags for the System Prompt

Active contexts serialize to XML tags inside an `<AmbientContext>` wrapper. The format mirrors the entity tags pattern, making it familiar to models trained on XML/HTML:

```xml
<AmbientContext>
  <Product id="P001" name="Studio Monitor Headphones" price="79.99" category="electronics" />
  <Cart itemCount="2" total="114.98" items="Studio Monitor Headphones x1, Cast Iron Skillet x1" />
  <User name="Alice Chen" email="alice@example.com" tier="premium" memberSince="2024-06-15" />
</AmbientContext>
```

Why XML tags instead of JSON or plain text?

- **Token-efficient** — self-closing tags with attributes are more compact than equivalent JSON
- **Typed** — the tag name (`Product`, `Cart`, `User`) tells the model the context type without extra fields
- **LLM-native** — models are trained on billions of HTML/XML tokens, so they parse and reference this format naturally
- **Cacheable** — the entire block is a stable prefix that changes only on navigation, enabling KV-cache reuse

The serialization function maps context types to XML tag names and flattens the data record into attributes:

```typescript
const TAG_NAMES: Record<ContextType, string> = {
  product: "Product",
  cart: "Cart",
  category: "Category",
  order: "Order",
  user: "User",
  "time-range": "TimeRange",
  filter: "Filter",
};

function serialize(): string {
  const active = getActive(); // refCount > 0 AND !excluded
  if (active.length === 0) return "";

  const tags = active.map((ctx) => {
    const tagName = TAG_NAMES[ctx.type];
    const attrs = Object.entries(ctx.data)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    return `  <${tagName} ${attrs} />`;
  });
  return `<AmbientContext>\n${tags.join("\n")}\n</AmbientContext>`;
}
```

## System Prompt Assembly — The Injection Point

The agent's system prompt is rebuilt before each LLM call by combining the base instruction with the serialized ambient context:

```typescript
function buildSystemPrompt(store: ContextStore): string {
  const ambient = store.serialize();

  if (ambient) {
    return `${BASE_PROMPT}

## Current Context

The following context describes what the user is currently viewing in the app.
Use this to provide relevant, contextual responses without asking the user
to repeat information they can already see on screen:

${ambient}`;
  }
  return BASE_PROMPT;
}
```

The phrasing matters. "What the user is currently viewing" tells the model this is _live screen state_, not historical data. "Without asking the user to repeat information" explicitly suppresses the clarification questions that waste time.

The ReAct loop itself is unchanged — ambient context is pure prompt engineering. The agent doesn't need new tools or special handling. It just _knows more_ when it starts reasoning:

```typescript
async function runAgent(userMessage: string, history: Message[], store: ContextStore) {
  const messages = [...history, { role: "user", content: userMessage }];
  const systemPrompt = buildSystemPrompt(store); // ← ambient context injected here

  while (true) {
    const response = await ollama.chat({ model, system: systemPrompt, messages, tools });
    // ... standard ReAct loop (tool calls → results → loop) ...
  }
}
```

## User Control — Exclude and Toggle

Not all ambient context is helpful all the time. A user debugging an order issue doesn't need the cart context cluttering the prompt. The store supports excluding individual contexts:

```
/contexts
  ● product:P001 → Studio Monitor Headphones [included] (ref: 1)
  ● cart:current → Shopping Cart [included] (ref: 1)
  ● user:profile → Alice Chen [included] (ref: 1)

/toggle cart:current
  ❌ Excluded: cart:current (hidden from agent)

/contexts
  ● product:P001 → Studio Monitor Headphones [included] (ref: 1)
  ○ cart:current → Shopping Cart [excluded] (ref: 1)
  ● user:profile → Alice Chen [included] (ref: 1)
```

Excluded contexts stay in the store (they're still "mounted") but are filtered out during serialization. The agent no longer sees the cart. This is the same pattern as CopilotKit's context toggling — the user curates what the agent knows.

## Persistence — Surviving Session Restarts

Contexts can be saved to disk and restored in a future session. Restored contexts are marked `temporary: true` — they exist in the store but haven't been reclaimed by a live page. When the user navigates to a page that registers the same context, the temporary flag is cleared and the refCount increments normally.

This mirrors how coding agents handle CLAUDE.md or `.cursorrules` — the context persists on disk and is loaded eagerly at session start, independent of whether the "page" (working directory) that created it is currently active.

```typescript
function persist(filePath: string): void {
  const all = getAll();
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      all.map((ctx) => ({
        id: ctx.id,
        type: ctx.type,
        data: ctx.data,
        source: ctx.source,
        excluded: ctx.excluded,
      })),
      null,
      2,
    ),
  );
}

function restore(filePath: string): number {
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  let count = 0;
  for (const entry of data) {
    if (!contexts.has(entry.id)) {
      contexts.set(entry.id, { ...entry, refCount: 1, temporary: true });
      count++;
    }
  }
  return count;
}
```

## Demo Walkthrough

Run `pnpm dev:ambient-context` and try this sequence:

```
# 1. Start on the catalog page — 3 contexts auto-registered
[catalog] (3 contexts) You: what categories do you have?
# Agent sees <Category>, <Filter>, <User> — answers from context

# 2. Navigate to a product
/product P001
# Catalog contexts unregistered, product context registered

# 3. Ask about the product — agent knows what "this" is
[product] (2 contexts) You: is this good for music production?
# Agent sees <Product id="P001" name="Studio Monitor Headphones" ... />

# 4. Check the cart
/cart
# Product context unregistered, cart context registered

# 5. Ask for recommendations based on cart contents
[cart] (2 contexts) You: what else might I need?
# Agent sees <Cart items="Studio Monitor Headphones x1, ..." />

# 6. Inspect active contexts
/contexts
# Shows all contexts with [included]/[excluded] status

# 7. Exclude a context and see the difference
/toggle cart:current
[cart] (1 contexts) You: what else might I need?
# Agent no longer sees cart contents — gives generic answer

# 8. Save and restore across sessions
/save
# ... restart the CLI ...
/restore
# Contexts restored with [temporary] flag
```

## Architecture

```
src/ambient-context/
├── types.ts           # AmbientContext, ContextType, Page, ContextStore interfaces
├── data.ts            # Mock products, cart, orders, user profile
├── context-store.ts   # The core pattern: ref-counted store with XML serialization
├── pages.ts           # Page definitions: register/unregister/display per page
├── tools.ts           # Shopping tools: search, cart, orders
├── agent.ts           # ReAct loop with ambient context prompt injection
└── index.ts           # CLI with /nav commands and dynamic prompt
```

The context store is the only new abstraction. Everything else — the ReAct loop, tool definitions, CLI factory — follows the same patterns as previous demos. The store itself is ~150 lines with no dependencies beyond `fs`.

## In the Wild: Coding Agent Harnesses

Ambient context injection is one of the most heavily-used patterns across coding agent harnesses. Every major harness has converged on some form of it, though they differ significantly in _what_ they inject and _how much control_ users have.

### Claude Code — The Most Sophisticated Implementation

Claude Code assembles **110+ modular prompt components** conditionally before each LLM call. At session start, it eagerly loads a hierarchy of instruction files: managed policy, user-level CLAUDE.md, project-level CLAUDE.md, local CLAUDE.md, and subdirectory-scoped instructions. It also injects git status (branch, changes, recent commits), environment info (OS, shell, working directory), auto-memory (first 200 lines of MEMORY.md), skill descriptions (budgeted to ~2% of context window), and tool descriptions.

During the session, it dynamically injects **system reminders** — IDE file selection, open files, new diagnostics, file modifications, and token usage. These are the equivalent of our page-level context registration: when the IDE state changes, new context is injected; when files close, that context is removed.

The `gitStatus` annotation at the top of this very conversation is ambient context in action — Claude Code registered it before the session started, and every prompt in this conversation includes it without you having to paste it.

### Cursor — Vector-Indexed Ambient Context

Cursor takes a different approach: instead of explicit registration, it uses **semantic indexing** against a vector database of codebase embeddings. When you open a file, Cursor automatically includes the current file content, cursor position, recently viewed files, edit history, and linter/compiler errors. In agent mode, it uses custom retrieval models to find relevant code chunks from across the codebase.

The key difference from our explicit registration model: Cursor's context is _inferred_ rather than _declared_. It doesn't know exactly what a "product page" is — it finds relevant code through embedding similarity. This is more automatic but less precise.

### GitHub Copilot — Hierarchical Instruction Files

Copilot's ambient context for completions includes **neighboring tabs** (all open files in the editor, not just the active one) and fill-in-the-middle context. Studies showed neighboring tabs improve completion acceptance by ~5%.

For custom instructions, Copilot uses a three-level hierarchy remarkably similar to our page-scoped registration: `.github/copilot-instructions.md` (repo-wide), `.github/instructions/*.instructions.md` (path-specific via `applyTo:` frontmatter globs), and personal/org instructions. Path-specific instructions are the equivalent of our product page registering product context — navigate to a file matching `src/api/**`, and the API-specific instructions activate automatically.

### Aider — Structural Ambient Context via PageRank

Aider's approach is the most architecturally distinct: it builds a **repository map** by parsing source files into ASTs with tree-sitter, constructing a dependency graph, and running PageRank (personalized by which files are in the chat) to identify the most relevant symbols. This map — typically ~1,024 tokens — is injected as ambient context on every prompt.

This is structural ambient context rather than content-based. Aider doesn't include file contents; it includes a _ranked summary of the codebase's shape_. The map dynamically expands when no files are explicitly added to the conversation, acting as a safety net that ensures the agent always has some awareness of the codebase even without explicit context.

### The Pattern Across Harnesses

All five approaches share the same core insight: **inject what's relevant before the user asks**. They differ on the eager-to-lazy spectrum:

- **Most eager**: Claude Code (110+ components, loaded at session start)
- **Semantic**: Cursor (vector retrieval, inferred relevance)
- **Structural**: Aider (PageRank over AST graph)
- **Hierarchical**: Copilot (path-scoped instruction files)
- **Most explicit**: Cline/Roo Code (manual `@` mentions, `.clinerules`)

Our demo sits at the eager end — contexts are registered declaratively by pages and serialized on every prompt. In production, you'd likely combine approaches: eager registration for known page context, semantic retrieval for codebase-wide relevance, and user toggles for fine-grained control.

## Key Takeaways

1. **Ambient context eliminates clarification round-trips.** Instead of the agent asking "which product?", it already knows — because the product page registered its data when the user navigated there.

2. **Reference counting prevents premature removal.** Shared contexts (like user profile visible in a sidebar) survive individual page transitions because multiple views hold references.

3. **XML serialization makes context typed and cacheable.** Self-closing tags with attributes are token-efficient, LLM-native, and form a stable prompt prefix that enables KV-cache reuse across messages.

4. **User control matters.** Not all context is helpful all the time. Exclude/include toggles let users curate what the agent sees without changing what's on screen.

5. **Persistence bridges sessions.** Saving contexts to disk and restoring them with a `temporary` flag mirrors how CLAUDE.md and `.cursorrules` work — persistent ambient context that's eagerly loaded and lazily reclaimed.

6. **The pattern is pure prompt engineering.** The ReAct loop is unchanged. No new tools, no special LLM capabilities. Just a richer system prompt assembled from live application state.

## Sources & Further Reading

- [CopilotKit — useCopilotReadable](https://docs.copilotkit.ai/reference/hooks/useCopilotReadable) — React hook for registering ambient readable context
- [GitHub Copilot Custom Instructions](https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot) — Path-scoped `.instructions.md` files
- [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) — KV-cache hit rate as the key metric, file system as extended context
- [Google ADK Context Architecture](https://developers.googleblog.com/en/architecting-efficient-context-aware-multi-agent-framework-for-production/) — Tiered storage, compiled views, processor pipelines
- [Aider Repository Map](https://aider.chat/docs/repomap.html) — Tree-sitter + PageRank for structural ambient context
- [Cursor Context System](https://docs.cursor.com/context/) — Semantic indexing with `@` mention overrides
- [MCP Resources Specification](https://modelcontextprotocol.io/docs/concepts/resources) — Application-controlled context primitive with annotations and subscriptions
