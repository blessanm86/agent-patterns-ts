# Agent Patterns — TypeScript

Minimal TypeScript implementations of common agentic patterns, using a local model via Ollama. No frameworks. Just the patterns.

📖 **[Read the blog post](./blog.md)** — deep dive into both patterns, evals, and LLM-as-judge scoring.
🗺️ **[See the learning roadmap](./LEARNING_ROADMAP.md)** — 20 concepts from foundations to production.

---

## Patterns

| Pattern | Demo | Entry point |
| --- | --- | --- |
| ReAct (Reason+Act) | Hotel reservation assistant | `pnpm dev:react` |
| Plan+Execute | Trip planner | `pnpm dev:plan-execute` |

---

## Setup

```bash
# 1. Install and start Ollama (https://ollama.com), then pull the model
ollama pull qwen2.5:7b

# 2. Install dependencies and configure environment
pnpm install
cp .env.example .env

# 3. Run
pnpm dev:react
pnpm dev:plan-execute
```
