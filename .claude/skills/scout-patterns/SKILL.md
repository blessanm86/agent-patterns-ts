---
name: scout-patterns
description: Scout the web for new agentic AI patterns and add them to LEARNING_ROADMAP.md
disable-model-invocation: true
argument-hint: "<time period, e.g. 'last 3 months'>"
---

# Scout Patterns

Scout the web for new agentic AI patterns published within `$ARGUMENTS` and add qualifying discoveries to `LEARNING_ROADMAP.md`.

---

## Phase 1 — Parallel Research

Spawn **6 agents in parallel**, each focused on a different research area. Every agent must:

- Include the current year in all search queries (e.g., "agentic patterns 2026", NOT just "agentic patterns")
- Scope searches to the time period specified by `$ARGUMENTS`
- For each finding, record: **name**, **one-sentence description**, **source URL**, **publication date**, **novelty assessment** (genuinely-new / significant-evolution / incremental-update)
- Return findings as a structured list

### Agent 1 — S-Tier Labs

Search Anthropic, OpenAI, and DeepMind for:

- Engineering blog posts about new agent patterns or architectures
- SDK releases with new abstractions (Claude Code, OpenAI Agents SDK, Gemini agent features)
- API features that enable new patterns (new tool-use modes, structured output features, streaming changes)

Queries (4-6, all time-bounded):

- `site:anthropic.com engineering blog agent pattern {year}`
- `site:openai.com blog agent SDK {year}`
- `site:deepmind.google blog agent architecture {year}`
- `Anthropic Claude agent new feature {year}`
- `OpenAI agents SDK new pattern {year}`
- `DeepMind Gemini agent capability {year}`

### Agent 2 — A+B-Tier Labs

Search xAI, Qwen/Alibaba, DeepSeek, Moonshot/Kimi, Zhipu AI, and Baidu for:

- Novel reasoning or planning techniques
- New agent architectures or training approaches
- Benchmark results revealing new capabilities

Queries (4-6, all time-bounded):

- `xAI Grok agent capability {year}`
- `Qwen agent reasoning planning {year}`
- `DeepSeek agent architecture technique {year}`
- `Moonshot Kimi agent feature {year}`
- `Zhipu GLM agent pattern {year}`
- `Baidu ERNIE agent workflow {year}`

### Agent 3 — Frameworks & SDKs

Search LangChain, Vercel AI SDK, LlamaIndex, CrewAI, AutoGen, Mastra, and Pydantic AI for:

- New formalized abstractions (named patterns that became first-class framework features)
- Architecture patterns codified in framework docs
- New primitives (e.g., new node types, new tool patterns, new memory strategies)

Queries (4-6, all time-bounded):

- `LangChain LangGraph new feature pattern {year}`
- `Vercel AI SDK new agent pattern {year}`
- `LlamaIndex agent workflow new {year}`
- `CrewAI AutoGen new agent pattern {year}`
- `Mastra agent framework feature {year}`
- `Pydantic AI agent pattern {year}`

### Agent 4 — Academic Research

Search arxiv.org and major AI conferences for:

- New agent architectures (planning, reasoning, memory, tool use)
- Benchmark papers revealing capability gaps
- Techniques with measured improvements over baselines

Queries (4-6, all time-bounded):

- `site:arxiv.org agentic AI pattern architecture {year}`
- `site:arxiv.org LLM agent tool use planning {year}`
- `site:arxiv.org multi-agent coordination benchmark {year}`
- `site:arxiv.org agent memory retrieval technique {year}`
- `LLM agent new technique paper {year}`
- `agentic AI benchmark evaluation {year}`

### Agent 5 — Practitioners

Search engineering blogs, dev.to, Medium, Hacker News, and community discussions for:

- Production agent patterns and lessons learned
- Failure modes and anti-patterns discovered in deployment
- Novel approaches to common agent problems

Queries (4-6, all time-bounded):

- `production AI agent pattern lessons learned {year}`
- `site:dev.to agentic pattern {year}`
- `site:news.ycombinator.com AI agent architecture {year}`
- `building AI agents production experience {year}`
- `AI agent failure mode anti-pattern {year}`
- `AI agent architecture blog post {year}`

### Agent 6 — Tools & Infrastructure

Search for new protocols, sandboxing approaches, browser automation, voice agents, and agent infrastructure:

- New protocols (MCP extensions, A2A, AG-UI, new standards)
- Sandboxing and execution environments
- Browser automation and computer use
- Voice and multimodal agent infrastructure

Queries (4-6, all time-bounded):

- `MCP model context protocol new extension {year}`
- `A2A agent-to-agent protocol {year}`
- `AG-UI agent user interface protocol {year}`
- `AI agent sandboxing execution environment {year}`
- `AI agent browser automation computer use {year}`
- `voice agent infrastructure pattern {year}`

---

## Phase 2 — Consolidation

After all 6 agents complete:

1. Merge all findings into a single list
2. **Deduplicate cross-agent finds** — if multiple agents found the same pattern, merge into one entry keeping the best description and all source URLs
3. Classify each finding as:
   - **genuinely-new**: A pattern/technique not previously documented in the roadmap
   - **significant-evolution**: A major advancement of an existing pattern (e.g., a new approach to RAG that changes the architecture)
   - **incremental-update**: A minor improvement or variation of an existing pattern
4. Drop all **incremental-update** findings immediately

---

## Phase 3 — Deduplication Against Existing Roadmap

**Read `LEARNING_ROADMAP.md` fresh** (do NOT rely on hardcoded knowledge — the roadmap may have changed since this skill was written).

For each remaining finding, check against ALL existing topics in the roadmap:

- **Exact match**: Finding describes the same pattern → EXCLUDE
- **Subset**: Finding is a narrower version of an existing topic → EXCLUDE
- **Superset**: Finding is a broader version that fully contains an existing topic → EXCLUDE (the existing topic already covers it)
- **Related-but-distinct**: Finding shares a domain with an existing topic but has a different core mechanism or architectural insight → KEEP
- **Genuinely-new**: No existing topic covers this → KEEP

Be conservative. When in doubt, exclude. The roadmap should grow with high-signal additions, not breadth for its own sake.

---

## Phase 4 — Save Research Artifact

Write the full consolidated research to `.research/scout-YYYY-MM-DD.md` (using today's date) with this structure:

```markdown
# Scout Patterns — YYYY-MM-DD

## Search Parameters

- Time period: {$ARGUMENTS}
- Date run: {today}
- Agents: 6

## Raw Findings by Agent

### Agent 1 — S-Tier Labs

{findings with URLs and dates}

### Agent 2 — A+B-Tier Labs

...

(repeat for all 6 agents)

## Consolidated Findings

{deduplicated list with classification}

## Excluded Findings

{each excluded finding with reason: exact-match/subset/superset/incremental}

## New Topics to Add

{final list of topics that passed all filters}
```

---

## Phase 5 — Tier Classification

Assign each new topic to a tier using these criteria:

| Tier                                                    | Criteria                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Tier 1 — Foundations**                                | Core building blocks everything else depends on. Unlikely to have new entries.                             |
| **Tier 2 — Practical Extensions**                       | Single-concept additions that make agents more useful (e.g., a new output pattern, a new memory strategy). |
| **Tier 3 — Multi-Model & Retrieval**                    | Patterns involving multiple models, retrieval, or external knowledge.                                      |
| **Tier 4 — Observability & Quality**                    | Production monitoring, evaluation, cost management, quality assurance.                                     |
| **Tier 5 — Advanced Production**                        | Multi-platform, sandboxed execution, dynamic integrations, autonomous workflows.                           |
| **Tier 6 — Agent Infrastructure & Advanced Evaluation** | Scaling across compute boundaries, long tool chains, behavioral evaluation.                                |

Most new discoveries will land in **Tier 4-6**. Assign to earlier tiers only if the pattern is truly foundational.

---

## Phase 6 — Add to Roadmap

For each new topic, make two edits to `LEARNING_ROADMAP.md`:

### 6a. Add a row to the Progress Tracking table

Insert after the last `Pending` row in the table. Format:

```markdown
| {Topic Name} | Pending | {Builds On, if any} |
```

### 6b. Add the full concept entry

Add it to the correct tier section, after the last entry in that tier. Follow the **exact** existing format:

```markdown
### [ ] {Topic Name}

**What it is:** {1-2 sentences describing the pattern concretely}

**Why it matters:** {1-2 sentences on practical value — why would a developer implement this?}

{**Builds on:** {prerequisite concept} — only if there's a clear dependency}

**Session brief:** {3-5 sentences. Describe what to build as a demo. Use concrete domain examples — e-commerce, travel, recipes, restaurants, CI/CD pipelines. Do NOT use observability/monitoring/dashboards as the demo domain.}

**Key ideas to cover:**

- {5-6 bullet points of concepts the blog post should explain}

**Blog angle:** "{catchy blog post title in quotes}"

**Sources:**

- [{Source title}]({URL}) — {author/org}, {year} — {one-line description}
- {3-5 sources total, each with a verified URL}
```

**Constraints on new entries:**

- Demo domains: Do NOT use observability, monitoring, dashboards, metrics, or alerting. Use: e-commerce, travel, recipes, restaurants, CI/CD pipelines, or other concrete domains.
- Sources: Provide 3-5 source URLs per entry. Every URL must come from the research phase (no invented URLs).
- Session brief: Must describe a buildable demo, not just a concept explanation.
- Blog angle: Should be a catchy, opinionated title that would work as a real blog post.

---

## Phase 7 — Summary Report

Print a summary:

```
## Scout Results — {date}

**Search period:** {$ARGUMENTS}
**Raw findings:** {count across all agents}
**After cross-agent dedup:** {count}
**After roadmap dedup:** {count}
**New topics added:** {count}

### Added to Roadmap
{numbered list of new topic names with their assigned tier}

### Notable Exclusions
{2-5 most interesting findings that were excluded, with reason}

### Research saved to
.research/scout-{date}.md
```
