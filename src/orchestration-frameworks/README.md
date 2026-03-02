# Graphs vs Teams vs Conversations: Three Ways to Orchestrate AI Agents

You've built a ReAct loop from scratch. You've expressed it as a [state graph](../state-graph/README.md). You've routed between [multiple agents](../multi-agent-routing/README.md) and [delegated to sub-agents](../sub-agent-delegation/README.md). Now someone says "use LangGraph" or "try CrewAI" and you're wondering: what do these frameworks actually do that my `while(true)` loop doesn't?

This guide compares the three dominant orchestration paradigms — **graph-based** (LangGraph), **role-based** (CrewAI), and **conversation-driven** (AutoGen/AG2) — side-by-side. It shows real code from each for the same task, maps their primitives back to patterns you've already built, and surfaces the tradeoffs that comparison articles gloss over. It also tells the cautionary tale of what happens when a 55K-star framework fragments into four competing projects.

The uncomfortable truth up front: **zero production coding agent harnesses use any of these frameworks.** Claude Code, Cursor, Aider, OpenCode, Codex CLI — every one builds its own loop from scratch. That fact should inform how you read this guide.

---

## The Three Paradigms

Before diving into code, understand what each framework _believes_ about how agents should coordinate:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  LangGraph                    CrewAI                    AutoGen / AG2        │
│  ──────────                   ──────                    ────────────         │
│                                                                              │
│  "Agents are nodes            "Agents are team          "Computation         │
│   in a state graph"            members with roles"       emerges from        │
│                                                          conversation"       │
│                                                                              │
│  You define nodes,            You define agents          You define agents   │
│  edges, state, and            with roles, goals,         that converse.      │
│  conditional routing.         backstories, and tasks.    An LLM picks who    │
│  The graph controls           The crew executes them.    speaks next.        │
│  execution flow.                                         Dialogue IS the     │
│                                                          computation.        │
│                                                                              │
│  Explicit control ────────── Fast prototyping ────────── Emergent behavior  │
│                                                                              │
│  Python + TypeScript          Python only                Python (fragmented) │
│  ~36.6M PyPI downloads/mo     ~2M PyPI downloads/mo      ~505K downloads/mo  │
│  25.4K GitHub stars           ~45K GitHub stars           ~55K GitHub stars   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

Note the star-to-download inversion: CrewAI has more stars than LangGraph but ~18x fewer downloads. AutoGen has the most stars but the fewest downloads — and those stars were accumulated before the framework fractured. Downloads are a better signal of production usage.

---

## Paradigm 1: Graph-Based (LangGraph)

### The Mental Model

LangGraph treats agents as **state machines**. You define a typed state object, node functions that transform it, and edges (static or conditional) that route between nodes. The runtime executes nodes in supersteps, checkpoints state after each one, and gives you time-travel, streaming, and human-in-the-loop as built-in capabilities.

The key insight: a `while(true)` loop has implicit structure — an LLM call, a tool-call check, tool execution, a loop-back. LangGraph makes that structure explicit, which lets the runtime instrument it.

```
┌─────────────────────────────────────────────────┐
│              LangGraph ReAct Agent               │
│                                                  │
│  START ──► llm_call ──► should_continue          │
│               ▲              │         │         │
│               │              ▼         ▼         │
│               └──── tool_node        END         │
│                                                  │
│  State: { messages: Message[] }                  │
│  Checkpoint saved after every superstep          │
└─────────────────────────────────────────────────┘
```

### The Same ReAct Agent — LangGraph Python

```python
from langgraph.graph import StateGraph, START, END, MessagesState
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langchain_core.messages import ToolMessage

# Tool definition (same concept as our tools.ts)
@tool
def search(query: str) -> str:
    """Search the web for information."""
    return f"Results for: {query}"

tools = [search]
tools_by_name = {t.name: t for t in tools}
model = ChatOpenAI(model="gpt-4o").bind_tools(tools)

# Node functions — (state) => partial state update
def call_llm(state: MessagesState):
    return {"messages": [model.invoke(state["messages"])]}

def call_tool(state: MessagesState):
    results = []
    for tc in state["messages"][-1].tool_calls:
        result = tools_by_name[tc["name"]].invoke(tc["args"])
        results.append(ToolMessage(content=result, tool_call_id=tc["id"]))
    return {"messages": results}

# Conditional edge — the routing logic
def should_continue(state: MessagesState):
    return "tools" if state["messages"][-1].tool_calls else END

# Build the graph
builder = StateGraph(MessagesState)
builder.add_node("llm", call_llm)
builder.add_node("tools", call_tool)
builder.add_edge(START, "llm")
builder.add_conditional_edges("llm", should_continue, ["tools", END])
builder.add_edge("tools", "llm")

agent = builder.compile()
```

### The Same Agent — LangGraph TypeScript

```typescript
import { StateGraph, START, END, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({ model: "gpt-4o" }).bindTools(tools);

async function callLlm(state: typeof MessagesAnnotation.State) {
  return { messages: [await model.invoke(state.messages)] };
}

const agent = new StateGraph(MessagesAnnotation)
  .addNode("llm", callLlm)
  .addNode("tools", new ToolNode(tools))
  .addEdge(START, "llm")
  .addConditionalEdges("llm", toolsCondition)
  .addEdge("tools", "llm")
  .compile();
```

Or, if you just want the loop with no customization:

```python
from langgraph.prebuilt import create_react_agent
agent = create_react_agent(model, tools=[search])
```

### Core Primitives

| Primitive     | What It Does                                         | Maps to This Repo                                           |
| ------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| `StateGraph`  | Graph parameterized by a state type                  | The `while(true)` loop structure in `src/react/agent.ts`    |
| Nodes         | Functions `(state) => Partial<State>`                | Individual steps inside the loop (LLM call, tool execution) |
| Edges         | Static or conditional routing between nodes          | The `if (no tool calls) break` check                        |
| Reducers      | Per-field merge logic (append, overwrite)            | Manual `history.push()` in our code                         |
| Checkpointer  | Serializes state after every superstep               | Nothing — our loop has no persistence                       |
| `interrupt()` | Pauses execution for human input                     | Our [HITL approval gates](../human-in-the-loop/README.md)   |
| `Command`     | Node decides next step at runtime (edgeless routing) | Nothing — our routing is implicit                           |

### What LangGraph Adds Over a Raw Loop

The honest answer: **checkpointing, HITL, streaming, and observability at node boundaries.**

| Capability           | While Loop          | LangGraph                          |
| -------------------- | ------------------- | ---------------------------------- |
| Checkpointing        | Build it yourself   | Automatic after each superstep     |
| Human-in-the-loop    | Where do you pause? | `interrupt()` at any node boundary |
| Streaming            | Custom plumbing     | 6 built-in modes                   |
| Time-travel / replay | Not possible        | Replay from any checkpoint         |
| Parallel execution   | Manual threading    | Declarative fan-out/fan-in         |
| Debugging            | Print statements    | Inspect state at every transition  |

If you don't need these capabilities, a raw loop is simpler and gives you more control. Harrison Chase (LangGraph creator) acknowledges this: "Any framework that makes it harder to control exactly what is being passed to the LLM is just getting in your way."

### The Pregel Execution Model

Under the hood, LangGraph implements Google's **Bulk Synchronous Parallel** (BSP) model — the same execution pattern from the 2010 Pregel paper for large-scale graph processing:

1. **Plan** — determine which nodes to execute
2. **Execute** — run all selected nodes in parallel (state updates are invisible to each other during this phase)
3. **Update** — apply all state updates atomically, checkpoint

This cycle repeats until no more nodes are activated. The key property: if any node in a parallel branch fails, **none of the updates from that superstep are applied** — transactional consistency.

### Criticisms

- **Over-engineering for simple cases.** A ReAct loop that takes 10 lines of code can require 30+ lines of LangGraph boilerplate with state types, node functions, edges, and compilation.
- **Learning curve.** Graphs, reducers, channels, supersteps, annotations — that's a lot of concepts before you can write your first agent.
- **Ecosystem coupling.** LangGraph 1.0 tightened integration with LangChain (deprecating `langgraph.prebuilt` in favor of `langchain.agents`). Dependency conflicts are a recurring practitioner complaint.
- **Security.** A critical RCE vulnerability in checkpoint serialization was discovered in early 2026.
- **The Functional API admission.** LangGraph added `@entrypoint`/`@task` decorators — essentially admitting that not everything needs to be a graph. When the framework adds a way to bypass its own core abstraction, that tells you something.

---

## Paradigm 2: Role-Based Teams (CrewAI)

### The Mental Model

CrewAI models multi-agent systems as **teams of people**. Each agent has a role ("Senior Researcher"), a goal ("Find cutting-edge developments"), and a backstory that shapes its personality. You assign tasks to agents, organize them into crews, and kick off execution. The framework handles the ReAct loop internally — you configure the team, it runs the mission.

```
┌─────────────────────────────────────────────────┐
│              CrewAI Content Pipeline              │
│                                                  │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│  │Researcher│──►│  Writer  │──►│  Editor  │    │
│  │          │   │          │   │          │    │
│  │role:     │   │role:     │   │role:     │    │
│  │"Senior   │   │"Content  │   │"Quality  │    │
│  │ Researcher"│ │ Writer"  │   │ Editor"  │    │
│  └──────────┘   └──────────┘   └──────────┘    │
│                                                  │
│  Process: sequential (or hierarchical)           │
│  Each agent runs its own ReAct loop internally   │
└─────────────────────────────────────────────────┘
```

### The Same ReAct Agent — CrewAI

```python
from crewai import Agent, Task, Crew, Process
from crewai.tools import tool

# Tool definition
@tool("Search")
def search_tool(query: str) -> str:
    """Search the web for information."""
    return f"Results for: {query}"

# Agent — role + goal + backstory replace our system prompt
researcher = Agent(
    role="Research Assistant",
    goal="Find accurate, up-to-date information on any topic",
    backstory="Meticulous researcher who always verifies facts",
    tools=[search_tool],
    verbose=True,
    max_iter=10,  # Equivalent to max iterations in a ReAct loop
)

# Task — the work to be done
research_task = Task(
    description="Research the latest developments in {topic}",
    expected_output="A comprehensive summary with key findings",
    agent=researcher,
)

# Crew — the runner
crew = Crew(
    agents=[researcher],
    tasks=[research_task],
    process=Process.sequential,
)

result = crew.kickoff(inputs={"topic": "quantum computing"})
```

Or even simpler — skip the Crew entirely:

```python
result = researcher.kickoff("What are the latest AI developments?")
```

### Core Primitives

| Primitive                            | What It Does                       | Maps to This Repo                                     |
| ------------------------------------ | ---------------------------------- | ----------------------------------------------------- |
| Agent (role/goal/backstory)          | Defines personality and capability | System prompt in `src/react/agent.ts`                 |
| Task (description/expected_output)   | Specific assignment for an agent   | User message                                          |
| Crew (agents/tasks/process)          | Orchestrates execution             | `runAgent()` + the readline loop in `index.ts`        |
| Process (sequential/hierarchical)    | Execution strategy                 | Sequential = our pipeline; hierarchical = manager LLM |
| Flows (`@start`/`@listen`/`@router`) | Event-driven orchestration layer   | Nothing directly — closest to our state graph         |
| Tools (`@tool` decorator)            | Tool definitions                   | `tools` array in `tools.ts`                           |

### Flows: CrewAI's Answer to Production

Flows are CrewAI's newer orchestration layer, designed to bridge the gap between "working demo" and "production system." They provide event-driven control with Python decorators:

```python
from crewai.flow.flow import Flow, start, listen, router

class ContentFlow(Flow):
    @start()
    def research(self):
        crew = ResearchCrew()
        result = crew.crew().kickoff(inputs={"topic": "AI agents"})
        self.state["research"] = result.raw

    @listen(research)
    def write(self):
        crew = WritingCrew()
        return crew.crew().kickoff(inputs={"research": self.state["research"]})

    @router(write)
    def quality_check(self, result):
        if result.quality_score > 0.8:
            return "publish"
        return "revise"

    @listen("publish")
    def publish(self):
        pass

    @listen("revise")
    def send_for_revision(self):
        pass
```

Flows separate deterministic orchestration (which step runs when) from probabilistic intelligence (what the LLM does within each step). This is the architecture pattern behind CrewAI's most successful deployments.

### What Makes CrewAI Appealing

**Speed to prototype.** The role/task/crew abstraction maps to how people think about teams. Non-technical stakeholders can read the YAML config and understand what's happening. Multiple sources report CrewAI is 5-6x faster to deploy than LangGraph for structured tasks.

**The team metaphor works.** Content pipelines (researcher → writer → editor), business workflows, and any scenario where you'd describe the solution as "I'd have someone research this, then someone write it up" — CrewAI's abstractions fit naturally.

**Enterprise traction.** 60% of Fortune 500 reportedly use CrewAI. $18M Series A. PwC, IBM, NVIDIA among customers. 2B+ agentic automations.

### What Breaks in Practice

**Hierarchical process is unreliable.** The manager agent that's supposed to coordinate workers doesn't truly delegate — tasks execute sequentially regardless. Manager hallucinations derail entire workflows. Community forums ask "does hierarchical process even work?" Multiple `DelegateWorkToolSchema` type validation errors reported.

**Token consumption spirals.** A devastating bug (GitHub #3836) caused 138K+ tokens per interaction with Anthropic models — $1+ per call instead of $0.10. Stop sequences weren't passed correctly, causing the model to generate entire multi-turn conversations in a single response. Even without bugs, agents get into infinite loops that `max_iter` can't always prevent.

**Debugging is opaque.** CrewAI's abstractions hide what agents actually decide. One practitioner comparison found "CrewAI logs are readable but hide what the LLM actually decided." Another described debugging as "spelunking without a headlamp." Understanding _why_ an agent took a specific path "often requires intuition rather than systematic analysis."

**Tasks freeze.** GitHub issue #2997 reports crews getting stuck on tasks as "THINKING" with no identified pattern and no reliable workaround.

**Python only.** No TypeScript or JavaScript support. This is a non-starter for teams in the JavaScript ecosystem.

### The "Prototype with CrewAI, Productionize with LangGraph" Pattern

This maturity path is well-documented. The ZenML blog explicitly names it. LangGraph even provides **official integration guides for wrapping CrewAI agents within LangGraph nodes** — combining CrewAI's role-based ergonomics with LangGraph's persistence and HITL capabilities.

The pattern is real, though not universal. For workflows that naturally map to role-based teams (content pipelines, research crews), CrewAI's enterprise features may be sufficient for production. But when you need complex branching, fine-grained state control, or step-level debugging, the migration to LangGraph is the common path.

---

## Paradigm 3: Conversation-Driven (AutoGen / AG2)

### The Mental Model

AutoGen's core insight is that **complex workflows can be simplified as multi-agent conversations.** Agents are computational units. Messages are data flows. Multi-agent interaction produces emergent behavior. You define agents with specific capabilities, put them in a group chat, and let an LLM pick who speaks next based on the conversation context.

```
┌─────────────────────────────────────────────────┐
│           AutoGen Group Chat                     │
│                                                  │
│          ┌─── Planner Agent                      │
│          │                                       │
│  Manager ├─── Executor Agent                     │
│  (LLM    │                                       │
│  picks   └─── Reviewer Agent                     │
│  speaker)                                        │
│                                                  │
│  All agents share a single conversation thread   │
│  Speaker selection: auto (LLM), round_robin,     │
│  random, manual, or custom function              │
└─────────────────────────────────────────────────┘
```

### The Same ReAct Agent — AutoGen (0.4 / AgentChat)

```python
from autogen_agentchat.agents import AssistantAgent
from autogen_ext.models.openai import OpenAIChatCompletionClient

client = OpenAIChatCompletionClient(model="gpt-4o")

def search(query: str) -> str:
    """Search the web for information."""
    return f"Results for: {query}"

agent = AssistantAgent(
    name="researcher",
    model_client=client,
    system_message="You are a helpful research assistant.",
    tools=[search],
)

result = await agent.run(task="What are the latest AI developments?")
```

### Multi-Agent Group Chat

Where AutoGen's paradigm really shows up:

```python
from autogen_agentchat.teams import SelectorGroupChat
from autogen_agentchat.conditions import TextMentionTermination

planner = AssistantAgent("planner", model_client=client,
    system_message="Create step-by-step plans for tasks.")
executor = AssistantAgent("executor", model_client=client,
    system_message="Execute plans step by step.")
reviewer = AssistantAgent("reviewer", model_client=client,
    system_message="Review results. Say TERMINATE when satisfied.")

team = SelectorGroupChat(
    participants=[planner, executor, reviewer],
    model_client=client,
    termination_condition=TextMentionTermination("TERMINATE"),
)

result = await team.run(task="Build a REST API design for a todo app")
```

The LLM-based speaker selection is the distinctive feature: the `SelectorGroupChat` uses a separate LLM call to analyze the conversation history and each agent's `name`/`description` to decide who speaks next. This is genuinely novel — computation emerges from the conversation itself.

### GraphFlow: AutoGen's Graph Addition

AutoGen 0.4 added explicit graph-based orchestration, acknowledging that pure conversation isn't always enough:

```python
from autogen_agentchat.teams import GraphFlow, DiGraphBuilder

builder = DiGraphBuilder()
builder.add_node(researcher).add_node(writer).add_node(editor)
builder.add_edge(researcher, writer)
builder.add_edge(writer, editor)
builder.add_edge(editor, writer, condition="REVISE")  # Loop back

flow = GraphFlow(
    participants=[researcher, writer, editor],
    graph=builder.build(),
    termination_condition=MaxMessageTermination(20),
)
```

GraphFlow is marked **experimental** and is already superseded by the Workflow API in Microsoft Agent Framework.

### The AutoGen Fragmentation: A Cautionary Tale

This is the most important lesson from AutoGen's story — not the technology, but the governance failure.

**The timeline:**

| Date          | Event                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Aug 2023**  | AutoGen paper published by Microsoft Research. "Conversation-as-computation" is a breakthrough                               |
| **2023-2024** | Rapid growth. ~55K GitHub stars. Massive community                                                                           |
| **Sep 2024**  | Original creators (Chi Wang, Qingyun Wu) depart Microsoft                                                                    |
| **Nov 2024**  | Departing team forks to **AG2**. Takes control of the `autogen` and `pyautogen` PyPI packages AND the Discord (20K+ members) |
| **Nov 2024**  | Microsoft releases **AutoGen 0.4** — a complete rewrite. Async actor model, new API, NOT backward compatible                 |
| **Oct 2025**  | Microsoft announces **Microsoft Agent Framework** — merging AutoGen 0.4 + Semantic Kernel. AutoGen enters maintenance mode   |
| **Mar 2026**  | Four competing projects exist simultaneously                                                                                 |

**The result — four things called "AutoGen":**

| Project                   | Repository                       | Status              | Downloads             |
| ------------------------- | -------------------------------- | ------------------- | --------------------- |
| AutoGen 0.2 (legacy)      | `microsoft/autogen` (0.2 branch) | Maintenance only    | Via `pyautogen` (AG2) |
| AutoGen 0.4+              | `microsoft/autogen` (main)       | Maintenance mode    | ~505K/mo              |
| AG2                       | `ag2ai/ag2`                      | Active development  | ~491K/mo              |
| Microsoft Agent Framework | `microsoft/agent-framework`      | Public preview → GA | Pre-release           |

**The practitioner impact:** Users genuinely could not determine which repo to use. GitHub Discussion #4216 ("Which autogen is the official") has conflicting guidance from both Microsoft and AG2 maintainers in the same thread. LLM coding assistants mix code from incompatible versions. Five distinct PyPI packages exist. Most tutorials are for 0.2 and are useless for 0.4.

The Softmax Data framework guide puts it bluntly: "AG2 is not production-ready for most enterprise use cases... If someone tells you to deploy it in production for a customer-facing application, we'd push back hard on that recommendation."

**The lesson for framework selection:** Even the most popular framework (55K stars) can fracture. Governance stability matters as much as features. The 55K stars were earned by one team and codebase; what exists now is four different teams maintaining four incompatible versions.

---

## Your ReAct Agent — Three Frameworks Compared

You built this loop in [Chapter 1](../react/README.md):

```typescript
// src/react/agent.ts — the raw loop
while (true) {
  const response = await callLLM(history, tools);
  history.push(response);
  if (!response.tool_calls?.length) break;
  for (const call of response.tool_calls) {
    const result = await executeTool(call);
    history.push({ role: "tool", content: result });
  }
}
```

Here's how each framework expresses the same logic:

| Aspect               | Raw Loop (This Repo)     | LangGraph                              | CrewAI                                 | AutoGen 0.4                            |
| -------------------- | ------------------------ | -------------------------------------- | -------------------------------------- | -------------------------------------- |
| **Lines of code**    | ~10                      | ~25                                    | ~20                                    | ~10                                    |
| **The loop**         | Explicit `while(true)`   | Graph cycle: llm → tools → llm         | Hidden inside Agent class              | Hidden inside `agent.run()`            |
| **Tool definitions** | JSON schema objects      | `@tool` decorator + Pydantic           | `@tool` decorator + Pydantic           | Python functions with type hints       |
| **System prompt**    | String                   | String                                 | role + goal + backstory                | `system_message` string                |
| **State**            | `Message[]` array        | `MessagesState` TypedDict with reducer | Implicit in conversation history       | `TaskResult` with messages             |
| **Routing**          | `if (!tool_calls) break` | Conditional edge function              | Crew process (sequential/hierarchical) | `SelectorGroupChat` with LLM selection |
| **Checkpointing**    | None                     | Automatic                              | None (opt-in `@persist` for Flows)     | Via Agent Framework                    |
| **HITL**             | Build it yourself        | `interrupt()` at any node              | `human_input=True` on Task             | Planned in Agent Framework             |
| **Language**         | TypeScript               | Python + TypeScript                    | Python only                            | Python (.NET via Agent Framework)      |

The raw loop is the simplest and gives you the most control. Each framework adds capabilities at the cost of abstraction. The question is whether those capabilities justify the abstraction for your specific use case.

---

## Head-to-Head: The Decision Matrix

### When to Use Each

| If you need...                      | Use...                        | Because...                                |
| ----------------------------------- | ----------------------------- | ----------------------------------------- |
| Quickest working prototype          | **CrewAI**                    | YAML config, role-based, working in hours |
| Production debugging                | **LangGraph**                 | Full state inspection at every node       |
| Token efficiency                    | **LangGraph** or **raw loop** | Graph reduces redundant context passing   |
| Human-in-the-loop                   | **LangGraph**                 | Built-in checkpoints and interrupts       |
| Role-based team workflows           | **CrewAI**                    | Natural organizational metaphor           |
| Complex branching logic             | **LangGraph**                 | Graph-based conditional routing           |
| TypeScript support                  | **LangGraph**                 | Only orchestration framework with JS/TS   |
| Microsoft ecosystem                 | **Agent Framework**           | AutoGen successor, Azure integration      |
| Maximum control                     | **Raw loop**                  | 10-50 lines, full transparency            |
| Conversational multi-agent research | **AG2**                       | Stable 0.2 API, GroupChat experimentation |

### The Feature Comparison

| Feature                 | LangGraph                             | CrewAI                        | AutoGen / AG2                           |
| ----------------------- | ------------------------------------- | ----------------------------- | --------------------------------------- |
| **Mental model**        | State graph                           | Team of agents                | Multi-agent conversation                |
| **Learning curve**      | Steep                                 | Gentle                        | Moderate (fragmentation adds confusion) |
| **Language**            | Python + TypeScript                   | Python only                   | Python                                  |
| **Checkpointing**       | First-class, every node               | Limited (`@persist` on Flows) | Via Agent Framework                     |
| **Human-in-the-loop**   | `interrupt()` + `Command(resume=)`    | `human_input=True` on Task    | Planned                                 |
| **Streaming**           | 6 built-in modes                      | Supported (v1.6+)             | Supported                               |
| **Debugging**           | LangSmith, state at every node        | Opaque abstractions           | Conversation logs                       |
| **Multi-agent**         | Sub-graphs, supervisor, swarm         | Crews with process types      | GroupChat, GraphFlow                    |
| **PyPI downloads/mo**   | ~36.6M                                | ~2M                           | ~505K (Microsoft)                       |
| **GitHub stars**        | 25.4K                                 | ~45K                          | ~55K (inflated — pre-fork)              |
| **Commercial**          | LangSmith / LangGraph Platform        | CrewAI+ / AMP                 | Azure integration                       |
| **Stability guarantee** | 1.0 GA, no breaking changes until 2.0 | 1.0 GA (2025)                 | Fragmented — 4 projects                 |

### Enterprise Adoption Patterns

| Industry / Use Case               | Preferred Framework | Why                                                       |
| --------------------------------- | ------------------- | --------------------------------------------------------- |
| Financial services (audit trails) | LangGraph           | Strict state tracking, node-by-node debugging             |
| Business workflow automation      | CrewAI              | Role-based model maps to org structures                   |
| Developer tools                   | LangGraph           | Production durability, complex branching                  |
| Microsoft / Azure shops           | Agent Framework     | Ecosystem alignment, Semantic Kernel migration            |
| Research / academia               | AG2                 | Conversational multi-agent experimentation                |
| Rapid prototyping / POC           | CrewAI              | Fastest time-to-working-demo                              |
| Content pipelines                 | CrewAI              | Natural role decomposition (researcher → writer → editor) |

---

## The No-Framework Argument

The strongest voice against frameworks comes from Anthropic's "Building Effective Agents" guide:

> "The most successful implementations weren't using complex frameworks or specialized libraries. Instead, they were building with simple, composable patterns."

> "Frameworks often create extra layers of abstraction that can obscure the underlying prompts and responses, making them harder to debug."

Harrison Chase (LangGraph creator) agrees on one crucial point: "Any framework that makes it harder to control exactly what is being passed to the LLM is just getting in your way."

The Hacker News thread "Why We No Longer Use LangChain" has developers who "successfully built complete systems in 80-150 lines of code." One described LangChain as the "Javafication of Python" — enterprise-level over-engineering for a problem solved by a loop and some API calls.

**The 2026 consensus:** Start with raw APIs. Recognize that production agents need infrastructure — but build it incrementally. An agent is "just a loop with some tools and an LLM" that can be built in about 20 lines of code. The right sequence:

1. Raw tool loop (what this repo teaches)
2. Add patterns incrementally (what this repo's concepts cover)
3. Adopt a framework **only when you demonstrably need its specific production features** (checkpointing, HITL, durable execution)

---

## In the Wild: Coding Agent Harnesses

Here's a fact that should reshape how you think about orchestration frameworks: **not a single production coding agent harness uses LangGraph, CrewAI, or AutoGen.**

| Harness          | Agent Loop                               | Framework Used                |
| ---------------- | ---------------------------------------- | ----------------------------- |
| Claude Code      | Custom `while(true)` loop                | None — Anthropic SDK directly |
| Aider            | Custom loop + LiteLLM                    | None                          |
| Cursor           | Custom Composer model + orchestration    | None                          |
| OpenCode         | Custom loop + Vercel AI SDK              | None                          |
| Codex CLI        | Custom Rust agent loop                   | None                          |
| Cline / Roo Code | Custom `recursivelyMakeClaudeRequests()` | None                          |
| GitHub Copilot   | Custom dual-model architecture           | None                          |
| Devin            | Custom cloud-based planning + execution  | None                          |

This was verified by checking actual dependency files (`package.json`, `pyproject.toml`, source code) for every open-source harness and reviewing architecture documentation for closed-source ones.

### Why Harnesses Skip Frameworks

**The loop is trivial; the infrastructure is hard.** Claude Code's core loop is reportedly ~50 lines. The engineering effort goes into git integration, file editing strategies, terminal sandboxing, context management, permission systems, and UI — none of which any framework provides.

**Control is non-negotiable.** Harnesses need fine-grained control over streaming, tool dispatch timing, error recovery, and UI updates. Framework abstractions interfere with this.

**Domain specificity dominates.** Coding agents are hyper-specialized for code editing, terminal execution, and git workflows. General-purpose orchestration frameworks solve a broader problem poorly.

### How Harnesses Map to Framework Paradigms

Even though harnesses don't use frameworks, they implement similar patterns:

| Framework Paradigm                   | Harness Usage                                                                         | Best Example                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Graph-based routing** (LangGraph)  | Absent in pure form. State machines used for lifecycle tracking, not workflow routing | OpenCode's two-level state machines                   |
| **Role-based teams** (CrewAI)        | Partial. Role specialization exists but without collaboration protocols               | Aider's Architect/Editor split, Cursor's agent types  |
| **Conversation-driven** (AutoGen)    | Absent. Too expensive (tokens per turn) and too unpredictable                         | None                                                  |
| **Orchestrator-workers** (Anthropic) | Most common pattern                                                                   | Claude Code's Task tool (up to 10 sub-agents)         |
| **Sequential pipeline**              | Common for reasoning/editing splits                                                   | Aider Architect → Editor, Windsurf planner → executor |

The most interesting observation: **the orchestrator-workers pattern** (not represented by any of the three frameworks) is the dominant multi-agent pattern in production harnesses. Claude Code spawns up to 10 isolated sub-agents. Cursor runs up to 8 parallel agents with git worktree isolation. These are hierarchical task delegation, not graphs, teams, or conversations.

### The Real Relationship

```
Generic Framework (LangGraph, CrewAI, AutoGen)
  provides: agent loop, tool registry, state management, multi-agent patterns
  missing:  domain tools, UI, safety, recovery, custom protocols

Production Harness (Claude Code, Aider, Codex)
  = Custom loop + domain tools + UI + safety + recovery + custom protocols
  = A "vertical framework" built from scratch for one domain
```

Harnesses are what you get when you merge framework abstractions with deep domain knowledge, accepting the cost of building from scratch in exchange for total control. For production-critical, domain-specific agents, the evidence is clear: the framework abstraction layer is net-negative.

---

## Key Takeaways

1. **LangGraph is the production choice** when you need checkpointing, human-in-the-loop, or complex stateful workflows. Its graph model is explicit, debuggable, and the only orchestration framework with TypeScript support. The tradeoff is complexity — you'll write more boilerplate than a raw loop.

2. **CrewAI is the prototyping choice** when you need a working multi-agent system fast. The team metaphor is intuitive, the learning curve is gentle, and you'll be productive in hours. The tradeoff is opacity — when things break, debugging is painful, and production reliability requires the Flows layer.

3. **AutoGen is a cautionary tale.** The "conversation-as-computation" paradigm was genuinely innovative, but governance failures fragmented the project into four competing versions. For new projects, the Microsoft Agent Framework is the successor. The lesson: framework choice should weigh governance stability, not just features.

4. **"Prototype with CrewAI, productionize with LangGraph"** is a real and documented pattern. LangGraph even provides official integration guides for wrapping CrewAI agents within LangGraph nodes. But it's not universal — evaluate whether your workflow actually needs the migration.

5. **The no-framework path is underrated.** Every production coding agent harness builds from scratch. Anthropic explicitly recommends raw APIs over frameworks. A `while(true)` loop with some tools is 10-50 lines of code and gives you total control. Frameworks earn their place only when you demonstrably need their production infrastructure.

6. **Downloads tell a truer story than stars.** LangGraph: 36.6M downloads/mo. CrewAI: 2M. AutoGen: 505K. Stars can be inflated by hype, forks, and historical momentum. Downloads reflect actual usage.

---

## Sources & Further Reading

### Official Documentation

- [LangGraph Documentation](https://docs.langchain.com/oss/python/langgraph/overview)
- [LangGraph.js (TypeScript)](https://github.com/langchain-ai/langgraphjs)
- [CrewAI Documentation](https://docs.crewai.com/)
- [AutoGen Documentation](https://microsoft.github.io/autogen/stable/)
- [AG2 GitHub](https://github.com/ag2ai/ag2)
- [Microsoft Agent Framework](https://github.com/microsoft/agent-framework)

### Architecture & Design

- [How to Think About Agent Frameworks — LangChain Blog](https://blog.langchain.com/how-to-think-about-agent-frameworks/)
- [Building LangGraph: Designing an Agent Runtime from First Principles](https://blog.langchain.com/building-langgraph/)
- [What is a Cognitive Architecture? — LangChain Blog](https://blog.langchain.com/what-is-a-cognitive-architecture/)
- [Lessons from 2 Billion Agentic Workflows — CrewAI Blog](https://blog.crewai.com/lessons-from-2-billion-agentic-workflows/)
- [AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation (arXiv 2308.08155)](https://arxiv.org/abs/2308.08155)

### Comparisons & Practitioner Experiences

- [A Production Engineer's Honest Comparison — Python in Plain English](https://python.plainenglish.io/autogen-vs-langgraph-vs-crewai-a-production-engineers-honest-comparison-d557b3b9262c)
- [CrewAI vs LangGraph — TrueFoundry](https://www.truefoundry.com/blog/crewai-vs-langgraph)
- [LangGraph vs CrewAI — ZenML](https://www.zenml.io/blog/langgraph-vs-crewai)
- [What is CrewAI? — IBM](https://www.ibm.com/think/topics/crew-ai)
- [Microsoft AutoGen Has Split in 2... Wait 3... No, 4 Parts — DEV Community](https://dev.to/maximsaplin/microsoft-autogen-has-split-in-2-wait-3-no-4-parts-2p58)
- [Definitive Guide to Agentic Frameworks in 2026 — Softmax Data](https://blog.softmaxdata.com/definitive-guide-to-agentic-frameworks-in-2026-langgraph-crewai-ag2-openai-and-more/)

### The No-Framework Perspective

- [Building Effective Agents — Anthropic](https://www.anthropic.com/research/building-effective-agents)
- [Why We No Longer Use LangChain — Hacker News](https://news.ycombinator.com/item?id=40739982)
- [Why LangGraph Overcomplicates AI Agents — Vitalii Honchar](https://www.vitaliihonchar.com/insights/go-ai-agent-library)

### Harness Engineering

- [Effective Harnesses for Long-Running Agents — Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Harness Engineering: Leveraging Codex — OpenAI](https://openai.com/index/harness-engineering/)
- [Harness Engineering — Martin Fowler](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html)

### Papers

- [Pregel: A System for Large-Scale Graph Processing (SIGMOD 2010)](https://dl.acm.org/doi/10.1145/1807167.1807184)
- [StateFlow: Enhancing LLM Task-Solving through State-Driven Workflows (arXiv 2403.11322)](https://arxiv.org/abs/2403.11322)

---

[Agent Patterns — TypeScript](../../README.md)
