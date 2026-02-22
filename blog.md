# Testing AI Agents: From Tool Trajectories to LLM Judges

*Using a hotel reservation agent as the running example. Full source: [blessanm86/agent-patterns-ts](https://github.com/blessanm86/agent-patterns-ts)*

---

Unit tests break when you add AI. A function that routes tool calls through an LLM can't be pinned to a deterministic output — the model might phrase things differently, call tools in a different order, or reason through a problem in an unexpected way. Yet agents still need to be tested.

This post walks through two phases of eval design for a hotel reservation agent built on the ReAct pattern. We'll go from simple deterministic checks (did the agent call the right tools?) up to LLM-as-judge scoring (was the final response actually good?). All evals run locally against Ollama — no API keys, no network calls.

The full source is in this repo. Let's start by understanding what we're testing.

---

## What Is a ReAct Agent?

ReAct stands for **Reason + Act**. The key insight is that you can give an LLM access to tools and put it in a loop: let it reason about what to do, act by calling a tool, observe the result, then reason again.

The loop looks like this:

```mermaid
flowchart TD
    A([User message]) --> B[Send history + tools to model]
    B --> C{Tool calls in response?}
    C -->|Yes| D[Execute each tool]
    D --> E[Append tool results to history]
    E --> B
    C -->|No| F([Return final reply to user])
```

There's no magic here. The entire "agent" is a `while(true)` loop in `src/agent.ts`:

```ts
while (true) {
  const response = await ollama.chat({ model, system, messages, tools })
  const assistantMessage = response.message
  messages.push(assistantMessage)

  if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
    break  // Model is done reasoning — return to user
  }

  for (const toolCall of assistantMessage.tool_calls) {
    const result = executeTool(toolCall.function.name, toolCall.function.arguments)
    messages.push({ role: 'tool', content: result })
  }
  // Loop — model now reasons about the tool results
}
```

The conversation history (an array of `Message` objects) is the entire state of the agent. Each iteration adds to it; the model sees the full history on every call.

---

## Building the Tools

Every tool has two completely separate parts, and keeping them separate is one of the most important patterns in agent development:

**The definition** is a JSON schema sent to the model. It describes *what the tool does* and *what parameters it accepts*. The model reads this and decides when and how to call the tool.

**The implementation** is the actual code that runs when the model calls the tool. The model never sees this.

```ts
// Definition — what the model sees
{
  type: 'function',
  function: {
    name: 'get_room_price',
    description: 'Get the total price for a specific room type and number of nights.',
    parameters: {
      type: 'object',
      properties: {
        room_type: { type: 'string', enum: ['single', 'double', 'suite'] },
        nights: { type: 'string', description: 'Number of nights' },
      },
      required: ['room_type', 'nights'],
    },
  },
}

// Implementation — what actually runs (model never sees this)
function getRoomPrice(args: { room_type: string; nights: string }): string {
  const price = ROOM_PRICES[args.room_type]
  const total = price * parseInt(args.nights, 10)
  return JSON.stringify({ room_type: args.room_type, pricePerNight: price, totalPrice: total })
}
```

Why does this separation matter for testing? Because when an eval fails, you immediately know whether to look at the model (definition quality, system prompt) or the implementation (the code itself). They're independent failure modes.

---

## The System Prompt

The system prompt is where you tell the agent *how to behave* — what order to follow steps in, what rules to enforce, how to handle edge cases. This is where most of agent reliability comes from.

```
You are a friendly hotel reservation assistant for The Grand TypeScript Hotel.

Your goal is to help guests make a room reservation. Follow these steps in order:
1. Greet the guest and ask for their name
2. Ask for their desired check-in and check-out dates
3. Use the check_availability tool to find available rooms
...
Important rules:
- Always use tools to check real availability and prices — never make up numbers
- If no rooms are available, suggest different dates
```

The ordered steps are what make Phase 1 evals meaningful. If the system prompt says "check availability before getting price", we can write a scorer that verifies `check_availability` comes before `get_room_price` in the tool call trajectory.

Changing the system prompt is a code change. It needs a test.

---

## What Are Evals?

Evals are to agents what tests are to functions — but they have to account for non-determinism, latency, and the fact that "correct" is often a spectrum rather than a binary.

The key difference from unit tests:

```mermaid
flowchart LR
    subgraph Unit Test
        UT_IN[Input] --> UT_FN[Pure function]
        UT_FN --> UT_ASSERT{assert === expected}
        UT_ASSERT -->|Pass| UT_PASS[✓]
        UT_ASSERT -->|Fail| UT_FAIL[✗]
    end

    subgraph Eval
        EV_IN[Input] --> EV_TASK[Agent / LLM]
        EV_TASK --> EV_OUTPUT[Output]
        EV_OUTPUT --> EV_SCORE[Scorer: 0.0–1.0]
        EV_SCORE --> EV_THRESHOLD{score ≥ threshold?}
        EV_THRESHOLD -->|Yes| EV_PASS[✓]
        EV_THRESHOLD -->|No| EV_FAIL[✗]
    end
```

Evals have a **task** (run the agent), **data** (test inputs), and **scorers** (functions that return a score from 0 to 1). This structure is what [evalite](https://evalite.dev) provides — a TypeScript-native eval runner built on top of vitest.

We're testing two things:
- **Phase 1**: Did the agent use the right tools in the right order? (deterministic)
- **Phase 2**: Was the final response actually good? (LLM-as-judge)

---

## Phase 1: Deterministic Evals

The most valuable property of a tool-calling agent is that it calls the correct tools with the correct arguments. This is fully checkable without an LLM judge.

We call these **trajectory evals** — we inspect the sequence of tool calls the agent made, not just the final output.

First, some helpers in `src/eval-utils.ts` to extract the trajectory from the history:

```ts
// Extract ordered list of tool names — for trajectory assertions
export function extractToolCallNames(history: Message[]): string[] {
  return history
    .filter((m) => m.role === 'assistant' && m.tool_calls?.length)
    .flatMap((m) => m.tool_calls!.map((tc) => tc.function.name))
}

// Extract full tool calls with arguments — for arg-level assertions
export function extractToolCalls(history: Message[]): ToolCall[] {
  return history
    .filter((m) => m.role === 'assistant' && m.tool_calls?.length)
    .flatMap((m) => m.tool_calls!)
}
```

Now the eval. Each test case gives the agent a self-contained prompt with everything it needs so the full ReAct loop can complete in one `runAgent()` call:

```ts
evalite('Tool call trajectory — happy path', {
  data: async () => [{
    input: 'My name is John Smith. Please book a double room from 2026-03-01 to 2026-03-05.',
  }],
  task: async (input) => {
    const history = await runAgent(input, [])
    return extractToolCallNames(history)  // returns string[]
  },
  scorers: [
    createScorer({
      name: 'All tools called',
      scorer: ({ output }) =>
        ['check_availability', 'get_room_price', 'create_reservation']
          .every(t => output.includes(t)) ? 1 : 0,
    }),
    createScorer({
      name: 'Correct order',
      scorer: ({ output }) => {
        const i1 = output.indexOf('check_availability')
        const i2 = output.indexOf('get_room_price')
        const i3 = output.indexOf('create_reservation')
        return i1 !== -1 && i2 !== -1 && i3 !== -1 && i1 < i2 && i2 < i3 ? 1 : 0
      },
    }),
  ],
})
```

A few things to notice:

1. **The task returns a typed value** (`string[]`), not the raw history. This makes scorers simple — they just work with the extracted data.

2. **Each scorer is independent**. "All tools called" can pass while "Correct order" fails, giving you precise signal about what broke.

3. **Scores are 0 or 1** here because these are binary checks. Evalite supports fractional scores (0.0–1.0) for more nuanced judgements.

We also test **argument fidelity** — that the agent passes the right values through the tool chain:

```ts
evalite('Argument fidelity — guest name and dates', {
  data: async () => [{
    input: 'My name is Alice Johnson. I need a suite from 2026-05-10 to 2026-05-15.',
  }],
  task: async (input) => {
    const history = await runAgent(input, [])
    return extractToolCalls(history)  // returns ToolCall[] with full arguments
  },
  scorers: [
    createScorer({
      name: 'Guest name preserved',
      scorer: ({ output }) => {
        const call = output.find(tc => tc.function.name === 'create_reservation')
        if (!call) return 0
        const name = call.function.arguments.guest_name ?? ''
        return name.toLowerCase().includes('alice') ? 1 : 0
      },
    }),
  ],
})
```

Guest names getting dropped or mangled is a real failure mode. A full booking trajectory (all tools, right order) with the wrong guest name is still broken.

---

## Phase 2: LLM-as-Judge

Trajectory evals tell you *what the agent did*. They don't tell you whether the agent's response was good. For that, we need a judge.

The idea is simple: use another LLM call to evaluate the output. You write a **criteria prompt** that describes what a good response looks like, and the judge returns a score.

```mermaid
flowchart LR
    A([User input]) --> B[Agent]
    B --> C[Final response]
    C --> D[Judge LLM]
    E([Criteria prompt]) --> D
    D --> F[Score 0.0–1.0]
    F --> G[Evalite result]
```

Since `autoevals`'s built-in `Factuality` scorer requires an OpenAI API key, we write our own judge using the same local Ollama model:

```ts
function makeOllamaJudge(name: string, criteria: string) {
  return createScorer<string, string>({
    name,
    scorer: async ({ output }) => {
      const result = await ollama.chat({
        model: MODEL,
        messages: [{
          role: 'user',
          content: `You are evaluating a hotel reservation assistant.

Assistant's response:
"""
${output}
"""

Criteria: ${criteria}

Score 0.0-1.0. Respond with JSON only:
{ "score": <number>, "reason": "<explanation>" }`,
        }],
        format: 'json',
      })
      const { score } = JSON.parse(result.message.content)
      return Math.max(0, Math.min(1, score))
    },
  })
}
```

Three things make this work well:

1. **Explicit scale** — "1.0 = fully meets, 0.5 = partially, 0.0 = does not" gives the judge clear anchors.

2. **`format: 'json'`** — forcing JSON output makes parsing reliable. Without this, the model might wrap the JSON in markdown code blocks.

3. **Clamping** — `Math.max(0, Math.min(1, score))` guards against models that return values slightly outside the expected range.

Now the eval becomes:

```ts
evalite('LLM judge — reservation confirmation quality', {
  data: async () => [{
    input: 'My name is Bob Chen. Please book a single room from 2026-06-01 to 2026-06-03.',
  }],
  task: async (input) => {
    const history = await runAgent(input, [])
    return lastAssistantMessage(history)  // just the text the user sees
  },
  scorers: [
    makeOllamaJudge(
      'Reservation confirmed with ID',
      'Did the assistant confirm the reservation was created and include a reservation ID starting with RES-?',
    ),
    makeOllamaJudge(
      'Guest name acknowledged',
      'Did the assistant mention the guest by name (Bob Chen)?',
    ),
  ],
})
```

**When to use LLM-as-judge vs deterministic scorers:**

| Check | Use |
|---|---|
| Did tool X get called? | Deterministic scorer |
| Was argument Y correct? | Deterministic scorer |
| Was the response helpful? | LLM judge |
| Did it handle the edge case gracefully? | LLM judge |
| Did it include the right information? | LLM judge |

Deterministic scorers are always faster and cheaper. Use LLM judges only where you genuinely can't express the criteria as code.

---

## Running Evalite

```bash
# Run evals once
pnpm eval

# Watch mode — re-runs when eval files change
pnpm eval:watch
```

Watch mode starts a local UI at `http://localhost:3006`. You get a table showing every eval, every test case, and the score from each scorer. It re-runs automatically as you edit eval files or src files.

Expected results on the first run:
- **Phase 1** — All scorers should return 1.0. If any return 0, check the tool definitions and system prompt.
- **Phase 2** — Scores should be ≥ 0.7 for the happy path. The judge is an LLM, so there's natural variance — run a few times to see the distribution.

---

## Plan + Execute: A Different Approach

ReAct works well when each step depends on the previous result — you can't confirm a room price until you've checked availability. But not all tasks have this dependency structure.

Consider trip planning: searching for flights, hotels, attractions, and restaurants are four **independent** tasks. You don't need flight results before you can look up restaurants. You can decide all four tool calls upfront, run them in any order, and then synthesize the results.

This is the **Plan+Execute** pattern:

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

Compare with ReAct, where the model decides each tool call only after seeing the previous result:

```mermaid
flowchart TD
    A([User request]) --> B[LLM call]
    B -->|tool call| C[Execute tool]
    C -->|result| B
    B -->|no tool calls| D([Reply to user])
```

In Plan+Execute, the phases are completely separated. The plan is a first-class object — visible, inspectable, and testable — before any tools run.

### The Implementation

`createPlan()` is a single LLM call with `format: 'json'`:

```ts
export async function createPlan(userMessage: string): Promise<Plan> {
  const response = await ollama.chat({
    model: MODEL,
    messages: [
      { role: 'system', content: PLANNER_PROMPT },
      { role: 'user', content: userMessage },
    ],
    format: 'json',
  })
  return JSON.parse(response.message.content) as Plan
}
```

The planner prompt lists available tools and asks for a JSON plan:

```
Available tools:
- search_flights: Search for available flights between two cities on a given date.
- search_hotels: Search for hotels in a city for given dates.
- find_attractions: Find top attractions in a city.
- find_restaurants: Find restaurant recommendations in a city.

Output a JSON object with this structure:
{ "goal": "...", "steps": [{ "tool": "...", "args": {...}, "description": "..." }] }
```

`runPlanExecuteAgent()` orchestrates the three phases:

```ts
export async function runPlanExecuteAgent(userMessage: string, history: Message[]): Promise<Message[]> {
  // Phase 1: Plan — one LLM call, returns structured plan
  const plan = await createPlan(userMessage)
  messages.push({ role: 'assistant', content: planSummary })

  // Phase 2: Execute — run each tool mechanically, no LLM involved
  for (const step of plan.steps) {
    const result = executeTripTool(step.tool, step.args)
    messages.push({ role: 'tool', content: result })
  }

  // Phase 3: Synthesize — one LLM call turns results into itinerary
  const synthResponse = await ollama.chat({ model: MODEL, system: SYNTHESIZER_PROMPT, messages })
  messages.push(synthResponse.message)

  return messages
}
```

There's no loop. The plan is fixed. Phase 2 is pure mechanical execution — no reasoning, no adaptation.

### Why the Trip Planner Fits Plan+Execute

The trip planner's four research tasks have **no dependencies between them**:

- Flight results don't affect what hotels are available
- Hotel results don't affect what attractions exist
- Attraction data doesn't change what restaurants to recommend

ReAct would work here too, but it would be slower (four separate LLM calls interleaved with tool calls) and the reasoning trajectory would be harder to test. With Plan+Execute, you get a single fast planning call, then deterministic execution.

When the tasks *do* have dependencies (can't confirm price until you've checked availability), ReAct is the right pattern.

### Phase 3 Evals: Testing the Plan

The most interesting property of Plan+Execute for eval design: **you can test the plan before running any tools**.

`createPlan()` returns a `Plan` object. You can assert on its structure directly:

```ts
evalite('Plan covers required tools', {
  data: async () => [{ input: 'Plan a 3-day trip to Paris from New York, departing 2026-07-10' }],
  task: async (input) => {
    const plan = await createPlan(input)
    return plan.steps.map((s) => s.tool)  // ['search_flights', 'search_hotels', ...]
  },
  scorers: [
    createScorer({
      name: 'All 4 tools included',
      scorer: ({ output }) =>
        ['search_flights', 'search_hotels', 'find_attractions', 'find_restaurants']
          .every((t) => output.includes(t)) ? 1 : 0,
    }),
    createScorer({
      name: 'Flights before hotels',
      scorer: ({ output }) => {
        const flightIdx = output.indexOf('search_flights')
        const hotelIdx = output.indexOf('search_hotels')
        return flightIdx !== -1 && hotelIdx !== -1 && flightIdx < hotelIdx ? 1 : 0
      },
    }),
  ],
})
```

You can also check argument fidelity at the plan level:

```ts
evalite('Plan argument fidelity', {
  data: async () => [{ input: 'Plan a 3-day trip to Tokyo from London, departing 2026-08-01' }],
  task: async (input) => {
    const plan = await createPlan(input)
    return plan.steps
  },
  scorers: [
    createScorer({
      name: 'search_flights destination is Tokyo',
      scorer: ({ output }) => {
        const flightStep = output.find((s) => s.tool === 'search_flights')
        const dest = flightStep?.args.destination ?? ''
        return dest.toLowerCase().includes('tokyo') ? 1 : 0
      },
    }),
  ],
})
```

This kind of eval is **only possible with Plan+Execute**. In ReAct, there's no plan object to inspect — the model makes tool call decisions one at a time, interleaved with execution. You can test the tool call trajectory after the fact, but you can't test "was the plan sensible?" before tools ran.

The third eval uses an LLM judge for the final itinerary quality — same pattern as Phase 2:

```ts
evalite('LLM judge — itinerary quality', {
  data: async () => [{ input: 'Plan a 3-day trip to Paris from New York, departing 2026-07-10' }],
  task: async (input) => {
    const history = await runPlanExecuteAgent(input, [])
    return lastAssistantMessage(history)
  },
  scorers: [
    makeOllamaJudge(
      'Itinerary includes specific details',
      'Does the itinerary include specific flight options (with airline or price), hotel recommendations (with name), and at least 3 named attractions to visit?',
    ),
  ],
})
```

---

## Key Takeaways

**1. Trajectory evals first.** Before you worry about response quality, verify the tool call sequence. It's the cheapest, most reliable signal you have.

**2. Test argument fidelity separately.** A correct trajectory with wrong arguments is a bug. Add at least one eval that checks the values flowing through tool calls.

**3. Changing the system prompt is a code change.** Every time you edit the prompt, trajectory evals give you immediate feedback on whether the agent's behaviour changed in the ways you intended.

**4. Use LLM judges for subjective quality.** Trajectory evals can't tell you if the final response was clear, friendly, or complete. That's what judges are for — but they're slower and less reliable, so use them sparingly.

**5. Local-first evals are fine.** Running `qwen2.5:7b` as both agent and judge is entirely valid for development. The model might be less capable than GPT-4, but the eval infrastructure is the same. You can swap in a stronger model when you need higher fidelity.

**6. Match the pattern to the dependency structure of the task.** ReAct shines when each step depends on the previous result. Plan+Execute is better when tasks are independent — you get a faster pipeline and a structured plan you can test directly. Understanding which pattern fits your problem is as important as getting the implementation right.

---

The full implementation is in this repo. The evals are in `evals/`, the helpers in `src/eval-utils.ts`. The agent itself is unchanged — evals are read-only observers of behaviour.
