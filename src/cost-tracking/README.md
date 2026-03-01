# Not Every LLM Call Deserves GPT-4 — Smart Model Selection for Agents

_Part of the [Agent Patterns — TypeScript](../../README.md) series. Builds on [Self-Instrumentation (Observability)](../self-instrumentation/README.md)._

---

You're paying 10x too much for 60% of your LLM calls.

When a user says "Hello!", your agent doesn't need a 70B parameter model to respond. When they ask "Yes, please book it", you don't need multi-step reasoning. But if you route every query through the same capable model, that's exactly what you're paying for — the cognitive equivalent of sending a senior engineer to answer the phone.

Research backs this up. [RouteLLM](https://arxiv.org/abs/2406.18665) demonstrated >85% cost reduction without quality loss by routing queries to appropriate model tiers. [FrugalGPT](https://arxiv.org/abs/2305.05176) showed that an LLM cascade — trying the cheapest model first and escalating only when needed — can match GPT-4 performance at 2% of the cost for many tasks. The pattern is clear: **match the model to the task, not the hardest task you might encounter.**

This post implements a three-tier model selection system for the hotel reservation agent: a fast model classifies queries, the appropriate tier handles reasoning, and a cost tracker shows the savings in real time.

---

## The Core Idea: Model Tiers

Instead of one model for everything, we define three tiers:

| Tier     | Model          | Role                          | Reference Pricing (per 1M tokens) |
| -------- | -------------- | ----------------------------- | --------------------------------- |
| Fast     | `qwen2.5:1.5b` | Router, greetings, simple FAQ | $0.10 in / $0.40 out              |
| Standard | `qwen2.5:7b`   | Main reasoning + tool calls   | $1.10 in / $4.40 out              |
| Capable  | `qwen2.5:14b`  | Complex multi-step synthesis  | $2.80 in / $11.20 out             |

The pricing ratios mirror real cloud API tiers (Haiku / Sonnet / Opus at roughly 1x / 11x / 28x). Ollama runs locally for free, but the demo tracks what production costs _would be_ — the same approach [Self-Instrumentation](../self-instrumentation/README.md) uses with "GPT-4o pricing."

---

## How It Works

Every user message flows through three stages:

```
User message
    │
    ▼
┌─────────────────────┐
│  1. CLASSIFY (fast)  │  Fast model → { tier, reason }
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────┐
│  2. REASON (selected model)  │  ReAct loop with tools
└──────────┬──────────────────┘
           │
           ▼
┌────────────────────────┐
│  3. TRACK COSTS        │  Record tokens + model per call
└──────────┬─────────────┘
           │
           ▼
   Cost summary displayed
```

**Stage 1 — Classify.** The fast model (1.5B parameters) reads the user's message and recent context, then returns a JSON classification: `{ tier, reason }`. This is the cheapest LLM call in the pipeline — it decides how much to spend on the real work.

**Stage 2 — Reason.** The selected model runs the standard ReAct loop (reason → tool call → observe → repeat). Simple greetings skip the tool loop entirely.

**Stage 3 — Track.** Every `ollama.chat()` call records its token counts and model via the `CostTracker`. After the turn completes, the CLI displays a per-call breakdown with a savings comparison against the all-capable baseline.

---

## The Router: Classifying Queries

The router is the key decision point. It uses structured output (`format: "json"`) to return a tier classification:

```typescript
const CLASSIFY_PROMPT = `You are a query complexity classifier for a hotel reservation assistant.

Given the user's message and conversation context, classify the query into one of three tiers:

- "fast": Greetings, simple yes/no answers, acknowledgments, thank-you messages,
          simple FAQ questions that don't need tools
- "standard": Queries that need tool calls — checking availability, getting prices,
              making reservations
- "capable": Complex queries requiring reasoning over multiple tool results —
             comparing room types, multi-step calculations, weighing tradeoffs

Respond with JSON: { "tier": "fast" | "standard" | "capable", "reason": "..." }`;
```

The classification rules are intentionally conservative. When in doubt, the router picks "standard" — it's better to overspend slightly than to route a tool-requiring query to a model that can't handle it.

```typescript
export async function classifyQuery(
  message: string,
  history: Message[],
  fastModel: string,
): Promise<ClassifyResult> {
  const response = await ollama.chat({
    model: fastModel,
    messages: [
      { role: "system", content: CLASSIFY_PROMPT },
      { role: "user", content: userPrompt },
    ],
    format: "json",
  });

  const parsed = JSON.parse(response.message.content);
  return {
    tier: ["fast", "standard", "capable"].includes(parsed.tier) ? parsed.tier : "standard", // safe fallback
    reason: parsed.reason,
    inputTokens: response.prompt_eval_count ?? 0,
    outputTokens: response.eval_count ?? 0,
  };
}
```

The router also passes recent conversation context (last 4 messages) so it understands _where_ we are in the conversation. A bare "yes" after a price quote means "book it" (standard), not a simple acknowledgment (fast).

---

## Cost Tracking

The `CostTracker` class records every LLM call with its model, tier, token counts, and purpose:

```typescript
export class CostTracker {
  private records: CostRecord[] = [];

  record(model, tier, inputTokens, outputTokens, purpose): void {
    const cost = calculateCost(model, inputTokens, outputTokens);
    this.records.push({ model, tier, inputTokens, outputTokens, cost, purpose });
  }

  getSummary(capableModel: string): CostSummary {
    // Calculate total cost across all tiers
    const totalCost = this.records.reduce((sum, r) => sum + r.cost, 0);

    // Baseline: what if every call used the capable model?
    const baselineCost = calculateCost(capableModel, totalInputTokens, totalOutputTokens);

    return { totalCost, baselineCost, savingsPercent, records };
  }
}
```

After each turn, the CLI displays a breakdown:

```
  ── Cost Summary ──────────────────────────────────────────────────
  Router:     qwen2.5:1.5b     →  142 in + 28 out    = $0.0000
  Reasoning:  qwen2.5:7b       →  823 in + 156 out   = $0.0016
  Total:      965 in + 184 out tokens                 = $0.0016
  Baseline:   if all qwen2.5:14b                      = $0.0048
  Savings:    67% vs all-capable baseline
  ──────────────────────────────────────────────────────────────────
```

The savings are real. The router call is essentially free (tiny model, small prompt). The standard model handles most queries at ~40% of the capable model's cost. Only complex multi-step queries escalate to the capable tier.

---

## The Agent: Routing + ReAct

The agent wires routing and cost tracking into the standard ReAct loop:

```typescript
export async function runAgent(
  userMessage: string,
  history: Message[],
  models: ModelMap,
  costTracker: CostTracker,
): Promise<Message[]> {
  // Step 1: Classify with the fast model
  const classification = await classifyQuery(userMessage, history, models.fast);
  costTracker.record(models.fast, "fast", ...tokens, "Router");

  const selectedModel = models[classification.tier];

  // Step 2: For fast tier, skip the tool loop entirely
  if (classification.tier === "fast") {
    const response = await ollama.chat({ model: selectedModel, messages });
    costTracker.record(selectedModel, "fast", ...tokens, "Response");
    return messages;
  }

  // Step 3: Standard ReAct loop with the selected model
  while (true) {
    const response = await ollama.chat({
      model: selectedModel,
      messages,
      tools,
    });
    costTracker.record(selectedModel, tier, ...tokens, "Reasoning");

    if (!assistantMessage.tool_calls?.length) break;

    for (const toolCall of assistantMessage.tool_calls) {
      const result = executeTool(name, args);
      messages.push({ role: "tool", content: result });
    }
  }

  return messages;
}
```

The key insight: **fast-tier queries skip the tool loop entirely.** They don't even load tool definitions into the prompt, saving tokens on both the input (no tool schemas) and output (no tool-call reasoning) sides.

---

## Model Availability Fallback

Not everyone will have all three models pulled. The CLI checks availability at startup and falls back gracefully:

```typescript
async function resolveModels(): Promise<ModelMap> {
  const available = new Set<string>();
  const list = await ollama.list();
  for (const model of list.models) {
    available.add(model.name);
  }

  return {
    fast: available.has(FAST_MODEL) ? FAST_MODEL : DEFAULT_MODEL,
    standard: DEFAULT_MODEL,
    capable: available.has(CAPABLE_MODEL) ? CAPABLE_MODEL : DEFAULT_MODEL,
  };
}
```

If all three tiers fall back to the same model, you still see the routing decisions and cost tracking — you just won't see real savings because the pricing is identical.

---

## Where Providers Disagree

The research community has three competing approaches to model routing:

**1. LLM-based classification (this demo).** Use a small model to classify query complexity, then route to the appropriate tier. Simple, interpretable, works with any provider. The downside: the router itself can misclassify, and you pay for an extra LLM call per turn.

**2. Learned routers ([RouteLLM](https://arxiv.org/abs/2406.18665)).** Train a classifier on preference data (human rankings of model outputs) to predict which model will produce acceptable quality. Achieves >85% cost savings on benchmarks. The downside: requires training data specific to your domain, and the router model needs periodic retraining.

**3. LLM cascades ([FrugalGPT](https://arxiv.org/abs/2305.05176)).** Always try the cheapest model first. If a confidence check (self-consistency, calibrated probability) shows the answer is unreliable, escalate to the next tier. The downside: adds latency on escalation (you pay for the cheap attempt _plus_ the expensive one), and confidence calibration is hard.

**4. Rule-based routing.** No ML at all — route based on message length, keyword presence, or conversation state. Fast and deterministic, but brittle. Breaks when users phrase complex requests simply ("Book two rooms for different dates" looks short but requires multi-tool reasoning).

For most applications, LLM-based classification (approach 1) hits the best balance of simplicity, accuracy, and cost. The router call is cheap enough that even a 10% misclassification rate still saves money overall.

---

## When NOT to Use Model Routing

Model routing adds complexity. Skip it when:

- **Low volume.** If you're making <1,000 LLM calls/day, the cost savings don't justify the engineering overhead. Just use the standard model for everything.
- **Homogeneous tasks.** If every query requires the same level of reasoning (e.g., all queries need tool calls), routing adds latency without savings.
- **Compliance requirements.** Some regulated environments require all data to be processed by the same model for audit consistency.
- **Latency-critical paths.** The router adds one round-trip to every request. If you're already at the latency budget, don't add another LLM call.
- **When quality variance is unacceptable.** If even a 5% quality drop on misrouted queries is too much, stick with the capable model.

---

## In the Wild: Coding Agent Harnesses

The most striking thing about production coding agents is that none of them use a single model. Every major harness runs multiple LLMs simultaneously, each assigned to a different task at a different cost point. This is the model-routing pattern taken to its logical extreme -- not just "pick the right tier for a query," but "decompose every user turn into sub-tasks and run each on the cheapest model that can handle it."

**Cursor** is the most aggressive example, running [six or more LLMs concurrently](https://cursor.com/blog/instant-apply): a frontier model (GPT-4o or Claude Sonnet) for the main chat reasoning, a [purpose-trained fast-apply model](https://fireworks.ai/blog/cursor) that translates edit plans into file changes at ~1000 tokens/second using speculative edits, a separate model for autocomplete suggestions, one for codebase indexing, and another for context assembly. Their "Auto" mode adds dynamic routing on top -- [selecting cheaper or more capable models based on query complexity](https://cursor.com/docs/models), much like the router in this demo. The two-model edit architecture is particularly clever: the expensive thinking model decides _what_ to change, and a cheap specialized model executes the change. This splits a single expensive operation into one expensive + one cheap call, reducing per-edit cost without sacrificing quality.

**Aider** takes a more explicit approach with its [Architect/Editor mode](https://aider.chat/2024/09/26/architect.html). Users configure four distinct model roles: the main model for reasoning, an editor model for applying changes, a "weak" model for cheap operations like commit messages and chat summarization, and an optional architect model for high-level planning. The cost savings are dramatic -- pairing DeepSeek R1 as architect with Claude Sonnet as editor [achieved state-of-the-art benchmark results at 14x less cost](https://aider.chat/2025/01/24/r1-sonnet.html) than the previous best. This is the FrugalGPT cascade idea made practical: a strong reasoning model proposes, a cheaper editing model disposes.

**Claude Code** uses a simpler two-tier strategy. The main model (Sonnet or Opus) handles all reasoning and tool use, while [Haiku handles cheaper sub-tasks](https://code.claude.com/docs/en/model-config) like classifying bash commands for safety and validating tool inputs. The cost ratio between tiers is stark -- 1:12:60 for Haiku:Sonnet:Opus -- so even routing 30-40% of internal operations to Haiku [yields 60-80% savings](https://restato.github.io/blog/claude-code-model-selection/) compared to running everything on Opus. Practitioners have noted that over 70% of typical tasks -- test generation, formatting, boilerplate, simple refactors -- could be handled by the cheapest tier.

**Manus** pushes the pattern across provider boundaries. Rather than routing within a single vendor's model family, Manus [assigns different providers to different task types](https://gist.github.com/renschni/4fbc70b31bad8dd57f3370239dccd58f): Claude for complex reasoning, Gemini for multimodal understanding, and fine-tuned Qwen models for routine operations. This is cross-provider cost arbitrage -- exploiting the fact that different vendors price different capabilities differently. A multimodal task that would be expensive on one provider might be cheap on another that specializes in it.

**Amazon Q Developer** invests compute differently: rather than routing to cheaper models, it [generates multiple solution candidates and selects the best one](https://aws.amazon.com/blogs/devops/reinventing-the-amazon-q-developer-agent-for-software-development/). Its multi-agent debugger includes a memory agent, a critic agent, and intelligent backtracking that can roll back dead-end solution paths. This trades higher upfront compute cost for better final quality -- the opposite tradeoff from routing, but still a deliberate model-selection decision about where to spend tokens.

The pattern across all these harnesses is clear: **the unit of cost optimization is not the request, it's the sub-task.** A single user message might trigger a cheap classification call, a mid-tier tool execution, an expensive reasoning step, and a cheap apply step -- four models, four cost tiers, one turn. This is exactly what the cost tracker in this demo measures per-call rather than per-request.

---

## Key Takeaways

1. **60-70% of LLM queries are simple enough for cheaper models.** Greetings, acknowledgments, yes/no — these don't need your most capable model.

2. **A tiny router model pays for itself.** The classification call costs ~100 tokens on a 1.5B model. The savings from routing a single query down a tier covers hundreds of router calls.

3. **Track costs per-call, not per-request.** A single user turn may involve 1 router call + 3 reasoning calls + 2 tool calls. You need per-call granularity to find optimization opportunities.

4. **Always fall back to standard.** When the router is uncertain, default to the middle tier. It handles 80% of queries correctly and costs less than the capable model.

5. **The pattern works at every scale.** Locally with Ollama (track hypothetical costs), with a single cloud provider (Haiku/Sonnet/Opus), or across providers (GPT-4o-mini for routing, Claude for reasoning).

---

## Sources & Further Reading

- [FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance](https://arxiv.org/abs/2305.05176) — Chen, Zaharia, Zou (Stanford), 2023 — the "LLM cascade" concept
- [RouteLLM: Learning to Route LLMs with Preference Data](https://arxiv.org/abs/2406.18665) — Ong et al. (LMSYS / UC Berkeley), ICLR 2025 — >85% cost reduction without quality loss
- [RouteLLM GitHub](https://github.com/lm-sys/RouteLLM) — open-source implementation
- [OpenAI Practical Guide for Model Selection](https://cookbook.openai.com/examples/partners/model_selection_guide/model_selection_guide) — official model-tier decision guide
- [Anthropic Models Overview](https://docs.anthropic.com/en/docs/about-claude/models) — Haiku / Sonnet / Opus tiers with cost/capability tradeoffs
- [Martian Model Router](https://withmartian.com/) — commercial model routing service with automatic provider selection
