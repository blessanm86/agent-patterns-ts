# Agent Patterns — TypeScript

Minimal TypeScript implementations of common agentic patterns, using a local model via Ollama. No frameworks. Just the patterns.

🗺️ **[See the learning roadmap](./LEARNING_ROADMAP.md)** — 20 concepts from foundations to production.

---

## Patterns

| Pattern | Demo | Entry point |
| --- | --- | --- |
| [Multi-Turn Conversation Memory](src/conversation-memory/README.md) | Recipe assistant (with and without memory) | `pnpm dev:memory` |
| [ReAct (Reason+Act)](src/react/README.md) | Hotel reservation assistant | `pnpm dev:react` |
| [Plan+Execute](src/plan-execute/README.md) | Trip planner | `pnpm dev:plan-execute` |
| [Reasoning Tool](src/reasoning-tool/README.md) | Refund decision agent | `pnpm dev:reasoning-tool` |
| [Tool Description Engineering](src/tool-descriptions/README.md) | Customer support agent (weak vs strong descriptions) | `pnpm dev:tool-descriptions` |
| [Guardrails & Circuit Breakers](src/guardrails/README.md) | Hotel agent with max-iterations, token budget, tool timeout, and input validation | `pnpm dev:guardrails` |
| [LLM Error Recovery](src/error-recovery/README.md) | Hotel agent with crash / blind / corrective retry strategies | `pnpm dev:error-recovery` |
| [Structured Output (JSON Mode)](src/structured-output/README.md) | Booking intent extractor: prompt-only vs json-mode vs schema (constrained decoding) | `pnpm dev:structured-output` |
| [Evaluation Patterns](src/evaluation-patterns/README.md) | 8 eval patterns: trajectory, dataset-driven, LLM judge, error injection, multi-turn, adversarial, semantic similarity, pass^k | `pnpm dev:evaluation-patterns` |

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
