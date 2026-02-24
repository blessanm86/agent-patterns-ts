# Agent Patterns — TypeScript

Minimal TypeScript implementations of common agentic patterns, using a local model via Ollama. No frameworks. Just the patterns.

🗺️ **[See the learning roadmap](./LEARNING_ROADMAP.md)** — 20 concepts from foundations to production.

---

## Patterns

| Pattern | Demo | Entry point |
| --- | --- | --- |
| [ReAct (Reason+Act)](src/react/README.md) | Hotel reservation assistant | `pnpm dev:react` |
| [Plan+Execute](src/plan-execute/README.md) | Trip planner | `pnpm dev:plan-execute` |
| [Reasoning Tool](src/reasoning-tool/README.md) | Refund decision agent | `pnpm dev:reasoning-tool` |
| [Tool Description Engineering](src/tool-descriptions/README.md) | Customer support agent (weak vs strong descriptions) | `pnpm dev:tool-descriptions` |

---

## Setup

```bash
# 1. Install Ollama (https://ollama.com), pull the model, and start it
ollama pull qwen2.5:7b
ollama serve

# 2. Install dependencies and configure environment
pnpm install
cp .env.example .env

# 3. Run
pnpm dev:react
pnpm dev:plan-execute
```
