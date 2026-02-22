# Agent Patterns — TypeScript

Two minimal agent implementations in TypeScript, using a local model via Ollama.

No frameworks. No LangChain. Just the patterns.

📖 **[Read the blog post](./blog.md)** — covers both patterns, eval design, and LLM-as-judge scoring.

---

## What's in this repo

| Agent | Pattern | Domain |
|---|---|---|
| `pnpm dev:react` | ReAct (Reason+Act) | Hotel reservation assistant |
| `pnpm dev:plan-execute` | Plan+Execute | Trip planner |

Each agent is a self-contained example of a different way to structure tool-calling with an LLM. Run them side by side to see the difference in practice.

---

## ReAct — Reason + Act

The model decides tool calls **one at a time**, after seeing each result. The loop runs until the model has enough information to respond.

```
User message
    │
    ▼
┌─────────────────────────────────────────┐
│             THE REACT LOOP              │
│                                         │
│  Model reasons about the conversation   │
│              │                          │
│     Does it need more info?             │
│         YES │           NO              │
│             ▼            │              │
│     Call a tool          │              │
│     Get result           │              │
│     Feed back in         │              │
│     Loop again           │              │
│                          ▼              │
└──────────────────── Reply to user ──────┘
```

The hotel agent uses ReAct because each step depends on the previous result — you can't confirm a price until you've checked availability, and you shouldn't create a reservation until the guest confirms.

---

## Plan+Execute

The model decides **all tool calls upfront** in a single planning step, without seeing any results. The plan is then executed mechanically, and a final LLM call synthesizes the results.

```
User request
    │
    ▼
┌─────────────────┐
│  Planner LLM    │  ← decides ALL tool calls here
│  returns JSON   │
└────────┬────────┘
         │ plan (fixed)
    ┌────┴─────────────────────┐
    ▼        ▼        ▼        ▼
  tool 1   tool 2   tool 3   tool 4   ← no LLM involved
    └────┬─────────────────────┘
         │ all results
         ▼
┌─────────────────┐
│ Synthesizer LLM │  ← produces final response
└─────────────────┘
```

The trip planner uses Plan+Execute because its four research tasks (flights, hotels, attractions, restaurants) are independent — you don't need flight results before you can look up restaurants.

---

## When to use which

| | ReAct | Plan+Execute |
|---|---|---|
| Tool call decisions | One at a time, after seeing each result | All upfront before any tools run |
| Adapts to unexpected results | Yes | No — plan is fixed |
| Plan is visible before execution | No | Yes |
| Best for | Dependent sequential steps | Independent parallel-ish steps |

---

## Setup

### 1. Install Ollama

```bash
brew install ollama
```

Or download from [ollama.com](https://ollama.com)

### 2. Pull the model

```bash
ollama pull qwen2.5:7b
```

> Swap to `qwen2.5:14b` anytime for better reasoning — just update `.env`

### 3. Start Ollama

```bash
ollama serve
```

### 4. Install dependencies

```bash
pnpm install
```

### 5. Configure environment

```bash
cp .env.example .env
# Edit .env if you want to change the model
```

### 6. Run

```bash
pnpm dev:react          # Hotel reservation — ReAct pattern
pnpm dev:plan-execute   # Trip planner — Plan+Execute pattern
```

---

## Project Structure

```
src/
├── index.ts          # CLI loop — handles user input and conversation history
├── agent.ts          # The ReAct loop
├── tools.ts          # Hotel reservation tools + mock data
├── types.ts          # Shared TypeScript types
├── eval-utils.ts     # Helpers for inspecting agent history in evals
└── plan-execute/
    ├── index.ts      # CLI entry — Plan+Execute trip planner
    ├── agent.ts      # createPlan() + runPlanExecuteAgent()
    └── tools.ts      # Trip planner tools + mock data

evals/
├── phase1-tool-calls.eval.ts   # Deterministic trajectory evals (ReAct)
├── phase2-llm-judge.eval.ts    # LLM-as-judge evals (ReAct)
└── phase3-plan-execute.eval.ts # Plan structure + itinerary quality evals
```

---

## Running evals

```bash
pnpm eval          # run all evals once
pnpm eval:watch    # watch mode with UI at localhost:3006
```

---

## Key concept: two parts to every tool

In both agents, every tool has two completely separate parts:

- **Definition** — JSON schema sent to the model describing what the tool does and what parameters it accepts. The model reads this to decide when and how to call it.
- **Implementation** — the actual code that runs. The model never sees this.

This separation matters for debugging: if an eval fails, you immediately know whether to look at the model side (definition, prompt) or the code side (implementation).

---

## Swapping the model

Just change `MODEL` in your `.env`:

```bash
MODEL=qwen2.5:14b   # smarter, still fast on M1
MODEL=llama3.1:8b   # alternative with good tool support
MODEL=mistral:7b    # fast, lighter weight
```

No code changes needed.
