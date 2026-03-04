# Repository Mapping

[Agent Patterns — TypeScript](../../README.md)

> Builds on: [RAG](../rag/README.md)

---

Your coding agent has 200K tokens of context. Your codebase has 2 million tokens of source code. How does the agent decide what to read?

The naive answer is "search for relevant files" — but text similarity misses structural dependencies. A function named `validateOrder` might not contain the word "authentication," yet it calls `validateToken` from `auth.ts`, which the agent needs to understand the order flow. RAG finds text matches. Repository mapping finds **structural connections**.

This pattern — pioneered by [Aider](https://aider.chat/docs/repomap.html) and validated on SWE-Bench — uses the TypeScript AST to extract definitions and references, builds a dependency graph, and runs PageRank to identify the most structurally important files. The result is a compact map (~1,000 tokens) that gives an agent an architectural overview of an entire codebase, enabling it to navigate directly to relevant code instead of searching blindly.

## The Core Problem: Context Selection

Every coding agent faces the same bottleneck: which files deserve the precious context window space?

| Approach               | Finds                       | Misses                           |
| ---------------------- | --------------------------- | -------------------------------- |
| Full file tree         | File names                  | What's _inside_ files            |
| Text search / grep     | Keyword matches             | Structural relationships         |
| Embedding-based RAG    | Semantic similarity         | Import chains, type dependencies |
| **Repository mapping** | **Structural architecture** | Deep semantic meaning            |

Embedding-based RAG retrieves chunks that are _textually similar_ to a query. Repository mapping retrieves files that are _structurally central_ to the codebase — the hubs that everything else depends on. These are complementary: RAG answers "what talks about X?" while repo mapping answers "what matters most?"

## The Pipeline

```
   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
   │   Walk   │───▶│  Parse   │───▶│  Graph   │───▶│  Rank    │───▶│  Render  │
   │ .ts files│    │ AST tags │    │ dep edges│    │ PageRank │    │ token    │
   │          │    │          │    │          │    │          │    │ budget   │
   └──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
   Find all TS      Extract         Build file→     Score files     Binary search
   files in the     definitions     file edges      by structural   for max files
   directory        + references    with weights    importance      that fit budget
```

Each stage is a pure function. The entire pipeline runs in milliseconds on a typical project.

## Deep Dive

### Step 1: Parse — Extract Definitions and References

We use the TypeScript Compiler API (`ts.createSourceFile`) to walk each file's AST and extract two kinds of tags:

- **Definitions**: exported functions, classes, interfaces, types, enums, const declarations — with their signature (the declaration line without the body)
- **References**: identifiers that match a definition name from another file

```typescript
// parser.ts — simplified
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    definitions.push({
      name: node.name.text,
      kind: "function",
      line: getLineNumber(node),
      signature: getSignature(node), // "export function authenticate(email, password): User"
      exported: isExported(node),
    });
  }

  if (ts.isIdentifier(node) && !isDeclarationName(node)) {
    identifiers.push({ name: node.text, line: getLineNumber(node) });
  }

  ts.forEachChild(node, visit);
}
```

After parsing all files individually, a second pass (`resolveReferences`) cross-references identifiers against definitions to keep only **cross-file references** — identifiers in file A that match a definition in file B. This is what creates the edges in the dependency graph.

### Why TypeScript's Compiler API Instead of Tree-Sitter?

Aider uses tree-sitter with `.scm` query files for 31 languages. We use the TypeScript Compiler API because:

1. **No native binaries** — tree-sitter requires platform-specific compiled parsers
2. **Already installed** — `typescript` is a devDependency in any TS project
3. **Full type information** — the TS API knows about exports, generics, and type aliases natively

The tradeoff: our parser only handles TypeScript. Aider's tree-sitter approach handles 31 languages. For a single-language project, the TS Compiler API is simpler and more precise.

### Step 2: Build the Dependency Graph

The graph has:

- **Nodes** = file paths
- **Edges** = file A references a definition in file B (directed: A → B)
- **Weights** follow a simplified version of Aider's multiplier system:

```typescript
let weight = 1.0;
if (ref.name.length >= 8) weight *= 2; // specific identifiers matter more
if (!target.exported) weight *= 0.1; // private symbols = internal detail
if (personalizedSet.has(from)) weight *= 10; // user's current file = boosted
```

Aider's actual multipliers are more aggressive — files in the active chat get **50x**, and identifiers mentioned in the conversation get **10x**. The key insight is the same: the graph should be _task-aware_, not just architecturally generic.

### Step 3: PageRank — The Breakthrough

Why PageRank? Because code dependency graphs have the same structure as the web: a few hub files are referenced by many others, while most files are leaves. PageRank was designed exactly for this topology.

```typescript
// ~30 lines, no external library
function pagerank(adjacency, personalization, damping = 0.85, iterations = 30) {
  const scores = new Map(); // start uniform
  for (let iter = 0; iter < iterations; iter++) {
    // Distribute each node's score to its neighbors proportional to edge weight
    // Apply damping: score = d * incoming + (1-d) * personalization
  }
  return scores;
}
```

**Personalization** is what makes this task-relevant rather than a static architectural ranking. By setting higher personalization values for files the user is currently working on, PageRank naturally biases toward the _neighborhood_ of those files in the dependency graph — exactly the context the agent needs.

Aider's benchmark: the repo map correctly identified the relevant files in **70.3%** of SWE-Bench tasks, using only **4.3–6.5%** of the available context window.

### Step 4: Render Within Token Budget

The final step fits the ranked files into a token budget using binary search:

1. Start with all files, sorted by PageRank score
2. For each file: show the path + exported definitions with signatures
3. Binary search on the number of files until the output fits the budget
4. Token estimation: `text.length / 4` (good enough for planning)

The output follows Aider's compact style:

```
services/order-service.ts:
│  export function createOrder(input: CreateOrderInput): Order | { error: string }
│  export function getOrder(orderId: string): Order | null
│  export function cancelOrder(orderId: string): boolean
│  export function getOrderSummary(orderId: string): string | null

services/auth.ts:
│  export function registerUser(input: CreateUserInput, password: string): User | { error: string }
│  export function authenticate(email: string, password: string): { token: string; user: User } | { error: string }
│  export function validateToken(token: string): User | null

models/order.ts:
│  export enum OrderStatus
│  export function calculateOrderTotal(items: OrderItem[]): number
│  export function formatOrderSummary(order: Order): string
```

~1,000 tokens for an entire project's architecture. An agent reading this map knows immediately that `order-service.ts` is the hub (it appears first), that authentication uses `registerUser` and `validateToken`, and that orders depend on `calculateOrderTotal` from the model layer.

## The Spectrum of Approaches

Repository mapping is one point on a spectrum. Every major coding agent makes a different tradeoff:

```
Pre-compute all ◄─────────────────────────────────────────────► Compute on demand
  Cursor       Copilot     Amazon Q     Aider       OpenCode      Claude Code    Cline
  (vectors     (remote     (BM25+       (PageRank   (grep+LSP)    (grep/glob)    (follow
   + cloud)     index)      vector)      per-task)                                imports)
```

| Approach                         | How It Works                                                           | Strengths                                                  | Weaknesses                                                         |
| -------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| **Vector index** (Cursor)        | Tree-sitter chunking → embeddings → vector DB, incremental sync        | Fast retrieval, semantic matching                          | Stale (10-min sync), chunking destroys structure, cloud dependency |
| **Remote index** (Copilot)       | Code-optimized transformer model, shared across repo users             | Shared investment, works at scale                          | No uncommitted changes, requires cloud                             |
| **Triple index** (Amazon Q)      | BM25 (22ms build) + structural tree + vector embeddings, all local     | Fast keyword + structure + semantic                        | 200MB workspace limit, 5-20 min initial vector build               |
| **PageRank map** (Aider)         | AST parse → dependency graph → PageRank, recomputed per task           | Fresh, ~1K tokens, 70.3% accuracy, local                   | Single-language parsers, degrades past 10K files                   |
| **RL-trained search** (Windsurf) | SWE-grep: RL model makes search decisions, 8 parallel calls, 4 turns   | Precision-optimized (RL penalizes context pollution), fast | Requires training infrastructure                                   |
| **LSP integration** (OpenCode)   | 24+ built-in language servers for goToDefinition, findReferences, etc. | IDE-equivalent navigation at zero indexing cost            | Requires running language servers                                  |
| **Agentic search** (Claude Code) | Glob → Grep → Read tool hierarchy, Explore sub-agent on Haiku model    | Always fresh, no infrastructure, validated by research     | Burns tokens per task, slower for cold starts                      |
| **No index** (Cline)             | Follow imports manually: read file → see import → follow it            | Maximally fresh, no stale data                             | Most expensive per task, limited to traced paths                   |

A key finding from practitioners: **less context is more**. ETH Zurich research showed that providing context files can actually _reduce_ success rates due to the "lost in the middle" problem — models become unreliable beyond 25–30K tokens of context. This validates the repo map approach of compressing an entire codebase into ~1K tokens of high-signal structure.

### Size-Based Recommendations

| Codebase Size             | Recommended Approach                           |
| ------------------------- | ---------------------------------------------- |
| < 100 files               | Full file tree or include everything           |
| 100–1,000 files           | PageRank map (~1K tokens) — this demo          |
| 1,000–10,000 files        | Hybrid: structural map + embedding search      |
| > 10,000 files / Monorepo | Scoped per-package maps + RL-trained retrieval |

## In the Wild: Coding Agent Harnesses

Repository mapping sits at the heart of how coding agents understand codebases. Every major harness makes a different bet on this spectrum:

**Aider** is the canonical implementation and the direct inspiration for this demo. It uses tree-sitter with `.scm` query files to parse 31 languages, builds a NetworkX MultiDiGraph, and runs personalized PageRank with aggressive weighting: files in the active chat get a **50x multiplier**, mentioned identifiers get 10x, and commonly-defined symbols (defined in 5+ files) get suppressed at 0.1x. The map is cached in SQLite with mtime-based invalidation and recomputed via binary search to fit the token budget. On SWE-Bench Lite, this approach achieved **26.3% SOTA** (May 2024) with the map using only 4.3–6.5% of the context window.

**Claude Code** took the opposite approach: it explicitly abandoned RAG and indexing after testing. Boris Cherny (the creator) explained: _"Early versions of Claude Code used RAG + a local vector db, but we found pretty quickly that agentic search generally works better."_ Instead, Claude Code uses a three-tier tool hierarchy ordered by token cost (Glob → Grep → Read) and spawns an **Explore sub-agent** on the cheaper Haiku model with an isolated context window. The sub-agent does all file reading and summarizes findings back — then its tokens are discarded, preserving the main agent's context. This was validated by the Amazon Science paper "Keyword Search Is All You Need" (arXiv 2602.23368), which showed keyword search achieves 90%+ of RAG performance.

**OpenCode** bridges the gap with **LSP integration** — 24+ built-in language servers that provide `goToDefinition`, `findReferences`, and `callHierarchy` at zero indexing cost. This gives IDE-equivalent structural navigation without building any index. LSP diagnostics also feed back to the LLM, creating a self-correcting cycle where type errors inform the next edit.

The interesting tension: Aider proves that _static structural analysis_ (parse once, rank, inject) is highly effective for file identification. Claude Code proves that _dynamic exploration_ (search as you go) works just as well in practice, especially when you have a cheap sub-agent to absorb the token cost. The right choice depends on whether you're optimizing for token efficiency (Aider wins) or infrastructure simplicity (Claude Code wins).

## Try the Demo

```bash
pnpm dev:repo-mapping
```

The CLI starts by generating a repo map of the sample e-commerce project. Two modes let you compare:

- **`/map`** (default) — agent has the structural map in its system prompt
- **`/nomap`** — agent explores blindly with `list_files`, `read_file`, `search_code`
- **`/show`** — print the current repo map

After each response, stats show LLM calls, tool calls, and files read. Try asking the same question in both modes:

```
"How does authentication work?"
"What happens when a user places an order?"
"How are products and inventory connected?"
```

With the map, the agent targets `auth.ts` directly. Without it, the agent has to list files, search for "auth", then read what it finds — more tool calls, more tokens, slower answers.

## Key Takeaways

1. **AST parsing beats text similarity for structural understanding.** Embeddings find textually similar chunks; repo maps find architecturally important files. They're complementary, not competing.

2. **PageRank is the right algorithm for code dependency graphs.** Code has the same hub-and-spoke topology as the web — a few files (models, core services) are referenced by everything else. PageRank naturally surfaces these hubs.

3. **Personalization makes the map task-relevant.** Without personalization, you get a generic "most important files" ranking. With it, the map biases toward the neighborhood of whatever the user is currently working on.

4. **~1,000 tokens is enough for architecture.** Aider's map uses 4.3–6.5% of the context window and correctly identifies relevant files 70.3% of the time. More context isn't always better — ETH Zurich showed that excess context can actually hurt.

5. **The approach scales to a point, then needs scoping.** PageRank works well up to ~10K files. Beyond that, scope the map per-package or switch to hybrid approaches (Windsurf's RL-trained retrieval, or Amazon Q's triple index).

## Sources & Further Reading

- [Aider — Repository Map](https://aider.chat/docs/repomap.html) — the canonical implementation and detailed explanation
- [Aider — Building a Better Repository Map with Tree Sitter](https://aider.chat/2023/10/22/repomap.html) — engineering deep dive on the tree-sitter transition
- [Aider — SWE Bench Lite Results](https://aider.chat/2024/05/22/swe-bench-lite.html) — benchmark results and methodology
- [RepoGraph: Enhancing AI Software Engineering with Repository-level Code Graph](https://arxiv.org/abs/2410.14684) — academic paper showing 32.8% improvement over baselines
- [Keyword Search Is All You Need](https://arxiv.org/abs/2602.23368) — Amazon Science paper validating keyword search over RAG
- [Cursor — Codebase Indexing](https://docs.cursor.com/context/codebase-indexing) — vector-based approach with Merkle tree change detection
- [Windsurf SWE-grep](https://windsurf.com/blog/swe-grep) — RL-trained retrieval approach
- [OpenCode](https://opencode.ai/) — LSP-integrated coding agent
- [Claude Code — Best Practices](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) — agentic search approach
- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) — the parsing foundation used in this demo
