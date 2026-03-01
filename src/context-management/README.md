# Context Window Management

_Part of [Agent Patterns — TypeScript](../../README.md). Builds on [Multi-Turn Conversation Memory](../conversation-memory/README.md)._

---

Your agent remembers everything — until it doesn't.

Turn 47 of a coding session, the agent "forgets" the architecture decision from turn 3. It's not a bug in the model. Your context window is full, and everything in the middle is fading.

This isn't a theoretical concern. Every LLM API is stateless — each request sends the **full conversation history**. As conversations grow, three things break:

1. **Token limits** — exceed the window and the request fails outright
2. **Context rot** — even within limits, accuracy degrades as context grows
3. **Cost and latency** — more tokens = more money = slower responses

Context management is the discipline of deciding **what stays in the window and what gets cut** — without losing the information the agent needs to do its job.

## The Problem: Linear Growth, Fixed Window

```
Tokens
  ▲
  │                                    ╱ ← Context limit
  │                                  ╱
  │                               ╱
  │                            ╱     ← Quality degrades here
  │                         ╱           (context rot)
  │                      ╱
  │                   ╱
  │                ╱
  │             ╱
  │          ╱
  │       ╱
  │    ╱
  │ ╱
  └──────────────────────────────────────► Turns
```

Every turn adds tokens: the user's message, the assistant's reasoning, tool calls, and tool results. A research agent reading 3-4 articles easily generates 5,000+ tokens per turn. At that rate, an 8K budget fills in 2 turns. A 128K budget fills in ~25 turns.

But the problem starts **before** you hit the limit. The "Lost in the Middle" research (Liu et al., 2023) showed that LLMs exhibit a **U-shaped performance curve**: best recall at the beginning and end of context, worst in the middle. Performance degrades >30% when critical information sits in the middle.

More context is not always better.

## The Full Taxonomy: 10 Strategies

Context management strategies exist on a spectrum from simple to sophisticated:

| #   | Strategy                       | Token Savings |   Quality    |  Latency Cost  | Complexity |
| --- | ------------------------------ | :-----------: | :----------: | :------------: | :--------: |
| 1   | Naive truncation               |     High      |     Bad      |      None      |  Trivial   |
| 2   | **Sliding window**             |     High      |   Moderate   |      None      |    Low     |
| 3   | Progressive summarization      |    Medium     |    Mixed     |  +1 LLM call   |   Medium   |
| 4   | **Summary + buffer hybrid**    |    Medium     |     Good     |  +1 LLM call   |   Medium   |
| 5   | **Observation masking**        |  High (50%+)  |     Good     |      None      |    Low     |
| 6   | Prompt compression (LLMLingua) |   Very high   | Minimal loss |  Small model   |    High    |
| 7   | Server-side compaction         |     High      |     Good     |  +1 LLM call   |   Medium   |
| 8   | External memory / notes        |     High      |     Good     |    File I/O    |   Medium   |
| 9   | Sub-agent delegation           |  N/A (fresh)  |     Good     | Agent overhead |    High    |
| 10  | Just-in-time retrieval (RAG)   |     High      |     Good     |   Tool call    |   Medium   |

This demo implements strategies **2, 4, and 5** (bolded above) — the three most practical for agent builders. They cover three different tradeoff points: zero-cost simplicity, quality-preserving compression, and the research-backed surprise winner.

## The Core Abstraction

Every strategy implements one interface:

```ts
interface ContextStrategy {
  name: string;
  description: string;
  prepare(messages: Message[], tokenBudget: number): Promise<Message[]>;
}
```

Take messages + budget, return trimmed messages. The agent loop calls `strategy.prepare()` before each LLM call:

```ts
while (true) {
  // Apply context management before each LLM call
  const prepared = strategy ? await strategy.prepare(messages, tokenBudget) : messages;

  const response = await ollama.chat({
    model: MODEL,
    messages: prepared,
    tools,
  });
  // ... standard ReAct loop
}
```

This is the entire integration point. Strategies are pluggable message transformers — swap them at runtime without touching the agent logic.

## Strategy 1: Sliding Window

The simplest approach. Keep only the most recent messages that fit within the token budget.

```ts
async prepare(messages: Message[], tokenBudget: number): Promise<Message[]> {
  if (estimateMessageTokens(messages) <= tokenBudget) return messages;

  // Keep the first message (often sets context)
  const first = messages[0];
  const remainingBudget = tokenBudget - estimateMessageTokens([first]);

  // Walk backwards, adding messages until we hit the budget
  const recent: Message[] = [];
  let usedTokens = 0;

  for (let i = messages.length - 1; i >= 1; i--) {
    const msgTokens = estimateMessageTokens([messages[i]]);
    if (usedTokens + msgTokens > remainingBudget) break;
    recent.unshift(messages[i]);
    usedTokens += msgTokens;
  }

  return [first, ...recent];
}
```

**When to use**: Short task conversations where older context doesn't matter. Chatbots, quick Q&A, stateless interactions.

**Tradeoff**: Total amnesia beyond the window. The agent has no memory of earlier decisions, discoveries, or user preferences.

## Strategy 2: Summary + Buffer

Keep recent messages verbatim. Summarize older messages into a single compressed message.

```ts
async prepare(messages: Message[], tokenBudget: number): Promise<Message[]> {
  if (estimateMessageTokens(messages) <= tokenBudget) return messages;

  // Split: older messages to summarize, recent to keep
  const bufferStart = Math.max(0, messages.length - bufferSize);
  const older = messages.slice(0, bufferStart);
  const recent = messages.slice(bufferStart);

  // Call LLM to summarize older messages
  const summary = await summarize(older);

  return [
    { role: "user", content: `[Summary of earlier conversation]:\n${summary}` },
    ...recent,
  ];
}
```

The summarization prompt asks the LLM to preserve: key facts discovered, user preferences, decisions made, and unresolved questions.

**When to use**: Long conversations where older context still matters — research sessions, multi-step planning, iterative debugging.

**Tradeoff**: The summarization call costs tokens and adds latency. More subtly, summaries can introduce hallucinations and smooth over failure signals that the agent should have noticed.

## Strategy 3: Observation Masking

The surprise winner. Keep ALL user and assistant messages. For tool results: keep the N most recent verbatim, replace older ones with a placeholder.

```ts
async prepare(messages: Message[], tokenBudget: number): Promise<Message[]> {
  if (estimateMessageTokens(messages) <= tokenBudget) return messages;

  // Find all tool result indices
  const toolIndices = messages
    .map((m, i) => m.role === "tool" ? i : -1)
    .filter((i) => i >= 0);

  // Mask older tool results, keep most recent N
  const toMask = new Set(toolIndices.slice(0, -observationWindow));

  return messages.map((msg, i) =>
    toMask.has(i)
      ? { ...msg, content: "[Previous tool result cleared]" }
      : msg,
  );
}
```

**Why this works**: In an agent loop, the assistant's reasoning about tool results is compact and contains the key findings. The raw tool outputs are bulky (file contents, API responses, search results). Masking the bulk preserves the reasoning chain while dramatically reducing tokens.

**When to use**: Agentic loops with tool-heavy work — code agents, research agents, data exploration.

**Tradeoff**: If the agent needs to re-read a tool result it already processed, the data is gone. In practice this rarely matters because the agent's own reasoning captured the important parts.

## The Surprise Finding: Simple Beats Complex

The JetBrains Research / NeurIPS 2025 paper "The Complexity Trap" (Lindenbauer et al.) tested context management strategies on SWE-bench Verified (500 real GitHub issues):

| Strategy                 | Cost Reduction | Solve Rate Impact |
| ------------------------ | :------------: | :---------------: |
| No management (baseline) |       —        |         —         |
| LLM summarization        |      ~45%      |  -0.4% to +1.2%   |
| **Observation masking**  |    **52%**     |     **+2.6%**     |

Observation masking — the simplest strategy with zero LLM calls — outperformed LLM summarization in 4 of 5 tested settings. Two reasons:

1. **Summaries smooth over failure signals.** When an agent hits an error, the raw tool output contains the error message. A summary might compress this into "the operation encountered an issue" — losing the specific error that would help the agent self-correct.

2. **Summarization causes trajectory elongation.** Agents using summarization took 13-15% more turns to complete tasks. The compression overhead (generating summaries) plus the quality loss (vague summaries) created a net negative.

The lesson: for agentic workloads, preserve the reasoning chain and clear the raw data. Don't add complexity (and cost) unless you've measured that it helps.

## The "Lost in the Middle" Problem

Even with context management, **where** you place information matters. Liu et al. (2023) demonstrated that LLMs recall information best at the beginning and end of context, worst in the middle.

```
Recall
  ▲
  │ █                               █
  │ █ █                           █ █
  │ █ █ █                       █ █ █
  │ █ █ █ █                   █ █ █ █
  │ █ █ █ █ █ █           █ █ █ █ █ █
  │ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █
  └───────────────────────────────────► Position
    Start        Middle          End
```

This affects strategy design: sliding window preserves the end (recent messages), summary buffer preserves both ends (summary at start, recent at end), and observation masking preserves reasoning throughout while clearing the bulky middle.

## How Production Tools Do It

**Claude Code** (Anthropic): Uses compaction — summarizes the full conversation when approaching limits, preserving architecture decisions and unresolved bugs. Supports just-in-time retrieval via glob/grep/read tools. CLAUDE.md files are loaded upfront as critical context.

**Cursor**: Defaults to ~20K token limit per chat. Uses RAG-style semantic search to retrieve relevant code context. "Max Mode" unlocks the full context window at higher cost.

**Aider**: Builds a repository map using Tree-sitter + PageRank to identify the most relevant code structures. Dynamically adjusts what's included based on a configurable token budget. The agent can request more files on demand.

The common thread: all production tools use **multiple strategies in combination**. No single strategy covers all cases.

## Running the Demo

```bash
# Prerequisites: Ollama running with model pulled
ollama serve
ollama pull qwen2.5:7b

# Run the demo
pnpm dev:context-management
```

The demo runs a tech research assistant with a deliberately low 8K token budget. This makes context management trigger within a few turns.

**Try these prompts to see strategies in action:**

```
You: What articles do you have about AI agents?
You: Read the article about context windows
You: Now read the article about testing LLM applications
You: Compare what you've learned about context management and testing
```

**Switch strategies mid-session:**

```
/strategy none               # No management — watch tokens grow
/strategy sliding-window     # Simple — drops old messages
/strategy summary-buffer     # Summarizes old messages
/strategy observation-masking # Masks old tool results (default)
/stats                       # See current token usage
/reset                       # Clear history and start fresh
```

After each turn, a stats footer shows the token usage and whether management triggered:

```
📊  Tokens: ~3.4K/8.0K | Strategy: observation-masking | Managed: yes (-1.2K tokens)
```

## Token Estimation

This demo uses the chars/4 approximation for token counting:

```ts
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

This is ~90% accurate for English text — good enough for threshold checks in an agent loop. For production accuracy, use:

- **tiktoken** (OpenAI) — exact BPE tokenization, client-side, fast
- **Anthropic countTokens API** — exact for Claude, requires API call
- **tiktoken p50k_base** — reasonable approximation for most models

## In the Wild: Coding Agent Harnesses

Context management is arguably the most differentiated area across coding agent harnesses. Every harness faces the same fundamental constraint — a fixed context window feeding a stateless API — but their solutions diverge dramatically. The approaches fall into four distinct philosophies: compaction-based, cache-first append-only, graph-based selection, and embedding-based retrieval. Examining them side by side reveals that the "right" strategy depends entirely on what you optimize for.

**Claude Code** takes the **compaction + hierarchical memory** approach. When the conversation approaches the token limit, the system generates a summary that preserves architecture decisions, unresolved bugs, and key facts, then replaces the full history with this compressed version. What makes Claude Code's approach distinctive is its [multi-layered memory hierarchy](https://code.claude.com/docs/en/memory): managed policy CLAUDE.md (organization-wide), project CLAUDE.md (team-shared), user CLAUDE.md (personal preferences), local CLAUDE.md (machine-specific), auto memory (Claude's own notes in `~/.claude/projects/<project>/memory/`), and path-scoped `.claude/rules/` files that load only when relevant files are touched. CLAUDE.md files fully survive compaction — after `/compact`, they are re-read from disk and re-injected fresh. The system also structures prompts for [prompt cache efficiency](https://platform.claude.com/cookbook/misc-session-memory-compaction): static content (system prompt, tool definitions, CLAUDE.md) sits at the front of every request as a stable prefix, so the cached portion is reused across turns. With cached input tokens costing 90% less than uncached ones, this ordering is a significant cost lever. The net effect is a system that gracefully degrades long sessions while maintaining persistent project knowledge across sessions.

**Manus** takes the opposite stance: [never modify history, optimize for KV-cache hits](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus). Their context is strictly append-only — no edits to previous actions or observations — because even a single-token difference invalidates the cache from that point forward. With Claude Sonnet, cached input tokens cost $0.30/MTok versus $3.00/MTok uncached — a 10x difference that dominates cost when agents average a 100:1 input-to-output token ratio. Instead of removing tools from the context to save space (which would break the cache prefix), Manus uses logit masking during decoding to constrain which tools the model can select, keeping the prompt structure frozen. For long tasks averaging ~50 tool calls, the agent maintains a `todo.md` file — essentially reciting its goals into the end of context to keep them in the model's high-attention zone and counteract the "lost in the middle" effect. When context does fill up, Manus treats the filesystem as extended memory: dropping bulky content (like full web pages) while preserving references (URLs), and teaching the agent to write to and read from files on demand. This is restorable compression — the data is not lost, just moved out of the window.

**Aider** sidesteps the "what to keep" problem entirely with a **graph-based pre-selection** strategy. Rather than filling the context window and then compressing, Aider builds a [repository map using tree-sitter and PageRank](https://aider.chat/docs/repomap.html) to decide what enters the window in the first place. Tree-sitter parses every file into an AST, extracting definitions and references. These become nodes and edges in a NetworkX graph, where PageRank — personalized toward the files the user is actively editing — ranks every symbol by importance. A binary search then finds the maximum number of top-ranked tags that fit within the token budget (defaulting to ~1K tokens). The result is a concise map of the most interconnected code structures in the entire repository, consuming only 4-6% of the context window while giving the model enough architectural awareness to make informed edits. This approach is fundamentally different from compaction: it never summarizes or discards conversation history, instead ensuring the right code context is selected upfront.

**Cursor** represents the **embedding-based retrieval** philosophy. When you ask Cursor a question, it does not dump your codebase into the prompt. Instead, it runs a [multi-stage retrieval pipeline](https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/): tree-sitter parses code into semantic chunks (functions, classes, logical blocks), a custom embedding model generates vector representations, and these are stored in [Turbopuffer](https://turbopuffer.com/) — a serverless vector database — keyed by content hash so unchanged code is never re-embedded. At query time, the pipeline narrows 10M tokens of codebase down to ~8K tokens of final context through embedding search, importance ranking, and smart truncation. Only embeddings and metadata leave the machine; source code stays local. Cursor also maintains a [shadow workspace](https://cursor.com/blog/shadow-workspace) — a hidden LSP instance that validates proposed edits before presenting them — which doubles as a context signal: LSP diagnostics from the shadow workspace feed back into the model's context, telling it whether its edits actually compile.

The contrast between these four approaches maps directly onto the strategies in this demo. Claude Code's compaction is a production-grade version of the summary + buffer strategy. Manus's append-only design with filesystem offloading is an extreme form of observation masking — instead of replacing tool results with placeholders, it moves them to files. Aider's repo map is a just-in-time retrieval system that prevents context bloat rather than managing it after the fact. And Cursor's embedding pipeline is RAG applied to code, selecting what enters the window rather than trimming what's already there. The lesson from production: the best harnesses do not pick one strategy. They layer multiple approaches — Claude Code combines compaction with hierarchical memory with just-in-time file retrieval, Cursor combines embeddings with LSP feedback with compaction — because no single strategy handles every situation an agent encounters.

## Key Takeaways

1. **Context management is not optional** — even with 200K+ token windows, unmanaged context degrades quality, increases cost, and adds latency.

2. **The `ContextStrategy` interface is the entire abstraction** — `prepare(messages, budget) → messages`. Strategies are pluggable message transformers.

3. **Observation masking is the best default for agents** — zero cost, zero latency, preserves the reasoning chain, and outperforms LLM summarization in research.

4. **Summary + buffer is the best default for conversations** — preserves both recent detail and compressed history.

5. **More context is not always better** — the "Lost in the Middle" effect means placing information matters as much as including it.

6. **Start without management, add it when needed** — when conversations hit ~50% of the window, add a strategy. Don't over-engineer early.

7. **Production tools combine multiple strategies** — Claude Code uses compaction + just-in-time retrieval + upfront context. No single strategy covers all cases.

8. **Measure before choosing** — the JetBrains research surprised everyone by showing simple > complex. Run evals on your specific workload before committing to a strategy.

## Sources / Further Reading

**Research Papers**

- [Liu et al. — "Lost in the Middle" (2023)](https://arxiv.org/abs/2307.03172) — U-shaped recall curve; >30% degradation in middle context positions
- [Lindenbauer et al. — "The Complexity Trap" (NeurIPS 2025)](https://arxiv.org/abs/2508.21433) — Observation masking outperforms summarization; 52% cheaper, +2.6% solve rate
- [Wang et al. — "Recursively Summarizing Enables Long-Term Dialogue Memory" (2023)](https://arxiv.org/abs/2308.15022) — Recursive summaries for long conversations
- [Jiang et al. — LLMLingua (2023)](https://arxiv.org/abs/2310.05736) — 20x prompt compression with 1.5% performance loss
- [Li et al. — Ms-PoE: "Found in the Middle" (2024)](https://arxiv.org/abs/2403.04797) — Multi-scale positional encoding fix for lost-in-the-middle

**Provider Documentation**

- [Anthropic — Context Windows](https://platform.claude.com/docs/en/docs/build-with-claude/context-windows) — Official context limit docs
- [Anthropic — Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Compaction, memory tools, just-in-time retrieval
- [Anthropic — Long Context Prompting Tips](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/long-context-tips) — Information placement guidance
- [Google — Gemini Long Context](https://ai.google.dev/gemini-api/docs/long-context) — 2M token window with near-perfect single-needle recall
- [OpenAI — Conversation State](https://platform.openai.com/docs/guides/conversation-state) — Stateless API, history management

**Frameworks & Tools**

- [LangChain Conversational Memory](https://www.pinecone.io/learn/series/langchain/langchain-conversational-memory/) — BufferWindow, Summary, SummaryBuffer, Entity memory types
- [Aider — Repository Map](https://aider.chat/docs/repomap.html) — Tree-sitter + PageRank for code context selection
- [JetBrains Research — Cutting Through the Noise](https://blog.jetbrains.com/research/2025/12/efficient-context-management/) — Practical guide to observation masking for agents
