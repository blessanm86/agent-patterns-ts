# Stateless by Design — How to Scale Agents Without Sticky Sessions

[Agent Patterns — TypeScript](../../README.md)

---

Every time you type a message into Claude Code, ChatGPT, or any LLM chat interface, something invisible happens: the **entire conversation history** gets sent back to the model. The model doesn't "remember" you — it re-reads everything from scratch. This isn't a limitation. It's the most important architectural decision in modern agent systems.

This post explores why stateless agents with history re-injection dominate production deployments, how to build one, and why the re-injection cost is a feature, not a bug.

## The Core Idea

A stateless agent has no memory between invocations. On every turn:

1. **Load** the full conversation history from an external store (database, Redis, file)
2. **Inject** it into the prompt alongside the new user message
3. **Run** a fresh agent session — the model processes everything from scratch
4. **Save** only the new messages back to the store

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   User       │────▶│ Load Balancer │────▶│  Worker 1   │
│   Message    │     │ (random pick) │     │  (fresh!)   │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                 │
                    ┌──────────────┐              │
                    │   History    │◀─── load ────┘
                    │   Store      │──── save ────▶ new messages
                    │  (DB/Redis)  │
                    └──────────────┘
```

Any worker can serve any conversation. Workers are interchangeable because all state lives in the store.

## Why Not Just Keep State in the Worker?

Session-pinned (stateful) agents seem simpler — keep the conversation in memory, avoid the re-injection cost. But they introduce hard operational problems:

| Problem        | Stateful (session-pinned)                                              | Stateless (re-injection)                                       |
| -------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Scaling**    | Sticky routing required; new workers can't help existing conversations | Any worker serves any conversation; add workers = add capacity |
| **Failover**   | Worker dies → conversation lost (or complex state transfer)            | Worker dies → next worker loads from store; invisible to user  |
| **Deployment** | Drain existing sessions before rolling update                          | Kill and replace workers freely                                |
| **Compliance** | Sensitive data lingers in worker memory                                | Store handles encryption and retention; workers are stateless  |
| **Cost**       | Lower per-turn token cost                                              | Higher per-turn, but offset by prompt caching (90% reduction)  |

Practitioner benchmarks paint a clear picture:

| Metric                | Stateless                             | Stateful                              |
| --------------------- | ------------------------------------- | ------------------------------------- |
| Response latency      | 50-150ms                              | 150-500ms                             |
| Scaling efficiency    | 99.9% linear                          | Vertical constraints (sticky routing) |
| Monthly cost (1M MAU) | ~$3,500                               | ~$9,400 (2.7x)                        |
| Tokens per exchange   | ~1,000 (includes re-injected history) | <100 (with KV cache)                  |

The re-injection cost is real — but manageable. And the operational simplicity is transformative.

## The Demo: Restaurant Agent with Worker Pool

This demo builds a restaurant order assistant backed by a pool of 3 simulated workers. Each turn, a random worker is selected to serve the conversation — demonstrating that no worker carries any memory.

### Architecture

```
src/stateless-agent/
├── README.md           # this post
├── index.ts            # CLI with /kill, /revive, /workers commands
├── agent.ts            # stateless ReAct loop (fresh each invocation)
├── tools.ts            # restaurant tools: menu, ordering, status
├── history-store.ts    # external JSON store (simulates database)
└── worker-pool.ts      # worker pool with random assignment
```

### The History Store

The canonical conversation history lives in a JSON file (simulating a database). Every message gets timestamped and tagged with the worker that produced it:

```typescript
export interface TimestampedMessage extends Message {
  timestamp: string;
  workerId?: string; // which worker produced this message
}

export interface ConversationRecord {
  threadId: string;
  messages: TimestampedMessage[];
  createdAt: string;
  updatedAt: string;
}
```

The store exposes simple CRUD operations: `getOrCreateConversation()`, `appendMessages()`, `toModelMessages()`. In production, this would be Postgres, Redis, or DynamoDB — the pattern is identical.

**Choosing a store in production:**

| Store                 | Latency | Use Case                                                         |
| --------------------- | ------- | ---------------------------------------------------------------- |
| Redis                 | <1ms    | Active session state; 30-60 min TTL, hot path                    |
| PostgreSQL / DynamoDB | 5-20ms  | Durable logs, compliance, GDPR deletion support                  |
| Vector DB             | 10-50ms | Semantic retrieval of relevant past context (medium-term memory) |
| In-memory             | <0.1ms  | Fastest, but prevents horizontal scaling — needs session pinning |

### The Stateless Agent Function

The agent function is the heart of the pattern. It receives the full history, runs a fresh ReAct loop, and returns only the new messages:

```typescript
export async function runStatelessAgent(
  userMessage: string,
  history: Message[], // loaded from external store
  worker: Worker, // which worker is serving (for logging)
): Promise<AgentResult> {
  // Build messages: full history + new user message
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  // Fresh ReAct loop — no state from prior invocations
  while (iterations < MAX_ITERATIONS) {
    const response = await ollama.chat({ model, system, messages, tools });
    // ... execute tools, push results, loop
  }

  return { newMessages, iterations, workerId, historySize };
}
```

Key detail: the function has **zero state between invocations**. Call it with the same history from any worker and you get the same behavior.

### The Worker Pool

Workers are deliberately simple — just an ID and an alive flag:

```typescript
export class WorkerPool {
  pickRandom(): Worker {
    const alive = this.workers.filter((w) => w.alive);
    return alive[Math.floor(Math.random() * alive.length)];
  }

  kill(workerId: string): boolean {
    /* mark as dead */
  }
  revive(workerId: string): boolean {
    /* mark as alive */
  }
}
```

No sticky routing, no session affinity, no state transfer. The pool doesn't know anything about conversations — it just hands out workers.

### The Turn Cycle

Each user turn follows the same 4-step pattern:

```typescript
// Step 1: Load full history from external store
const record = getOrCreateConversation(threadId);
const history = toModelMessages(record);

// Step 2: Pick a random worker (no sticky routing)
const worker = pool.pickRandom();

// Step 3: Run a FRESH agent session — worker has no memory
const result = await runStatelessAgent(userMessage, history, worker);

// Step 4: Save new messages to external store
appendMessages(threadId, result.newMessages);
```

### Failover Demo

The CLI lets you kill workers mid-conversation:

```
You: Show me the menu
📡 Routed to Worker 2 (re-injecting 0 messages)
Assistant: Here's our menu! ...
ℹ️  Served by: Worker 2 | History re-injected: 0 msgs

/kill 2
💀 Worker 2 killed! (2 workers remaining)
Next turn will seamlessly route to a surviving worker.

You: I'd like the Grilled Salmon please
📡 Routed to Worker 3 (re-injecting 4 messages)
Assistant: Great choice! The Grilled Salmon is $24. What name for the order?
ℹ️  Served by: Worker 3 | History re-injected: 4 msgs
```

Worker 3 has never seen this conversation before. It loaded the full history from the store, processed it fresh, and continued seamlessly. The user noticed nothing.

## The Re-Injection Cost (and Why It's Fine)

The obvious concern: doesn't re-sending the entire history every turn waste tokens?

Yes — in theory. A 20-turn conversation might re-inject 10,000 tokens per turn. Without mitigation, that's expensive. But **prompt caching** makes it nearly free — and there's a critical nuance about _what_ to cache.

### How Prompt Caching Works

When you send the same prefix repeatedly, providers cache the KV-state from the first computation:

| Turn   | What happens                                            | Cost                |
| ------ | ------------------------------------------------------- | ------------------- |
| Turn 1 | Process system + user message                           | 1.25x (cache write) |
| Turn 2 | Cache hit on turn 1 prefix, process only new content    | 0.1x (cache read)   |
| Turn 3 | Cache hit on turns 1-2 prefix, process only new content | 0.1x (cache read)   |

Over a 5-turn conversation with 10K cached tokens:

- **Without caching**: 10K x 5 turns x $5/MTok = **$0.25**
- **With caching**: 1 write + 4 reads = **~$0.01**
- **Savings: 96%**

Anthropic offers cache reads at 0.1x cost (90% discount) with a 5-minute TTL that auto-refreshes on use. OpenAI reports 40-80% cost improvement through server-side caching with the Responses API compared to Chat Completions.

### Don't Break the Cache

The ["Don't Break the Cache" paper (arXiv:2601.06007)](https://arxiv.org/abs/2601.06007) tested prompt caching across OpenAI, Anthropic, and Google on 500+ agent sessions, and found a critical nuance: **naive full-context caching can actually regress performance**.

| Strategy             | Cost Savings | TTFT Improvement                |
| -------------------- | ------------ | ------------------------------- |
| System prompt only   | 41-81%       | Most consistent                 |
| Exclude tool results | 27-80%       | 13-31%                          |
| Full context caching | 38-81%       | Can _worsen_ (-8.8% for GPT-4o) |

The lesson: **cache the stable prefix (system prompt + tool definitions), but don't try to cache dynamic conversation content across sessions.** Within a single conversation, the auto-advancing cache works well. Across sessions or after modifications (summarization, pruning), cache invalidation can hurt more than it helps.

This has a direct architectural implication: structure your prompt so cacheable content comes first and remains stable. Dynamic history follows the prefix.

```
┌─────────────────────────────┐  ← Stable prefix (cacheable)
│  System prompt              │
│  Tool definitions           │
├─────────────────────────────┤  ← Dynamic (auto-cached within session)
│  Conversation history       │
│  New user message           │
└─────────────────────────────┘
```

### The Pensieve Paper

The [Pensieve paper (arXiv:2312.05516)](https://arxiv.org/abs/2312.05516) quantifies the cost at the GPU serving layer. In multi-turn conversations, stateless re-processing causes 1.5-3x throughput loss. By caching KV-state in a two-tier GPU-CPU hierarchy:

- **1.51-1.95x throughput** improvement over vLLM
- **60-75% p90 latency** reduction
- Tested on real conversation datasets (ShareGPT: 15,553 conversations, avg 7.58 turns; LMSYS: 79,166 conversations, avg 7.73 turns)

Key techniques: pipelined GPU-CPU transfers overlapping with computation, ahead-of-time eviction when GPU utilization exceeds thresholds, and selective eviction (only trailing half of histories) to preserve early context tokens. The re-injection cost that seemed expensive is actually the foundation for massive optimization.

## The Great Divergence: Anthropic vs OpenAI

The two leading labs have taken opposite philosophical stances on agent state, and understanding this tension is key to making good architectural choices.

### Anthropic: Stateless + Structured Artifacts

Anthropic's Messages API is **stateless only** — no server-side sessions, no conversation objects. They compensate with prompt caching (90% discount on re-injected tokens) and detailed guidance on three compaction strategies:

1. **Tool result clearing**: Remove verbose tool outputs from older turns (lightest weight)
2. **Structured note-taking**: Agents write notes to persistent storage _outside_ the context window, re-injected when relevant
3. **Multi-agent delegation**: Sub-agents handle focused tasks with clean context, returning condensed summaries

For long-running agents spanning multiple sessions, Anthropic recommends a key insight: **the right persistence unit is structured artifacts, not raw conversation history.** Their two-agent pattern has an initializer agent set up the environment and write progress files (JSON feature lists, `claude-progress.txt`, git commits), then a coding agent reads those artifacts at the start of each session instead of reconstructing context from messages. A fresh agent with a progress file outperforms a stale agent with 50 turns of history.

### OpenAI: Server-Managed State

OpenAI is moving the opposite direction — toward **server-managed state as the default**. The Responses API offers `conversation` objects (durable, server-managed threads) and `previous_response_id` (explicit chaining). The Assistants API provides full server-side threads. Their AWS Stateful Runtime Environment bets on persistent model context as the future.

They report 40-80% cost improvement with the Responses API compared to Chat Completions, largely from better server-side caching. The `truncation: "auto"` option and `compact()` method handle context overflow server-side.

### Where They Agree

Both agree that **raw conversation history is insufficient for long-running agents.** Anthropic uses structured artifacts (progress files, feature lists, git). OpenAI uses server-managed persistent state. Both converge on the need for "summarized, structured state" rather than raw message logs.

The practical implication: for conversations under ~20 turns, stateless re-injection is fine as-is. For longer sessions, you need compaction or artifact-based persistence regardless of which provider you use.

## How Frameworks Implement This

Every major agent framework converges on the same fundamental architecture: **stateless compute + externalized state.** They differ in how much they handle for you.

### LangGraph

LangGraph Platform is the gold standard for the stateless worker + shared store pattern. All server instances are stateless. Checkpointers save graph state (including message history) to shared stores. Any worker can resume any conversation by loading the latest checkpoint.

```
Workers (stateless) ←→ Checkpoint Store (Postgres / Redis / DynamoDB)
```

Built-in store adapters: PostgresSaver, SqliteSaver, MongoDBSaver, Redis, DynamoDB. Context trimming is manual via `trim_messages()`, `RemoveMessage`, or LLM-based summarization applied in graph nodes. The legacy `RunnableWithMessageHistory` is deprecated in favor of native checkpointing.

### Vercel AI SDK

The most explicitly stateless framework. Server-side functions (`streamText`, `generateText`) are pure with no built-in persistence. AI SDK 5 introduced the **UIMessage / ModelMessage split**: persist UIMessages (rich, UI-friendly format), convert to ModelMessages before LLM calls. With server-side persistence, only the chat ID and new message travel over the wire — history is loaded server-side. Designed for serverless (Vercel Functions, Edge Runtime) — inherently stateless.

### LlamaIndex

Stateless by default. State is opt-in via a serializable `Context` object: `ctx.to_dict(serializer=JsonSerializer())`. No built-in store adapters — the developer chooses their own backend. Maximally flexible but more infrastructure work. `ChatMemoryBuffer(token_limit=N)` for auto-trimming, `ChatSummaryMemoryBuffer` for compression.

### Mastra

The most opinionated about memory. Four distinct types: message history, working memory (persistent structured data), semantic recall (vector search over old messages), and **observational memory** — background agents that compress old messages into dense observations. This last one is unique: instead of summarizing history when you hit the limit, Mastra proactively compresses in the background, keeping the context window small while preserving long-term knowledge.

### Framework Comparison

| Dimension            | LangGraph                          | Vercel AI SDK                  | LlamaIndex                          | Mastra                               |
| -------------------- | ---------------------------------- | ------------------------------ | ----------------------------------- | ------------------------------------ |
| **Default**          | Stateless (checkpointer opt-in)    | Stateless                      | Stateless                           | Stateless (Memory opt-in)            |
| **Re-injection**     | Automatic via checkpointer         | Manual (load from DB, convert) | Manual (pass restored Context)      | Automatic via Memory                 |
| **Built-in stores**  | 6+ (Postgres, Redis, DynamoDB...)  | None (BYO)                     | None (BYO)                          | 3+ (LibSQL, Postgres, MongoDB)       |
| **Context trimming** | `trim_messages`, summarization     | None built-in                  | `ChatMemoryBuffer(token_limit)`     | `lastMessages`, observational memory |
| **Scaling model**    | Stateless workers + shared store   | Serverless-native              | BYO infrastructure                  | BYO + Trigger.dev                    |
| **Unique feature**   | Time-travel via checkpoint history | UIMessage/ModelMessage split   | Pydantic-typed serializable Context | Background compression agents        |

## In the Wild: Coding Agent Harnesses

Every major coding agent harness uses stateless re-injection — they have to, because they all use stateless LLM APIs. But they diverge significantly on _compaction strategy_ when conversations get long.

### Claude Code

The purest stateless example. Every turn sends a fresh API call to the Messages API with the full conversation history. No server-side sessions. Anthropic's automatic prompt caching means the system prompt + tool definitions + prior turns get cached at 0.1x cost. Without isolation, each subprocess invocation loads ~50K tokens; with proper scoping, this drops to ~5K (10x reduction).

**Compaction**: Clears older tool outputs first (lightest touch), then summarizes the conversation if needed. Users are advised to put critical instructions in `CLAUDE.md` rather than relying on early conversation messages surviving compaction. Subagents get completely isolated context windows — their work doesn't bloat the main conversation.

### OpenAI Codex CLI

The most explicitly stateless at the API level — it **does not use `previous_response_id`** despite being OpenAI's own tool. Every request is fully self-contained. However, Codex CLI has a unique compaction approach: **encrypted opaque compaction.** Instead of LLM-generated natural language summaries, it uses a `type=compaction` item with encrypted content that "preserves the model's latent understanding of the original conversation." This is fundamentally different from every other harness — it maintains model-internal state rather than human-readable summaries.

Per-session, it uses `Mutex<SessionState>` with a `ContextManager`. Per-turn, frozen `TurnContext` snapshots ensure immutability during model calls. History is recorded to JSONL for replay. The `x-codex-turn-state` header provides session affinity for prompt cache reuse.

### Aider

Two-tier message system: `done_messages` (completed history) and `cur_messages` (current turn). Each API call assembles fresh context from system prompts + repo map + file contents + history. When token limits approach, a `ChatSummary` class runs **in a background thread** to avoid blocking — summarization happens asynchronously via `move_back_cur_messages()`. A separate (cheaper/faster) model can be configured for summarization. The `--cache-prompts` flag enables provider-level prompt caching.

### OpenCode

Go TUI + JS HTTP server with SQLite persistence. Reconstructs full context per turn. Key detail: errored assistant messages are filtered out before sending (`m.info.role === "assistant" && m.info.error`) to prevent hallucination feedback loops. Auto-compaction triggers at 90% of (context window - output limit), asking the LLM to summarize "what we did, what we're doing, which files we're working on, and what we're going to do next."

### Cline

A unique **middle-out truncation** strategy: preserves the first and last messages, removes from the middle of the conversation. This exploits the LLM attention pattern where the beginning (task setup) and end (recent context) matter most. Auto-compaction triggers at 80% context usage. Also deduplicates redundant file reads with `[DUPLICATE FILE READ]` notices.

### Windsurf (Cascade)

The most interesting divergence from the standard pattern. Rather than full history re-injection, Windsurf uses **selective retrieval from RAG-indexed conversation history and codebase.** It autonomously generates memories between conversations, creates named snapshots, and retrieves only the most relevant parts. "It typically will not retrieve the full conversation as to not overwhelm the context window." This is closer to how a human re-reads — skim for relevance rather than replaying everything.

### Harness Comparison

| Harness         | Compaction Trigger       | Strategy                                                  | Prompt Caching                 |
| --------------- | ------------------------ | --------------------------------------------------------- | ------------------------------ |
| **Claude Code** | Auto (near limit)        | Clear tool outputs first, then summarize                  | Yes (90% discount)             |
| **Codex CLI**   | Configurable threshold   | Encrypted opaque compaction (model-internal state)        | Yes (session affinity headers) |
| **Aider**       | Configurable token limit | Background thread summarization                           | Optional (`--cache-prompts`)   |
| **OpenCode**    | 90% of context           | LLM-generated summary                                     | Provider-dependent             |
| **Cline**       | 80% of context           | Middle-out truncation + summarization                     | Provider-dependent             |
| **Copilot CLI** | 95% of context           | Checkpoint-based compaction                               | Unknown                        |
| **Windsurf**    | Selective retrieval      | RAG over conversation + summaries (not full re-injection) | Unknown                        |

The common pattern: **reconstruct full context each turn, manage history externally, compress when approaching limits.** The divergence is in _how_ they compress — natural language summaries (most), encrypted model state (Codex), or selective retrieval (Windsurf).

## Failure Modes and Anti-Patterns

Research and practitioner experience reveal several common failures with stateless re-injection:

1. **Cache invalidation on mutation**: Summarizing or pruning conversation history **breaks the cached prefix**, invalidating prompt cache. This is the #1 operational lesson from the "Don't Break the Cache" paper. If you modify history, you lose the cache.

2. **Memory bloat**: Retaining too much history creates latency issues and irrelevant recall. Solution: summarize + chunk + use semantic search for older context rather than stuffing everything into the prompt.

3. **Over-engineering trap**: Building complex stateful infrastructure before validating need. The universal recommendation: start stateless, measure friction, add state selectively.

4. **Cross-user data bleed**: Inadequate session isolation in multi-tenant systems. Strict thread-level isolation in the store is essential.

5. **Context anxiety** (observed in Devin): The model takes shortcuts or leaves tasks incomplete when it _believes_ it's near the end of its context window, even when it has plenty of room. Context-window awareness can backfire.

6. **Context pollution from RAG**: Embedding-based retrieval can inject irrelevant information into the prompt. Newer reasoning models explicitly prefer simpler, shorter prompts over maximally-stuffed context windows.

7. **Error feedback loops**: Re-injecting errored assistant messages can trigger hallucination cascades. OpenCode's approach of filtering these out (`m.info.error`) before re-injection is a good defensive pattern.

## Key Takeaways

1. **Stateless is the default** — every major LLM API is stateless at the model level, even the "stateful" ones. Building stateful on top adds complexity without proportional benefit for most use cases.

2. **The history store is the single source of truth** — not the worker, not the model, not the in-memory state. The store is what makes failover, scaling, and replay possible.

3. **Re-injection cost is solved by prompt caching** — but cache only the stable prefix (system prompt + tool defs). Dynamic history benefits from auto-advancing within-session caching, but across sessions or after mutations, be careful not to break the cache.

4. **Workers should be disposable** — kill them, replace them, scale them. If your architecture can't survive a random worker dying mid-conversation, you have sticky state leaking in.

5. **Start stateless, add state selectively** — the dominant production pattern is a session-scoped hybrid: Redis for hot state during active conversations (30-60 min TTL), persistent DB for cold storage and compliance. Don't build the complex version first.

6. **For long-running agents, persist structured artifacts, not raw history** — Anthropic's key insight: progress files, feature lists, and git commits carry state between sessions far more effectively than message logs. A fresh agent reading a progress file outperforms a stale agent with 50 turns of history.

## Running the Demo

```bash
# Start Ollama
ollama serve
ollama pull qwen2.5:7b

# Run the demo
pnpm dev:stateless-agent
```

Try this sequence:

1. Ask to see the menu
2. Place an order
3. `/kill 2` to kill a worker
4. Continue the conversation — notice seamless failover
5. `/workers` to see pool status
6. `/revive 2` to bring a worker back

## Sources & Further Reading

- [Pensieve: Stateful LLM Serving with KV-Cache Reuse (arXiv:2312.05516)](https://arxiv.org/abs/2312.05516) — quantifies re-injection cost, proposes multi-tier GPU/CPU caching; 1.51-1.95x throughput improvement
- [Don't Break the Cache (arXiv:2601.06007)](https://arxiv.org/abs/2601.06007) — evaluates prompt caching strategies; naive full-context caching can regress performance
- [OpenAI — Conversation State Guide](https://platform.openai.com/docs/guides/conversation-state) — explains three tiers: Chat Completions, Responses API, Assistants API
- [Anthropic — Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — 90% cost reduction, TTL options, auto-advancing cache breakpoints
- [Anthropic — Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — compaction, structured note-taking, multi-agent delegation
- [Anthropic — Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — two-agent pattern, artifact-based state persistence
- [LangGraph Platform — Why You Need It](https://blog.langchain.com/why-langgraph-platform/) — stateless workers + checkpoint stores at scale
- [Vercel AI SDK — Chatbot Message Persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence) — UIMessage/ModelMessage split, server-side re-injection
- [Stateful vs Stateless AI Agents (ruh.ai)](https://www.ruh.ai/blogs/stateful-vs-stateless-ai-agents) — practitioner benchmarks: $3,500 vs $9,400/mo at 1M MAU
- [Benchmarking Stateless vs Stateful Agent Architectures (Desell, 2025)](https://www.researchgate.net/publication/399576067_Benchmarking_Stateless_Versus_Stateful_LLM_Agent_Architectures_in_Enterprise_Environments) — hybrid semantic checkpointing as production-ready middle ground
- [Mistral — Agents & Conversations](https://docs.mistral.ai/agents/agents) — the stateful API counter-example with server-side conversation IDs
- [Multi-Turn Conversation Evaluation Survey (arXiv:2503.22458)](https://arxiv.org/html/2503.22458v1) — memory/context retention as first-class evaluation dimension

_Builds on: [Multi-Turn Conversation Memory](../conversation-memory/README.md), [Context Window Management](../context-management/README.md)_
