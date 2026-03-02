# The Agent Framework Landscape: A Taxonomy for Confused Developers

You've built a ReAct loop from scratch. You've wired up tools, managed context windows, streamed tokens, added guardrails, and delegated to sub-agents. Now the internet tells you to use a framework, and you're staring at a wall of options: LangGraph, CrewAI, AutoGen, Vercel AI SDK, Mastra, PydanticAI, Claude Agent SDK, OpenAI Agents SDK, Google ADK. Each claims to be the "right" way to build agents. Some are thin wrappers. Some are full runtimes. Some are products dressed as frameworks.

This guide cuts through the confusion. It provides a taxonomy for understanding the agent framework ecosystem, compares the major players across every meaningful dimension, and gives you a decision framework for choosing — or not choosing — one.

The uncomfortable truth up front: **the most successful production agents tend to use no framework at all.** But frameworks solve real problems for specific use cases, and understanding the landscape helps you make an informed choice rather than a trendy one.

---

## The 4-Layer Agent Stack

Before comparing frameworks, it helps to see where they fit in the broader stack. Every AI agent system, from a weekend prototype to Claude Code, sits on four layers:

```
┌─────────────────────────────────────────────────┐
│                  HARNESSES                       │
│  Claude Code, Cursor, Aider, Devin, OpenCode    │
│  (Complete products combining many patterns)     │
├─────────────────────────────────────────────────┤
│                 FRAMEWORKS                       │
│  LangGraph, CrewAI, Vercel AI SDK, Mastra, ...  │
│  (Orchestration, tools, multi-agent, memory)     │
├─────────────────────────────────────────────────┤
│                 PROTOCOLS                        │
│  MCP (tool integration), A2A (agent-to-agent)    │
│  (Standardized interfaces between components)    │
├─────────────────────────────────────────────────┤
│                 MODEL APIs                       │
│  Anthropic, OpenAI, Google, Ollama, ...          │
│  (Raw LLM inference + tool calling)              │
└─────────────────────────────────────────────────┘
```

**Model APIs** provide inference — you send messages, get completions, handle tool calls. This is the `while(true)` loop you've already built.

**Protocols** standardize how components talk to each other. MCP standardizes tool integration (one tool interface to rule them all). A2A standardizes agent-to-agent communication. Protocols _reduce_ what frameworks need to provide — the custom connector code that justified a framework's existence is being standardized away.

**Frameworks** sit between raw APIs and finished products. They provide orchestration logic, tool management, multi-agent coordination, memory, tracing, and other capabilities that a raw loop doesn't handle. This is the layer this guide focuses on.

**Harnesses** are complete products built on top of everything below. Claude Code, Cursor, Aider — these combine dozens of patterns into a single tool developers use daily. They're the densest concentration of agentic patterns in production.

The key insight: **you don't need every layer.** Many production agents skip the framework layer entirely, going straight from model APIs (plus protocols) to a finished product. Understanding _when_ the framework layer earns its place is the entire point of this guide.

---

## Framework Taxonomy: Four Categories

The "agent framework" label covers fundamentally different things. A vendor SDK and an orchestration framework solve different problems, have different tradeoffs, and attract different adopters. Lumping them together creates the confusion this guide resolves.

### Category 1: Vendor Agent SDKs

**What they are:** Agent development kits built by the model providers themselves.

**Examples:** Claude Agent SDK (Anthropic), OpenAI Agents SDK, Google ADK (Agent Development Kit)

**Core trait:** Tight integration with the vendor's models and infrastructure. Range from "thick runtime" (Claude Agent SDK ships the entire Claude Code CLI binary and includes 9+ built-in tools) to "thin orchestration" (OpenAI Agents SDK provides the agent loop + handoffs + guardrails, you bring tool implementations).

**Use when:** You're committed to a model provider and want the smoothest integration path.

### Category 2: Model-Agnostic Toolkits

**What they are:** Lightweight libraries that handle LLM interaction plumbing (provider abstraction, tool calling, streaming, type safety) without prescribing architecture.

**Examples:** Vercel AI SDK, PydanticAI

**Core trait:** Functions, not frameworks. They're the thinnest useful layer above raw API calls. You compose them however you want — they don't own your architecture.

**Use when:** You want provider flexibility and type safety without giving up control of your agent loop.

### Category 3: Orchestration Frameworks

**What they are:** Full-featured systems for building complex multi-agent workflows with persistence, state management, and coordination.

**Examples:** LangGraph, CrewAI, AutoGen/AG2/Microsoft Agent Framework

**Core trait:** They prescribe how agents are structured and how they communicate. Graph-based (LangGraph), role-based (CrewAI), or conversation-based (AutoGen). They own the execution model.

**Use when:** Your agent requires complex multi-step workflows, human-in-the-loop approval, durable execution, or multi-agent coordination.

### Category 4: Full-Stack Agent Frameworks

**What they are:** Batteries-included platforms that bundle agents, workflows, RAG, memory, evals, and developer tooling into one package.

**Examples:** Mastra

**Core trait:** The "Next.js of agents" — opinionated, batteries-included, fast to start but harder to escape. They handle everything from LLM calls to vector search to evaluation.

**Use when:** You want a single dependency for your entire AI application stack and you're willing to buy into the framework's opinions.

---

## The Thin-to-Thick Spectrum

The most useful mental model for comparing frameworks isn't a feature matrix — it's understanding how much orchestration each framework handles versus how much you own.

```
Thin (you own the loop)                                        Thick (framework owns the loop)
│                                                                                             │
│  Raw API    Vercel AI SDK    PydanticAI    OpenAI SDK    LangGraph    Google ADK    CrewAI   │
│             ────────────     ──────────    ──────────    ─────────    ──────────    ──────   │
│             + provider       + DI +        + handoffs +  + graph +    + workflow    + team   │
│               abstraction    validation    guardrails +  checkpoint   agents +     metaphor  │
│             + tool schemas   + self-       tracing       + HITL       delegation   + memory  │
│             + streaming      correction                               + eval       + auto    │
│                                                                                    manager  │
│                                                                                             │
│  Claude Agent SDK sits off the right edge — it ships a full runtime with 9+ built-in tools  │
```

**Thin frameworks** (Vercel AI SDK, PydanticAI) handle the tedious parts — provider abstraction, tool schema generation, streaming — and get out of your way. You write the agent loop, the routing logic, the persistence. When something goes wrong, you debug your code.

**Thick frameworks** (CrewAI, Claude Agent SDK) handle orchestration, tool execution, memory, and coordination. You configure rather than code. When something goes wrong, you debug the framework's decisions.

**The tradeoff is always the same:** thin frameworks give you control at the cost of implementation effort. Thick frameworks give you speed at the cost of transparency. There is no framework that gives you both — it's a fundamental design tension.

---

## Deep Comparison: The Major Frameworks

### Claude Agent SDK (Anthropic) — The Full Runtime

The Claude Agent SDK is unique because it doesn't abstract over an API — it bundles the entire Claude Code CLI as a subprocess. When you call `query()`, you're spawning the same runtime that powers Claude Code, with the same tools, context management, and agent loop.

**Architecture:**

```
Your Code
    │
    ▼
query({ prompt, options })
    │
    ▼
┌──────────────────────────┐
│  Claude Code CLI Binary   │  (spawned as subprocess)
│                           │
│  ┌─────────────────────┐ │
│  │   TAOR Loop          │ │  Think → Act → Observe → Repeat
│  │   (agent loop)       │ │
│  ├─────────────────────┤ │
│  │   Built-in Tools     │ │  Read, Write, Edit, Bash, Glob,
│  │   (9+ tools)         │ │  Grep, WebSearch, WebFetch, Task
│  ├─────────────────────┤ │
│  │   Context Compaction │ │  Auto-summarizes near token limits
│  ├─────────────────────┤ │
│  │   Hooks (18+ events) │ │  PreToolUse, PostToolUse, Stop...
│  └─────────────────────┘ │
└──────────────────────────┘
```

**Key primitives:**

- `query()` — main entry point, returns an async generator of typed messages
- **Built-in tools** — Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, AskUserQuestion, Task (subagents)
- **Hooks** — 18+ event types with deny/allow/ask priority for deterministic control over non-deterministic agents
- **Subagents** — via the Task tool, with own context window, tool restrictions, and model overrides
- **Sessions** — capture session ID to resume or fork conversations
- **Custom tools** — implemented as in-process MCP servers

**What makes it different:** You don't implement tools. The SDK ships a full execution environment. `Read` actually reads files. `Bash` actually runs commands. `Edit` actually modifies code. This is a thick runtime — the thickest in the ecosystem.

**The tradeoff:** Claude-only. The CLI binary adds package size and deployment complexity. You're not building on top of an SDK — you're configuring a product.

### OpenAI Agents SDK — The Thin Orchestrator

The polar opposite of the Claude Agent SDK. Released March 2025 as the production successor to Swarm, it provides a small set of orchestration primitives and expects you to bring tool implementations.

**Architecture:**

```
Your Code
    │
    ▼
Runner.run(agent, input)
    │
    ▼
┌──────────────────────────┐
│  Agent Loop (Runner)      │
│                           │
│  1. LLM call with         │
│     instructions + tools  │
│  2. Response:             │
│     ├── Final output → END│
│     ├── Tool calls →      │
│     │   execute + loop    │
│     └── Handoff →         │
│         switch agent +    │
│         loop              │
│  3. Max turns check       │
│                           │
│  ┌─ Input Guardrails ──┐ │
│  ├─ Output Guardrails ─┤ │
│  ├─ Tracing (auto) ────┤ │
│  └─ Context (DI) ──────┘ │
└──────────────────────────┘
```

**Key primitives:**

- **Agent** — configuration object (not a class to subclass) with instructions, tools, handoffs, output_type, guardrails
- **Runner** — owns the agent loop. Three methods: `run()` (async), `run_sync()`, `run_streamed()`
- **Handoffs** — transfer control to another agent (target responds directly to user)
- **Agent-as-Tool** — `agent.as_tool()` for orchestrator pattern (caller retains control)
- **Guardrails** — input/output/tool validation with tripwire pattern, parallel or blocking execution
- **Sessions** — SQLite, Redis, SQLAlchemy, server-managed, encrypted
- **Tracing** — automatic, with 21+ platform integrations
- **Context** — generic typed object flowing through tools, hooks, and guardrails (not sent to LLM)

**Multi-agent patterns:**

```python
# Pattern 1: Handoffs (routing/triage) — target takes over
triage = Agent(name="Triage", handoffs=[billing_agent, refund_agent])

# Pattern 2: Agent-as-Tool (orchestrator) — caller retains control
manager = Agent(tools=[researcher.as_tool(tool_name="research")])

# Pattern 3: Code-based — Python asyncio
results = await asyncio.gather(Runner.run(a, "X"), Runner.run(b, "Y"))
```

**What makes it different:** The minimal surface area. A handful of primitives — Agent, Runner, handoffs, guardrails, tracing — cover most agent patterns. It's Python-native: no DSLs, no YAML, no graph definitions.

**The tradeoff:** You implement tools yourself. Hosted tools (WebSearch, CodeInterpreter) only work with OpenAI models. No graph-level control for complex workflows. Optimized for OpenAI despite supporting 100+ models via LiteLLM.

### Google ADK — The Hierarchical Composer

Google's entry is the most architecturally ambitious vendor SDK. It introduces workflow agents as first-class primitives and an event-driven runtime, available in four languages (Python, TypeScript, Go, Java).

**Architecture:**

```
┌──────────────────────────────────────┐
│  Event-Driven Runtime                 │
│                                       │
│  ┌─────────────────────────────┐     │
│  │  Agent Hierarchy (tree)      │     │
│  │                              │     │
│  │  SequentialAgent             │     │  Execute sub-agents in order
│  │  ParallelAgent               │     │  Run sub-agents concurrently
│  │  LoopAgent                   │     │  Repeat until condition
│  │  LlmAgent                   │     │  LLM-powered reasoning
│  │  Custom (BaseAgent)          │     │
│  └─────────────────────────────┘     │
│                                       │
│  Communication:                       │
│  ├── Shared session state             │
│  ├── LLM-driven delegation            │
│  └── AgentTool (explicit invocation)  │
└──────────────────────────────────────┘
```

**Key primitives:**

- **Five agent types** — LlmAgent, SequentialAgent, ParallelAgent, LoopAgent, Custom
- **Tools** — function tools, MCP via McpToolset, OpenAPI auto-generation, AgentTool (agents as callable tools)
- **Session & State** — session context + shared key-value store across agent hierarchy + long-term memory
- **ArtifactService** — file and binary data management
- **Built-in eval framework** — multi-turn assessment

**What makes it different:** Workflow agents (Sequential, Parallel, Loop) give you deterministic control as first-class primitives rather than framework configuration. The agent hierarchy with single-parent constraint enforces clean decomposition. Four language SDKs is the broadest coverage.

**The tradeoff:** The most complex API surface. Gemini-optimized (other models need more configuration). Built-in tools have restrictions (one per root agent). Google Cloud emphasis for deployment.

### LangGraph — The State Machine

LangGraph models agents as directed graphs: nodes are computation steps, edges define control flow, and a typed state object flows through the graph. Inspired by Google's Pregel and Apache Beam.

**Architecture:**

```
┌─ StateGraph ──────────────────────────┐
│                                        │
│  State: TypedDict with reducers        │
│  ┌──────────────────────────────────┐  │
│  │  messages: Annotated[list, add]   │  │  (append reducer)
│  │  final_answer: str                │  │  (overwrite reducer)
│  └──────────────────────────────────┘  │
│                                        │
│  Nodes (Python functions):             │
│  ┌──────────┐     ┌──────────┐        │
│  │call_model │────▶│call_tool │        │
│  └────┬─────┘     └────┬─────┘        │
│       │                 │              │
│       │    ◀────────────┘              │
│       │   (conditional edge)           │
│       ▼                                │
│      END                               │
│                                        │
│  + Checkpointer (state persistence)    │
│  + Interrupts (HITL)                   │
│  + LangSmith integration               │
└────────────────────────────────────────┘
```

**A ReAct agent in LangGraph:**

```python
builder = StateGraph(State)
builder.add_node("call_model", call_model)
builder.add_node("call_tool", call_tool)
builder.add_edge(START, "call_model")
builder.add_conditional_edges("call_model", should_continue, {
    "continue": "call_tool", "end": END
})
builder.add_edge("call_tool", "call_model")
graph = builder.compile(checkpointer=MemorySaver())
```

Compare this to the `runAgent()` while loop in `src/react/agent.ts` — same behavior, different expression. The graph version makes the flow visible and inspectable but adds ceremony.

**Where it shines:** When your agent needs checkpointing (long-running workflows), human-in-the-loop interrupts (pause → inspect → modify state → resume), or complex branching with cycles. These are genuinely hard to build from scratch and justify the graph abstraction.

**Where it hurts:** Simple agents. The ReAct loop above is more code than a while loop, harder to debug when the conditional edge doesn't route as expected, and carries the LangChain ecosystem baggage (frequent breaking changes, abstraction layers).

### CrewAI — The Team Metaphor

CrewAI models agents as role-playing team members. Each agent has a role, goal, and backstory. Tasks are work assignments. A Crew is a team executing tasks through a defined process.

**Architecture:**

```
┌─ Crew ──────────────────────────────────┐
│                                          │
│  Agents:                                 │
│  ┌──────────────────────────────────┐   │
│  │ role: "Senior Researcher"         │   │
│  │ goal: "Find comprehensive info"   │   │
│  │ backstory: "15 years experience"  │   │
│  │ tools: [search, scrape]           │   │
│  └──────────────────────────────────┘   │
│                                          │
│  Tasks:                                  │
│  ┌──────────────────────────────────┐   │
│  │ description: "Research AI trends"  │   │
│  │ expected_output: "10 bullet pts"   │   │
│  │ agent: researcher                  │   │
│  └──────────────────────────────────┘   │
│                                          │
│  Process:                                │
│  ├── Sequential (pipeline)               │
│  ├── Hierarchical (auto-manager)         │
│  └── Hybrid                              │
│                                          │
│  + Memory (short/long/shared/entity)     │
│  + Guardrails (function + LLM-based)     │
└──────────────────────────────────────────┘
```

**Where it shines:** The fastest path from idea to multi-agent system. The team metaphor is intuitive — non-technical stakeholders understand "researcher + writer + editor." Hierarchical mode auto-generates a manager agent that delegates.

**Where it hurts:** The role/goal/backstory pattern is prompt engineering dressed up as architecture. It can mislead developers into thinking agents are "smarter" because they have personas. Hard to escape when you outgrow the abstraction. Hierarchical mode adds an extra LLM call for every delegation. Python-only.

### AutoGen / AG2 / Microsoft Agent Framework — The Fragmentation Cautionary Tale

The AutoGen story is a cautionary tale in framework adoption. Understanding the timeline matters:

1. **Original AutoGen (0.2)** — Microsoft Research. Conversation-driven multi-agent. Hugely popular.
2. **September 2024** — Original creators depart Microsoft.
3. **November 2024** — Two things happen simultaneously:
   - Departing team creates **AG2** — inherits the `autogen` PyPI package. Backward-compatible.
   - Microsoft releases **AutoGen 0.4** — complete architectural rewrite. Fundamentally different API.
4. **October 2025** — Microsoft announces **Microsoft Agent Framework** — merges AutoGen + Semantic Kernel. Both predecessors enter maintenance mode.
5. **Q1 2026** — Agent Framework GA target.

**The current state (March 2026):**

| Version                   | Maintainer         | Status                                    |
| ------------------------- | ------------------ | ----------------------------------------- |
| AG2 (v0.3.2)              | Original creators  | Actively developed                        |
| AutoGen 0.4               | Microsoft          | Maintenance, merging into Agent Framework |
| AutoGen 0.2               | Microsoft (legacy) | Maintenance                               |
| Microsoft Agent Framework | Microsoft          | Public preview                            |

If you adopted AutoGen in early 2024, you now face: a fragmented community, unclear migration paths, and a framework in transition. This is the risk of heavy framework adoption — you're not just buying an API, you're buying a team's roadmap.

### Vercel AI SDK — The Thin Toolkit

The Vercel AI SDK is the thinnest useful abstraction in the ecosystem. It provides composable functions (`generateText`, `streamText`, `tool()`) that handle LLM interaction plumbing — provider abstraction across 24+ providers, streaming, tool calling, type safety via Zod — without prescribing architecture.

**The agentic loop:**

```typescript
const { text, steps } = await generateText({
  model: openai("gpt-4o"),
  tools: {
    weather: tool({
      description: "Get the weather in a location",
      inputSchema: z.object({ location: z.string() }),
      execute: async ({ location }) => ({ location, temperature: 72 }),
    }),
  },
  stopWhen: stepCountIs(5),
  prompt: "What is the weather in San Francisco?",
});
```

Compare to the `runAgent()` loop in `src/react/agent.ts`. The AI SDK internalizes the while loop — it automatically sends tool results back to the model and loops until no more tool calls or the step limit hits. Same behavior, less boilerplate, but the loop is hidden inside `generateText`.

**What it handles:** Model provider abstraction (24+), tool schema validation via Zod, the agentic loop, streaming (SSE, React Server Components), step-level callbacks.

**What you bring:** Tool implementations, domain-specific stop conditions, application architecture, state management, persistence, memory, multi-agent coordination.

**AI SDK 6** introduces a reusable Agent class, `stopWhen` for flexible loop control, and `prepareStep` for per-step model/tool switching. Still functions-first under the hood.

### PydanticAI — The Type-Safe Python Toolkit

PydanticAI brings the "FastAPI feeling" to agents — type-safe, dependency-injected, validation-first. Built by the Pydantic team.

**The killer feature — dependency injection:**

```python
@dataclass
class SupportDeps:
    customer_id: int
    db: DatabaseConn

support_agent = Agent('openai:gpt-4o', deps_type=SupportDeps, output_type=SupportResponse)

@support_agent.tool
async def customer_balance(ctx: RunContext[SupportDeps], include_pending: bool) -> float:
    return await ctx.deps.db.customer_balance(id=ctx.deps.customer_id, ...)

# Production
result = await support_agent.run("What's my balance?", deps=SupportDeps(db=real_db, ...))
# Testing — swap dependencies
result = await support_agent.run("What's my balance?", deps=SupportDeps(db=mock_db, ...))
```

**What makes it different:** Tools become genuinely testable because dependencies are injected, not imported. Output validation with self-correction — when the LLM produces invalid output, PydanticAI feeds the validation error back to the model for retry. This is a unique feature that turns Pydantic's validation strength into an agent primitive.

**The tradeoff:** Python-only. No multi-agent coordination. No persistence or checkpointing. It's the Python equivalent of the Vercel AI SDK's "functions, not frameworks" philosophy, with type safety cranked up.

### Mastra — The Batteries-Included TypeScript Framework

Mastra is the thickest framework in the TypeScript ecosystem. Built by the Gatsby team (YC-backed), it sits on top of the Vercel AI SDK and adds everything the AI SDK deliberately leaves out: workflows, RAG, memory, evals, and a dev environment.

```typescript
import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";

const agent = new Agent({
  name: "WeatherAgent",
  instructions: "You are a weather assistant.",
  model: openai("gpt-4-turbo"), // AI SDK provider object
});
```

**What it adds on top of AI SDK:**

- **Workflows** — graph-based, built on XState. `.then()`, `.branch()`, `.parallel()` syntax
- **RAG** — `.chunk()`, `.embed()`, `.upsert()`, `.query()`, `.rerank()`
- **Memory** — thread-based with semantic search across past interactions
- **Evals** — 15 pre-built evaluation metrics
- **Mastra Dev** — local development environment with chat UI and state visualization

**The tradeoff:** Heavy dependency. The workflow DSL is another abstraction to learn. TypeScript-only. Relatively new with a smaller community than LangGraph or CrewAI.

---

## Feature Matrix

| Feature            |      Claude SDK       |       OpenAI SDK        |          Google ADK          |     LangGraph      |      CrewAI       | Vercel AI SDK |    PydanticAI     |      Mastra      |
| ------------------ | :-------------------: | :---------------------: | :--------------------------: | :----------------: | :---------------: | :-----------: | :---------------: | :--------------: |
| **Language**       |         Py/TS         |          Py/TS          |        Py/TS/Go/Java         |       Py/TS        |        Py         |      TS       |        Py         |        TS        |
| **Model-agnostic** |      Claude only      |     100+ (LiteLLM)      |       Any (Gemini-opt)       |     All major      |     All major     | 24+ providers |     All major     | 40+ (via AI SDK) |
| **Built-in tools** |          9+           |        5 hosted         |              3               |        None        |       None        |     None      |       None        |       None       |
| **Multi-agent**    |       Subagents       |   Handoffs + as-tool    | Workflow agents + delegation |    Graph-based     | Crews + processes |      No       |        No         |    Workflows     |
| **Persistence**    |       Sessions        |  Sessions (5 backends)  |       Sessions + State       |   Checkpointing    |        No         |      No       |        No         |  Workflow state  |
| **HITL**           |    Hooks + AskUser    |      Interruptions      |          Callbacks           |  Graph interrupts  |    human_input    |      No       |        No         | Workflow suspend |
| **Memory**         |  Context compaction   |      Sessions only      |     Session + long-term      | Via checkpointing  | Short/Long/Shared |      No       |        No         |   Thread-based   |
| **Guardrails**     |  Hooks (deny/allow)   |    Tripwire pattern     |        Via callbacks         |    Custom nodes    |  Function + LLM   |      No       | Output validation |        No        |
| **Tracing**        |          No           | Auto (21+ integrations) |        Built-in eval         |     LangSmith      |     Built-in      |   Callbacks   |      Logfire      |     Built-in     |
| **Streaming**      |    Async generator    |         Events          |            Events            |   State updates    |      Limited      |  First-class  |        Yes        |    Via AI SDK    |
| **MCP support**    |      First-class      |      5 transports       |          McpToolset          |     Via tools      |     Via tools     |      No       |        No         |    Via tools     |
| **Type safety**    | Tool names as strings |        Pydantic         |          TypedDict           | TypedDict/Pydantic |       Basic       |  Zod schemas  |     Pydantic      | Zod (via AI SDK) |
| **DI/Context**     |         Hooks         |    RunContextWrapper    |      InvocationContext       |       State        |        No         |      No       |    RunContext     |        No        |

---

## The Protocols Thesis: Why Frameworks Are Getting Thinner

Here's the structural argument for why the framework layer is shrinking: **protocols are commoditizing the integration code that frameworks used to provide.**

Before MCP, connecting an agent to a database required custom code — and frameworks provided that code as "connectors" or "integrations." Before A2A, coordinating agents across systems required custom protocols — and frameworks provided that as "multi-agent orchestration."

Now:

- **MCP** standardizes how agents access external tools and data. Tens of thousands of MCP servers exist. Any agent that speaks MCP can use any MCP-compatible tool — no framework-specific connector needed.
- **A2A** standardizes how agents communicate with each other. Agent coordination doesn't require a shared framework — agents can coordinate via a shared protocol.

What's left for frameworks after protocols? **Pure orchestration logic** — the control flow, state management, persistence, and developer experience layer. And that's exactly what many developers argue they can write themselves with a while loop and a state object.

The framework landscape is bifurcating:

- **Thin toolkits** (Vercel AI SDK, PydanticAI) that handle provider abstraction and tool plumbing are becoming _more_ useful — they complement protocols
- **Thick frameworks** (LangGraph, CrewAI) that bundled integration code are becoming _less_ differentiated — protocols replace their connectors, leaving only orchestration logic

This doesn't mean thick frameworks are dead. Checkpointing, human-in-the-loop, durable execution, and graph visualization are genuinely hard to build from scratch. But the bar for reaching for a framework is rising, because the floor (raw API + protocols + while loop) is rising with it.

---

## In the Wild: Coding Agent Harnesses

Here's the most powerful data point in this entire guide: **9 out of 10 major coding agent harnesses build their agent loops from scratch.** Not one uses LangGraph, CrewAI, or AutoGen. Not one uses an orchestration framework.

| Harness        | Framework?            | LLM Client            | Agent Loop                     |
| -------------- | --------------------- | --------------------- | ------------------------------ |
| Claude Code    | None                  | Direct Anthropic API  | Custom TAOR loop (TypeScript)  |
| Aider          | None                  | litellm               | Custom Coder class (Python)    |
| OpenCode       | AI SDK for calls only | Vercel AI SDK         | Custom orchestration (JS/Go)   |
| Codex CLI      | None                  | Direct OpenAI API     | Custom loop (Rust)             |
| Cline          | None                  | Direct multi-provider | Custom Task class (TypeScript) |
| Roo Code       | None (Cline fork)     | Direct multi-provider | Custom Task class (TypeScript) |
| Cursor         | None (proprietary)    | Proprietary           | Proprietary multi-agent        |
| Windsurf       | None (proprietary)    | Proprietary           | Proprietary Cascade engine     |
| GitHub Copilot | MS Agent Framework    | Semantic Kernel       | Hierarchical orchestration     |
| Devin          | None (proprietary)    | Direct multi-model    | Custom sandboxed environment   |

The one exception — GitHub Copilot using Microsoft Agent Framework — involves Microsoft using its own framework.

**Why don't they use frameworks?** Three reasons:

1. **Performance.** Framework overhead matters at scale. Custom agents report up to 40% faster response times than framework-based equivalents. Every unnecessary abstraction layer adds latency.

2. **Control.** Coding agents need deep customization — edit strategies, context management, permission models, sub-agent architectures — that frameworks constrain. As one developer put it: "Building custom solutions took roughly the same time as debugging framework issues, but I actually understood what I built."

3. **The loop is simple.** The canonical agent architecture is approximately 9 lines of code:

```typescript
while (!done) {
  const response = await callLLM(messages);
  messages.push(response);
  if (response.toolCalls) {
    const results = await Promise.all(response.toolCalls.map((tc) => executeTool(tc)));
    messages.push(...results);
  } else {
    done = true;
  }
}
```

That's the `runAgent()` function from `src/react/agent.ts` in this repo. It's the same loop that powers Claude Code, Aider, and Codex CLI. The complexity isn't in the loop — it's in tool design, context engineering, and prompt architecture. Frameworks don't help with those.

**What harnesses do use:**

- **Provider abstraction** — Aider uses litellm, OpenCode uses Vercel AI SDK. Provider switching is the one universally valued thin layer
- **MCP** — Most harnesses support MCP for tool integration. This is protocol adoption, not framework adoption
- **Custom everything else** — Agent loops, context management, sub-agent delegation, edit strategies — all custom-built

The lesson: if the most sophisticated production agents in existence don't need orchestration frameworks, most developers don't either. Frameworks solve real problems — but those problems are narrower than the frameworks' marketing suggests.

---

## Decision Guide

### Start Here

```
Do you need multi-agent coordination with complex state?
├── Yes → Do you need durable execution (checkpointing, crash recovery)?
│         ├── Yes → LangGraph or Microsoft Agent Framework
│         └── No  → CrewAI (prototype) or OpenAI Agents SDK (production)
│
└── No  → Do you need provider abstraction across many models?
          ├── Yes → TypeScript? → Vercel AI SDK
          │         Python?     → PydanticAI
          │
          └── No  → Are you committed to one model provider?
                    ├── Anthropic → Claude Agent SDK (thick) or raw API (thin)
                    ├── OpenAI   → OpenAI Agents SDK or raw API
                    ├── Google   → Google ADK
                    └── Any      → Raw API with a while loop
```

### When to Use Each

| If you need...                           | Use...                    | Why                                 |
| ---------------------------------------- | ------------------------- | ----------------------------------- |
| Maximum speed to prototype               | CrewAI                    | Team metaphor, minimal code         |
| Complex stateful workflows               | LangGraph                 | Graph + checkpointing + HITL        |
| Thin TS toolkit                          | Vercel AI SDK             | Functions, 24+ providers, streaming |
| Thin Python toolkit                      | PydanticAI                | DI, type safety, validated output   |
| Full TS stack (agents + RAG + evals)     | Mastra                    | Batteries-included                  |
| OpenAI ecosystem integration             | OpenAI Agents SDK         | Handoffs, tracing, sessions         |
| Full runtime with no tool implementation | Claude Agent SDK          | 9+ built-in tools, hooks, sessions  |
| Google ecosystem + multi-language        | Google ADK                | 4 languages, workflow agents        |
| Microsoft/.NET ecosystem                 | Microsoft Agent Framework | Azure, Semantic Kernel lineage      |
| Maximum control, minimum abstraction     | Raw API + while loop      | The pattern from this repo          |

### When NOT to Use a Framework

- **Your agent is a single model + tools + while loop.** This covers more use cases than the framework ecosystem wants you to believe. You've built this in `src/react/agent.ts`.
- **You need deep customization.** If you'll spend more time fighting the framework's assumptions than building your feature, skip it.
- **Latency matters.** Every abstraction layer adds overhead. For real-time or latency-sensitive applications, fewer layers wins.
- **You're building a product, not a prototype.** Products need to be debugged, profiled, and maintained by your team. Code you wrote is code you understand.

### When Frameworks Genuinely Earn Their Place

- **Durable execution.** Long-running agents that survive crashes, with checkpoint/resume. This is genuinely hard to build from scratch and is LangGraph's strongest case.
- **Human-in-the-loop workflows.** Pause → inspect → approve/reject → resume. The interruption/resume pattern with state persistence is complex to implement correctly.
- **Rapid prototyping.** CrewAI gets you a working multi-agent demo in minutes. If the prototype is the goal, the tradeoff is worth it.
- **Enterprise compliance.** Tracing, audit logs, guardrails, permission models — frameworks bundle these. If your org requires them, building from scratch is wasted effort.
- **Multi-agent research.** If you're exploring novel coordination patterns, frameworks like AutoGen or Google ADK provide primitives that accelerate experimentation.

---

## The Uncomfortable Truth

Here's what the framework ecosystem doesn't want you to know: **a well-crafted while loop with good tools and a good prompt outperforms a poorly configured framework agent every time.**

Braintrust analyzed real production agents and found that tool responses account for 67.6% of tokens in agent conversations, system prompts only 3.4%, and tool definitions 10.7%. Tools represent nearly 80% of what agents actually process. The leverage is in context engineering — what goes into the context window — not in orchestration logic.

Vercel proved this with their d0 agent: removing 80% of their tools and replacing 15+ specialized tools with a single bash sandbox made the agent **3.5x faster** and took success rate from 80% to **100%**. The improvement came from simplification, not from switching frameworks.

Anthropic's official guidance: "Start by using LLM APIs directly: many patterns can be implemented in a few lines of code." Frameworks "often create extra layers of abstraction that can obscure the underlying prompts and responses, making them harder to debug."

The agent framework landscape will continue to evolve — new frameworks will appear, existing ones will merge and fragment (as AutoGen demonstrated). But the canonical agent architecture — a while loop that calls an LLM and handles tool invocations — has remained stable since the ReAct paper in 2022. Bet on the stable pattern, not on any individual framework.

---

## Key Takeaways

1. **The 4-layer stack (APIs → Protocols → Frameworks → Harnesses) is the right mental model.** Most agents need layers 1 and 2. Layer 3 is optional. Layer 4 is the goal.

2. **Frameworks exist on a thin-to-thick spectrum.** Vercel AI SDK and PydanticAI handle plumbing. LangGraph and CrewAI handle orchestration. Claude Agent SDK ships a complete runtime. Know what you're buying.

3. **Protocols are thinning out frameworks.** MCP commoditizes tool integration. A2A commoditizes agent communication. What's left for frameworks is pure orchestration — which is often just a while loop.

4. **Production harnesses validate the simple loop.** 9 out of 10 major coding agents build from scratch. If Claude Code and Aider don't need LangGraph, you probably don't either.

5. **The real leverage is in context engineering, not orchestration.** Tool design, prompt architecture, and what goes into the context window matter more than which framework manages the loop.

6. **Frameworks solve real problems — narrowly.** Durable execution, HITL workflows, rapid prototyping, enterprise compliance. If you have one of these problems, use a framework. If you don't, a while loop is fine.

7. **The biggest risk is framework lock-in during framework churn.** The AutoGen fragmentation story is a warning. The more you depend on a framework, the more its roadmap becomes your roadmap.

---

## Sources & Further Reading

**Vendor SDKs:**

- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview) — Anthropic's full-runtime agent SDK
- [OpenAI Agents SDK Docs](https://openai.github.io/openai-agents-python/) — Thin orchestration layer with handoffs and guardrails
- [Google ADK Docs](https://google.github.io/adk-docs/get-started/about/) — Event-driven runtime with workflow agents

**Frameworks & Toolkits:**

- [LangGraph Docs](https://docs.langchain.com/oss/python/langgraph/overview) — Graph-based agent orchestration
- [CrewAI Docs](https://docs.crewai.com/) — Role-based multi-agent teams
- [Vercel AI SDK Docs](https://ai-sdk.dev/docs/introduction) — Thin TypeScript toolkit
- [PydanticAI Docs](https://ai.pydantic.dev/) — Type-safe Python toolkit with dependency injection
- [Mastra Docs](https://mastra.ai/docs) — Full-stack TypeScript agent framework

**Analysis & Comparisons:**

- [How to Think About Agent Frameworks — LangChain Blog](https://blog.langchain.com/how-to-think-about-agent-frameworks/) — LangChain's taxonomy of framework dimensions
- [Comparing Open-Source AI Agent Frameworks — Langfuse](https://langfuse.com/blog/2025-03-19-ai-agent-comparison) — 12-framework comparison
- [We Removed 80% of Our Agent's Tools — Vercel](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools) — Evidence for simplification
- [The Canonical Agent Architecture: A While Loop with Tools — Braintrust](https://www.braintrust.dev/blog/agent-while-loop) — Data on agent token distribution
- [Building Effective Agents — Anthropic](https://www.anthropic.com/research/building-effective-agents) — Five workflow patterns with the case for simplicity
- [Agent Frameworks vs Runtimes vs Harnesses — Analytics Vidhya](https://www.analyticsvidhya.com/blog/2025/12/agent-frameworks-vs-runtimes-vs-harnesses/) — Three-layer taxonomy

**Academic:**

- [Agentic AI Frameworks: Architectures, Protocols, and Design Challenges (arxiv 2508.10146)](https://arxiv.org/html/2508.10146v1) — Academic taxonomy with thin-to-thick spectrum
- [AIOS: LLM Agent Operating System (arxiv 2403.16971)](https://arxiv.org/abs/2403.16971) — Agent OS concept
- [Agent Design Pattern Catalogue (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S0164121224003224) — 18 architectural patterns

**Harness Architecture:**

- [How Claude Code Is Built — Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/how-claude-code-is-built) — TAOR loop, 90% self-written
- [OpenCode Deep Dive](https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/) — AI SDK for calls, custom everything else
- [Unrolling the Codex Agent Loop — OpenAI](https://openai.com/index/unrolling-the-codex-agent-loop/) — Custom Rust loop, not their own SDK
- [Why We No Longer Use LangChain — Octomind](https://www.octomind.dev/blog/why-we-no-longer-use-langchain-for-building-our-ai-agents) — Practitioner case study of framework removal

---

[Agent Patterns — TypeScript](../../README.md)
