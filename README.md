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
| [Context Window Management](src/context-management/README.md) | Research assistant with 4 context strategies (sliding window, summary buffer, observation masking) | `pnpm dev:context-management` |
| [State Graph (Node-Based Architecture)](src/state-graph/README.md) | Hotel agent refactored from while loop to 3-node state graph with generic runtime | `pnpm dev:state-graph` |
| [Multi-Agent Routing](src/multi-agent-routing/README.md) | Travel assistant with 3 specialist agents + LLM router vs single-agent baseline | `pnpm dev:multi-agent-routing` |
| [Sub-Agent Delegation](src/sub-agent-delegation/README.md) | Parent agent spawns parallel child agents for multi-domain trip planning | `pnpm dev:sub-agent-delegation` |

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
