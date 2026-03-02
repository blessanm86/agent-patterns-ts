# Search Once or Search Until You Know — Agentic RAG

[Agent Patterns — TypeScript](../../README.md)

> **Previous concept:** [RAG](../rag/README.md) — grounding answers in documentation with retrieval-augmented generation. This concept asks: what if one search isn't enough?

---

Ask a basic RAG system "How do I set up replication and configure automated backups?" and you'll get a partial answer. The system searches once, pulls back whatever chunks match best, and generates from that. If the retriever happened to find replication docs, you'll get replication details but nothing about backups. If it found backup docs, you'll get the reverse. Getting both requires luck — the single query has to simultaneously match documents about two different topics.

This is the fundamental limitation of basic RAG: **one query, one chance.** The system has no mechanism to notice gaps in what it retrieved, no ability to search again with a different angle, and no way to build up a complete picture across multiple retrieval steps.

Agentic RAG fixes this by putting the agent in control of retrieval. Instead of a fixed retrieve-then-generate pipeline, the agent formulates queries, evaluates results, identifies gaps, and searches again until it has enough information to give a complete answer.

## The Core Difference

**Basic RAG** runs a fixed pipeline:

```
Question → Search (once) → Generate answer
```

**Agentic RAG** runs an agent loop:

```
Question → Plan what to search
              ↓
         Search with targeted query
              ↓
         Evaluate: do I have enough? ──── Yes → Synthesize answer
              ↓ No
         Refine: what's missing?
              ↓
         Search again with different query
              ↓
         (repeat until sufficient or budget exhausted)
```

The difference isn't a better retriever or smarter embeddings. It's giving the agent the _autonomy to decide_ when to retrieve, what to retrieve, and when to stop.

## Measured Impact

The Hugging Face agentic RAG benchmark provides the clearest head-to-head comparison. Using a documentation QA eval set with LLM-judge scoring:

| Mode              | Score     | LLM Calls |
| ----------------- | --------- | --------- |
| No RAG (baseline) | 36.0%     | 1         |
| Standard RAG      | 73.1%     | 1         |
| **Agentic RAG**   | **86.9%** | 3-10      |

The agentic setup was minimal — a ReAct agent with a single retriever tool. The improvement came from three emergent behaviors:

1. **Query reformulation** — the agent formulates queries in affirmative form (closer to document language) rather than passing the raw question
2. **Result critique** — the agent evaluates whether retrieved chunks actually answer the question
3. **Multi-angle search** — the agent makes multiple searches with semantically different queries to cover compound questions

This naturally implements HyDE-like reformulation and self-query without any explicit engineering of those patterns.

## Architecture: Two Modes in One Demo

This demo runs both basic and agentic RAG against the same NexusDB documentation so you can see the difference directly.

### Basic RAG Agent

```typescript
// agent.ts — runBasicAgent()
// System prompt forces single search:
// "Search the docs ONCE, then answer. Do NOT search multiple times."

const response = await ollama.chat({
  model: MODEL,
  system: BASIC_SYSTEM_PROMPT,
  messages,
  tools: basicTools, // just search_docs
});
```

One search, one answer. The baseline.

### Agentic RAG Agent

```typescript
// agent.ts — runAgenticAgent()
// System prompt teaches iterative reasoning:
// "1. PLAN — what info do you need?
//  2. SEARCH — targeted query
//  3. EVALUATE — do results fully answer?
//  4. REFINE — if gaps remain, search again"

const response = await ollama.chat({
  model: MODEL,
  system: AGENTIC_SYSTEM_PROMPT,
  messages,
  tools: agenticTools, // search_docs + list_sources
});

// Budget enforcement — search_docs costs 1, list_sources is free
if (name === "search_docs") {
  if (stats.searchCalls >= SEARCH_BUDGET) {
    stats.budgetExhausted = true;
    messages.push({
      role: "tool",
      content: JSON.stringify({
        error: "Search budget exhausted. Synthesize from what you have.",
      }),
    });
    continue;
  }
  stats.searchCalls++;
}
```

The agent gets two tools and a search budget:

| Tool           | Budget Cost | Purpose                       |
| -------------- | ----------- | ----------------------------- |
| `search_docs`  | 1 per call  | Search documentation chunks   |
| `list_sources` | Free        | See what documentation exists |

`list_sources` costs nothing because it's strategic navigation, not retrieval. It gives the agent a table of contents so it can plan targeted searches instead of searching blindly.

## The Key Design Decision: Natural Iteration

A tempting approach is to add explicit tools like `evaluate_results` or `refine_query`. We deliberately avoided this. The system prompt teaches the reasoning pattern, but the agent itself decides when to iterate:

```
You are a NexusDB documentation research assistant.

When answering questions, follow this reasoning process:
1. PLAN — What information do you need?
2. SEARCH — Call search_docs with a specific, targeted query.
3. EVALUATE — Do the results fully answer the question?
4. REFINE — If gaps remain, formulate a DIFFERENT query and search again.

Guidelines:
- Each search should target a different aspect — don't repeat queries
- State your reasoning before each search
- You have a budget of 5 searches — use them wisely
- When you have enough information, stop and synthesize
```

Why this approach? Because the _point_ of agentic RAG is that the agent controls the loop. Encoding evaluate/refine as tools turns it back into a pipeline. Claude Code validates this — it has Grep, Glob, and Read tools with no "evaluate results" tool, and iterates naturally through its own reasoning.

## The Search Budget

Without a budget, an agentic RAG system can spiral. A broad question triggers search after search, burning tokens and adding latency without proportionally improving the answer. This is the most common production failure mode — practitioners report unconstrained agents producing "$47 conversations" and 30-second response times.

The budget pattern is simple:

```typescript
const SEARCH_BUDGET = 5;

// In the agent loop:
if (stats.searchCalls >= SEARCH_BUDGET) {
  stats.budgetExhausted = true;
  // Tell the agent to work with what it has
  return "Budget exhausted. Synthesize your answer.";
}
stats.searchCalls++;
```

When the budget is exhausted, the agent gets a clear signal to stop searching and synthesize. It doesn't fail — it produces the best answer it can from what it gathered. The budget prevents runaway costs while still allowing 5x more retrieval than basic RAG.

The practitioner consensus on budgets: 2-5 retrieval calls for most use cases. LangGraph's corrective RAG implementation caps at 2-3 rewrites. Our budget of 5 gives the agent room for complex multi-topic questions while keeping latency manageable.

## When Basic RAG Fails

The failure pattern is predictable. Basic RAG struggles with:

**Compound questions** — "How do I set up replication AND configure automated backups?" The single search returns chunks about one topic or the other, rarely both.

**Diagnostic questions** — "My NexusDB is running out of memory and queries are slow" requires pulling from troubleshooting docs, performance tuning docs, and configuration docs. A single search can't cover all three.

**Comprehensive questions** — "What's the complete security setup for production?" needs authentication methods, RBAC, encryption at rest, and TLS — spread across multiple documentation sections.

In each case, the agent needs to search for _different things_ to build a complete picture. Basic RAG gets one shot; agentic RAG gets five.

## The Academic Landscape

Agentic RAG sits at the convergence of several research threads:

**CRAG (Corrective RAG)** — Yan et al., 2024. Evaluates retrieval confidence and takes corrective action: trust results if high-confidence, supplement with web search if ambiguous, discard and re-retrieve if low-confidence. The plug-and-play corrective evaluator is the most practical addition to any existing RAG system.

**Self-RAG** — Asai et al., 2023. Trains the model itself to predict special reflection tokens: should I retrieve? Is this passage relevant? Is my generation supported? The most "agentic" approach — the model's retrieval decisions are learned, not orchestrated. Self-RAG 7B outperforms retrieval-augmented ChatGPT on 4 of 6 benchmarks.

**IRCoT** — Trivedi et al., 2023. Interleaves retrieval with chain-of-thought at the sentence level. Each reasoning step generates the query for the next retrieval step. Up to 21-point retrieval improvement on multi-hop questions.

**A-RAG** — Du et al., 2026. Exposes three hierarchical retrieval tools (keyword search, semantic search, chunk read) as agent tools. The model decides which granularity of retrieval to use at each step. This is the natural endpoint: retrieval as just another tool in a ReAct loop.

The Agentic RAG Survey (Singh et al., 2025) formalizes five stages of RAG evolution:

```
Naive RAG → Advanced RAG → Modular RAG → Graph RAG → Agentic RAG
(keyword)    (dense)        (components)   (KG)        (autonomous)
```

Each stage gives the system more control over its own retrieval process. Agentic RAG is the stage where the system makes autonomous decisions about when, what, and how to retrieve.

## Anti-Patterns to Avoid

Research and practitioner experience surface several failure modes:

**Infinite retrieval loops** — The most common production bug. The agent searches, grades results as irrelevant, rewrites the query, searches again, grades as irrelevant... forever. Fix: enforce a search budget (this demo's approach) or a max-rewrite count.

**Query drift** — After multiple reformulations, the rewritten query diverges from the original intent. The agent starts searching for tangentially related topics. Fix: always anchor reformulations to the original question.

**Over-retrieval / context pollution** — Pulling too many documents to avoid missing anything. The signal gets buried in noise, and the LLM produces generic, hedged answers. Fix: limit to 5-10 chunks per search, use reranking.

**Blind retrieval for every query** — Not every question needs retrieval. "What's 2+2?" shouldn't trigger a document search. Production systems use intent classification to route simple queries directly to the LLM. This saves 40% in cost and 35% in latency.

## In the Wild: Coding Agent Harnesses

Agentic RAG is the defining pattern of coding agent harnesses. Every coding agent needs to find relevant code before it can modify it — and a single search is almost never enough.

**Claude Code** takes the purest agentic approach: no vector database, no embeddings, no indexing. The agent gets Grep (content search), Glob (file pattern matching), and Read (file contents) as tools and iterates naturally. Boris Cherny, a Claude Code developer, stated that "early versions of Claude Code used RAG + a local vector db, but we found pretty quickly that agentic search generally works better." The reasons: vector indexes become stale as code changes, code search demands exact symbol names (not semantically similar snippets), and there's no embedding infrastructure to maintain. Claude Code uses subagent isolation — Explore subagents run in separate context windows to prevent irrelevant search results from polluting the main conversation.

**Cline** makes the anti-RAG stance philosophical: "When you chunk code for embeddings, you're literally tearing apart its logic." Instead, Cline reads files sequentially while following imports and logical connections — mirroring how senior engineers navigate unfamiliar codebases. It combines ripgrep for lexical search, fzf for fuzzy matching, and tree-sitter for structural analysis.

**Aider** takes a radically different approach: no search at all. Instead, it builds a dependency graph of the entire repository using tree-sitter AST parsing, runs PageRank to identify the most relevant files, and sends a structural map with every request. This uses only 4.3-6.5% of the context window (vs. 54-70% for agentic search), but it can't find things that aren't structurally connected.

**Devin** represents the frontier: SWE-grep and SWE-grep-mini are purpose-built models trained with reinforcement learning specifically for parallel code retrieval. They make 8 parallel tool calls per turn across 4 serial turns — an order of magnitude faster than sequential agentic search. The key insight: "The initial context-gathering phase can consume over 60% of an agent's first turn."

The industry is converging on a hybrid: **agentic backbone + selective semantic indexing**. Use agentic search for accuracy and freshness; add semantic indexes for concept search on huge repositories. Windsurf combines both approaches (Riptide embeddings + SWE-grep agentic search), and OpenAI Codex CLI is adding `codex index` / `codex search` to its agentic toolset.

## Running the Demo

```bash
pnpm dev:agentic-rag
```

### Commands

| Command                             | Effect                                           |
| ----------------------------------- | ------------------------------------------------ |
| `/agentic`                          | Agentic RAG mode (default) — iterative retrieval |
| `/basic`                            | Basic RAG mode — single search                   |
| `/compare`                          | Run in BOTH modes, show side-by-side with stats  |
| `/mode <keyword\|semantic\|hybrid>` | Change search strategy                           |

### Try These Questions

**Simple question (both modes should handle):**

> What port does NexusDB use?

**Compound question (agentic shines):**

> How do I set up replication and configure automated backups?

**Diagnostic question (requires multiple sources):**

> My NexusDB is running out of memory and queries are slow, how do I fix it?

Use `/compare` to see both modes run on the same question with stats showing the difference in search calls and LLM calls.

## Key Takeaways

1. **Basic RAG searches once and hopes for the best.** Agentic RAG puts the agent in control of retrieval — it plans, searches, evaluates, and refines until it has enough information.

2. **The system prompt is the teaching artifact.** No explicit evaluate/refine tools needed. The agent's natural reasoning drives iteration. This is validated by how coding agents work in production.

3. **Search budgets prevent runaway costs.** Without a budget, agentic RAG can spiral into expensive, slow loops. A budget of 2-5 searches covers most use cases while keeping latency manageable.

4. **The improvement is real and measured.** Hugging Face benchmarks show 86.9% vs 73.1% — a 19% relative improvement from a minimal agentic setup (one tool, no explicit CRAG/Self-RAG engineering).

5. **Not every question needs agentic RAG.** Simple factual lookups work fine with basic RAG. The value shows on compound, diagnostic, and comprehensive questions where multiple retrieval passes build a more complete picture.

## Sources & Further Reading

### Academic Papers

- [CRAG: Corrective Retrieval Augmented Generation](https://arxiv.org/abs/2401.15884) — Yan et al., 2024
- [Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection](https://arxiv.org/abs/2310.11511) — Asai et al., 2023 (ICLR 2024)
- [IRCoT: Interleaving Retrieval with Chain-of-Thought Reasoning](https://arxiv.org/abs/2212.10509) — Trivedi et al., 2023 (ACL 2023)
- [Adaptive-RAG: Learning to Adapt through Question Complexity](https://arxiv.org/abs/2403.14403) — Jeong et al., 2024 (NAACL 2024)
- [A-RAG: Hierarchical Retrieval Interfaces](https://arxiv.org/abs/2602.03442) — Du et al., 2026
- [Agentic RAG Survey](https://arxiv.org/abs/2501.09136) — Singh et al., 2025
- [Search-o1: Agentic Search-Enhanced Reasoning](https://arxiv.org/abs/2501.05366) — Li et al., 2025
- [DeepRAG: Thinking to Retrieve Step by Step](https://arxiv.org/abs/2502.01142) — Guan et al., 2025

### Practitioner Resources

- [HuggingFace Cookbook: Agentic RAG](https://huggingface.co/learn/cookbook/en/agent_rag) — the benchmark this README references
- [LangChain: Self-Reflective RAG with LangGraph](https://blog.langchain.com/agentic-rag-with-langgraph/)
- [Softcery: How to Build Production-Ready Agentic RAG](https://softcery.com/lab/how-to-build-production-ready-agentic-rag-systems-that-actually-work)
- [Redis: Agentic RAG in the Enterprise](https://redis.io/blog/agentic-rag-how-enterprises-are-surmounting-the-limits-of-traditional-rag/)
- [LlamaIndex: RAG is Dead, Long Live Agentic Retrieval](https://www.llamaindex.ai/blog/rag-is-dead-long-live-agentic-retrieval)

### Coding Agent Harnesses

- [Why Claude Code Dropped Vector Search for Agentic Search](https://zerofilter.medium.com/why-claude-code-is-special-for-not-doing-rag-vector-search-agent-search-tool-calling-versus-41b9a6c0f4d9)
- [Cognition: SWE-grep — RL-trained Retrieval for Coding Agents](https://cognition.ai/blog/swe-grep)
- [Why Cline Doesn't Index Your Codebase](https://cline.bot/blog/why-cline-doesnt-index-your-codebase-and-why-thats-a-good-thing)
- [Aider Repository Map Architecture](https://aider.chat/docs/repomap.html)
- [Jason Liu: Why Grep Beat Embeddings on SWE-Bench](https://jxnl.co/writing/2025/09/11/why-grep-beat-embeddings-in-our-swe-bench-agent-lessons-from-augment/)
