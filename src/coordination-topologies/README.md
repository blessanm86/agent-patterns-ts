# Star, Chain, Tree, or Graph — Picking the Right Multi-Agent Topology

[Agent Patterns — TypeScript](../../README.md)

> **Previous concept:** [Test-Time Compute Scaling](../test-time-compute/README.md) — scaling inference quality with adaptive compute. This concept builds on [Multi-Agent Routing](../multi-agent-routing/README.md) and [Sub-Agent Delegation](../sub-agent-delegation/README.md).

---

Here is a finding from Google DeepMind research that should give every multi-agent developer pause: adding agents to a system **without a formal coordination topology amplifies errors 17.2x** compared to a well-structured single agent. Not 17% worse. 17.2 times worse.

The problem isn't agent count. It's topology. An uncoordinated system where every agent can communicate with every other agent — what researchers call a "bag of agents" — creates N×(N-1)/2 error propagation paths. Each path is a new way for a mistake to compound. A 5-agent bag has 10 such paths. A 10-agent bag has 45.

Topology is the architecture of agent coordination. The same four specialists — requirements analyst, pricing analyst, marketing writer, technical reviewer — produce wildly different results depending on how they're connected. One topology makes them 80.9% better than a solo agent. Another makes them worse.

This post builds four topologies for the same task so you can see the structural differences directly.

## The "Bag of Agents" Anti-Pattern

Before the topologies, the anti-pattern worth naming explicitly.

A bag of agents has three characteristics:

1. **Flat structure** — no hierarchy, no hub, no gatekeeper
2. **No functional planes** — agents mix coordination, execution, and verification roles freely
3. **Open-loop execution** — errors propagate forward with no verification step to catch them

Research from UC Berkeley (MAST, arXiv 2503.13657, studying 150+ traces across five frameworks) found three failure categories that account for nearly all multi-agent breakdowns:

| Category                 | Share | Root cause                                                 |
| ------------------------ | ----- | ---------------------------------------------------------- |
| System design issues     | ~44%  | Step repetition, undefined termination, conflicting specs  |
| Inter-agent misalignment | ~32%  | Reasoning-action mismatch, task derailment, ignored inputs |
| Verification gaps        | ~24%  | Premature termination, no quality gate, incorrect checks   |

None of these are model problems. They're topology problems. A bag of agents has no mechanism to catch any of them. Formal topology creates the checkpoints that suppress each failure category.

## The Four Topologies

Every topology is a different answer to the same question: _when does agent B start, and what does it know?_

### 1. Chain

```
  requirements → pricing → marketing → technical
     (full context accumulates at each step)
```

Agents execute in a fixed order. Each agent receives the original task **plus all prior agents' outputs** as accumulated context. The last agent has seen everything.

**When it works:** Strict sequential dependencies where step N+1 genuinely needs the full output of step N. Document analysis pipelines. Legal review chains. Compliance workflows where each approval depends on the prior layer's sign-off.

**Error propagation:** Linear and cumulative. A flawed output at step N taints every subsequent step. The classic compound reliability formula applies: if each step is 95% reliable, a 20-step chain is only 36% reliable end-to-end (0.95^20 = 0.358). This is not a hypothetical — it's arithmetic.

**Implementation:**

```typescript
// Chain: accumulate context at each step
let accumulatedContext = "";

const req = await runSpecialist("requirements", task);
accumulatedContext += `[Requirements]\n${req.output}`;

const pricing = await runSpecialist("pricing", task, accumulatedContext);
accumulatedContext += `\n\n[Pricing]\n${pricing.output}`;

// Each specialist sees EVERYTHING that came before
const marketing = await runSpecialist("marketing", task, accumulatedContext);
```

**Tradeoff:** Deep context is a double-edged sword. Later specialists benefit from richer information, but they're also exposed to every mistake made earlier. The longer the chain, the more prompt bloat and error surface area you accumulate.

---

### 2. Star (Orchestrator-Workers)

```
  ┌── requirements analyst ─┐
  ├── pricing analyst ───────┤
  ├── marketing writer ──────┤→  synthesizer
  └── technical reviewer ───┘
          (all parallel, isolated context)
```

All specialists run in parallel with completely isolated context — they cannot see each other's work. A synthesizer makes one final call to combine the results.

**When it works:** Independent sub-tasks that can be parallelized. Financial analysis (different market aspects analyzed simultaneously). Research synthesis. Any task that decomposes cleanly into parallel workstreams that don't need each other's intermediate output.

**Error propagation:** Contained. One failing specialist does not corrupt others. The synthesizer acts as a validation bottleneck — it can detect inconsistencies across specialist reports and is the single point where cross-cutting errors surface. Google DeepMind's scaling study measured **4.4x error amplification** for centralized (star) architectures vs **17.2x for bag-of-agents**. Centralized coordination reduces logical contradictions by 36.4% and context-omission errors by 66.8%.

**Implementation:**

```typescript
// Star: parallel fan-out — NO shared context between specialists
const [req, pricing, marketing, technical] = await Promise.all([
  runSpecialist("requirements", task), // task only — no prior context
  runSpecialist("pricing", task),
  runSpecialist("marketing", task),
  runSpecialist("technical", task),
]);

// Synthesizer combines all results
const output = await llmCall(synthPrompt, formatReports([req, pricing, marketing, technical]));
```

**Tradeoff:** Speed advantage is significant (all specialists run concurrently), but specialists are blind to each other's work. The pricing analyst doesn't know what the requirements analyst found. If their outputs need to be consistent, the synthesizer must reconcile inconsistencies rather than preventing them. For tasks where sub-specialists genuinely need each other's outputs to do their work well, star topology degrades.

---

### 3. Tree

```
           Director
          /         \
   Strategy Lead   Execution Lead    ← parallel at level 2
   (Req + Pricing)  (Mkt + Tech)
```

A multi-level hierarchy. Domain leads coordinate leaf specialists and synthesize their outputs into domain reports. The Director synthesizes domain reports into the final plan.

**When it works:** Problems with a clear natural domain hierarchy where subdomain complexity genuinely warrants a coordination layer. Large-scale software architecture (system → module → function). Enterprise workflows with genuine domain ownership boundaries. Situations where domain leads add value by pre-synthesizing their domain's outputs before the director sees them.

**Error propagation:** Bidirectional risk. Bad decomposition at the top cascades down to all leaves. A leaf failure blocks its domain lead's synthesis. A domain lead failure orphans its entire subtree. MultiAgentBench (ACL 2025) found tree topology had the **highest token consumption and lowest coordination scores** — information must traverse multiple hops, and context reconstructed at each level inevitably loses fidelity.

**Implementation:**

```typescript
// Tree: domain leads coordinate leaf specialists in parallel
async function runDomain(domainName, specialists, task) {
  // Leaf specialists run with just the original task (domain isolation)
  const results = await Promise.all(specialists.map((s) => runSpecialist(s, task)));

  // Domain lead synthesizes into a focused domain report
  return llmCall(`You are the ${domainName} lead. Synthesize...`, formatReports(results));
}

// Two domain leads run in parallel at level 2
const [strategy, execution] = await Promise.all([
  runDomain("Strategy", ["requirements", "pricing"], task),
  runDomain("Execution", ["marketing", "technical"], task),
]);

// Director synthesizes domain reports at level 1
const output = await llmCall(directorPrompt, formatDomainReports([strategy, execution]));
```

**Tradeoff:** The extra coordination layer adds LLM calls and latency without proportional benefit unless the domain decomposition is genuinely meaningful. If your domain boundaries are artificial, tree topology creates bureaucracy without value. The CrewAI community has documented a recurring failure mode: in hierarchical mode, the manager LLM executes all tasks itself rather than delegating — because the coordination structure is LLM-behavior-dependent, not structurally enforced.

---

### 4. Graph (DAG)

```
  Nodes and dependencies:
    requirements → pricing     (pricing needs requirements)
    requirements → technical   (technical needs requirements)
    audience     → copy        (copy needs audience)
    pricing      → copy        (copy also needs pricing)
    copy         → brief       (brief needs copy)
    technical    → brief       (brief also needs technical)

  Execution waves (all nodes in a wave run in parallel):
    Wave 1:  requirements, audience   (no deps — start immediately)
    Wave 2:  pricing, technical       (both depend on: requirements)
    Wave 3:  copy                     (depends on: pricing + audience — both done)
    Wave 4:  brief                    (depends on: copy + technical — both done)
```

Agents form a directed acyclic graph. A node starts when **all its dependencies have completed** — enabling maximum safe parallelism without coupling unrelated work.

The execution algorithm is simple: find all nodes whose dependencies are satisfied, run them in parallel, store results, repeat until all nodes are done.

**When it works:** Tasks with complex, non-linear dependencies. Research synthesis where an audience analysis and a pricing analysis feed independently into a copywriting step, which then combines with a technical review for a final brief. Coding pipelines where linting and type-checking can run in parallel after parsing, but testing waits for both to complete.

**Error propagation:** Surgical containment. An upstream failure only affects nodes that directly or transitively depend on it. Independent branches continue unaffected. Context passing is **targeted** — each node receives only its dependencies' outputs, not the entire accumulated history. This prevents the prompt bloat of chain topology while preserving the richer context that isolated-star topology lacks.

**Implementation:**

```typescript
// Graph: run nodes in waves — each wave = all nodes with satisfied dependencies
const completed = new Map<string, SpecialistResult>();

while (completed.size < graph.length) {
  const ready = graph.filter(
    (node) => !completed.has(node.id) && node.dependencies.every((dep) => completed.has(dep)),
  );

  // Run all ready nodes in parallel
  const wave = await Promise.all(
    ready.map((node) => {
      const context = node.contextBuilder?.(completed) ?? ""; // TARGETED context
      return runSpecialist(node.specialistKey, task, context);
    }),
  );

  for (let i = 0; i < ready.length; i++) {
    completed.set(ready[i].id, wave[i]);
  }
}
```

**Tradeoff:** DAG topology requires upfront dependency modeling — you must know the dependency structure before running. For highly dynamic tasks where the correct dependencies aren't known until mid-execution, a graph topology based on static DAG may not fit. AgentConductor (arXiv 2602.17100) showed that **dynamic** topology selection (choosing density and structure per task difficulty) outperforms static DAGs by up to 14.6% on code generation benchmarks while reducing token usage by 68%.

---

## Error Propagation: The Math

The "17x error trap" originates from Google DeepMind's "Towards a Science of Scaling Agent Systems" (arXiv 2512.08296). The specific numbers:

| Architecture                | Error amplification | Coordination overhead |
| --------------------------- | ------------------- | --------------------- |
| Single agent                | 1.0x (baseline)     | —                     |
| Independent / bag-of-agents | **17.2x**           | 58%                   |
| Centralized (star)          | **4.4x**            | 285%                  |
| Decentralized (graph)       | 7.8x                | 263%                  |
| Hybrid                      | 5.1x                | 515%                  |

For chains, the math is simpler and more intuitive:

```
Per-step reliability: 95%
4 steps:  0.95^4  = 81%    → acceptable
10 steps: 0.95^10 = 60%    → concerning
20 steps: 0.95^20 = 36%    → alarming
```

A 36% end-to-end success rate from individually "reliable" steps is not a model problem — it's a topology problem. You're compounding failures rather than containing them.

The research also found a domain dependency: star topology wins for **structured, parallelizable tasks** (+80.9% over single agent on financial reasoning), while decentralized / graph patterns win for **exploratory tasks** (+9.2% on web navigation benchmarks). No single topology dominates across all task types.

---

## The Shared Primitive

The key architectural observation: all four topologies share the same agent runner. The topology determines _when_ it runs and _what context_ it receives, not how the agent itself works.

```typescript
// This function is unchanged across all four topologies.
// Only the caller changes.
async function runSpecialist(
  profileKey: string,
  task: string,
  context = "", // ← the topology controls what goes here
): Promise<SpecialistResult> {
  // standard ReAct loop — the same in every topology
}
```

This separation matters. Topology is an orchestration concern, not an agent concern. Your specialists don't need to know which topology they're in — they just receive a task (and optional context) and return a result. This means you can swap topologies without modifying your specialist implementations.

---

## Topology Selection Guide

| Task characteristic              | Recommended topology   | Why                                               |
| -------------------------------- | ---------------------- | ------------------------------------------------- |
| Strict sequential dependencies   | Chain                  | Each step genuinely needs all prior outputs       |
| Independent parallel subtasks    | Star                   | Maximum parallelism, 4.4x error containment       |
| Natural domain hierarchy         | Tree                   | When subdomain coordination adds real value       |
| Complex non-linear dependencies  | Graph                  | Targeted context, maximum safe parallelism        |
| Iterative quality refinement     | Loop + Critic          | Generator-critic closes the error loop            |
| High-stakes irreversible actions | Star + Human gate      | Central validation before execution               |
| Exploratory / open-ended tasks   | Graph or Decentralized | Peer-to-peer outperforms central for dynamic work |

Three signals that you should **not** add multi-agent at all:

1. **Single-agent baseline > 45%** — Google DeepMind found multi-agent adds value below this threshold but creates coordination overhead above it
2. **Tasks requiring 16+ tools** — coordination overhead dominates at high tool counts
3. **Inherently sequential reasoning** — tasks that require a single unified reasoning chain degrade 39–70% when split across agents

## In the Wild: Coding Agent Harnesses

Every major coding agent harness is a multi-agent topology in production. The harnesses disagree in interesting ways.

**Claude Code** uses a strict hub-and-spoke (star) topology for its subagent system. The main session is the hub; subagents are leaf nodes that cannot spawn further subagents — no nesting, no peer communication. Context flows one-way: the parent passes a task at spawn time; the subagent returns only a summary result. This prevents context pollution ("context cancer") that would occur if subagents shared the parent's growing history. The hub-and-spoke constraint also limits error propagation — a failing subagent doesn't take down the main session. Claude Code's experimental Agent Teams system breaks from this to allow peer communication via a shared task list and a Mailbox system, enabling lateral agent-to-agent messaging for longer-horizon collaborative work.

**Cursor** implemented all the topologies before settling on one. They tried flat peer-to-peer coordination (agents checking each other's work via a shared file), added locking, tried optimistic concurrency control — and found all of them made individual agents risk-averse and conservative, avoiding hard tasks to minimize coordination conflicts. Their breakthrough was removing peer coordination entirely and pushing all complexity upward to a **Planner→Worker→Judge** hierarchy. Planners generate tasks; Workers execute autonomously with no cross-worker visibility; a Judge evaluates and loops. This is a tree topology that learned from failure: cross-worker coordination was the bug, not the feature.

**Aider** uses the simplest multi-agent pattern: a fixed two-step chain. The **Architect** model (optimized for reasoning — o1-preview, o3) describes the solution in natural language. The **Editor** model (optimized for code formatting — GPT-4o, Claude 3.5 Sonnet) converts that description into formatted diffs. No feedback loop, no parallel execution, no orchestrator. The chain is fixed: Architect → Editor. Benchmark results validated it: o1-preview + o1-mini reached 85% pass rate, substantially above single-model configurations.

**Roo Code** built explicit hub-and-spoke orchestration with a key structural constraint: the **Orchestrator mode** is intentionally given limited tools (no file reads, no command execution) to prevent context poisoning. It only spawns subtasks via `new_task`, passing all needed context explicitly at spawn time. Subtasks run in complete isolation — results flow upward as summaries only via `attempt_completion`. This is the star topology with a deliberate design choice: cripple the hub's own execution capabilities to keep it focused on coordination.

**Cognition (Devin)** took the most skeptical stance: their engineering post "Don't Build Multi-Agents" documents the specific failure modes they observed — subtasks miscommunicating requirements, two parallel agents building visually incompatible components because neither could see the other's work. Their current architecture uses **read-only subagents only** (for planning and information gathering) with a single write-capable main agent. The multi-agent caution is calibrated, not absolute: their Devin 2.0 fleet feature allows spawning parallel Devin instances for independent tasks, with each getting its own cloud IDE.

The convergence point across all harnesses: **read-only subagents for information gathering are safe and useful**; write-capable subagents working in parallel on shared state are where failures compound. Claude Code, Devin, and Roo Code all independently arrived at the same constraint.

---

## Running the Demo

```bash
# Run all four topologies and compare
pnpm dev:coordination-topologies

# Run a single topology
pnpm dev:coordination-topologies:chain
pnpm dev:coordination-topologies:star
pnpm dev:coordination-topologies:tree
pnpm dev:coordination-topologies:graph
```

The demo runs a product launch task ("Nomad Track Wallet") through all four topologies and prints a comparison table showing duration, LLM call count, agent count, and context flow model. The star topology finishes fastest (parallel fan-out); the chain finishes slowest (sequential); graph shows the wave-by-wave dependency-driven execution structure.

---

## Key Takeaways

- **Topology determines error amplification** — 17.2x for bag-of-agents, 4.4x for star, best-in-class for moderately sparse graph
- **The four topologies answer the same question differently**: when does agent B start, and what does it know?
- **Chain** compounds context and errors linearly — 0.95^20 = 36% at 20 steps
- **Star** isolates specialists but requires a synthesizer; wins when sub-tasks are genuinely independent
- **Tree** adds coordination layers worth it only when natural domain hierarchies exist
- **Graph (DAG)** enables targeted context passing and dependency-driven parallelism — best for non-linear tasks
- **All four topologies share one primitive** — `runSpecialist()` — topology is an orchestration concern, not an agent concern
- **Don't add multi-agent before you need it** — single-agent baseline > 45% means coordination overhead dominates

---

## Sources & Further Reading

- [Towards a Science of Scaling Agent Systems](https://arxiv.org/abs/2512.08296) — Google DeepMind + MIT, 2025 — source of the 17.2x / 4.4x numbers; 87% accuracy predicting optimal topology from task features
- [MultiAgentBench / MARBLE](https://arxiv.org/abs/2503.01935) — ACL 2025 — benchmark comparing star, chain, tree, graph across 6 task types; graph best for research, tree worst overall
- [Why Do Multi-Agent LLM Systems Fail? (MAST)](https://arxiv.org/abs/2503.13657) — UC Berkeley, 2025 — 14 failure modes in 3 categories across 150+ traces; 41–87% production failure rates
- [Multi-Agent Teams Hold Experts Back](https://arxiv.org/abs/2602.01011) — 2026 — flat teams degrade expert performance by 37.6% via integrative compromise
- [Understanding Information Propagation in Multi-Agent Topologies](https://aclanthology.org/2025.emnlp-main.623/) — EMNLP 2025 — moderately sparse graphs suppress errors while preserving beneficial information diffusion
- [AgentConductor: Topology Evolution for Code Generation](https://arxiv.org/abs/2602.17100) — 2026 — dynamic topology beats static DAG by 14.6%; 68% token reduction
- [Why Your Multi-Agent System is Failing: The 17x Error Trap](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/) — Towards Data Science, 2026 — practitioner breakdown of bag-of-agents failure modes
- [Google ADK Multi-Agent Patterns](https://google.github.io/adk-docs/agents/multi-agents/) — Google's 8 named patterns with SequentialAgent / ParallelAgent / LoopAgent primitives
- [Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) — Cognition (Devin), 2025 — specific failure modes that motivated single-agent architecture with read-only subagents
- [Scaling Agents](https://cursor.com/blog/scaling-agents) — Cursor, 2025 — documents the failed flat coordination experiments and the Planner→Worker→Judge architecture that replaced them
- [Anthropic: Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) — December 2024 — Orchestrator-Workers, Prompt Chaining, Parallelization, Evaluator-Optimizer patterns
