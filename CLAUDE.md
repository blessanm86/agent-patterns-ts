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
```

**Prerequisites:** Ollama must be running locally (`ollama serve`) with the model pulled (`ollama pull qwen2.5:7b`). Copy `.env.example` to `.env` to configure the model and host.

## Architecture

This repo contains two agents demonstrating two different agentic patterns:

1. **ReAct (Reason+Act)** — hotel reservation assistant (`src/`)
2. **Plan+Execute** — trip planner (`src/plan-execute/`)

### The ReAct Loop (`src/agent.ts`)

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
| `src/index.ts` | readline CLI loop, maintains `history: Message[]` across turns |
| `src/agent.ts` | ReAct loop, Ollama calls, tool orchestration, `SYSTEM_PROMPT` |
| `src/tools.ts` | Hotel tool definitions + implementations + mock data |
| `src/types.ts` | `Message`, `ToolDefinition`, `Room`, `Reservation` interfaces |
| `src/eval-utils.ts` | `extractToolCallNames`, `extractToolCalls`, `lastAssistantMessage` |
| `src/plan-execute/agent.ts` | `createPlan()`, `runPlanExecuteAgent()`, prompts |
| `src/plan-execute/tools.ts` | Trip planner tool definitions + implementations + mock data |
| `src/plan-execute/index.ts` | readline CLI loop for the trip planner |

### Model Configuration

Set via `.env`. No code changes needed to swap models:
```
MODEL=qwen2.5:7b        # default
OLLAMA_HOST=http://localhost:11434
```

Models with good tool-call support: `qwen2.5:7b`, `qwen2.5:14b`, `llama3.1:8b`, `mistral:7b`.
