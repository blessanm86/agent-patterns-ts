# The 10x Cost Difference: Why Cache Hit Rate Is the Most Important Metric for AI Agents

[Agent Patterns — TypeScript](../../README.md)

> **Previous concept:** [Prompt Caching](../prompt-caching/README.md) — understanding KV-cache mechanics and measuring cache hits. This concept takes the next step: designing the **entire agent architecture** around maximizing cache hit rate, because in production, cache efficiency is the single biggest cost and latency driver.

---

You already know that prompt caching saves money. The [Prompt Caching](../prompt-caching/README.md) concept showed how identical prefixes get their KV vectors reused, and how cloud providers charge 50-90% less for cached tokens.

But knowing about caching and _designing for caching_ are different things. The gap between them is why Manus rebuilt their agent framework four times, why a single HashMap in OpenAI's Codex caused cache hit rates to plummet to 1%, and why Anthropic's Claude Code team treats drops in cache hit rate as production incidents that trigger severity alerts.

This concept is about the architectural shift: from "use caching" to **"every decision serves cache efficiency."**

## Why This Matters More Than You Think

Agent workloads have a unique economic property: **input tokens outnumber output tokens by roughly 100:1.** On every turn, the agent re-reads its entire context — system prompt, tool definitions, conversation history — but generates only a short action (a tool call or brief response). As the conversation grows, the input keeps inflating while output stays short.

With Claude Sonnet 4.6, cached input tokens cost **$0.30/MTok** while uncached cost **$3.00/MTok** — a 10x difference. At a 100:1 input:output ratio, even a small drop in cache hit rate translates to massive cost spikes.

Here's the math for a 20-turn agent session with a 3,000-token prefix:

| Cache Hit Rate | Input Cost (20 turns) |     Difference     |
| :------------: | :-------------------: | :----------------: |
|      95%       |        $0.0054        |      Baseline      |
|      50%       |        $0.0324        | 6x more expensive  |
|       0%       |        $0.0600        | 11x more expensive |

A single changed token in the system prompt — a timestamp, a session ID, a reshuffled tool — drops you from the left column to the right.

## The Three-Zone Architecture

Every production agent that takes caching seriously converges on the same structure:

```
┌────────────────────────────────────────────────────────┐
│  ZONE 1: STABLE PREFIX (cached across all turns)       │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Tool definitions (all tools, always present,     │  │
│  │ deterministically ordered, never removed)        │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │ System prompt (no timestamps, no session IDs,    │  │
│  │ no dynamic content — identical every request)    │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Static context (few-shot examples, policies)     │  │
│  └──────────────────────────────────────────────────┘  │
│  ═══════════ cache breakpoint ① ═══════════════════    │
├────────────────────────────────────────────────────────┤
│  ZONE 2: SEMI-STABLE (grows append-only)               │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Conversation history (previous turns)            │  │
│  │ Tool results from earlier turns                  │  │
│  │ NEVER modified — only appended to                │  │
│  └──────────────────────────────────────────────────┘  │
│  ═══════════ cache breakpoint ② (slides forward) ══    │
├────────────────────────────────────────────────────────┤
│  ZONE 3: DYNAMIC SUFFIX (not cached)                   │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Latest user message                              │  │
│  │ Most recent tool observation                     │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

Zone 1 never changes. Zone 2 only grows. Zone 3 is different every turn. The cache boundary slides forward each turn as Zone 2 grows, and the entire prefix (Zone 1 + Zone 2 up to the previous turn) hits cache.

Anthropic's cache hierarchy enforces this order: `tools → system → messages`. If tools change, the system and message caches are also invalidated. If the system prompt changes, the message cache is invalidated. This cascading invalidation is why stability at the top matters most.

## The Demo

Our benchmark runs a 20-turn recipe planning conversation through three context strategies and measures KV-cache behavior on each turn:

```bash
pnpm dev:kv-cache-design          # full 20-turn benchmark
pnpm dev:kv-cache-design --turns=5  # quick 5-turn run
```

### Strategy 1: Naive (Cache-Hostile)

Demonstrates three common anti-patterns that destroy cache efficiency:

```typescript
// Anti-pattern 1: Timestamp in system prompt — changes every request
buildSystemPrompt(turn: number): string {
  return `Current time: ${new Date().toISOString()}
Session ID: ${Math.random().toString(36).slice(2)}

${BASE_SYSTEM_PROMPT}`;
}

// Anti-pattern 2: Shuffled tool order — randomizes the prefix
buildTools(turn: number, allTools: ToolDefinition[]): ToolDefinition[] {
  const shuffled = [...allTools];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Anti-pattern 3: Mutated history — changes the first message each turn
processHistory(history: Message[], turn: number): Message[] {
  return history.map((msg, i) => {
    if (msg.role === "user" && i === 0) {
      return { ...msg, content: `[last accessed: turn ${turn}] ${msg.content}` };
    }
    return msg;
  });
}
```

Every turn produces a completely different prefix. `prompt_eval_count` stays high — the model re-processes everything from scratch every time.

### Strategy 2: Append-Only (Cache-Friendly)

Follows the three basic rules:

```typescript
// Rule 1: Static system prompt — no timestamps, no dynamic content
buildSystemPrompt(): string {
  return BASE_SYSTEM_PROMPT; // identical every request
}

// Rule 2: Deterministic tool ordering — same array, same order, always
buildTools(_turn: number, allTools: ToolDefinition[]): ToolDefinition[] {
  return allTools;
}

// Rule 3: Append-only history — never modify previous entries
processHistory(history: Message[]): Message[] {
  return history; // unchanged
}
```

On turns 2+, `prompt_eval_count` drops to just the new tokens (latest user message + recent tool results). The entire prefix — system prompt, tools, all previous conversation turns — hits cache.

### Strategy 3: Cache-Optimized (Full Pipeline)

Everything from append-only, plus techniques from Manus and Claude Code:

```typescript
// Tool masking: all tools stay in the prompt, availability noted in text
// (In production: logit masking constrains decoding, not the prompt)
buildSystemPrompt(): string {
  return `${BASE_SYSTEM_PROMPT}

## Tool Availability
All tools are always available. Tool availability is managed via
constrained decoding (logit masking) rather than adding/removing
tools from the prompt, to preserve KV-cache prefix stability.`;
}

// Restorable compression: old verbose tool results → compact references
processHistory(history: Message[], turn: number): Message[] {
  return history.map((msg, turnIndex) => {
    if (msg.role === "tool" && msg.content.length > 200 && turnIndex < turn - 3) {
      const parsed = JSON.parse(msg.content);
      return {
        ...msg,
        content: JSON.stringify({
          _compressed: true,
          _ref: `offload://turn-${turnIndex}/tool-result.json`,
          _keys: Object.keys(parsed),
        }),
      };
    }
    return msg;
  });
}
```

This reduces total context size while maintaining the stable prefix. The agent can "re-read" offloaded content by following the reference — the filesystem is the external memory.

### What to look for in the output

The benchmark prints `prompt_eval_count` (tokens evaluated in prefill) for each turn:

- **Naive**: High and variable across all turns — cache misses everywhere
- **Append-Only**: High on turn 1 (cold), then drops on turns 2+ to just the new tokens
- **Cache-Optimized**: Same cache behavior as append-only, but with fewer total tokens due to compression

The summary table shows the warm-turn averages side by side.

## The Five Rules of Cache-First Design

### Rule 1: Never put timestamps in the system prompt

This is the #1 cache killer in production. A current-time field at the start of the prompt invalidates the entire cache — every single token after it must be recomputed.

```typescript
// BAD: timestamp changes every request
const systemPrompt = `Current time: ${new Date().toISOString()}
You are a recipe assistant...`;

// GOOD: timestamp in the user message (at the end, in the dynamic suffix)
const systemPrompt = `You are a recipe assistant...`;
const userMessage = `[Time: ${new Date().toISOString()}] ${question}`;
```

### Rule 2: Sort tools deterministically

OpenAI's Codex discovered this the hard way. Their MCP integration stored tools in a `HashMap`, which iterates in non-deterministic order. Every request produced a different tool ordering, and since tool definitions sit near the top of the prompt prefix, the entire cache was invalidated on every single turn. Cache hit rates plummeted to below 1%.

The fix was one line: sort tools alphabetically by name before sending to the API.

```typescript
// BAD: HashMap/Map iteration order is non-deterministic
const tools = Object.fromEntries(toolMap.entries());

// GOOD: explicit, stable ordering
const tools = [...toolArray].sort((a, b) => a.function.name.localeCompare(b.function.name));
```

### Rule 3: Never modify previous messages

Editing any earlier message in the conversation invalidates the cache from that point forward. This means no "cleanup" of old tool results, no retroactive corrections, no "last accessed" timestamps on old messages.

```typescript
// BAD: editing old messages to add metadata
history[0].content = `[updated] ${history[0].content}`;

// GOOD: append a new message referencing the old one
history.push({
  role: "user",
  content: `Correction to turn 1: I meant 4 servings, not 2.`,
});
```

### Rule 4: Mask tools instead of removing them

When you need to restrict which tools the agent can use (different phases, state-dependent availability), **don't remove tools from the definitions**. Tool definitions are at the very top of the cache hierarchy — removing one invalidates everything.

Instead, use one of these approaches:

| Approach                       | Used By               | How It Works                                                              |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------- |
| **Logit masking**              | Manus                 | All tools in prompt; constrained decoding prevents selecting masked tools |
| **`allowed_tools` parameter**  | OpenAI Codex          | All tools in prompt; API parameter restricts callable tools per request   |
| **`defer_loading` stubs**      | Claude Code           | Lightweight tool stubs always present; full schemas loaded on demand      |
| **System prompt instructions** | Simulated in our demo | Note in the prompt that certain tools are unavailable                     |

Manus uses consistent tool name prefixes (`browser_*`, `shell_*`) so constraints can be applied efficiently. In Hermes format, they can force a specific tool category by prefilling the response with `<tool_call>{"name": "browser_` — the model can only complete with a browser tool.

### Rule 5: Compress restorably, not destructively

When context grows too long, don't delete or summarize old content — replace it with a **recoverable reference**. The agent can follow the reference to retrieve the original content if it's needed later.

```typescript
// BAD: irreversible summarization
message.content = "Tool returned recipe details for pizza.";

// GOOD: restorable compression — keep a pointer
message.content = JSON.stringify({
  _compressed: true,
  _ref: "offload://turn-3/tool-result.json", // agent can re-read this
  _originalSize: 1847,
  _keys: ["id", "title", "ingredients", "steps"],
});
```

Manus calls the filesystem the "ultimate context" — it's unlimited in size, persistent across steps, and directly operable by the agent. When a web page is dropped from context, the URL stays. When a file's content is compressed, the file path remains. The agent can always fetch the full content when it needs it.

## The Compaction vs. Caching Tension

Context compaction (summarizing old turns to reclaim space) and prompt caching are inherently at odds. Compaction mutates the prefix; caching requires prefix stability. This is the fundamental tradeoff in long-running agents.

Production systems resolve it by **compacting infrequently and in large chunks:**

- **Claude Code** triggers compaction at 150,000 input tokens — well after the cache has provided savings across many turns. The system prompt and tool definitions are preserved verbatim through compaction, so the stable prefix survives.
- **Manus** uses a two-stage approach: first, replace verbose tool results with compact references (restorable compression — cache-safe). Only when that reaches diminishing returns does it apply full summarization (cache-hostile, but infrequent).
- **Factory.ai** recommends wide gaps between the trigger threshold (T_max) and the post-compaction target (T_retained). Narrow gaps cause frequent compaction → frequent cache invalidation. Wide gaps mean fewer compactions → better cache stability.

The principle: **minimize tokens per task, not per request.** An occasional cache miss from compaction is worth it if it prevents running out of context entirely.

## In the Wild: Coding Agent Harnesses

Cache-aware context design is not an optimization technique you can bolt on — it's an architectural foundation that shapes every feature decision. The coding agent harnesses are the clearest proof of this.

**Claude Code** exemplifies cache-first architecture most explicitly. Thariq Shihipar (Claude Code engineer) stated: "You fundamentally have to design agents for prompt caching first — almost every feature touches on it somehow." The team treats drops in cache hit rate as production incidents that trigger severity alerts. Real sessions achieve **96% cache hit rates**, with nearly 100% of input tokens read from cache after the first turn. Specific design decisions shaped by caching: plan mode is implemented as a callable tool (rather than a configuration switch) to preserve the cached prefix; all tools remain in every request using lightweight stubs with `defer_loading` flags; model switching routes through subagents rather than switching mid-session; and compaction triggers only at 150,000 tokens while preserving system prompt and tools verbatim. The system prompt (~4,000 tokens) is identical across all users, so every Claude Code session worldwide shares the same prefix cache. Without prompt caching, a long Opus coding session would cost $50-100 in input tokens; with it, $10-19 — this is what makes Claude Code Pro at $20/month economically viable.

**OpenAI Codex** provides the canonical cautionary tale. Their Responses API server assembles the prompt in a deterministic order — system message, then tool definitions, then instructions, then conversation history — specifically so each turn's prompt is an exact prefix of the next turn's prompt. This worked perfectly until MCP integration introduced a `HashMap` for storing tool servers. HashMap iteration is non-deterministic, so tool definitions appeared in a different order on every turn. Because tools come near the top of the prompt, this invalidated the cache for _everything_ — instructions, conversation history, all of it. Cache hit rates dropped to below 1% for users with MCP tools, and usage limits were hit immediately. The fix (PR #2611) was sorting tools alphabetically — a one-line change with outsized impact. Codex also uses `allowed_tools` to restrict tool availability per turn without modifying the cached tool array, and `x-codex-turn-state` headers for session-sticky routing that keeps requests on the same machine where the KV cache lives.

**Aider** takes a practical approach with explicit cache management. The `--cache-prompts` flag enables caching for four components (system prompt, read-only files, repository map, editable files), and `--cache-keepalive-pings N` sends pings every 5 minutes to prevent Anthropic's cache from expiring during idle periods. This addresses a real-world issue: a developer pausing to think for 6 minutes would lose their entire cache (Anthropic's default TTL is 5 minutes) and pay the full recomputation cost on their next action.

**Cline** demonstrates cache-aware context _reduction_. Rather than aggressively truncating conversation history (which breaks the cache prefix), Cline removes redundant file reads — keeping only the latest version of each file while preserving narrative integrity. Their blog describes the insight: "Aggressively truncating older messages can break the cache and increase costs on subsequent turns." They also optimized their system prompt by replacing inline MCP server instructions (previously 30% of the system prompt, ~8,000 tokens) with a `load_mcp_documentation` tool that retrieves docs only when needed — making the static prefix smaller and more stable.

## Cross-Provider Caching Comparison

The mechanics differ, but the principle is universal:

| Feature                | Anthropic                       | OpenAI                   | DeepSeek        | Google Gemini               |
| ---------------------- | ------------------------------- | ------------------------ | --------------- | --------------------------- |
| **Mode**               | Auto + explicit breakpoints     | Fully automatic          | Fully automatic | Implicit + explicit objects |
| **Cache read savings** | 90% (0.1x base)                 | 50-90% (model-dependent) | 90% (0.1x base) | 90% (0.1x, Gemini 2.5+)     |
| **Cache write cost**   | 1.25x base (5min) / 2x (1hr)    | No premium               | No premium      | No premium (implicit)       |
| **Min prefix**         | 1,024-4,096 tokens              | 1,024 tokens             | 64 tokens       | 1,024-4,096 tokens          |
| **TTL**                | 5 min / 1 hr (refreshes on hit) | 5-10 min (auto) / 24 hr  | Hours to days   | Configurable                |
| **Granularity**        | Up to 4 breakpoints             | 128-token increments     | 64-token units  | Named cache objects         |
| **Tool restriction**   | N/A (prompt-level)              | `allowed_tools` param    | N/A             | N/A                         |

DeepSeek's approach is architecturally unique: their Multi-Latent Attention (MLA) compresses KV cache to ~7% of standard size, enabling disk-based caching rather than expensive GPU memory. This makes caching dramatically cheaper at the infrastructure level — cached tokens cost $0.028/MTok vs. $0.28/MTok uncached.

## Key Takeaways

1. **Cache hit rate is the #1 production metric for agents.** Not accuracy, not latency, not token count — cache hit rate. It's the biggest lever for both cost (10x on Anthropic) and latency (up to 80% TTFT reduction). Manus declared it their most important metric. Claude Code treats drops as production incidents.

2. **The three-zone architecture is universal.** Stable prefix (tools + system prompt) → semi-stable middle (append-only history) → dynamic suffix (latest message). Every production harness converges on this structure because prefix caching demands it.

3. **One changed token destroys everything downstream.** A timestamp in the system prompt, a reshuffled tool list, an edited old message — any single-token change invalidates the cache from that point forward. The damage cascades: Anthropic's hierarchy is `tools → system → messages`, so a tool change invalidates all three layers.

4. **Never remove tools — mask them.** Manus uses logit masking, OpenAI uses `allowed_tools`, Claude Code uses `defer_loading` stubs. The prompt stays byte-identical; only the decoder's output space changes.

5. **Compress restorably, compact infrequently.** Replace verbose content with recoverable references (URLs, file paths) — the agent can fetch the original when needed. Reserve full compaction (cache-hostile) for when context is nearly full, and do it in large chunks to amortize the cache miss.

6. **The MCP tool ordering bug is the canonical example.** A HashMap in OpenAI's Codex produced non-deterministic tool ordering, dropping cache hit rates to 1%. The fix: sort tools alphabetically. One line of code, order-of-magnitude cost impact.

## Sources & Further Reading

- [Manus — Context Engineering for AI Agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) — the definitive write-up on KV-cache-first architecture, append-only context, logit masking, and restorable compression
- [OpenAI — Unrolling the Codex Agent Loop](https://openai.com/index/unrolling-the-codex-agent-loop/) — the MCP tool ordering cache bug and prompt assembly pipeline
- [OpenAI Codex PR #2611](https://github.com/openai/codex/pull/2611) — the one-line fix that restored cache hit rates
- [Anthropic — Prompt Caching Docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) — cache hierarchy, breakpoints, TTL, and pricing
- [Don't Break the Cache (arxiv)](https://arxiv.org/html/2601.06007v1) — benchmarking prompt caching across providers in 500+ agent sessions; full-context caching can paradoxically increase latency
- [Lance Martin — Agent Design Patterns](https://rlancemartin.github.io/2026/01/09/agent_design/) — "Cache Context" as one of seven core agent patterns
- [Lance Martin — Context Engineering in Manus](https://rlancemartin.github.io/2025/10/15/manus/) — analysis of Manus's three-strategy context management
- [Anthropic Says Cache Misses Are Production Incidents](https://www.implicator.ai/anthropic-says-cache-misses-are-production-incidents-reveals-caching-shaped-claude-code/) — how caching shaped Claude Code's architecture
- [Simon Willison quoting Thariq Shihipar](https://simonwillison.net/2026/Feb/20/thariq-shihipar/) — "you fundamentally have to design agents for prompt caching first"
- [Aider — Prompt Caching Docs](https://aider.chat/docs/usage/caching.html) — keepalive pings and cache component strategy
- [Cline — Context Optimization Blog](https://cline.bot/blog/inside-clines-framework-for-optimizing-context-maintaining-narrative-integrity-and-enabling-smarter-ai) — file deduplication over truncation for cache preservation
- [Factory.ai — Compressing Context](https://factory.ai/news/compressing-context) — the compaction vs. caching tradeoff; minimize tokens per task, not per request
- [OpenAI — Prompt Caching 201](https://developers.openai.com/cookbook/examples/prompt_caching_201/) — `allowed_tools`, `prompt_cache_key`, routing stickiness
- [DeepSeek — Context Caching](https://api-docs.deepseek.com/guides/kv_cache) — disk-based caching enabled by MLA architecture
- [llm-d — KV-Cache Wins You Can See](https://llm-d.ai/blog/kvcache-wins-you-can-see) — 57x faster response times with prefix-cache-aware scheduling in distributed inference

---

[Agent Patterns — TypeScript](../../README.md) · [Previous: Prompt Caching](../prompt-caching/README.md)
