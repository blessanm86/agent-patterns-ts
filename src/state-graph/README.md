# From While Loop to State Graph — Refactoring an AI Agent

[Agent Patterns — TypeScript](../../README.md) · Concept 5

---

Your ReAct agent works. It calls tools, reasons about results, loops until it has an answer. But what's hiding inside that while loop?

```typescript
while (true) {
  const response = await ollama.chat({ messages, tools }); // implicit "think" node
  messages.push(response.message);

  if (!response.message.tool_calls?.length) break; // implicit routing edge

  for (const call of response.message.tool_calls) {
    // implicit "execute_tool" node
    const result = await executeTool(call);
    messages.push({ role: "tool", content: result });
  }
} // implicit edge back to "think"
```

Three nodes. Three edges. A conditional branch. It's all there — just unnamed and invisible. A state graph takes the same logic and makes it explicit, testable, and instrumentable.

---

## The Three Primitives

Every state graph has exactly three building blocks:

### 1. State (with Reducers)

A typed object that flows through the graph. Each key has a **reducer** that controls how updates merge:

```typescript
const agentStateSchema = {
  messages: {
    default: () => [],
    reducer: (a, b) => [...a, ...b], // append — messages accumulate
  },
  iterations: {
    default: () => 0, // no reducer — last write wins
  },
  done: {
    default: () => false, // no reducer — last write wins
  },
};
```

Why reducers? Because multiple nodes write to the same state. Without reducers, `messages` would get overwritten on every update. With an append reducer, each node adds to the conversation — the same behavior as `messages.push()` in the while loop, but declarative.

### 2. Nodes

Functions that receive the full state and return a **partial update**:

```typescript
async function think(state: AgentState): Promise<Partial<AgentState>> {
  const response = await ollama.chat({
    model: MODEL,
    system: SYSTEM_PROMPT,
    messages: state.messages,
    tools,
  });

  return {
    messages: [response.message], // appended via reducer
    iterations: state.iterations + 1, // overwritten (no reducer)
  };
}
```

A node doesn't know about edges, other nodes, or the graph structure. It reads state, does work, returns what changed. This makes it a pure function of its inputs — testable in complete isolation.

### 3. Edges

Transitions between nodes. Two kinds:

- **Normal edge**: always taken. `execute_tool → think` means "after executing tools, always go back to thinking."
- **Conditional edge**: a function inspects state and picks the next node. This is where the `if (!tool_calls) break` logic lives.

```typescript
function routeAfterThink(state: AgentState): string {
  const lastMessage = state.messages[state.messages.length - 1];
  const hasToolCalls = lastMessage?.tool_calls?.length > 0;

  if (!hasToolCalls || state.iterations >= MAX_ITERATIONS) {
    return "synthesize";
  }
  return "execute_tool";
}
```

---

## Side by Side: While Loop vs. Graph

Same hotel reservation agent. Same behavior. Different structure.

**While Loop** (from [Concept 4 — Guardrails](../guardrails/README.md)):

```typescript
while (true) {
  if (iterations >= MAX_ITERATIONS) {
    /* synthesize and break */
  }

  const response = await ollama.chat({ messages, tools });
  messages.push(response.message);
  iterations++;

  if (!response.message.tool_calls?.length) break;

  for (const call of response.message.tool_calls) {
    const result = await executeTool(call);
    messages.push({ role: "tool", content: result });
  }
}
```

**State Graph**:

```typescript
const graph = new StateGraph(agentStateSchema)
  .addNode("think", think)
  .addNode("execute_tool", executeToolNode)
  .addNode("synthesize", synthesize)
  .setEntryPoint("think")
  .addConditionalEdge("think", routeAfterThink, ["execute_tool", "synthesize"])
  .addEdge("execute_tool", "think")
  .addEdge("synthesize", END)
  .compile();
```

The graph makes the implicit structure visible:

```
         ┌─────────────────────────────────────┐
         │                                     │
         ▼                                     │
      ┌──────┐    route (cond edge)    ┌───────────────┐
      │ think │───────────────────────>│ execute_tool   │
      └──────┘                         └───────────────┘
         │
         │ (no tool calls / max iterations)
         ▼
      ┌─────────────┐
      │ synthesize   │──> END
      └─────────────┘
```

Running the demo with `pnpm dev:state-graph` shows the graph transitions in real time:

```
  [graph] → think
  🔧 Tool call: check_availability
     Args: { "check_in": "2026-03-01", "check_out": "2026-03-05" }
     Result: {"available":true,"nights":4,"rooms":[...]}
  [graph] → execute_tool
  [graph] → think
  [graph] → synthesize
  [graph] → END

  📊 Trace: think -> execute_tool -> think -> synthesize -> END
     Iterations: 2
```

---

## Building the Runtime

The graph runtime in [`graph.ts`](./graph.ts) is ~120 lines of domain-agnostic TypeScript. No framework needed. Here's how it works.

### State Schema + Reducers

```typescript
type Reducer<T> = (existing: T, incoming: T) => T;

interface ChannelConfig<T> {
  default: () => T;
  reducer?: Reducer<T>; // optional — no reducer means last-write-wins
}

type StateSchema = Record<string, ChannelConfig<unknown>>;
```

When a node returns `{ messages: [newMsg] }`, the runtime checks: does `messages` have a reducer? If yes, call `reducer(existing, incoming)`. If no, overwrite.

### The Builder

The `StateGraph` class collects nodes and edges, then `compile()` validates the structure:

- Entry point is set and points to an existing node
- Every node has at least one outgoing edge
- All edge targets reference existing nodes (or the special `END` sentinel)

If validation fails, you get a clear error at compile time — not a silent runtime failure.

### The Execution Loop

`CompiledGraph.run()` is, itself, a while loop:

```typescript
while (current !== END) {
  const nodeFn = this.nodes.get(current);
  const update = await nodeFn(state);
  state = this.applyUpdate(state, update);
  current = this.resolveNextNode(current, state);
}
```

That's the entire runtime. The graph IS the while loop, made visible. Every transition is logged. Every state update goes through reducers. The execution trace is captured automatically.

---

## The Testability Win

The biggest practical benefit: **each node is independently testable**.

With a while loop, testing means running the entire agent and checking the final output. With a graph, you can test each node in isolation:

```typescript
// Test the think node directly
const state = {
  messages: [{ role: "user", content: "What rooms are available?" }],
  iterations: 0,
  done: false,
};
const update = await think(state);
// Assert: update.messages contains an assistant response
// Assert: update.iterations === 1

// Test the router directly
const stateWithToolCalls = {
  messages: [{ role: "assistant", content: "", tool_calls: [...] }],
  iterations: 1,
  done: false,
};
const next = routeAfterThink(stateWithToolCalls);
// Assert: next === "execute_tool"

// Test max iterations routing
const stateAtLimit = { ...stateWithToolCalls, iterations: 15 };
const nextAtLimit = routeAfterThink(stateAtLimit);
// Assert: nextAtLimit === "synthesize"
```

No LLM calls needed for routing tests. No mock setup for state validation. Each piece is a function of its inputs.

---

## When Loop vs. Graph: An Honest Assessment

The industry is genuinely split on this. Here's what the data and practitioners say.

### Where Graphs Win

**Measured results from academia:**

- **StateFlow** (COLM 2024) showed 13–28% higher success rates vs. ReAct loops on InterCode SQL and ALFWorld benchmarks, with 3–5x lower inference cost. The cost savings come from state-specific prompts (~400 tokens) replacing full ReAct few-shot examples (~2,043 tokens).
- **AFlow** (ICLR 2025 Oral) found that optimized graph workflows outperform hand-designed approaches by 5.7%, and enable smaller models to beat GPT-4o at 4.55% of its cost.

**Structural guarantees that loops can't easily provide:**

| Capability           | While Loop                      | State Graph                  |
| -------------------- | ------------------------------- | ---------------------------- |
| Checkpointing        | Manual serialization            | Automatic at node boundaries |
| Human-in-the-loop    | Where do you pause?             | Natural — pause at any node  |
| Streaming            | Custom plumbing                 | Built-in at transitions      |
| Time travel / replay | Not possible                    | Replay from any checkpoint   |
| Testing              | Integration test the whole loop | Unit test each node          |
| Parallel execution   | Manual threading                | Declarative fan-out          |

### Where Loops Win

**Anthropic's position** (December 2024):

> "Agents can handle sophisticated tasks, but their implementation is often straightforward — they are typically just LLMs using tools based on environmental feedback in a loop."

**Braintrust** found that Claude Code, the OpenAI Agents SDK, and most successful production agents share the same architecture: a while loop with tools. The loop pattern wins "for the same reason as UNIX pipes and React components: it's simple, composable, and flexible enough to handle complexity without becoming complex itself."

**Temporal CTO Maxim Fateev** offered the sharpest critique:

> "A graph is one of the worst ways to represent procedural code. Its perceived simplicity is an illusion that shatters the moment you encounter the dynamic, data-driven, and error-prone reality of building sophisticated systems."

His argument: conditional branches require code anyway, so you end up with a diagram plus code snippets — worse than just code.

### The Pragmatic Answer

Use a **loop** when:

- Your agent does open-ended reasoning with tools (classic ReAct)
- The LLM naturally decides tool order and when to stop
- You're prototyping or iterating quickly
- You don't need persistence, streaming, or human-in-the-loop

Use a **graph** when:

- Steps must execute in a guaranteed order (compliance, audit workflows)
- Human-in-the-loop approval is required at specific points
- Multiple agents share state with defined handoff points
- You need checkpointing for long-running workflows
- You need to prevent the LLM from skipping or reordering steps

The honest truth: **most agents are while loops**, and that's fine. The graph earns its complexity when you need structural guarantees the loop can't provide.

---

## In Production: Frameworks and Libraries

Our demo hand-rolls a minimal runtime to teach the concepts. In production, you'd reach for a framework — unless your needs are very simple. Here's the landscape:

### LangGraph (Python + JavaScript)

The dominant graph-based agent framework. `StateGraph` class with nodes, conditional edges, and reducers — the same primitives we built, plus production infrastructure: built-in checkpointing, 6 streaming modes, human-in-the-loop interrupts, and time-travel debugging via LangGraph Studio. ~400 companies running it in production as of mid-2025.

**Best for:** Complex multi-step agents needing persistence, observability, and human oversight.

### Mastra (TypeScript-native)

From the Gatsby team. Graph-based workflows with durable execution, Zod-based type-safe schemas, and a functional-core-imperative-shell pattern. Deploys as standalone endpoints or embedded in Next.js/Node.js apps.

**Best for:** TypeScript teams wanting graph structure with modern DX and first-class workflow durability.

### XState / Stately Agent

Lightweight state machine library. The LLM decides which transition to take, but the machine constrains the choices — the model can't skip states or take invalid paths. Built on XState v5 with full TypeScript support.

**Best for:** When you want graph guarantees without a full agent framework. Good middle ground between a raw loop and a heavy framework.

### Google ADK

Deterministic workflow agents (`SequentialAgent`, `ParallelAgent`, `LoopAgent`) with LLM reasoning only at the leaves. The key insight: orchestration is code-controlled, reasoning is model-controlled. Separates the two concerns cleanly.

**Best for:** When you want to separate orchestration from reasoning. The workflow structure is deterministic; only individual steps involve the LLM.

### Temporal (durable execution)

The anti-graph alternative. Normal procedural code — loops, conditionals, function calls — with crash-proof guarantees. Every function call is automatically persisted; on failure, execution resumes from the exact point of failure. No graph abstraction needed.

**Best for:** When you want persistence and fault-tolerance without graph abstractions. Especially strong for highly dynamic, data-driven agents where a static graph feels too rigid.

### Vercel AI SDK

Loop-based with `maxSteps` and `stopWhen` for fine-grained loop control. Explicitly anti-graph in philosophy — "building AI agents is just regular programming." Uses standard `if/else` and `while` loops. Integrates with Temporal for durability when needed.

**Best for:** Simple agents where a loop is sufficient. The ecosystem default for Next.js/React developers.

### When to hand-roll vs. use a framework

Hand-roll (like this demo) when you're **learning the concepts** or when your needs are simple enough that a framework adds more complexity than it removes. Use a framework when you need **production infrastructure** — checkpointing, streaming, human-in-the-loop, observability — that would take weeks to build correctly from scratch.

---

## Key Takeaways

1. **The graph IS the while loop, made visible.** Every while-loop agent already has implicit nodes and edges. The state graph just names them.

2. **Three primitives are enough.** State with reducers, node functions, and edges (normal + conditional) are all you need to build a state graph runtime from scratch.

3. **Testability is the immediate win.** Each node is a pure function testable in isolation. Routing logic is a simple function of state. No need to run the full agent to test individual pieces.

4. **Graphs earn their complexity when you need structural guarantees** — checkpointing, human-in-the-loop, parallel execution, guaranteed step ordering — that while loops can't easily provide.

5. **Most agents don't need graphs.** Start with a loop. Move to a graph when measured results show the structure helps. The industry consensus, from Anthropic to Vercel: find the simplest solution that works.

---

## Sources

### Academic Papers

- [StateFlow: Enhancing LLM Task-Solving through State-Driven Workflows](https://arxiv.org/abs/2403.11322) — Wu et al., COLM 2024
- [AFlow: Automating Agentic Workflow Generation](https://arxiv.org/abs/2410.10762) — ICLR 2025 Oral
- [Pregel: A System for Large-Scale Graph Processing](https://research.google/pubs/pregel-a-system-for-large-scale-graph-processing/) — Malewicz et al., SIGMOD 2010
- [AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation](https://arxiv.org/abs/2308.08155) — Wu et al., Microsoft Research, 2023

### Industry

- [LangGraph announcement](https://blog.langchain.com/langgraph/) — LangChain, 2024
- [Building LangGraph: Designing an Agent Runtime from First Principles](https://blog.langchain.com/building-langgraph/)
- [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) — Anthropic, 2024
- [The canonical agent architecture: A while loop with tools](https://www.braintrust.dev/blog/agent-while-loop) — Braintrust
- [The fallacy of the graph](https://temporal.io/blog/the-fallacy-of-the-graph-why-your-next-workflow-should-be-code-not-a-diagram) — Temporal
- [The No-Nonsense Approach to AI Agent Development](https://vercel.com/blog/the-no-nonsense-approach-to-ai-agent-development) — Vercel
