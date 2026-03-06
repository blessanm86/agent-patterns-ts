# Your Agent's Memory Doesn't Need a Vector Database

## Observational Memory for Long Conversations

[Agent Patterns — TypeScript](../../README.md)

---

Your agent is having a great conversation. The user mentions they're vegan, allergic to nuts, and cooking for six on Saturday. Twenty turns later, the agent recommends a walnut-crusted salmon. What happened?

The conversation grew. The context window filled up. The early messages — the ones containing the user's most important preferences — got pushed out. This is the fundamental failure mode of long-running agents: **the information that matters most arrives early and disappears first**.

The standard fixes each have a cost:

| Approach          | What it loses                                                                |
| ----------------- | ---------------------------------------------------------------------------- |
| **Truncation**    | Information — early messages vanish entirely                                 |
| **Summarization** | Specificity — "user has dietary preferences" instead of "vegan, nut allergy" |
| **RAG**           | Temporal coherence — retrieves fragments without conversational flow         |
| **Full context**  | Quality — models degrade as context grows (60% on LongMemEval)               |

Observational memory takes a different approach: **treat the conversation as a stream to be observed, not a log to be stored.** Two background agents — an Observer and a Reflector — continuously compress raw messages into dated factual observations, keeping the context window small while preserving every important detail.

The result: 94.87% on [LongMemEval](https://arxiv.org/abs/2410.10813) (vs. 80% for RAG, 60% for full context), with 3–40x compression and full prompt caching compatibility.

## The Core Idea: Two Agents, Two Blocks

The architecture is inspired by how human memory works. When you walk down a busy street, your brain processes millions of visual signals but distills them into one or two observations: _that car just ran a red light_, _the neighbor's dog is off leash_. Later, your brain reflects — reorganizing, combining, and condensing into long-term memory.

Observational memory works the same way:

```
┌──────────────────────────────────────────────────────┐
│  SYSTEM PROMPT                                        │
│                                                       │
│  Base instructions                                    │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │  BLOCK 1: OBSERVATIONS              (stable)   │  │
│  │                                                 │  │
│  │  Date: 2026-03-01                               │  │
│  │  - 🔴 User is vegan and allergic to nuts        │  │
│  │  - 🟡 User prefers Mediterranean and Thai food  │  │
│  │  - 🟢 User asked about easy weeknight dinners   │  │
│  │                                                 │  │
│  │  Date: 2026-03-04                               │  │
│  │  - 🔴 Hosting dinner for 6 on Saturday          │  │
│  │  - 🟡 Comfortable with medium-difficulty recipes │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
├──────────────────────────────────────────────────────┤
│  BLOCK 2: RAW MESSAGES          (sliding window)      │
│                                                       │
│  User: What should I make for Saturday?               │
│  Assistant: [tool call: search_recipes(...)]           │
│  Tool: { recipes: [...] }                             │
│  Assistant: Based on your vegan diet and nut allergy, │
│  here are some options for your dinner party...       │
└──────────────────────────────────────────────────────┘
```

**Block 1 (Observations)** is a compressed log of everything important from past conversation. It sits in the system prompt as a stable prefix — the model sees it every turn. Created by the Observer, pruned by the Reflector.

**Block 2 (Raw Messages)** is the recent, uncompressed conversation. It grows with each turn until the Observer consumes it, compressing it into new observations for Block 1.

### The Observer

The Observer is a background LLM call that fires when raw messages exceed a token threshold (~30K tokens in production, ~1.5K in our demo). It reads the raw messages and produces dated observation entries:

```typescript
// observer.ts — the compression step
export async function runObserver(messages: Message[], today: string): Promise<ObserverResult> {
  // Build a readable transcript for the observer
  const transcript = messages
    .map((m) => {
      if (m.role === "tool") return `[Tool result]: ${m.content}`;
      if (m.role === "assistant") return `Assistant: ${m.content}`;
      return `User: ${m.content}`;
    })
    .join("\n");

  const response = await ollama.chat({
    model: MODEL,
    system: OBSERVER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Today: ${today}\n\n${transcript}` }],
  });

  return {
    observations: response.message.content.trim(),
    messagesConsumed: messages.length,
  };
}
```

Each observation gets an emoji priority flag:

- 🔴 **Critical** — dietary restrictions, allergies, strong preferences, key decisions
- 🟡 **Useful** — cuisine interests, skill level, household size
- 🟢 **Context** — topics discussed, recipes viewed, questions asked

### The Reflector

The Reflector fires when the observation block itself gets too large (~40K tokens in production, ~2K in our demo). It's the garbage collector:

```typescript
// reflector.ts — the pruning step
export async function runReflector(currentObservations: string): Promise<ReflectorResult> {
  const response = await ollama.chat({
    model: MODEL,
    system: REFLECTOR_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Condense this observation log:\n\n${currentObservations}`,
      },
    ],
  });

  return { observations: response.message.content.trim() };
}
```

The Reflector:

- **Merges** redundant observations ("likes spicy food" appearing twice → one entry)
- **Removes** superseded facts ("is vegetarian" followed later by "switched to vegan")
- **Promotes** patterns — if the user keeps asking for vegan recipes, that gets upgraded to 🔴
- **Drops** stale 🟢 observations that have no lasting value

### The Agent Loop

The main agent loop checks thresholds before each LLM call:

```typescript
// agent.ts — the two-block context architecture
export async function runAgent(
  userMessage: string,
  memory: MemoryState,
  mode: AgentMode,
): Promise<AgentResult> {
  memory.rawMessages.push({ role: "user", content: userMessage });

  // Phase 1: Observer — compress raw messages if threshold exceeded
  if (rawTokens > OBSERVER_TOKEN_THRESHOLD) {
    const result = await runObserver(memory.rawMessages, today);
    memory.observations += "\n\n" + result.observations;
    memory.rawMessages = [{ role: "user", content: userMessage }];
  }

  // Phase 2: Reflector — prune observations if threshold exceeded
  if (obsTokens > REFLECTOR_TOKEN_THRESHOLD) {
    const result = await runReflector(memory.observations);
    memory.observations = result.observations;
  }

  // Phase 3: ReAct loop with two-block context
  const systemPrompt = buildSystemPrompt(memory.observations);
  // observations are in system prompt, raw messages are the message array
  // ... standard tool-calling loop
}
```

## Why This Beats RAG

The instinct when hearing "agent needs to remember things" is to reach for a vector database. Embed the conversation, store chunks, retrieve on demand. But for long-running conversations, this has real costs:

**RAG breaks prompt caching.** Every turn, the retrieval step injects different chunks into the prompt. The prefix changes each time → no cache hits → full price per turn. Observational memory's Block 1 is append-only until the Reflector runs. The observation prefix stays identical across turns → full prompt cache hits.

**RAG loses temporal coherence.** Retrieval returns fragments ranked by similarity, not by conversational flow. "User is vegan" and "user asked about Thai food" might be retrieved, but "user switched from vegetarian to vegan last week" requires temporal reasoning that chunk-based retrieval can't provide. Observations preserve temporal ordering by design — they're dated and sequential.

**RAG adds latency.** Each turn requires an embedding call, a vector search, and a reranking step. Observational memory has zero retrieval latency — observations are always in context. The Observer and Reflector run asynchronously in the background, not on the critical path.

The benchmark numbers bear this out. On [LongMemEval](https://arxiv.org/abs/2410.10813) — a benchmark testing memory across 500 questions spanning ~57M tokens:

| System                                     | Score      |
| ------------------------------------------ | ---------- |
| Mastra Observational Memory (gpt-5-mini)   | **94.87%** |
| Mastra Observational Memory (gpt-4o)       | 84.23%     |
| Oracle (given only relevant conversations) | 82.40%     |
| RAG (top-k=20, gpt-4o)                     | 80.05%     |
| Zep (temporal knowledge graph)             | 71.20%     |
| Full context (gpt-4o)                      | 60.20%     |

The observation-based approach beats the _oracle_ — a system given only the conversations containing the answer. This suggests that compressed observations are actually more useful to the model than raw conversation data, because the noise has been stripped away.

Other practitioner memory systems tell the same story. [Mem0](https://mem0.ai/research), the most widely-adopted memory layer, extracts discrete facts via a two-phase pipeline and achieves 90%+ token savings — but at 20–40 seconds extraction latency and lower accuracy than OM on inference tasks. [Letta/MemGPT](https://docs.letta.com/concepts/memgpt/) takes an OS-inspired approach with FIFO eviction and recursive summarization, but the agent must remember to retrieve (no automatic injection). The key distinction: **summarization compresses everything equally, while observation selectively extracts what matters.** This is why observations outperform even full-context approaches — they strip noise, preserving signal.

## The Cache Dividend

The two-block structure isn't just architecturally clean — it's financially significant. Most cloud providers offer 4–10x cost reduction for prompt cache hits (tokens the model has already processed in recent requests).

Here's how caching interacts with each conversation event:

| Event               | Block 1 (Observations)    | Block 2 (Raw Messages)   | Cache behavior                                                  |
| ------------------- | ------------------------- | ------------------------ | --------------------------------------------------------------- |
| **Normal turn**     | Unchanged                 | Appends new messages     | **Full cache hit** — entire prefix is identical                 |
| **Observer fires**  | New observations appended | Reset to current message | **Partial cache hit** — Block 1 prefix cached, Block 2 restarts |
| **Reflector fires** | Reorganized               | Unchanged                | **Cache miss** — but this is rare                               |

In practice, the Observer fires every ~30K tokens of conversation and the Reflector fires perhaps once per session. That means the vast majority of turns get full cache hits — a massive cost reduction for long conversations.

## Running the Demo

```bash
# With observational memory (default)
pnpm dev:observational-memory

# Without observations (baseline for comparison)
pnpm dev:observational-memory:no-observe
```

### CLI Commands

| Command         | What it does                       |
| --------------- | ---------------------------------- |
| `/observations` | Show the current observation log   |
| `/stats`        | Token counts for each memory block |
| `/clear`        | Reset all observations and history |

### Suggested Walkthrough

Try this sequence to see the Observer in action:

```
1. "I'm vegan and allergic to nuts"
2. "I love Thai and Mediterranean food"
3. "Find me an easy weeknight dinner"
4. "What about something more challenging?"
5. "I'm cooking for 6 people this Saturday"
6. /observations  ← see what the Observer captured
7. /stats         ← check token counts
8. "Recommend a recipe for my Saturday dinner"
   ↑ The agent uses observations to remember your preferences
     even if the early messages have been compressed away
```

## The Academic Roots

Observational memory draws from several lines of research:

**Generative Agents (Park et al., Stanford 2023)** introduced the memory stream — an append-only log where agents record observations, then generate reflections when accumulated importance exceeds a threshold. Their retrieval scoring formula (recency × importance × relevance) established the three-signal approach to memory access. The key insight: reflections stored _as memories_ create an emergent hierarchy where observations feed reflections, which feed meta-reflections.

**A-MEM (Xu, Liang et al., NeurIPS 2025)** adapted the Zettelkasten method — each memory node carries seven fields (content, timestamp, keywords, tags, context description, embedding, links). Unlike append-only streams, A-MEM _evolves_ existing memories when new information arrives. The LLM decides which connections are meaningful, achieving an 85–93% token reduction over baselines.

**AgeMem (Yu et al., Alibaba 2026)** framed memory operations as tool calls — the agent learns _when_ to memorize through three-stage RL training: build long-term memory → learn to filter short-term context → coordinate both. The FILTER tool (removing irrelevant context) proved as important as storage.

Mastra's Observational Memory synthesizes these ideas into a production-ready architecture: the Observer plays the role of Generative Agents' observation + initial reflection, the Reflector plays the role of memory consolidation, and the two-block context structure provides A-MEM's token efficiency without requiring vector embeddings or graph databases.

## Tradeoffs

**Observer quality depends on the model.** A weak observer model might miss subtle preferences or hallucinate observations. The Observer is an LLM call — it can fail. Mastra recommends 128K+ context models like Gemini 2.5 Flash for the Observer/Reflector roles.

**Latency on threshold crossings.** When the Observer or Reflector fires, it adds 1-2 extra LLM calls to that turn. Mastra solves this with async buffering (observer runs in the background before the threshold is hit). Our demo runs them synchronously for clarity.

**No random access.** Unlike RAG, you can't ask "what did the user say about mushrooms?" and get a targeted answer. Observations are always fully loaded into context. For very long histories (months of daily interactions), the Reflector may need to run multiple times.

**Information loss is possible.** Compression is lossy by design. A 🟢 observation about a mentioned cookbook might get dropped by the Reflector, and if the user later asks "what was that cookbook?", the agent won't know. The priority system (🔴/🟡/🟢) mitigates this, but doesn't eliminate it.

**Context poisoning.** If the Observer hallucinates a fact ("user is allergic to dairy" when they never said that), the incorrect observation persists and compounds across sessions. Unlike raw messages, there's no original source to verify against once messages are consumed. The priority system makes this worse — a hallucinated 🔴 observation is nearly impossible to displace.

**Preference drift.** Users change their minds. "I'm vegan" might become "I started eating fish again" six months later. The Reflector should catch explicit supersessions, but gradual drift is harder — the observation log might contain both "user is vegan" and "user enjoyed the salmon recipe" without recognizing the contradiction.

**When to use alternatives:**

- **Short conversations** (<8K tokens): Just use full context — no compression needed
- **Known-item lookup**: RAG is better when you need to search a large external corpus
- **Structured data**: If preferences are well-defined, a simple key-value store (like our [Persistent Memory](../persistent-memory/README.md) concept) may be cleaner
- **Cross-session knowledge base**: If you need the user to curate and edit memories, file-based approaches (like CLAUDE.md) give more control

## In the Wild: Coding Agent Harnesses

Observational memory — or patterns closely resembling it — appears across the coding agent landscape:

**GitHub Copilot** has the most explicitly observation-based memory among harnesses. Copilot agents create structured memory entries during normal operation, each containing a subject, fact, citations to specific code locations, and a reason. When retrieving memories, Copilot performs just-in-time validation — checking that cited code still exists on the current branch before using the memory. Memories expire after 28 days unless refreshed, preventing memory rot. This is textbook observational memory: a sidecar process watches the agent work and records actionable facts with provenance.

**Cursor** runs a sidecar model that observes conversations and extracts relevant facts in the background. Background-generated memories require user approval before being saved — an interesting trust boundary that Mastra's OM doesn't have. This is the closest IDE implementation to the Observer pattern: a separate model watches the conversation and distills observations.

**Claude Code** takes a more manual approach with its auto-memory feature (`MEMORY.md`). Claude decides what's worth remembering and writes notes for itself — build commands, debugging insights, architecture decisions, code style preferences. It's observation-based in spirit (Claude observes and records), but it's selective note-taking rather than systematic conversation compression. The 200-line cap on `MEMORY.md` functions like a soft version of the Reflector — it forces conciseness by moving detailed notes to separate topic files.

**Cline/Roo Code** uses a Memory Bank — structured markdown files (`projectbrief.md`, `activeContext.md`, `progress.md`, etc.) that the agent reads at session start. This is more of a structured project wiki than observational memory. Updates are user-triggered rather than automatic, though Roo Code's MCP integration makes the process more seamless.

**Windsurf (Codeium)** has built-in auto-generated memories — Cascade watches conversation patterns and decides what to persist across sessions. Combined with user-prompted creation ("remember that we use PostgreSQL"), it offers a dual-path approach. Notably, memory generation is free (no flow action credit cost).

The harness landscape reveals an interesting pattern: **conversation compression and observational memory serve different purposes**. Harnesses like Aider and OpenCode compress conversations (summarization) to manage context within a session. But observational memory builds a persistent knowledge base that improves future performance regardless of session continuity. The most sophisticated harnesses (Copilot, Cursor) do both.

## Key Takeaways

1. **Observation, not storage.** The paradigm shift: stop storing conversations and start observing them. Two background agents (Observer + Reflector) replace complex retrieval pipelines.

2. **Two blocks, one context.** Observations (compressed, stable) + raw messages (recent, sliding) = a context window that's both small and complete. The stable observation prefix enables prompt caching.

3. **Compression beats retrieval.** On LongMemEval, observational memory (84–95%) beats RAG (80%), full context (60%), and even the oracle (82%). Compressed observations are more useful than raw conversation data because the noise has been stripped away.

4. **Priority flags prevent information loss.** The 🔴/🟡/🟢 system ensures critical facts (allergies, restrictions) survive compression while ephemeral context (topics browsed) can be safely dropped.

5. **Text is the universal interface.** Observations are plain text — no vector database, no graph DB, no embedding pipeline. This makes them inspectable, debuggable, and portable.

## Sources & Further Reading

- [Announcing Observational Memory](https://mastra.ai/blog/observational-memory) — Mastra, 2026. The primary reference: 94.87% LongMemEval, 5-40x compression
- [Observational Memory Research](https://mastra.ai/research/observational-memory) — Mastra benchmarks and methodology
- [Observational Memory Docs](https://mastra.ai/docs/memory/observational-memory) — API reference and configuration
- [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442) — Park et al., Stanford 2023. Memory stream with observation, reflection, and planning layers
- [A-MEM: Agentic Memory for LLM Agents](https://arxiv.org/abs/2502.12110) — Xu, Liang et al., NeurIPS 2025. Zettelkasten-inspired memory with dynamic indexing
- [AgeMem: Agentic Memory for LLM-Based Agents](https://arxiv.org/abs/2601.01885) — Yu et al., Alibaba 2026. Memory operations as tool calls with three-stage RL
- [LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory](https://arxiv.org/abs/2410.10813) — Wu et al., ICLR 2025. The benchmark: 500 questions across ~57M tokens
- [Building an Agentic Memory System for GitHub Copilot](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/) — GitHub Engineering Blog
- [VentureBeat: Observational memory cuts AI agent costs 10x](https://venturebeat.com/data/observational-memory-cuts-ai-agent-costs-10x-and-outscores-rag-on-long) — Industry coverage
- [Evo-Memory & ReMem](https://arxiv.org/abs/2511.20857) — UIUC/DeepMind, 2025. Experience-reuse memory with retrieval-augmented refinement

Previous concept: [Agent Dependency Injection](../dependency-injection/README.md)
