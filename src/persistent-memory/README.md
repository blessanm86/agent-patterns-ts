# Persistent Cross-Session Memory

_Part of [Agent Patterns — TypeScript](../../README.md). Builds on [Multi-Turn Conversation Memory](../conversation-memory/README.md) and [Context Window Management](../context-management/README.md)._

---

Your agent has perfect memory within a conversation. Ask it your dietary restrictions on turn 1, and it nails the recommendation on turn 5. Close the terminal, open it again, and it has no idea who you are.

This is the gap between a useful tool and a useful assistant. ChatGPT, Claude, and Gemini all solved it the same way — and it's surprisingly simple. No vector databases. No embeddings. Just: **extract facts via LLM, store as a file, inject into the system prompt at session start.**

The file-based approach scores 74% on the LoCoMo long-conversation benchmark. Mem0's graph-based system scores 68.5%. The simpler approach wins.

---

## The Memory Lifecycle

```
Session 1                          Session 2
┌─────────────────────┐            ┌─────────────────────┐
│  User: "I'm         │            │  System prompt:      │
│  vegetarian and      │            │  ┌─────────────────┐│
│  live near Midtown"  │            │  │ What I Remember: ││
│                      │            │  │ - vegetarian     ││
│  ┌── ReAct Loop ──┐ │            │  │ - lives Midtown  ││
│  │ tool calls ...  │ │            │  │ - loves Thai     ││
│  │ response        │ │            │  └─────────────────┘│
│  └─────────────────┘ │            │                      │
│                      │            │  User: "What do you  │
│  ┌── Post-Loop ───┐ │            │  recommend?"          │
│  │ LLM extracts:  │ │            │                      │
│  │ • vegetarian   │─┼──── JSON ──┼─►(agent uses all 3   │
│  │ • Midtown      │ │    file    │   facts naturally)   │
│  └─────────────────┘ │            │                      │
└─────────────────────┘            └─────────────────────┘
```

Four stages, every conversation:

1. **Inject** — Load stored facts from JSON, render into system prompt
2. **Converse** — Standard ReAct loop with tool calls
3. **Extract** — Post-loop LLM call pulls new facts from the exchange
4. **Store** — Privacy-check, deduplicate, persist to JSON file

---

## How Every Major Lab Does It

Before building, we researched across the AI landscape. The dominant pattern is remarkably consistent:

| Lab                     | Mechanism                          | Key Detail                                                  |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------- |
| **OpenAI** (ChatGPT)    | Extract → file → inject            | `bio` field in system prompt; user editable; opt-out        |
| **Anthropic** (Claude)  | Extract → file → inject            | `CLAUDE.md` + memory directory; `.claude/` project memories |
| **Google** (Gemini)     | Extract → file → inject            | "Saved Info" persists across sessions                       |
| **Microsoft** (Foundry) | Extract → consolidate → retrieve   | 3-phase pipeline with LLM-backed conflict resolution        |
| **Mistral** (Le Chat)   | Extract → encrypted store → inject | Privacy-first: opt-in only, segregated from training        |

The outliers are interesting too:

- **DeepSeek** bets on architecture-level memory (Engram: O(1) retrieval, 1M token context at 128K cost) — skip extraction entirely
- **MiniMax** uses a tool-based approach — the agent explicitly calls a "note" tool to persist information
- **Nvidia** wraps memory transparently at the infrastructure level — agents don't know they have memory
- **Zhipu** preserves reasoning chains, not just facts — addressing "the model forgot how it was thinking"

---

## Implementation

### Memory Extraction (Post-Conversation LLM Call)

After each conversation turn, a secondary LLM call extracts facts worth remembering. This reuses the constrained-decoding pattern from [Post-Conversation Metadata](../post-conversation-metadata/README.md):

```ts
// memory-extractor.ts — Zod schema for constrained decoding
const ExtractionResultSchema = z.object({
  facts: z.array(
    z.object({
      content: z.string(), // "User is vegetarian"
      category: z.enum([
        "dietary",
        "cuisine",
        "restaurant",
        "location",
        "dining-style",
        "personal",
      ]),
      importance: z.number().int().min(1).max(10),
    }),
  ),
  forgetRequests: z.array(z.string()), // "vegetarian" if user says "I'm no longer vegetarian"
});
```

The extraction prompt includes existing memories to avoid re-extracting known facts. Only the last 2 filtered messages (user + assistant) are sent to minimize token cost.

### Memory Storage (JSON File)

Each fact is a `MemoryFact` with metadata for scoring:

```ts
interface MemoryFact {
  id: string; // "mem-<timestamp>-<random>"
  content: string; // "User is vegetarian"
  category: MemoryCategory; // "dietary" | "cuisine" | "restaurant" | ...
  importance: number; // 1-10, LLM-rated
  source: "extracted" | "explicit";
  createdAt: string; // ISO 8601
  lastAccessedAt: string; // Updated when injected
  accessCount: number; // How many times this fact was used
  sessionId: number; // Which session created it
}
```

Storage is a plain JSON file at `memory/restaurant-assistant.json`. No database, no embeddings, no vector store. For a personal assistant with fewer than ~50 memories, this is both simpler and more accurate than semantic search.

### Retrieval Scoring (Simplified Generative Agents)

Not all memories are equally relevant. Park et al.'s _Generative Agents_ (2023) introduced a scoring system combining recency, importance, and relevance. We simplify it (dropping the relevance/embedding component):

```
score = 0.4 × (importance / 10)           ← How critical is this fact?
      + 0.4 × (0.995 ^ hoursSinceAccess)  ← Exponential recency decay
      + 0.2 × (log(1 + accessCount) / 10) ← Frequency bonus (diminishing)
```

The top 15 facts by score get injected into the system prompt. Low-scoring memories aren't deleted — they're excluded from injection but preserved. They can resurface if more important facts are forgotten.

This follows the Ebbinghaus forgetting curve principle — memories decay exponentially unless reinforced through access. MemoryBank (Zhong et al., 2023) formalized this as `R = e^(-t/S)` where `S` is the memory's stability. Our `0.995^hours` is a simplified version of the same idea.

### Memory Injection (System Prompt)

Stored memories are rendered as a section in the system prompt:

```
## What I Remember About You
- User is vegetarian (importance: 9, session 1)
- User lives near Midtown (importance: 7, session 1)
- User loves Thai food (importance: 8, session 2)
```

The agent sees this at the start of every conversation. It references memories naturally ("Since you're vegetarian...") rather than mechanically ("According to my memory database...").

Why system prompt injection instead of a memory-retrieval tool? ChatGPT and Claude Code both use injection. Tool-based memory (the MemGPT approach) requires the model to know when to search — and small local models aren't reliable at deciding "should I check my memory?" before answering. Injection is stateless and predictable.

### Privacy Filter

Before any fact is stored, it passes through a regex-based PII detector:

```ts
// Blocked patterns: SSN, credit card, email, phone, password
const piiCheck = checkForPII(fact.content);
if (!piiCheck.isSafe) {
  console.log(`Blocked (PII: ${piiCheck.flaggedPatterns.join(", ")})`);
  // Fact is logged but never persisted
}
```

This is a first line of defense. Production systems layer on NER models and custom classifiers, but regex catches the obvious patterns. The MINJA attack paper (Palo Alto Unit42) showed that memory poisoning can achieve over 95% injection success rate — making PII filtering and input validation essential even for simple implementations.

### Deduplication

String-matching dedup within the same category:

```ts
// "User is vegetarian and prefers plant-based" vs "User is vegetarian"
// → substring match in same category → skip the duplicate
const existing = memoryStore.deduplicate(fact.content, fact.category);
if (existing) continue; // Already know this
```

Sufficient for <50 memories. At scale, you'd upgrade to embedding-based similarity (cosine > 0.85 threshold). For contradiction resolution (user said "vegetarian" then later "I eat fish now"), the extraction prompt detects these and emits `forgetRequests`.

---

## Three-Session Demo

Run the assistant and try this sequence:

```bash
pnpm dev:persistent-memory
```

**Session 1** — Establish preferences:

```
You: I'm vegetarian and live near Midtown
  💾 Stored: "User is vegetarian" [dietary, importance: 9]
  💾 Stored: "User lives near Midtown" [location, importance: 7]
```

**`/new-session`** — Clear chat history, keep memories:

```
  🔄 Started session 2 (chat history cleared, memories kept)
     2 memories available
```

**Session 2** — Add more context:

```
You: I also love Thai food
  🧠 Injected 2 memories into system prompt
  💾 Stored: "User loves Thai food" [cuisine, importance: 8]
```

**`/new-session`** → **Session 3**:

```
You: What do you recommend?
  🧠 Injected 3 memories into system prompt
  🔧 Tool call: search_restaurants { cuisine: "thai", neighborhood: "midtown" }
Assistant: Based on your preferences, I'd recommend Siam Garden in Midtown!
  Since you're vegetarian, they have excellent vegetarian and vegan options...
```

The agent combines all three facts — without the user repeating any of them.

### Contrast Mode

Run without memory to see the difference:

```bash
pnpm dev:persistent-memory:no-memory
```

Same questions, but the agent has no stored context. When you ask "What do you recommend?" in session 3, it has nothing to work with — no dietary restrictions, no location, no cuisine preference. It gives a generic response instead of a personalized one.

---

## Memory Management

### Slash Commands

| Command          | What it does                                         |
| ---------------- | ---------------------------------------------------- |
| `/memories`      | Display all stored facts with scores                 |
| `/forget <text>` | Remove memories matching the text                    |
| `/new-session`   | Increment session counter, clear chat, keep memories |
| `/clear-all`     | Delete all memories, start fresh                     |
| `/stats`         | Show counts by category                              |

### The Forget Flow

Users can explicitly forget things:

```
You: Actually, I'm no longer vegetarian
  (extractor detects forgetRequest: "vegetarian")
  trash Forgot: "User is vegetarian"
```

Or use the slash command:

```
/forget vegetarian
  trash Forgot: "User is vegetarian"
```

---

## Academic Context

This implementation draws from three key papers:

### Generative Agents (Park et al., 2023)

The foundational work on agent memory. 25 AI agents living in a simulated town, each with a memory stream of observations scored by recency, importance, and relevance. The full architecture scored 29.89 on believability — higher than human crowdworkers at 22.95.

Our scoring formula is a simplified version of theirs, dropping the relevance component (which requires embeddings) but keeping the importance-recency-frequency structure.

### MemGPT (Packer et al., 2023)

Introduced the "OS analogy" for LLM memory: context window = RAM, external storage = disk. The agent manages its own memory through explicit function calls (read, write, search). Achieved 93.4% accuracy on the DMR benchmark.

We chose system-prompt injection over MemGPT's tool-based approach because small local models aren't reliable at deciding when to search their memory. MemGPT works best with frontier models (GPT-4+).

### MemoryBank (Zhong et al., 2023)

Applied Ebbinghaus forgetting curves to agent memory. Memories decay exponentially unless reinforced through access. Our `0.995^hours` decay factor is inspired by their formalization `R = e^(-t/S)`.

### A-Mem (2025)

Zettelkasten-inspired memory with note-linking and evolution. Showed +79.8% improvement on multi-hop reasoning over MemGPT baseline. Their ablation study found that removing memory evolution alone causes a 32% degradation — confirming that consolidation is not optional.

---

## Key Takeaways

1. **File-based memory beats vector search for small scale.** A plain JSON file with LLM-extracted facts scores 74% on LoCoMo. Mem0g (graph-based) scores 68.5%. Don't reach for a vector DB until you have >50 memories per user.

2. **Forgetting is a feature, not a bug.** Without decay, memory bloat degrades performance. Indiscriminate storage leads to error propagation — inaccurate past experiences compound to degrade future performance.

3. **System prompt injection is the production default.** ChatGPT, Claude, and Gemini all inject memories into the system prompt. Tool-based memory retrieval (MemGPT) is more sophisticated but requires the model to know when to search.

4. **Privacy is non-negotiable.** Memory stores are attack surfaces. PII filtering, input validation, and user control (view, edit, delete) are baseline requirements, not nice-to-haves.

5. **Extraction quality > storage sophistication.** The bottleneck is the LLM deciding what's worth remembering and at what importance level. A good extraction prompt with constrained decoding matters more than the storage backend.

6. **The landscape is not converged.** Five distinct approaches exist across labs: file-based extraction (OpenAI/Anthropic), architecture-level context (DeepSeek), tool-based notes (MiniMax), infrastructure wrapping (Nvidia), and reasoning persistence (Zhipu). The "right" approach depends on scale, model capability, and privacy requirements.

---

## Sources & Further Reading

- [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442) — Park et al., 2023. The foundational agent memory paper.
- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560) — Packer et al., 2023. OS-inspired virtual context management.
- [MemoryBank: Enhancing Large Language Models with Long-Term Memory](https://arxiv.org/abs/2305.10250) — Zhong et al., 2023. Ebbinghaus forgetting curves for agents.
- [Mem0: Building Production-Ready AI Agent Memory](https://arxiv.org/abs/2504.19413) — Chhikara et al., 2025. Graph-based memory with measured benchmarks.
- [A-Mem: Agentic Memory for LLM Agents](https://arxiv.org/abs/2502.12110) — 2025. Zettelkasten-inspired memory with note evolution.
- [Zep: Temporal Knowledge Graphs for Agent Memory](https://arxiv.org/abs/2501.13956) — Rasmussen et al., 2025. Bi-temporal fact tracking.
- [Memory in the Age of AI Agents](https://arxiv.org/abs/2512.13564) — Survey, 2025. Unified taxonomy of agent memory.
- [Anthropic Memory Tool Documentation](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/memory) — File-based memory for Claude.
- [OpenAI Memory and Context Guide](https://platform.openai.com/docs/guides/conversation-state) — ChatGPT memory system.
- [Microsoft Foundry Agent Memory](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/what-is-memory) — Enterprise 3-phase pipeline.
