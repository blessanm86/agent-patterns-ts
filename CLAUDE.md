# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (run directly with tsx, no build step needed)
pnpm dev:react          # Hotel reservation — ReAct pattern
pnpm dev:plan-execute   # Trip planner — Plan+Execute pattern

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

This repo contains two agents demonstrating two different agentic patterns:

1. **ReAct (Reason+Act)** — hotel reservation assistant (`src/react/`)
2. **Plan+Execute** — trip planner (`src/plan-execute/`)

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

| File | Role |
|------|------|
| `src/shared/types.ts` | `Message`, `ToolCall`, `ToolDefinition` — shared across all agents |
| `src/shared/eval-utils.ts` | `lastAssistantMessage` — shared eval helper |
| `src/react/README.md` | Concept explainer — ReAct pattern, evals, LLM-as-judge |
| `src/react/index.ts` | readline CLI loop, maintains `history: Message[]` across turns |
| `src/react/agent.ts` | ReAct loop, Ollama calls, tool orchestration, `SYSTEM_PROMPT` |
| `src/react/tools.ts` | Hotel tool definitions + implementations + mock data |
| `src/react/types.ts` | Hotel domain types (`Room`, `Reservation`); re-exports shared types |
| `src/react/eval-utils.ts` | `extractToolCallNames`, `extractToolCalls` — ReAct-specific eval helpers |
| `src/react/evals/` | Phase 1 (trajectory) + Phase 2 (LLM-as-judge) evals |
| `src/plan-execute/README.md` | Concept explainer — Plan+Execute pattern, plan-level evals |
| `src/plan-execute/agent.ts` | `createPlan()`, `runPlanExecuteAgent()`, prompts |
| `src/plan-execute/tools.ts` | Trip planner tool definitions + implementations + mock data |
| `src/plan-execute/index.ts` | readline CLI loop for the trip planner |
| `src/plan-execute/evals/` | Phase 3 evals for the Plan+Execute agent |

## Repo Philosophy

This repo is a series of self-contained demos, one per concept from `LEARNING_ROADMAP.md`. Each concept lives in its own folder under `src/`. Evals live inside the concept folder they test.

### Adding a new concept

Follow these steps when implementing a concept from the learning roadmap:

**0. Research the concept first**

Before writing any code or forming an implementation plan, do a research pass across multiple sources. The goal is to understand the concept deeply — including real-world tradeoffs, provider differences, and measured results — so the implementation and README reflect the best current thinking, not just one vendor's perspective.

**Always research across:**
- **LLM providers** — Anthropic, OpenAI, Google/Gemini, Mistral — each has engineering blog posts and API docs that often disagree in useful ways
- **Frameworks** — Vercel AI SDK, LangChain, LlamaIndex — practical guidance from teams that have implemented the pattern at scale
- **Academic papers** — the LEARNING_ROADMAP.md lists the key papers per concept; read the abstracts and results sections for benchmarks and formal definitions
- **General web** — practitioner blog posts, engineering write-ups, and community discussion often surface failure modes and gotchas that official docs omit

**Use parallel agent spawning for research.** Spawn multiple Task agents simultaneously — one per source or topic area — so research completes faster. For example:
```
Agent 1: Fetch and summarize Anthropic's engineering post on the concept
Agent 2: Fetch OpenAI + Vercel AI SDK docs on the concept
Agent 3: Web search for practitioner experience and measured results
```

Synthesize findings before starting implementation. Key things to extract:
- Concrete before/after examples (weak vs. strong implementations)
- Measured impact (accuracy numbers, benchmark results, latency data)
- Where providers/frameworks disagree — these disagreements are worth surfacing in the README
- Failure modes and anti-patterns practitioners have encountered in production

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
- Close with concrete key takeaways
- Link back to the root README with `[Agent Patterns — TypeScript](../../README.md)`
- Reference the previous concept post if this one builds on it

The tone should be that of a good technical blog post — not bare-bones documentation.

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
