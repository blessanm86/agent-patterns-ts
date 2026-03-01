# Plan+Execute Agents — Decide Everything Upfront

_Part of the [Agent Patterns — TypeScript](../../README.md) series. If you haven't read the [ReAct post](../react/README.md) yet, start there — it covers the tool system and eval foundations this post builds on._

---

ReAct works well when each step depends on the previous result — you can't confirm a room price until you've checked availability, and you shouldn't book a room until the guest confirms. The model needs to see each result before it can decide what to do next.

But not all tasks have that dependency structure. Consider trip planning: searching for flights, hotels, attractions, and restaurants are four **independent** tasks. You don't need flight results before you can look up restaurants. There's no chain of dependencies — just a set of parallel lookups that all feed into a final synthesis.

This is where the **Plan+Execute** pattern shines.

---

## The Core Idea

Instead of one loop where the model decides each tool call after seeing the previous result, Plan+Execute separates reasoning from execution into three distinct phases:

```mermaid
flowchart TD
    A([User request]) --> B[Planner LLM call\nformat: json]
    B --> C[Structured plan\nall tool calls decided]
    C --> D[Execute step 1]
    C --> E[Execute step 2]
    C --> F[Execute step 3]
    C --> G[Execute step 4]
    D & E & F & G --> H[Synthesizer LLM call]
    H --> I([Final itinerary])
```

Compare that to ReAct, where the model is in the loop for every step:

```mermaid
flowchart TD
    A([User request]) --> B[LLM call]
    B -->|tool call| C[Execute tool]
    C -->|result| B
    B -->|no tool calls| D([Reply to user])
```

In Plan+Execute, **the plan is a first-class object** — visible, inspectable, and testable — before any tools run. Phase 2 is pure mechanical execution. No reasoning, no adaptation. The LLM is only involved twice: once to plan, once to synthesize.

---

## The Implementation

`createPlan()` is a single LLM call with `format: 'json'`:

```ts
export async function createPlan(userMessage: string): Promise<Plan> {
  const response = await ollama.chat({
    model: MODEL,
    messages: [
      { role: "system", content: PLANNER_PROMPT },
      { role: "user", content: userMessage },
    ],
    format: "json",
  });
  return JSON.parse(response.message.content) as Plan;
}
```

The planner prompt lists the available tools as plain text (no JSON schema needed — the model just needs to know what tools exist and what they do) and asks for a structured JSON plan:

```
Available tools:
- search_flights: Search for available flights between two cities on a given date.
- search_hotels: Search for hotels in a city for given dates.
- find_attractions: Find top attractions in a city.
- find_restaurants: Find restaurant recommendations in a city.

Output a JSON object with this structure:
{ "goal": "...", "steps": [{ "tool": "...", "args": {...}, "description": "..." }] }
```

`runPlanExecuteAgent()` then orchestrates all three phases:

```ts
export async function runPlanExecuteAgent(
  userMessage: string,
  history: Message[],
): Promise<Message[]> {
  // Phase 1: Plan — one LLM call, returns structured plan
  const plan = await createPlan(userMessage);
  messages.push({ role: "assistant", content: planSummary });

  // Phase 2: Execute — run each tool mechanically, no LLM involved
  for (const step of plan.steps) {
    const result = executeTripTool(step.tool, step.args);
    messages.push({ role: "tool", content: result });
  }

  // Phase 3: Synthesize — one LLM call turns results into itinerary
  const synthResponse = await ollama.chat({ model: MODEL, system: SYNTHESIZER_PROMPT, messages });
  messages.push(synthResponse.message);

  return messages;
}
```

There's no loop. The plan is fixed once it's created. If a tool fails or returns something unexpected, the synthesizer has to work with it — the plan doesn't adapt.

---

## Why This Fits Trip Planning

The trip planner's four research tasks have no dependencies between them:

- Flight results don't affect what hotels are available
- Hotel results don't affect what attractions exist
- Attraction data doesn't change what restaurants to recommend

ReAct would work here too, but at a cost: four separate LLM reasoning calls interleaved with tool execution, a longer overall latency, and a reasoning trajectory that's harder to inspect. With Plan+Execute you get a single fast planning call, parallel-ish execution, and a structured plan you can look at and test before anything runs.

The tradeoff is adaptability. If a tool returns something surprising — say, no flights available on that date — ReAct could reason about it and ask a follow-up. Plan+Execute just passes the empty result to the synthesizer and hopes it handles it gracefully. Choose based on whether your tasks have dependencies and whether mid-stream adaptation matters.

---

## Evals: Testing the Plan Before Tools Run

The most interesting property of Plan+Execute for eval design: **you can test the plan before running any tools**.

`createPlan()` is exported separately precisely for this reason. You can call it in isolation and assert on the structure of the plan — did the model include all four tools? Did it pass the right city names? — without waiting for tool execution or a final synthesized response.

```ts
evalite("Plan covers required tools", {
  data: async () => [{ input: "Plan a 3-day trip to Paris from New York, departing 2026-07-10" }],
  task: async (input) => {
    const plan = await createPlan(input);
    return plan.steps.map((s) => s.tool); // ['search_flights', 'search_hotels', ...]
  },
  scorers: [
    createScorer({
      name: "All 4 tools included",
      scorer: ({ output }) =>
        ["search_flights", "search_hotels", "find_attractions", "find_restaurants"].every((t) =>
          output.includes(t),
        )
          ? 1
          : 0,
    }),
    createScorer({
      name: "Flights before hotels",
      scorer: ({ output }) => {
        const flightIdx = output.indexOf("search_flights");
        const hotelIdx = output.indexOf("search_hotels");
        return flightIdx !== -1 && hotelIdx !== -1 && flightIdx < hotelIdx ? 1 : 0;
      },
    }),
  ],
});
```

You can also verify argument fidelity at the plan level — that the model correctly extracted the destination, dates, and origin from the user's request and routed them to the right tools:

```ts
evalite("Plan argument fidelity", {
  data: async () => [{ input: "Plan a 3-day trip to Tokyo from London, departing 2026-08-01" }],
  task: async (input) => {
    const plan = await createPlan(input);
    return plan.steps;
  },
  scorers: [
    createScorer({
      name: "search_flights destination is Tokyo",
      scorer: ({ output }) => {
        const flightStep = output.find((s) => s.tool === "search_flights");
        const dest = flightStep?.args.destination ?? "";
        return dest.toLowerCase().includes("tokyo") ? 1 : 0;
      },
    }),
  ],
});
```

This kind of eval is **only possible with Plan+Execute**. In ReAct, there's no plan object to inspect — the model makes tool call decisions one at a time, interleaved with execution. You can test the trajectory after the fact, but you can't test "was the plan sensible?" before tools ran. Separating planning from execution gives you a new testing surface that simply doesn't exist in the loop-based approach.

The third eval uses an LLM judge to score the final synthesized itinerary — same pattern as in the ReAct post:

```ts
evalite("LLM judge — itinerary quality", {
  data: async () => [{ input: "Plan a 3-day trip to Paris from New York, departing 2026-07-10" }],
  task: async (input) => {
    const history = await runPlanExecuteAgent(input, []);
    return lastAssistantMessage(history);
  },
  scorers: [
    makeOllamaJudge(
      "Itinerary includes specific details",
      "Does the itinerary include specific flight options (with airline or price), hotel recommendations (with name), and at least 3 named attractions to visit?",
    ),
  ],
});
```

---

## In the Wild: Coding Agent Harnesses

The Plan+Execute pattern shows up across production coding agents, but no two harnesses implement it the same way. The interesting story is not just which harnesses plan upfront, but _how much_ they plan, how rigid the plan is, and what happens when reality diverges from the plan. This spectrum -- from pure ReAct to pure Plan+Execute -- reveals the fundamental tradeoff this pattern navigates.

**Windsurf takes the most literal approach to Plan+Execute.** Its [Cascade architecture](https://docs.windsurf.com/windsurf/cascade/cascade) runs a dedicated planning agent _concurrently_ with the execution agent. While the selected model takes short-term actions, a specialized planning agent continuously refines a long-term plan in the background, represented as a todo list that updates as new information emerges. This is neither the rigid Plan+Execute from our demo (where the plan is fixed) nor pure ReAct (where there's no plan at all). It's a hybrid: the plan exists as a first-class object you can inspect and modify, but it's a living document rather than a contract. When you watch Windsurf break a complex task into steps and show you the plan before executing -- that's Cascade's planning agent at work, producing something very close to the `Plan` object in our trip planner, except one that adapts mid-execution.

**GitHub Copilot embeds planning as the first three steps of a structured [8-step workflow](https://dev.to/seiwan-maikuma/a-deep-dive-into-github-copilot-agent-modes-prompt-structure-2i4g):** (1) deeply understand the problem, (2) investigate the codebase, (3) produce a detailed plan with a concrete TODO list. Only then does it move to steps 4-8: implement, debug, test, iterate, verify. The plan isn't enforced by architecture the way our `createPlan()` return value is -- it lives in the model's context as a self-imposed structure. But the intent is the same: separate the "what should I do?" reasoning from the "do it" execution. Copilot even has a dedicated [implementation-plan agent](https://github.com/github/awesome-copilot/blob/main/agents/implementation-plan.agent.md) that generates structured plans explicitly designed to be executed by other agents or humans -- pure planning with no execution, the clearest real-world example of `createPlan()` as a standalone function.

**Devin pushes Plan+Execute into an iterative loop.** When you assign Devin a task, it [proactively scans your codebase and produces a preliminary plan](https://cognition.ai/blog/devin-2) within seconds -- then lets you refine the plan before autonomous execution begins. But unlike our demo where the plan is fixed, Devin's plan is a starting point that evolves through an execute-debug-refine cycle: it implements a step, runs tests, analyzes failures, and revises the plan. This is Plan+Execute wrapped in a feedback loop -- you get the inspectability benefits of an upfront plan, but the system can recover when a tool returns something unexpected (the exact weakness of our rigid implementation).

**Amazon Q Developer takes the most unusual approach: it plans multiple solutions simultaneously.** Rather than generating one plan and executing it, Q's agent [generates multiple candidate implementations, then selects the most promising one](https://aws.amazon.com/blogs/devops/reinventing-the-amazon-q-developer-agent-for-software-development/) based on quality signals like test results. Think of it as running Plan+Execute in parallel across several competing plans. AWS built a custom framework called `textcode` that gives the agent a token-efficient text-based IDE to work in, making this multi-candidate approach feasible. The 5 specialized sub-agents (development, documentation, testing, review, and a 3-agent debugger) each handle their own phase of the pipeline -- the pattern at scale.

**By contrast, Claude Code and Aider are deliberately ReAct-only.** Claude Code's orchestrator is [famously minimal](https://code.claude.com/docs/en/how-claude-code-works) -- roughly 50 lines of "runtime is dumb, model is CEO" logic. There's no planning agent, no upfront plan object. The model decides each tool call after seeing the previous result, one at a time. Aider follows a similar philosophy with its send-parse-apply cycle (though its [Architect mode](https://aider.chat/2024/09/26/architect.html) introduces a planning-like split where one model designs and another implements). OpenAI's Codex CLI is also [a ReAct-style loop at its core](https://openai.com/index/unrolling-the-codex-agent-loop/) -- prompt assembly, inference, tool execution, repeat -- with no explicit planning phase. These harnesses bet that for interactive coding, the overhead of planning isn't worth the rigidity cost. When a developer is watching and can redirect mid-stream, step-by-step reasoning is more adaptive than a predetermined plan.

The pattern that emerges: **Plan+Execute dominates in autonomous or long-running agents** (Devin, Amazon Q, Copilot's coding agent) where the system runs unsupervised and needs a plan to stay on track. **ReAct dominates in interactive, human-in-the-loop tools** (Claude Code, Aider, Codex CLI) where adaptability matters more than predictability. The hybrid approaches (Windsurf, Copilot's agent mode) try to get both -- and the sophistication of their hybrids suggests that the pure version of either pattern, like our demo's rigid plan, is rarely the end state in production.

---

## Key Takeaways

**Separate planning from execution when tasks are independent.** If your tool calls don't depend on each other's results, Plan+Execute gives you a faster pipeline, a structured plan you can inspect, and a new testing surface that ReAct doesn't have.

**Export `createPlan()` separately.** Making the planning step a standalone function is what enables plan-level evals. If it's buried inside the agent runner, you lose the ability to test it in isolation.

**The plan is a contract.** Once created, it's fixed. This makes the execution phase simple and fast, but means the agent can't adapt if something goes wrong. Design your tools to return useful results even in edge cases — the synthesizer is your last line of defense.

**Match the pattern to the dependency structure of the task.** ReAct shines when each step depends on the previous result. Plan+Execute is better when tasks are independent. Getting this choice right is as important as getting the implementation right.

---

## Further Reading

**The academic origin of Plan+Execute**
[Plan-and-Solve Prompting: Improving Zero-Shot Chain-of-Thought Reasoning](https://arxiv.org/abs/2305.04091) — Wang et al., ACL 2023. The paper that formalised the decompose → delegate → synthesize structure. The trip planner in this repo is a direct implementation of this pattern.

**The ReAct paper (for comparison)**
[ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629) — Yao et al., 2022 (ICLR 2023). Understanding ReAct makes the tradeoffs of Plan+Execute clearer — the two papers are best read together.

**LLM-as-Judge methodology**
[Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685) — Zheng et al. (UC Berkeley), NeurIPS 2023. The canonical paper on using an LLM to evaluate another LLM's output — the technique used in the itinerary quality eval.

**The eval runner used in this repo**
[Evalite](https://github.com/mattpocock/evalite) — Matt Pocock. TypeScript-native eval framework built on vitest. The source behind `pnpm eval` and `pnpm eval:watch`.
