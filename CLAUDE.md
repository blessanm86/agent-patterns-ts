# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (run directly with tsx, no build step needed)
# Run `pnpm dev:<concept-name>` — see package.json for all available scripts

# Build to dist/
pnpm build

# Run compiled output
pnpm start

# Evals
pnpm eval         # run all evals once
pnpm eval:watch   # watch mode with UI at localhost:3006

# Lint & format (oxlint + oxfmt — also runs automatically on pre-commit)
pnpm lint         # check for lint errors
pnpm lint:fix     # auto-fix lint errors
pnpm fmt          # format all files in src/
pnpm fmt:check    # check formatting without writing
```

**Prerequisites:** Ollama must be running locally (`ollama serve`) with the model pulled (`ollama pull qwen2.5:7b`). Copy `.env.example` to `.env` to configure the model and host.

## Architecture

This repo contains self-contained demos of agentic patterns — see `LEARNING_ROADMAP.md` for the full list and status.

The two foundational patterns are:

### The ReAct Loop (`src/react/agent.ts`)

`runAgent()` accepts a user message and the full conversation history, then runs a `while(true)` loop:

1. Send history + system prompt + available tools to the Ollama model
2. If the response contains **no tool calls** → break and return updated history
3. If the response contains **tool calls** → execute each via `executeTool()`, push the results back into the message history as `role: 'tool'` messages, and loop again

The conversation history (array of `Message` objects) is the entire state of the agent. It's maintained in `index.ts` and passed into `runAgent()` on each user turn.

### The Plan+Execute Pipeline (`src/plan-execute/agent.ts`)

`runPlanExecuteAgent()` runs three phases — no loop:

1. **Plan** — single LLM call with `format: 'json'`, returns a `Plan` with all tool calls decided upfront
2. **Execute** — loop through `plan.steps`, call `executeTripTool()` for each (no LLM involved)
3. **Synthesize** — single LLM call turns all tool results into a final itinerary

`createPlan()` is exported separately so evals can test the plan structure before any tools run.

### Tool System

Every tool has two distinct parts — a pattern to preserve when adding new tools:

- **Definition** (in the `tools`/`tripTools` export array): JSON schema describing name, description, and parameters. This is what gets sent to the model (or listed in the planner prompt).
- **Implementation** (private functions): The actual code that runs. The model never sees this.

### File Responsibilities

Each concept folder follows the same structure:

```
src/<concept>/
├── README.md   — blog post / concept explainer
├── index.ts    — readline CLI entry point
├── agent.ts    — agent loop and LLM calls
└── tools.ts    — tool definitions + implementations
```

Shared types (`Message`, `ToolDefinition`, etc.) live in `src/shared/types.ts`.
Shared eval helpers live in `src/shared/eval-utils.ts`.

## Repo Philosophy

This repo is a series of self-contained demos, one per concept from `LEARNING_ROADMAP.md`. Each concept lives in its own folder under `src/`. Evals live inside the concept folder they test.

### Adding a new concept

Follow these steps when implementing a concept from the learning roadmap:

**0. Research the concept first**

Before writing any code or forming an implementation plan, do a research pass across multiple sources. The goal is to understand the concept deeply — including real-world tradeoffs, provider differences, and measured results — so the implementation and README reflect the best current thinking, not just one vendor's perspective.

**Always research across these 6 areas:**

- **The web** — broad web search to discover what's out there; surface blog posts, tutorials, discussions, and framework docs (Vercel AI SDK, LangChain, LlamaIndex) that cover the concept
- **LLM makers** — check the tiered AI labs list below; prioritize S and A tier, cover B tier for concepts where they have relevant work, and spot-check C/D tier for unique angles. Look at their engineering blog posts, API docs, and official guides on how they implement or recommend the pattern
- **Providers** — cloud platforms, tooling companies, and framework authors that offer the pattern as a product or feature — how they package it for real users
- **Researchers** — academic papers (the LEARNING_ROADMAP.md lists key papers per concept); read abstracts and results sections for benchmarks, formal definitions, and measured outcomes. Also search https://arxiv.org/ directly for recent preprints on the topic
- **Practitioners** — engineers who've built with the pattern in production; their blog posts, write-ups, and community discussions surface failure modes, gotchas, and real-world tradeoffs that official docs omit
- **Coding agent harnesses** — check if the pattern is used by popular coding agent harnesses (see the reference list below). These harnesses are the most visible, widely-used agentic systems today — they combine dozens of patterns into a single product that developers interact with daily. Understanding how they apply a pattern grounds the concept in something concrete the reader already uses

**Use parallel agent spawning for research.** Spawn multiple Task agents simultaneously — one per source or topic area — so research completes faster. For example:

```
Agent 1: Fetch and summarize Anthropic's engineering post on the concept
Agent 2: Fetch OpenAI + Vercel AI SDK docs on the concept
Agent 3: Web search for practitioner experience and measured results
```

> **Note:** Sub-agents need `WebSearch` and `WebFetch` pre-approved in `.claude/settings.json` for background web research to work. If permissions aren't configured, do web research directly from the main agent.

**Save research artifacts** to `.research/<topic>.md` so they're available during implementation. The `.research/` directory is gitignored.

Synthesize findings before starting implementation. Key things to extract:

- Concrete before/after examples (weak vs. strong implementations)
- Measured impact (accuracy numbers, benchmark results, latency data)
- Where providers/frameworks disagree — these disagreements are worth surfacing in the README
- Failure modes and anti-patterns practitioners have encountered in production
- **Harness usage** — which coding agent harnesses use this pattern, how they implement it, and any interesting variations or tradeoffs between harnesses. This feeds directly into the README's "In the Wild" section

**0.5. Assess: single concept or topic decomposition**

After synthesizing research, evaluate whether the topic should remain a single concept or split into multiple sub-concepts:

- **Keep as one** when variations are nuances — different vendor implementations of the same core idea, minor technique differences, or tradeoffs best understood in contrast. Document these in the README.
- **Split into sub-concepts** when research reveals fundamentally different approaches that have their own distinct architecture, mental model, or implementation worth exploring independently.

Signals that a split is warranted:

- The approaches solve the same high-level problem but in incompatible ways
- A reader would need to "unlearn" one approach to understand the other
- Each variant has enough depth for its own demo + README
- Combining them into one README would require constant "but if you're using X instead..." context-switching

**When splitting: update the LEARNING_ROADMAP.md with the new sub-concept entries (e.g. "Harness Engineering — OpenCode", "Harness Engineering — Claude Code") and stop.** Do not continue to implementation. The user will clear context and kick off each sub-concept in its own session using the normal flow. This keeps each session focused and avoids context bloat that degrades output quality.

**1. Decide: extend an existing demo or create a new one**

- **Extend** if the concept is a small additive change that doesn't obscure how the original works (e.g. adding a guardrail to the ReAct loop)
- **New demo** if understanding it requires the reader to mentally subtract other features, or the concept is the main point — a focused new demo with some duplication is better than a bloated existing one

**2. Create the concept folder**

```
src/<concept-name>/
├── README.md       # required — the concept explainer (see below)
├── index.ts        # CLI entry point if it's a runnable demo
├── agent.ts        # agent logic
├── tools.ts        # tool definitions + implementations
└── evals/          # evals for this concept
```

**3. Write the README.md**

Every concept folder gets a `README.md` that reads as a well-written blog post aimed at teaching a developer the concept. It should:

- Open with a hook — why does this concept matter?
- Show the core idea with a diagram or concise code snippet
- Walk through the implementation with annotated examples
- Explain the tradeoffs: when to use this pattern vs. alternatives
- Include an **"In the Wild: Coding Agent Harnesses"** section (see below)
- Close with concrete key takeaways
- Include a "Sources & Further Reading" section with links to key papers, docs, and blog posts from the research phase
- Link back to the root README with `[Agent Patterns — TypeScript](../../README.md)`
- Reference the previous concept post if this one builds on it

The tone should be that of a good technical blog post — not bare-bones documentation.

**The "In the Wild: Coding Agent Harnesses" section**

If research reveals that one or more coding agent harnesses use this pattern, include a dedicated section that shows how real products apply it. This section demystifies the harnesses — turning them from black boxes into concrete examples of patterns the reader just learned.

Guidelines for this section:

- **Include it when the pattern is clearly used by at least one harness.** Most patterns will qualify — harnesses are the densest concentration of agentic patterns in production today.
- **Be specific, not hand-wavy.** Don't just say "Claude Code uses this pattern." Explain _how_ — what the tool name is, what the flow looks like, what tradeoffs the harness made. Reference the harness's documentation or source code where possible.
- **Compare across harnesses** when they take different approaches to the same pattern. These differences are the most valuable teaching moments (e.g., Aider's multiple edit formats vs. Claude Code's search-replace vs. Cursor's inline diff).
- **Keep it concise** — 3-6 paragraphs. This is a spotlight, not a full case study. The goal is "oh, _that's_ what Claude Code is doing when it..." moments.
- **Skip it** if the pattern is too low-level or theoretical for any harness to visibly use (e.g., pure academic evaluation patterns). Don't force it.

**4. Add a dev script to `package.json`**

```json
"dev:<concept-name>": "tsx src/<concept-name>/index.ts"
```

**5. Add a row to the patterns table in the root `README.md`**

```markdown
| [Concept Name](src/<concept-name>/README.md) | Demo description | `pnpm dev:<concept-name>` |
```

**6. Handle shared code**

Extract to `src/shared/` only when the same code would appear in two or more demos. Don't pre-emptively share — duplication is fine until the second copy appears.

**7. Mark the concept as done in `LEARNING_ROADMAP.md`**

Change `[ ]` to `[x]` and update the status in the progress table at the bottom.

---

### Model Configuration

Set via `.env`. No code changes needed to swap models:

```
MODEL=qwen2.5:7b        # default
OLLAMA_HOST=http://localhost:11434
```

Models with good tool-call support: `qwen2.5:7b`, `qwen2.5:14b`, `llama3.1:8b`, `mistral:7b`.

### AI Labs — Tiered Reference List

Use this list when researching concepts. All tiers must be researched and distilled — not just S/A. Every tier brings unique perspectives worth capturing.

| Tier                                           | Labs                                                                      | Notes                       |
| ---------------------------------------------- | ------------------------------------------------------------------------- | --------------------------- |
| **S** — Dominating leaders                     | DeepMind, OpenAI, Anthropic                                               | Always research and distill |
| **A** — Other leaders with clear dominance     | xAI, Tongyi Qianwen (Alibaba)                                             | Always research and distill |
| **B** — Strong contenders with SOTA releases   | DeepSeek, Moonshot (Kimi), Zhipu AI (GLM), Baidu (ERNIE)                  | Always research and distill |
| **C** — Some major advantages giving potential | Meta AI (LLaMA), Nvidia (NeMo), Microsoft (Phi), Tencent AI Lab (Hunyuan) | Always research and distill |
| **D** — Behind but promising                   | Amazon AGI Lab (Nova), MiniMax, Mistral AI                                | Always research and distill |

### Coding Agent Harnesses — Reference List

Use this list when researching the "Coding agent harnesses" area. These are the most widely-used agentic coding tools — each one is a production harness that combines many patterns from this repo.

| Category               | Harnesses                                                           | Notes                                                   |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| **CLI / Terminal**     | Claude Code, OpenAI Codex CLI, Aider, OpenCode                      | Terminal-native, git-integrated, often open-source      |
| **IDE-embedded**       | Cursor, Windsurf (Codeium), GitHub Copilot, Cline, Roo Code         | Editor extensions or forks, visual diff, inline edits   |
| **Cloud / Autonomous** | Devin (Cognition), OpenAI Codex (cloud sandbox), Amazon Q Developer | Full dev environment, long-running, sandboxed execution |
| **Hybrid / Other**     | Manus, Augment Code, Tabnine                                        | Varying architectures worth checking for unique angles  |

When checking harnesses during research:

- Prioritize CLI and IDE categories — they're the most transparent and best-documented
- Check open-source harnesses (Aider, Cline, OpenCode) for implementation details — their source code is the ground truth
- For closed-source harnesses (Claude Code, Cursor, Codex), rely on official docs, engineering blogs, and practitioner reverse-engineering posts
- Not every harness will use every pattern — focus on the 2-3 harnesses where the pattern is most visible or interesting

### Demo Domain Preferences

- **Do NOT use observability/monitoring examples** for demos (no dashboards, metrics, tracing, alerting). Pick domains like e-commerce, travel, recipes, restaurants, CI/CD pipelines, etc.

### Concept Kickoff

When the user names a concept from the roadmap (e.g. "Context Window Management"), trigger the full process automatically: research (step 0) → plan → implement. No extra prompting needed.
