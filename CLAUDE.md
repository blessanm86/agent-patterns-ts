# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (run directly with tsx, no build step needed)
pnpm dev

# Build to dist/
pnpm build

# Run compiled output
pnpm start
```

**Prerequisites:** Ollama must be running locally (`ollama serve`) with the model pulled (`ollama pull qwen2.5:7b`). Copy `.env.example` to `.env` to configure the model and host.

## Architecture

This is a minimal TypeScript implementation of a **ReAct (Reason + Act) agent** — no frameworks, just the loop. It's an educational demo of how LLM agents work at their core.

### The ReAct Loop (`src/agent.ts`)

`runAgent()` accepts a user message and the full conversation history, then runs a `while(true)` loop:

1. Send history + system prompt + available tools to the Ollama model
2. If the response contains **no tool calls** → break and return updated history
3. If the response contains **tool calls** → execute each via `executeTool()`, push the results back into the message history as `role: 'tool'` messages, and loop again

The conversation history (array of `Message` objects) is the entire state of the agent. It's maintained in `index.ts` and passed into `runAgent()` on each user turn.

### Tool System (`src/tools.ts`)

Every tool has two distinct parts — a pattern to preserve when adding new tools:

- **Definition** (in the `tools` export array): JSON schema describing name, description, and parameters. This is what gets sent to the model.
- **Implementation** (private functions): The actual code that runs. The model never sees this.

`executeTool()` is a simple switch dispatcher routing tool names to their implementations.

Current tools: `check_availability`, `get_room_price`, `create_reservation`. All use in-memory mock data — `MOCK_ROOMS` state is mutated in place when a reservation is created (resets on process restart).

### File Responsibilities

| File | Role |
|------|------|
| `src/index.ts` | readline CLI loop, maintains `history: Message[]` across turns |
| `src/agent.ts` | ReAct loop, Ollama calls, tool orchestration, `SYSTEM_PROMPT` |
| `src/tools.ts` | Tool definitions + implementations + mock data |
| `src/types.ts` | `Message`, `ToolDefinition`, `Room`, `Reservation` interfaces |

### Model Configuration

Set via `.env`. No code changes needed to swap models:
```
MODEL=qwen2.5:7b        # default
OLLAMA_HOST=http://localhost:11434
```

Models with good tool-call support: `qwen2.5:7b`, `qwen2.5:14b`, `llama3.1:8b`, `mistral:7b`.
