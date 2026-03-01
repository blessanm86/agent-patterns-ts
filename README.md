# Agent Patterns — TypeScript

TypeScript implementations of agentic patterns drawn from across the AI landscape — research papers, LLM maker docs, framework authors, and practitioners. Each concept is a self-contained demo with an explainer that compares approaches, surfaces where sources disagree, and links everything. Runs entirely on free local models via Ollama.

**[See the learning roadmap](./LEARNING_ROADMAP.md)** for session briefs, source papers, and detailed concept descriptions.

---

## Setup

```bash
# 1. Install Ollama (https://ollama.com), pull the model, and start it
ollama pull qwen2.5:7b
ollama serve

# 2. Install dependencies and configure environment
pnpm install
cp .env.example .env

# 3. Run any demo
pnpm dev:react
pnpm dev:plan-execute
```

---

## Scouting for New Patterns

The roadmap grows via automated scouting. From Claude Code, run:

```
/scout-patterns last 3 months
```

This spawns 6 parallel research agents covering S-tier labs, A/B-tier labs, frameworks, academic papers, practitioners, and tools/infrastructure. Findings are deduplicated against the existing roadmap and qualifying discoveries are added automatically. Research artifacts are saved to `.research/scout-YYYY-MM-DD.md`.

---

## Patterns

Start from the top and work down. The **Builds on** column shows prerequisite concepts — empty means standalone.

| Pattern                                                                | Demo                                                              | Run                                   | Builds on                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------- | -------------------------------------------- |
| [ReAct Loop](src/react/README.md)                                      | Hotel reservation assistant                                       | `pnpm dev:react`                      |                                              |
| [Plan+Execute](src/plan-execute/README.md)                             | Trip planner                                                      | `pnpm dev:plan-execute`               |                                              |
| [Multi-Turn Conversation Memory](src/conversation-memory/README.md)    | Recipe assistant with/without memory                              | `pnpm dev:memory`                     |                                              |
| [Structured Output (JSON Mode)](src/structured-output/README.md)       | Booking intent extractor: prompt-only vs json-mode vs schema      | `pnpm dev:structured-output`          |                                              |
| [Reasoning Tool Pattern](src/reasoning-tool/README.md)                 | Refund decision agent                                             | `pnpm dev:reasoning-tool`             | Structured Output                            |
| [Guardrails & Circuit Breakers](src/guardrails/README.md)              | Hotel agent with iteration, token, and timeout limits             | `pnpm dev:guardrails`                 |                                              |
| [Human-in-the-Loop](src/human-in-the-loop/README.md)                   | Sprint board agent with approval gates and audit trail            | `pnpm dev:human-in-the-loop`          | Guardrails                                   |
| [Evaluation Patterns](src/evaluation-patterns/README.md)               | 8 eval patterns: trajectory, LLM judge, adversarial, and more     | `pnpm dev:evaluation-patterns`        |                                              |
| [LLM Error Recovery](src/error-recovery/README.md)                     | Hotel agent with crash / blind / corrective retry                 | `pnpm dev:error-recovery`             |                                              |
| [State Graph](src/state-graph/README.md)                               | Hotel agent as 3-node state graph with generic runtime            | `pnpm dev:state-graph`                | ReAct Loop                                   |
| [Context Window Management](src/context-management/README.md)          | Research assistant with 4 context strategies                      | `pnpm dev:context-management`         | Multi-Turn Memory                            |
| [Persistent Cross-Session Memory](src/persistent-memory/README.md)     | Restaurant assistant with cross-session fact memory               | `pnpm dev:persistent-memory`          | Multi-Turn Memory, Context Window Management |
| [Multi-Agent Routing](src/multi-agent-routing/README.md)               | Travel assistant with 3 specialist agents + LLM router            | `pnpm dev:multi-agent-routing`        |                                              |
| [Sub-Agent Delegation](src/sub-agent-delegation/README.md)             | Parallel child agents for multi-domain trip planning              | `pnpm dev:sub-agent-delegation`       | Multi-Agent Routing                          |
| [Streaming Responses (SSE)](src/streaming/README.md)                   | Hotel agent with HTTP server, browser UI, typed SSE events        | `pnpm dev:streaming`                  |                                              |
| [RAG](src/rag/README.md)                                               | NexusDB docs with BM25, semantic, and hybrid search               | `pnpm dev:rag`                        |                                              |
| Agentic RAG                                                            |                                                                   |                                       | RAG                                          |
| Multi-Modal Agents                                                     |                                                                   |                                       |                                              |
| [Prompt Caching](src/prompt-caching/README.md)                         | KV-cache prefix reuse benchmark + cloud provider cost comparison  | `pnpm dev:prompt-caching`             |                                              |
| [Tool Description Engineering](src/tool-descriptions/README.md)        | Customer support: weak vs strong descriptions                     | `pnpm dev:tool-descriptions`          |                                              |
| [Dual Return Pattern](src/dual-return/README.md)                       | Service monitor with content + artifact split                     | `pnpm dev:dual-return`                |                                              |
| [Query Builder Pattern](src/query-builder/README.md)                   | Metrics monitor: raw query vs structured builder                  | `pnpm dev:query-builder`              |                                              |
| [Structured Entity Tags](src/entity-tags/README.md)                    | E-commerce agent with XML entity tags                             | `pnpm dev:entity-tags`                |                                              |
| [Prompt Injection Detection](src/prompt-injection/README.md)           | Hotel agent with 3-layer defense                                  | `pnpm dev:prompt-injection`           |                                              |
| [Self-Instrumentation](src/self-instrumentation/README.md)             | Hotel agent with OpenTelemetry tracing                            | `pnpm dev:self-instrumentation`       |                                              |
| [Cost Tracking & Model Selection](src/cost-tracking/README.md)         | Hotel agent with 3-tier model routing                             | `pnpm dev:cost-tracking`              |                                              |
| [Declarative Plan Execution](src/declarative-plan/README.md)           | Metrics monitor with execute_plan meta-tool and `$ref` references | `pnpm dev:declarative-plan`           | Plan+Execute                                 |
| [On-Demand Skill Injection](src/skill-injection/README.md)             | E-commerce support with get_skill meta-tool                       | `pnpm dev:skill-injection`            | Tool Description Engineering                 |
| [Self-Validation Tool](src/self-validation/README.md)                  | Menu config generator with validate QA gate                       | `pnpm dev:self-validation`            | LLM Error Recovery                           |
| [Post-Conversation Metadata](src/post-conversation-metadata/README.md) | CloudStack support with secondary LLM call                        | `pnpm dev:post-conversation-metadata` |                                              |
| [Agent-Authored TODO Lists](src/todo-lists/README.md)                  | CI/CD pipeline agent with persistent TODO scaffold                | `pnpm dev:todo-lists`                 |                                              |
| Ambient Context Store                                                  |                                                                   |                                       | Structured Entity Tags                       |
| Cross-Platform Response Rendering                                      |                                                                   |                                       | Structured Entity Tags                       |
| MCP (Model Context Protocol)                                           |                                                                   |                                       |                                              |
| Tool Bundle System                                                     |                                                                   |                                       |                                              |
| External Event-Triggered Agent                                         |                                                                   |                                       | Streaming                                    |
| Sandboxed Code Execution                                               |                                                                   |                                       |                                              |
| Long-Running Agents & Checkpointing                                    |                                                                   |                                       | State Graph                                  |
| Agent Middleware Pipeline                                              |                                                                   |                                       | ReAct Loop                                   |
| Observational Memory                                                   |                                                                   |                                       | Persistent Memory, Context Window Management |
| Dynamic Tool Selection                                                 |                                                                   |                                       | Tool Description Engineering                 |
| Event Sourcing for Agents                                              |                                                                   |                                       | State Graph                                  |
| Test-Time Compute Scaling                                              |                                                                   |                                       | Cost Tracking, Self-Validation               |
| Multi-Agent Coordination Topologies                                    |                                                                   |                                       | Multi-Agent Routing, Sub-Agent Delegation    |
| A2A Protocol (Agent-to-Agent)                                          |                                                                   |                                       | MCP                                          |
