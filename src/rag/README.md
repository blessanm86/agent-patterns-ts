# Teaching Your Agent to Read the Docs — RAG from Scratch

[Agent Patterns — TypeScript](../../README.md)

> **Previous concept:** [Streaming Responses](../streaming/README.md) — delivering agent output token-by-token via SSE. This concept moves from _how_ the agent speaks to _what_ it knows, grounding answers in actual documentation instead of hallucinated knowledge.

---

Ask an LLM about your product's configuration and it will confidently give you an answer. The port number will sound right. The config key will look plausible. The CLI command will have perfect syntax. And every detail will be completely wrong — because the LLM has never seen your documentation.

This is the hallucination problem. The model doesn't know what it doesn't know, so it fills gaps with statistically plausible fiction. RAG solves this by giving the model a way to _look things up_ before answering.

## What is RAG?

**Retrieval-Augmented Generation** is a two-phase pattern:

1. **Retrieve** — search a knowledge base for documents relevant to the user's question
2. **Generate** — feed those documents into the LLM's context and ask it to answer _using the retrieved information_

```
User question
     |
     v
+--------------+     +---------------+     +--------------+
|   Search     |---->|  Top chunks   |---->|    LLM       |
|  knowledge   |     |  injected as  |     |  generates   |
|    base      |     |  tool result  |     |   answer     |
+--------------+     +---------------+     +--------------+
```

The critical insight: the LLM _reads_ the relevant documentation on every question. It doesn't need to have memorized your docs during training — it gets them fresh in its context window.

## The Knowledge Base

Our demo builds a documentation assistant for **NexusDB**, a fictional database. Twelve markdown documents cover everything from getting started to backup/restore:

```
getting-started    - installation, first commands, port 9242
configuration      - nexus.conf settings, all config keys
nql-query-syntax   - NQL pipe-based query language
indexing           - B-tree, hash, full-text, geo indexes
replication        - leader-follower, multi-leader, conflict resolution
security           - API keys, RBAC, encryption at rest
api-reference      - REST API endpoints, rate limiting
troubleshooting    - common issues, slow queries, OOM fixes
migrations         - schema enforcement, migration files
performance-tuning - cache tuning, write/read optimization
backup-restore     - snapshot, incremental, automated backups
data-types         - supported types, schema definition, limits
```

Every detail is invented — port 9242, `nexus-cli` commands, `nexus.conf` config keys. This makes hallucination trivially detectable: if the agent says something not in these 12 docs, it made it up.

## Document Chunking

Raw documents are too large for effective search. A 500-word doc about backups contains paragraphs about snapshots, incremental backups, automated scheduling, and verification. A query about "incremental backup" should match the incremental section, not the whole document.

Chunking splits documents into smaller, focused pieces:

```typescript
// chunker.ts - split by ## headings, then by paragraph
function splitBySections(markdown: string): Section[] {
  // Split on ## headings (level 2+)
  // Each section gets its own heading metadata
}

function chunkDocuments(docs: KBDocument[]): Chunk[] {
  // For each doc -> split into sections -> split into paragraphs
  // Merge tiny chunks (<50 words) into the previous chunk
  // Result: ~50-80 chunks from 12 documents
}
```

Each chunk carries metadata — the source document ID and the section heading — so we can trace search results back to their origin.

## Three Search Strategies

The demo implements three search strategies you can toggle at runtime with `/mode`:

### 1. Keyword Search (BM25)

BM25 (Best Matching 25) is the classic information retrieval algorithm. It scores documents by term frequency (how often the query words appear) weighted by inverse document frequency (rare words count more than common ones).

```typescript
// Uses the okapibm25 package
const scores = BM25(documents, keywords);
```

**Strengths:** Fast, no ML required, good for exact term matches (`nexus-cli backup`, `port 9242`).
**Weaknesses:** Misses synonyms and paraphrases. "How do I save my data?" won't match a doc about "backup and restore."

### 2. Semantic Search (Embeddings)

Embed both the query and every chunk into a vector space using `nomic-embed-text`, then find chunks closest to the query by cosine similarity.

```typescript
// vector-store.ts
async function embedText(text: string): Promise<number[]> {
  const response = await ollama.embed({ model: EMBEDDING_MODEL, input: text });
  return response.embeddings[0];
}

function cosineSimilarity(a: number[], b: number[]): number {
  // dot(a, b) / (||a|| * ||b||)
}
```

**Strengths:** Understands meaning, not just keywords. "How do I save my data?" matches "backup and restore."
**Weaknesses:** Slower (requires embedding the query), can miss exact technical terms.

### 3. Hybrid Search (Reciprocal Rank Fusion)

Run _both_ BM25 and semantic search, then merge the results using Reciprocal Rank Fusion (RRF):

```typescript
function reciprocalRankFusion(lists: SearchResult[][], topK: number) {
  // For each result across all lists:
  //   score += 1 / (k + rank)
  // where k = 60 (standard constant)
  // Sort by fused score -> top K
}
```

RRF is elegant because it doesn't need to normalize scores between different search methods. It only cares about _rank position_ — a result ranked #1 in either list gets a high fused score regardless of the raw score scale.

**This is the default mode** because it combines the precision of BM25 with the recall of semantic search.

## The Agent Loop

The agent uses the same ReAct loop from [ReAct](../react/README.md), with one key addition: two system prompts that swap based on whether RAG is enabled.

**RAG-enabled prompt:**

```
You must ALWAYS use the search_docs tool before answering any question about NexusDB.
Do NOT answer from memory - NexusDB has specific details that you must look up.
```

**RAG-disabled prompt:**

```
Answer questions about NexusDB to the best of your knowledge.
```

When RAG is disabled, the tools array is empty — the model can't call `search_docs` even if it wants to. This creates a clean A/B comparison: same model, same question, different access to documentation.

## RAG vs No-RAG: The Difference

With RAG enabled, ask "What port does NexusDB use?":

```
[RAG | hybrid] You: What port does NexusDB use?

  Tool call: search_docs
     Args: {"query": "default port NexusDB"}
     Result: [chunks mentioning port 9242, server.port config...]

Assistant: NexusDB listens on port **9242** by default. You can change this
via the `server.port` key in `/etc/nexusdb/nexus.conf`.
```

The answer is grounded — port 9242 and the config path came directly from the retrieved chunks.

With RAG disabled (`/norag`), the same question:

```
[no-RAG] You: What port does NexusDB use?

Assistant: NexusDB typically uses port 5432 for connections...
```

The model guesses a plausible port number (5432 is PostgreSQL's port). It sounds confident but is completely wrong.

## When RAG Helps vs. Doesn't

**RAG helps when:**

- The question is about specific facts (port numbers, commands, config keys)
- The knowledge base contains the answer
- The LLM has no training data about your domain (fictional product, internal docs)
- Accuracy matters more than speed

**RAG adds overhead when:**

- The question is general knowledge the LLM already knows well
- The knowledge base doesn't contain relevant information
- The question requires reasoning across many documents (RAG finds individual chunks, not cross-document patterns)
- Latency is critical and the search adds too much time

## Try It

```bash
# Prerequisites
ollama pull nomic-embed-text
ollama pull qwen2.5:7b
ollama serve

# Run the demo
pnpm dev:rag
```

Commands:

- `/rag` — enable RAG (default)
- `/norag` — disable RAG, answer from LLM knowledge only
- `/mode keyword` — BM25 search only
- `/mode semantic` — embedding search only
- `/mode hybrid` — both, merged with RRF (default)

## In the Wild: Coding Agent Harnesses

The retrieval problem we solved in this demo — "given a user question, find the most relevant chunks of a knowledge base" — is the same problem every coding agent harness faces on every single turn. The user says "fix the login bug," and the harness must figure out which of the repository's thousands of files to put in the context window. What makes this fascinating is that the major harnesses have converged on three fundamentally different retrieval strategies: classic vector RAG, graph-based ranking, and behavioral prediction.

**Cursor** is the textbook RAG implementation, and it operates at remarkable scale. When you enable codebase indexing, Cursor parses your code into an AST using [tree-sitter](https://tree-sitter.github.io/tree-sitter/), then chunks it at logical boundaries — functions, classes, and sibling nodes merged together up to a token limit. These chunks are embedded using Cursor's own embedding model and stored in [Turbopuffer](https://turbopuffer.com/customers/cursor), a serverless vector database, with each `(user_id, codebase)` pair getting its own namespace. The scale is staggering: over 100 billion vectors across 10 million+ namespaces, with peak write throughput of 10GB/s. Every few minutes, a Merkle tree hash comparison detects changed files and re-indexes only the diffs. At query time, your prompt is embedded and a nearest-neighbor search retrieves the most semantically similar code chunks — exactly the same retrieve-then-generate pattern we built in this demo, just with a custom embedding model and industrial-grade vector infrastructure instead of local Ollama embeddings and in-memory cosine similarity.

**Aider** takes a completely different path: no embeddings, no vector database, no neural retrieval at all. Instead, it builds a [repository map](https://aider.chat/2023/10/22/repomap.html) using tree-sitter to extract every function, class, and variable definition across your codebase, then constructs a [NetworkX](https://networkx.org/) directed multigraph where nodes are files and edges represent identifier references between them. The magic is in the ranking: Aider runs [personalized PageRank](https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping) on this graph, with a personalization vector that heavily weights files currently in the chat context (+100), identifiers the user mentioned (+100), and cross-file references from active files (x50 multiplier). The result is a ranked list of the most "important" code definitions — the same files Google's original PageRank would surface if your codebase were a web of interlinked pages. This graph-based approach is deterministic, requires no GPU or external services, works entirely offline, and captures structural relationships (who calls whom, who imports what) that embedding similarity can miss entirely. It defaults to a budget of just 1,024 tokens for the entire repo map — proving that high-signal retrieval can be radically compact.

**Windsurf** (formerly Codeium) introduces a third paradigm through its [Cascade](https://docs.windsurf.com/windsurf/cascade/cascade) system: retrieval driven by developer behavior rather than query similarity or code structure. Cascade continuously tracks your actions — file edits, terminal commands, clipboard contents, navigation patterns, and conversation history — to build a real-time model of your intent. Rather than waiting for you to ask a question and then searching for relevant code, Windsurf predicts what context you will need based on what you have been doing. This is closer to a recommendation engine than a search engine: the retrieval signal is not "what is semantically similar to the query" (Cursor) or "what is structurally connected to the active code" (Aider), but "what does this developer's recent behavior suggest they need next." The indexing engine still operates across the full codebase, but the ranking is shaped by behavioral signals that neither embeddings nor graph topology can capture.

The divergence between these three approaches mirrors the three search strategies in our demo. Cursor's vector embeddings parallel our semantic search — understanding meaning through geometric proximity in embedding space. Aider's PageRank graph is a structural analog to our BM25 keyword matching — both are deterministic, explainable algorithms that rely on explicit signals (term frequency for BM25, reference frequency for PageRank) rather than learned representations. And Windsurf's behavioral tracking has no direct analog in traditional RAG, but points toward a future where retrieval is proactive rather than reactive. The lesson for practitioners: there is no single "right" retrieval strategy. The best coding agents are choosing their approach based on what signal is most available and most reliable for their specific architecture.

## Key Takeaways

1. **RAG is search + generation.** The retrieval step is just as important as the generation step. Bad search means bad answers regardless of model quality.

2. **Chunking strategy matters.** Too-large chunks waste context. Too-small chunks lose meaning. Section-aware chunking with paragraph merging is a good starting point.

3. **Hybrid search beats either alone.** BM25 catches exact terms. Embeddings catch meaning. RRF merges them without score normalization. Default to hybrid.

4. **The system prompt is the control lever.** "Always search before answering" and "cite specific details from documentation" are simple instructions that dramatically improve grounding.

5. **Fictional knowledge bases make hallucination obvious.** If your test knowledge is entirely invented, any "fact" the LLM produces without searching is provably hallucinated.

## Sources & Further Reading

- [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401) — Lewis et al. (Facebook AI Research), NeurIPS 2020 — the paper that coined "RAG" and defined the paradigm
- [REALM: Retrieval-Augmented Language Model Pre-Training](https://arxiv.org/abs/2002.08909) — Guu et al. (Google Research), ICML 2020 — co-originator of retrieval-augmented approach
- [LlamaIndex — Introduction to RAG](https://docs.llamaindex.ai/en/stable/understanding/rag/) — practical guide covering the full RAG pipeline
- [LangChain Retrieval](https://python.langchain.com/docs/how_to/#retrievers) — covers 2-step RAG and agentic RAG patterns
