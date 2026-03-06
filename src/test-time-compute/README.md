# When in Doubt, Think Twice: Adaptive Compute for Uncertain Agent Queries

[Agent Patterns — TypeScript](../../README.md)

---

What if your agent could decide _how hard to think_ about each question?

Simple queries — "What's in a Caesar salad?" — deserve a single, fast pass. But complex queries — "Plan a 3-course gluten-free, dairy-free dinner under 900 calories" — benefit from multiple attempts and careful selection. The problem is that most agent architectures treat every query the same: one trajectory, one answer, hope for the best.

**Test-time compute scaling** flips this around. Instead of training a bigger model, you spend more _inference_ compute on harder problems. Run multiple agent trajectories in parallel, then select the best result. The key insight from recent research: _adaptive_ allocation — spending extra compute only when the agent is uncertain — achieves the accuracy gains at 2-3x fewer tokens than uniformly scaling every query.

## The Three Strategies

This demo implements a recipe research agent with three test-time compute strategies:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER QUERY                                     │
│              "Plan a gluten-free dinner under 900 cal"                  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
          ┌─────────────────────┼──────────────────────┐
          │                     │                      │
    ┌─────▼─────┐       ┌──────▼──────┐       ┌───────▼───────┐
    │  SINGLE   │       │   UNIFORM   │       │   ADAPTIVE    │
    │   PASS    │       │   SCALING   │       │   SCALING     │
    │           │       │             │       │               │
    │ 1 run     │       │ N=3 runs    │       │ 1 run         │
    │ return    │       │ always      │       │ ↓             │
    │           │       │ ↓           │       │ confidence?   │
    │           │       │ LLM judge   │       │ ↓        ↓    │
    │           │       │ picks best  │       │ high    low   │
    │           │       │             │       │ ↓        ↓    │
    │           │       │             │       │ return  N-1   │
    │           │       │             │       │         more  │
    │           │       │             │       │         runs  │
    │           │       │             │       │         ↓     │
    │           │       │             │       │        judge  │
    └─────┬─────┘       └──────┬──────┘       └───────┬───────┘
          │                    │                      │
     1x cost              ~3.5x cost          1.1x-3.5x cost
     fastest              most reliable       best cost/quality
```

### 1. Single Pass — One Trajectory

The baseline. Run the agent once, return whatever it produces. Cheapest option, but the agent might miss key details on complex queries.

```typescript
// The simplest strategy: run once, return the result
const trajectory = await runTrajectory(userMessage, history, 0, verbose);
return { finalMessages: trajectory.messages, trajectoryCount: 1 };
```

### 2. Uniform Scaling — Always Run N Trajectories

Run N=3 trajectories with varied temperatures for diversity, then use an LLM judge to select the best one. This is the "brute force" approach — reliable, but wastes compute on easy queries.

```typescript
// Generate N diverse trajectories
for (let i = 0; i < UNIFORM_N; i++) {
  const trajectory = await runTrajectory(userMessage, history, i, verbose);
  trajectories.push(trajectory);
}

// LLM judge picks the best
const judge = await judgeTrajectories(userMessage, trajectories);
return { finalMessages: trajectories[judge.selectedIndex].messages };
```

Temperature diversity is critical here. Each trajectory uses a different temperature (`0.3`, `0.65`, `0.8`) so the model explores different reasoning paths. Without diversity, you'd get three near-identical answers — paying 3x for no benefit.

### 3. Adaptive Scaling — Scale Up Only When Uncertain

The CATTS-inspired approach. Run once, then ask a cheap confidence-check question: "How complete and specific was this answer, 1-5?" If confidence is high (>= 4), return immediately. If low, spawn additional trajectories and judge.

```typescript
// Phase 1: Single trajectory
const firstTrajectory = await runTrajectory(userMessage, history, 0, verbose);

// Phase 2: Cheap confidence estimation (~1 LLM call)
const confidence = await estimateConfidence(firstTrajectory);

if (confidence.score >= CONFIDENCE_THRESHOLD) {
  // High confidence → return immediately, no extra compute
  return { finalMessages: firstTrajectory.messages, trajectoryCount: 1 };
}

// Low confidence → scale up
for (let i = 1; i < ADAPTIVE_N; i++) {
  trajectories.push(await runTrajectory(userMessage, history, i, verbose));
}
const judge = await judgeTrajectories(userMessage, trajectories);
```

This yields the cost profile of single-pass for easy queries and uniform scaling for hard ones. The CATTS paper showed this achieves +9.1% accuracy gains while using 2.3x fewer tokens than uniform scaling, because only ~20-30% of agent decisions actually need extra compute.

## The Verification Problem

Parallel scaling (best-of-N) only works when you can _verify_ which trajectory is best. This is the **verification gap** identified by the General AgentBench paper — the fundamental limit of parallel test-time scaling.

For some domains, verification is easy:

- **Math**: Check the final answer against a known solution
- **Code**: Run tests, lint, type-check
- **Structured output**: Validate against a schema

For general agent tasks (recipe planning, research, writing), verification is hard. This demo uses an **LLM-as-judge** — a separate LLM call that compares candidate responses against quality criteria:

```typescript
const response = await ollama.chat({
  messages: [
    {
      role: "user",
      content: `Pick the best recipe response. Criteria:
      1. Mentions specific recipe names (not generic suggestions)
      2. Includes calorie/nutrition information
      3. Addresses all dietary constraints
      4. Provides actionable details
      Reply with ONLY the candidate number.`,
    },
  ],
});
```

The LLM judge is imperfect — it can occasionally overrule correct high-consensus decisions. But it's cheap (one LLM call regardless of N) and effective enough for most cases. The multi-agent verification paper showed that using multiple cheap, focused verifiers outperforms a single expensive one.

## The Two Fundamental Limits

Research has identified two barriers that prevent naive scaling from working indefinitely:

### The Context Ceiling (Sequential Scaling Limit)

Adding more reflection steps fills the context window, eventually _degrading_ coherence. The agent starts contradicting itself, forgetting earlier tool results, or going in circles. More thinking can actually hurt accuracy — the "test-time compute paradox."

### The Verification Gap (Parallel Scaling Limit)

Generating N trajectories only helps if you can reliably identify which one is best. For general tasks without deterministic verifiers (tests, proofs), this becomes the bottleneck. The General AgentBench paper showed that domain-specific scaling results do not transfer to general agents — math benchmarks showing clean scaling curves don't predict what happens on open-ended tasks.

## Confidence Estimation Approaches

This demo uses a simple LLM self-assessment for confidence, but there are several approaches:

| Approach                        | How it works                                        | Pros                             | Cons                                       |
| ------------------------------- | --------------------------------------------------- | -------------------------------- | ------------------------------------------ |
| **Self-assessment** (this demo) | Ask the model to rate its own output 1-5            | Simple, one LLM call             | Model may overestimate confidence          |
| **Voting entropy**              | Run 3 cheap "summary" calls, measure agreement      | More robust than self-assessment | 3x the cost of self-assessment             |
| **Tool call heuristics**        | Fewer tool calls = less thorough = lower confidence | Zero extra LLM calls             | Crude; doesn't catch wrong tool usage      |
| **Output uncertainty markers**  | Detect hedging language ("might", "possibly")       | Pattern matching, fast           | Easy to game; misses confident-but-wrong   |
| **Verification score**          | Run output through a validator/test suite           | Ground truth                     | Only works for structured/testable outputs |

The CATTS paper used voting entropy and top-1/top-2 margins from a small set of baseline trajectories. The key finding: "Knowing when to reflect is more important than reflecting at every step."

## When to Use Each Strategy

| Scenario                           | Best Strategy                  | Why                                                          |
| ---------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| Simple factual questions           | Single pass                    | Waste to run multiple trajectories                           |
| Mixed difficulty workload          | Adaptive                       | Cheap on easy, thorough on hard                              |
| High-stakes outputs (production)   | Uniform                        | Consistency matters more than cost                           |
| Tasks with deterministic verifiers | Sequential retry               | Tests/linters give concrete feedback (what coding agents do) |
| Budget-constrained                 | Single pass + retry on failure | Cheapest path to acceptable quality                          |

## The Industry Convergence: Effort-Level APIs

The test-time compute pattern has become so important that all major AI labs now expose it through their APIs:

| Provider  | Parameter                                | Values                                   |
| --------- | ---------------------------------------- | ---------------------------------------- |
| OpenAI    | `reasoning.effort`                       | `none`, `low`, `medium`, `high`          |
| Anthropic | `thinking.type` + `output_config.effort` | `adaptive` + `low`/`medium`/`high`/`max` |
| Amazon    | Thinking budget level                    | `low`, `medium`, `high`                  |
| Google    | Thinking mode                            | Standard, Deep Think                     |

These reasoning models do test-time compute scaling _internally_ — the model decides how long to think via reinforcement-learned chain-of-thought. The pattern in this demo (external best-of-N with a judge) is complementary: it operates at the _agent trajectory_ level, while reasoning effort APIs operate at the _single LLM call_ level.

A key finding from Microsoft's Phi-4 research: even a small 14B model can surpass its teacher model (o3-mini) with enough Majority@N samples. Test-time compute scaling is not exclusive to frontier-scale models.

## In the Wild: Coding Agent Harnesses

Interestingly, **no major coding agent harness uses explicit best-of-N or majority voting**. Claude Code, Aider, Cursor, Devin, and OpenAI Codex all converge on a different pattern: **sequential retry-with-reflection**.

```
loop:
  1. Generate code (or edit)
  2. Run verifier (lint, typecheck, test)
  3. If pass → done
  4. If fail → feed error back to LLM as context
  5. LLM reflects on error and generates improved attempt
  6. Repeat (typically max 3-5 iterations)
```

Why? Because code has _deterministic verifiers_. Tests and linters provide concrete pass/fail signals with rich error messages. Sequential retry with this feedback is more token-efficient than blind parallel sampling. The error message from attempt #1 tells the model exactly what's wrong — making attempt #2 far more likely to succeed than a parallel trajectory that started from scratch.

**Cursor** uses a related technique — speculative edits — but for speed, not accuracy. A fine-tuned Llama-3-70b speculatively generates edits, validated by greedy decoding, achieving ~13x speedup. The "generate candidates and verify" principle is shared, but the goal is latency reduction.

**Devin** offers MultiDevin (up to 10 parallel workers), but this is task-level parallelism (different subtasks to different workers), not best-of-N on the same task.

The lesson: test-time compute scaling via parallel sampling shines when verification is expensive or impossible (open-ended generation, reasoning, planning). When you have cheap, reliable verifiers, sequential retry-with-reflection dominates.

## Running the Demo

```bash
# Adaptive scaling (default) — scales up only when uncertain
pnpm dev:test-time-compute

# Single pass — cheapest, one trajectory
pnpm dev:test-time-compute --single

# Uniform scaling — always runs 3 trajectories + judge
pnpm dev:test-time-compute --uniform
```

Try the same question across all three modes to see the cost/quality tradeoff:

- **Easy**: "What's in a Caesar salad?" — adaptive should stay at 1 trajectory
- **Medium**: "Find me a vegan dinner under 300 calories" — adaptive may or may not scale up
- **Hard**: "Plan a 3-course gluten-free, dairy-free dinner under 900 total calories" — adaptive should scale up

## Key Takeaways

1. **Adaptive beats uniform.** Confidence-aware scaling achieves comparable accuracy at 2-3x fewer tokens. Most queries don't need extra compute.

2. **Temperature diversity is essential.** Running N trajectories at the same temperature produces near-identical outputs. Vary temperature across trajectories so each explores a different reasoning path.

3. **Verification is the bottleneck.** Best-of-N only helps if you can tell which trajectory is best. The verification gap is the fundamental limit of parallel scaling — invest in better judges, not just more trajectories.

4. **Know the two ceilings.** Sequential scaling hits the context ceiling (more reflection degrades coherence). Parallel scaling hits the verification gap. Adaptive allocation navigates between them.

5. **Domain matters.** Code has deterministic verifiers (tests/linters) → sequential retry wins. Open-ended tasks have weak verifiers → parallel sampling with a judge fills the gap.

6. **Small models benefit too.** Microsoft's 14B Phi-4 surpasses o3-mini with enough Majority@N samples. Test-time compute scaling is not only for frontier models.

## Sources & Further Reading

- [Scaling LLM Test-Time Compute Optimally](https://arxiv.org/abs/2408.03314) — Snell et al. (UC Berkeley), 2024. Foundational paper: compute-optimal test-time scaling improves efficiency 4x+ over best-of-N
- [CATTS: Confidence-Aware Test-Time Scaling](https://arxiv.org/abs/2602.12276) — Lee et al., 2025. +9.1% accuracy with 2.3x fewer tokens via entropy-based selective scaling
- [ARTIS: Risk-Aware Test-Time Scaling](https://arxiv.org/abs/2602.01709) — Zeng et al., 2025. Simulated interactions before real execution with risk-aware rebalancing
- [General AgentBench](https://arxiv.org/abs/2602.18998) — Li et al., 2025. Identifies context ceiling and verification gap as fundamental scaling barriers
- [Scaling Test-Time Compute for LLM Agents](https://arxiv.org/abs/2506.12928) — Zhu et al., 2025. List-wise verification beats scoring/voting; rollout diversity correlates with success
- [Multi-Agent Verification](https://arxiv.org/abs/2502.20379) — Lifshitz et al., 2025. Multiple cheap verifiers outperform single expensive reward models
- [ST-BoN: Sampling-Efficient Scaling](https://arxiv.org/abs/2503.01422) — Wang et al., 2025. Early truncation achieves 70-80% cost savings vs full best-of-N
- [Self-Consistency Improves Chain of Thought Reasoning](https://arxiv.org/abs/2203.11171) — Wang et al., 2022. Majority voting over sampled reasoning paths
- [Phi-4-reasoning](https://www.microsoft.com/en-us/research/publication/phi-4-reasoning-technical-report/) — Microsoft, 2025. Small model surpasses teacher with Majority@N
- [OpenAI Reasoning Models Guide](https://platform.openai.com/docs/guides/reasoning) — reasoning.effort parameter documentation
- [Anthropic Adaptive Thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking) — Claude's adaptive thinking mode
- [DSPy Optimizers](https://dspy.ai/learn/optimization/optimizers/) — Framework with first-class Ensemble and optimization support
- [Test-Time Scaling Survey](https://testtimescaling.github.io/) — Comprehensive survey of the field
