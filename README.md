# Agent Patterns — TypeScript

Minimal TypeScript implementations of common agentic patterns, using a local model via Ollama. No frameworks. Just the patterns.

🗺️ **[See the learning roadmap](./LEARNING_ROADMAP.md)** — 23 concepts from foundations to production.

---

## Patterns

### Core Agent Loops

The two foundational architectures everything else builds on.

| Pattern                                    | Demo                        | Entry point             |
| ------------------------------------------ | --------------------------- | ----------------------- |
| [ReAct (Reason+Act)](src/react/README.md)  | Hotel reservation assistant | `pnpm dev:react`        |
| [Plan+Execute](src/plan-execute/README.md) | Trip planner                | `pnpm dev:plan-execute` |

### Tier 1 — Foundations

Building blocks that extend the core loops.

| Pattern                                                             | Demo                                                                                | Entry point                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------- |
| [Multi-Turn Conversation Memory](src/conversation-memory/README.md) | Recipe assistant (with and without memory)                                          | `pnpm dev:memory`            |
| [Structured Output (JSON Mode)](src/structured-output/README.md)    | Booking intent extractor: prompt-only vs json-mode vs schema (constrained decoding) | `pnpm dev:structured-output` |
| [Reasoning Tool](src/reasoning-tool/README.md)                      | Refund decision agent                                                               | `pnpm dev:reasoning-tool`    |
| [Guardrails & Circuit Breakers](src/guardrails/README.md)           | Hotel agent with max-iterations, token budget, tool timeout, and input validation   | `pnpm dev:guardrails`        |

### Tier 2 — Testing & Reliability

Immediately practical — learn these before the architectural leap.

| Pattern                                                  | Demo                                                                                                                          | Entry point                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [Evaluation Patterns](src/evaluation-patterns/README.md) | 8 eval patterns: trajectory, dataset-driven, LLM judge, error injection, multi-turn, adversarial, semantic similarity, pass^k | `pnpm dev:evaluation-patterns` |
| [LLM Error Recovery](src/error-recovery/README.md)       | Hotel agent with crash / blind / corrective retry strategies                                                                  | `pnpm dev:error-recovery`      |

### Tier 3 — Architecture

The leap from loop-based agents to graph-based, multi-agent systems.

| Pattern                                                            | Demo                                                                                               | Entry point                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------- |
| [State Graph (Node-Based Architecture)](src/state-graph/README.md) | Hotel agent refactored from while loop to 3-node state graph with generic runtime                  | `pnpm dev:state-graph`          |
| [Context Window Management](src/context-management/README.md)      | Research assistant with 4 context strategies (sliding window, summary buffer, observation masking) | `pnpm dev:context-management`   |
| [Multi-Agent Routing](src/multi-agent-routing/README.md)           | Travel assistant with 3 specialist agents + LLM router vs single-agent baseline                    | `pnpm dev:multi-agent-routing`  |
| [Sub-Agent Delegation](src/sub-agent-delegation/README.md)         | Parent agent spawns parallel child agents for multi-domain trip planning                           | `pnpm dev:sub-agent-delegation` |

### Tier 4 — Production Infrastructure

Making agents real — streaming UIs, knowledge grounding, and cost optimization.

| Pattern                                                   | Demo                                                                                                              | Entry point               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------- |
| [Streaming Responses (SSE)](src/streaming/README.md)      | Hotel agent with HTTP server, browser UI, 4 typed SSE events, streaming vs blocked comparison                     | `pnpm dev:streaming`      |
| [RAG (Retrieval-Augmented Generation)](src/rag/README.md) | NexusDB docs assistant with BM25, semantic, and hybrid search — toggle RAG on/off to compare                      | `pnpm dev:rag`            |
| [Prompt Caching](src/prompt-caching/README.md)            | Benchmark measuring KV-cache prefix reuse with stable vs rotating system prompts + cloud provider cost comparison | `pnpm dev:prompt-caching` |

### Tier 5 — Product & Scale

Refinements and optimizations for production-grade agents.

| Pattern                                                                    | Demo                                                                                                               | Entry point                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| [Tool Description Engineering](src/tool-descriptions/README.md)            | Customer support agent (weak vs strong descriptions)                                                               | `pnpm dev:tool-descriptions`    |
| [Dual Return Pattern](src/dual-return/README.md)                           | Service monitor with content + artifact split — concise summaries for LLM, full data for UI                        | `pnpm dev:dual-return`          |
| [Query Builder Pattern](src/query-builder/README.md)                       | Metrics monitor comparing raw LLM query strings vs structured parameter builder — A/B error rate comparison        | `pnpm dev:query-builder`        |
| [Structured Entity Tags](src/entity-tags/README.md)                        | E-commerce agent with XML entity tags in LLM output — parsed and rendered as colored terminal badges               | `pnpm dev:entity-tags`          |
| [Prompt Injection Detection](src/prompt-injection/README.md)               | Hotel agent with 3-layer defense: heuristic patterns, LLM classifier, canary tokens — run protected vs unprotected | `pnpm dev:prompt-injection`     |
| [Self-Instrumentation (Observability)](src/self-instrumentation/README.md) | Hotel agent with OpenTelemetry tracing — span hierarchy, token counts, cost estimation, trace summaries            | `pnpm dev:self-instrumentation` |
| [Cost Tracking & Model Tier Selection](src/cost-tracking/README.md)        | Hotel agent with 3-tier model routing — fast classifier, per-call cost tracking, savings vs all-capable baseline   | `pnpm dev:cost-tracking`        |

### Tier 6 — Advanced Execution

Sophisticated execution strategies that push beyond simple tool calling.

| Pattern                                                         | Demo                                                                                                                  | Entry point                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [Declarative Plan Execution](src/declarative-plan/README.md)    | Metrics monitor with execute_plan meta-tool — `$ref` cross-step references, declarative vs individual mode comparison | `pnpm dev:declarative-plan` |
| [On-Demand Skill Injection](src/skill-injection/README.md)      | E-commerce support agent with get_skill meta-tool — on-demand procedure loading vs verbose tool descriptions          | `pnpm dev:skill-injection`  |
| [Self-Validation Tool (QA Gate)](src/self-validation/README.md) | Menu config generator with validate_menu QA gate — 3-layer Zod validation, validated vs one-shot mode comparison      | `pnpm dev:self-validation`  |

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
