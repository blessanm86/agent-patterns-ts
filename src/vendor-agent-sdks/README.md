# Vendor Agent SDKs: Three Philosophies of Agent Building

You've built a ReAct loop from scratch. You've wired up tools, managed context, added guardrails, streamed tokens, and delegated to sub-agents. Now the model providers want you to use _their_ SDK to do the same thing — but each one packages the `while(true)` loop differently, bundles different tools, and makes different tradeoffs about how much you should own versus how much they should own.

This guide compares the three major vendor agent SDKs — **Claude Agent SDK** (Anthropic), **OpenAI Agents SDK** (OpenAI), and **Google ADK** (Google) — head-to-head across every dimension that matters. It shows real code from all three for the same task, maps their primitives back to patterns you've already built in this repo, and gives you a decision framework for choosing — or not choosing — one.

The fundamental architectural split: **full runtime** (Claude) vs. **thin orchestration** (OpenAI) vs. **enterprise platform** (Google). Same `while(true)` loop inside. Completely different opinions about what surrounds it.

---

## The Three Philosophies

Before diving into specifics, understand what each SDK _is_:

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  Claude Agent SDK          OpenAI Agents SDK         Google ADK      │
│  ─────────────────         ──────────────────        ──────────      │
│                                                                      │
│  "Claude Code              "Four primitives,          "Enterprise    │
│   as a library"             you bring the rest"        multi-agent   │
│                                                        platform"     │
│  Ships a full CLI          Agents + Handoffs +        LLM Agents +  │
│  binary with 14+           Guardrails + Tracing.      Workflow       │
│  built-in tools.           Python functions            Agents +      │
│  You configure.            become tools.               60+ pre-built │
│  It executes.              You implement.              integrations. │
│                                                        You compose.  │
│  Subprocess arch.          Pure library.               Event-driven  │
│  JSON lines over           Direct API calls.           runtime.      │
│  stdin/stdout.             No subprocess.              Runner +      │
│                                                        Sessions.     │
│                                                                      │
│  Thickest ──────────────── Thinnest ──────────────── In Between     │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Claude Agent SDK** is the thickest runtime in the ecosystem. It bundles the entire Claude Code CLI as a subprocess — the same runtime that powers the coding agent responsible for 4% of public GitHub commits. When you call `query()`, you're not making API calls. You're spawning a process that makes API calls, runs tools, manages context, and reports back via a stream of typed messages. You configure what it can do. It decides how to do it.

**OpenAI Agents SDK** is deliberately minimal. Born from the experimental Swarm project, it provides four primitives — Agents, Handoffs, Guardrails, Tracing — and stays out of the way. Functions become tools via a decorator. Agents hand off conversations to other agents. The SDK handles the loop; you handle everything else.

**Google ADK** splits the difference. It has LLM-powered agents for reasoning _and_ deterministic workflow agents (Sequential, Parallel, Loop) for structured orchestration. It ships 60+ pre-built integrations, a built-in evaluation framework, managed deployment to Vertex AI, and native A2A protocol support. It's the enterprise play.

---

## Architecture Deep Dive

### Claude Agent SDK: The Subprocess Runtime

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
│  │  Agent Loop (TAOR)   │ │  Think → Act → Observe → Repeat
│  ├─────────────────────┤ │
│  │  Built-in Tools      │ │  Read, Write, Edit, Bash, Glob,
│  │  (14+ tools)         │ │  Grep, WebSearch, WebFetch, Task...
│  ├─────────────────────┤ │
│  │  Context Compaction  │ │  Auto-summarizes near token limits
│  ├─────────────────────┤ │
│  │  Hooks (18 events)   │ │  PreToolUse, PostToolUse, Stop...
│  ├─────────────────────┤ │
│  │  Permission Engine   │ │  Hooks → Rules → Modes → Callback
│  └─────────────────────┘ │
│                           │
│  stdin ◄──── JSON lines ────► stdout
└──────────────────────────┘
```

The critical architectural detail: **the SDK is not a library that makes API calls**. It bundles the Claude Code CLI binary inside the npm/pip package and spawns it as a subprocess. Communication happens over stdin/stdout via a JSON lines protocol. Each `query()` call manages a process, not a connection.

This is not a typical SDK pattern. It means:

- Every tool (`Read`, `Bash`, `Edit`) runs inside the subprocess — you never implement them
- Context compaction happens automatically as the conversation grows
- The 18-hook event system lets you intercept, block, or modify tool calls before/after execution
- But bundlers (Bun, webpack) can break the binary path resolution, and each query spawns a process

**Entry point — `query()`:**

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Find all TODO comments in this codebase and create a summary",
  options: {
    model: "claude-sonnet-4-6",
    allowedTools: ["Read", "Glob", "Grep", "Write"],
    maxBudgetUsd: 1.0,
    permissionMode: "default",
    hooks: {
      PreToolUse: [
        {
          matcher: "Write",
          hooks: [
            (input) => {
              if (input.tool_input.file_path?.includes(".env"))
                return { decision: "block", reason: "Cannot modify .env files" };
              return { decision: "approve" };
            },
          ],
        },
      ],
    },
  },
})) {
  if (message.type === "assistant") {
    // Claude's text responses and tool invocations
    console.log(message.content);
  }
  if (message.type === "result") {
    // Final result with cost tracking
    console.log(`Cost: $${message.total_cost_usd}, Turns: ${message.num_turns}`);
  }
}
```

The `query()` function returns an async generator yielding an `SDKMessage` union with 18+ message types — assistant messages, system messages, result messages, hook events, subagent notifications, rate limit events, and more. You consume the stream and react to the types you care about.

**Key primitives:**

| Primitive            | What it does                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query()`            | Spawns agent, returns message stream                                                                                                                              |
| Built-in tools (14+) | Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task, AskUserQuestion, NotebookEdit, EnterWorktree, TodoWrite, TaskOutput                               |
| Hooks (18 events)    | PreToolUse, PostToolUse, PostToolUseFailure, Notification, Stop, SubagentStart, SubagentStop, PreCompact, PermissionRequest, SessionStart, SessionEnd, and 7 more |
| Subagents            | Via `Task` tool — isolated context, own tools, own model, background execution                                                                                    |
| Sessions             | Capture session_id, resume/fork conversations                                                                                                                     |
| MCP servers          | stdio, SSE, HTTP, in-process SDK servers                                                                                                                          |
| Permission modes     | default, acceptEdits, bypassPermissions, plan, dontAsk                                                                                                            |

### OpenAI Agents SDK: The Four-Primitive Orchestrator

```
Your Code
    │
    ▼
Runner.run(agent, input)
    │
    ▼
┌───────────────────────────┐
│  Agent Loop (Runner)       │
│                            │
│  1. LLM call with          │
│     instructions + tools   │
│  2. Response:              │
│     ├── Final output → END │
│     ├── Tool calls →       │
│     │   execute + loop     │
│     └── Handoff →          │
│         switch agent +     │
│         loop               │
│  3. Max turns check        │
│                            │
│  ┌── Input Guardrails ──┐ │  (parallel or blocking)
│  ├── Output Guardrails ─┤ │  (after final output)
│  ├── Tracing (auto) ────┤ │  (agent, LLM, tool, handoff spans)
│  └── Context (DI) ──────┘ │  (RunContextWrapper[T])
└───────────────────────────┘
```

The OpenAI Agents SDK is a pure library — no subprocess, no binary bundling. `Runner.run()` makes API calls, executes your tool functions, processes handoffs, and returns a `RunResult`. The loop is the same `while(true)` you built in `src/react/agent.ts`, wrapped in a class.

**Entry point — `Runner.run()`:**

```python
from agents import Agent, Runner, function_tool, input_guardrail, GuardrailFunctionOutput

@function_tool
async def search_codebase(query: str, file_pattern: str = "**/*") -> str:
    """Search the codebase for files matching a pattern and content query."""
    # You implement this — the SDK just calls it
    results = await do_search(query, file_pattern)
    return results

@input_guardrail
async def safety_check(ctx, agent, input):
    result = await Runner.run(check_agent, input, context=ctx.context)
    return GuardrailFunctionOutput(
        tripwire_triggered=result.final_output.is_unsafe
    )

agent = Agent(
    name="Code Analyzer",
    instructions="You analyze codebases. Find TODO comments and create summaries.",
    tools=[search_codebase],
    input_guardrails=[safety_check],
    model="gpt-4.1",
)

result = await Runner.run(agent, "Find all TODO comments and create a summary")
print(result.final_output)
```

Notice the difference. With Claude Agent SDK, you say "use the Glob and Grep tools" — and they exist. With OpenAI Agents SDK, you define `search_codebase` yourself. The SDK generates the JSON schema from your type hints and docstring, then calls your function when the model selects it.

**Key primitives:**

| Primitive              | What it does                                                  |
| ---------------------- | ------------------------------------------------------------- |
| `Agent`                | LLM + instructions + tools + handoffs + guardrails            |
| `Runner.run()`         | Executes the agent loop, returns `RunResult`                  |
| `@function_tool`       | Turns any function into a tool (auto-schema from types)       |
| Handoffs               | Transfer conversation to another agent (`transfer_to_<name>`) |
| Guardrails             | Input/output validation with tripwire pattern                 |
| Tracing                | Automatic spans for agents, LLM calls, tools, guardrails      |
| `RunContextWrapper[T]` | Typed dependency injection (not sent to LLM)                  |
| Sessions (8 types)     | SQLite, Redis, SQLAlchemy, encrypted, compaction              |
| `agent.as_tool()`      | Use an agent as a tool (manager retains control)              |

### Google ADK: The Enterprise Multi-Agent Platform

```
Your Code
    │
    ▼
Runner(agent, app_name, session_service)
    │
    ▼
┌───────────────────────────────────┐
│  Event-Driven Runtime              │
│                                    │
│  ┌── LLM Agents ──────────────┐  │
│  │  Gemini/Claude/LLaMA        │  │  LLM-powered reasoning
│  │  + tools + sub_agents        │  │
│  │  + output_key                │  │
│  ├── Workflow Agents ──────────┤  │
│  │  SequentialAgent             │  │  Deterministic orchestration
│  │  ParallelAgent               │  │
│  │  LoopAgent                   │  │
│  ├── Session + State ──────────┤  │
│  │  app: / user: / temp: /     │  │  Scoped state prefixes
│  │  InMemory / Database /      │  │
│  │  VertexAI                    │  │
│  ├── Events + EventActions ────┤  │
│  │  state_delta, artifact_delta │  │  Every action produces an Event
│  │  escalate, transfer_to_agent │  │
│  ├── A2A Protocol ─────────────┤  │
│  │  A2AServer / RemoteA2aAgent  │  │  Cross-network agent comms
│  └─────────────────────────────┘  │
└───────────────────────────────────┘
```

Google ADK introduces an event-driven runtime where every action — tool call, agent response, state change — produces an `Event` with associated `EventActions`. This is fundamentally different from both Claude's subprocess model and OpenAI's loop-and-return model.

The distinguishing feature is **workflow agents** as first-class primitives. Instead of relying on the LLM to orchestrate multiple agents (error-prone, expensive), ADK lets you compose deterministic orchestration patterns — sequential pipelines, parallel fan-outs, iterative loops — that wrap LLM agents.

```python
from google.adk import Agent, SequentialAgent, ParallelAgent, Runner
from google.adk.sessions import InMemorySessionService

# LLM agents for reasoning
scanner = Agent(
    name="TodoScanner",
    model="gemini-2.5-flash",
    instruction="Search the codebase for TODO comments. Return each with file path and line.",
    tools=[search_files],
    output_key="todos"
)

categorizer = Agent(
    name="Categorizer",
    model="gemini-2.5-flash",
    instruction="Categorize these TODOs by priority: {todos}",
    output_key="categorized"
)

summarizer = Agent(
    name="Summarizer",
    model="gemini-2.5-flash",
    instruction="Create a summary report from: {categorized}",
)

# Deterministic pipeline wrapping LLM agents
pipeline = SequentialAgent(
    name="TodoPipeline",
    sub_agents=[scanner, categorizer, summarizer]
)

# Run with session management
session_service = InMemorySessionService()
runner = Runner(agent=pipeline, app_name="todo-app", session_service=session_service)
session = await session_service.create_session(app_name="todo-app", user_id="dev1")

response = await runner.run(user_id="dev1", session_id=session.id, new_message="Analyze the project")
```

**Key primitives:**

| Primitive             | What it does                                                            |
| --------------------- | ----------------------------------------------------------------------- |
| `Agent` (LlmAgent)    | LLM-powered reasoning with tools and sub-agents                         |
| Workflow Agents       | SequentialAgent, ParallelAgent, LoopAgent — deterministic orchestration |
| `Runner`              | Orchestrates agent-session interactions                                 |
| Events + EventActions | Every action produces typed events with state/artifact deltas           |
| State prefixes        | `app:`, `user:`, `temp:`, session-scoped — 4-level state scoping        |
| SessionService        | InMemory, Database, VertexAI backends                                   |
| MemoryService         | Cross-session searchable knowledge                                      |
| AutoFlow              | LLM-driven automatic agent transfer routing                             |
| A2A Protocol          | Cross-network agent-to-agent communication                              |
| 60+ integrations      | Enterprise connectors (Asana, BigQuery, GitHub, Stripe...)              |

---

## Head-to-Head Comparison

### The Agent Loop

All three SDKs implement the same core loop you built in `src/react/agent.ts`:

```
while (true) {
  response = await model.generate(history + tools)
  if (no tool calls) break
  results = await executeTools(toolCalls)
  history.push(results)
}
```

What differs is what _surrounds_ the loop:

| Dimension            | Claude Agent SDK                              | OpenAI Agents SDK                                   | Google ADK                                        |
| -------------------- | --------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| **Loop location**    | Inside CLI subprocess                         | Inside `Runner.run()`                               | Inside `Runner` + event system                    |
| **Loop termination** | No tool calls, or max turns/budget            | Final output matches `output_type`, or max turns    | Agent response without tool calls, or `escalate`  |
| **What you control** | Which tools are available, hooks, permissions | Tool implementations, instructions, handoff targets | Agent graph, workflow orchestration, state schema |
| **Cost tracking**    | Built-in per-query (`total_cost_usd`)         | Via tracing spans                                   | Via Google Cloud monitoring                       |

### Tool Systems

This is where the three SDKs diverge most sharply:

**Claude Agent SDK — tools are built in:**

```typescript
// You DON'T implement Read, Grep, Bash — they exist
const response = query({
  prompt: "Find all TypeScript files with TODO comments",
  options: {
    allowedTools: ["Glob", "Grep", "Read"], // Already implemented
  },
});
```

**OpenAI Agents SDK — you implement tools:**

```python
@function_tool
async def find_todos(file_pattern: str = "**/*.ts") -> str:
    """Find TODO comments in files matching the pattern.

    Args:
        file_pattern: Glob pattern to match files.
    """
    # Your implementation
    files = glob.glob(file_pattern, recursive=True)
    results = []
    for f in files:
        with open(f) as fh:
            for i, line in enumerate(fh, 1):
                if "TODO" in line:
                    results.append(f"{f}:{i}: {line.strip()}")
    return "\n".join(results)

agent = Agent(tools=[find_todos])
```

**Google ADK — function tools with rich context:**

```python
def find_todos(file_pattern: str, tool_context: ToolContext) -> str:
    """Find TODO comments in files matching the pattern."""
    files = glob.glob(file_pattern, recursive=True)
    results = []
    for f in files:
        with open(f) as fh:
            for i, line in enumerate(fh, 1):
                if "TODO" in line:
                    results.append(f"{f}:{i}: {line.strip()}")
    # Save to session state for downstream agents
    tool_context.state["todo_results"] = results
    return "\n".join(results)

agent = Agent(tools=[find_todos])
```

The key differences:

- Claude's tools **run in a sandbox** inside the subprocess — file reads, bash commands, web searches all happen automatically
- OpenAI's `@function_tool` **auto-generates JSON schemas** from Python type hints and docstrings — the schema is inferred, not written
- ADK's `ToolContext` gives tools **rich runtime access** — state management, artifact storage, authentication, agent flow control

### Multi-Agent Patterns

| Pattern                 | Claude Agent SDK                               | OpenAI Agents SDK                           | Google ADK                                 |
| ----------------------- | ---------------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| **Routing**             | Parent spawns subagent via `Task` tool         | Handoffs: `transfer_to_<agent>`             | AutoFlow: LLM-driven `transfer_to_agent()` |
| **Manager/Worker**      | Subagents with isolated context                | `agent.as_tool()` — manager retains control | `AgentTool` — wrap agent as callable tool  |
| **Sequential pipeline** | Not built-in                                   | Chain handoffs                              | `SequentialAgent` (first-class)            |
| **Parallel execution**  | Background subagents (`run_in_background`)     | No built-in parallel                        | `ParallelAgent` (first-class)              |
| **Iteration**           | Agent loop continues until done                | Handoff back to self                        | `LoopAgent` with `max_iterations`          |
| **Max depth**           | Single level (subagents can't spawn subagents) | Unlimited handoff chains                    | Unlimited nesting                          |

**Claude — subagents via `Task` tool:**

```typescript
for await (const message of query({
  prompt: "Review this codebase for security issues and performance problems",
  options: {
    allowedTools: ["Read", "Glob", "Grep", "Task"],
    agents: {
      "security-reviewer": {
        description: "Scans code for security vulnerabilities",
        prompt: "Find injection flaws, auth issues, data exposure risks.",
        tools: ["Read", "Grep", "Glob"],
        model: "sonnet",
      },
      "performance-reviewer": {
        description: "Identifies performance bottlenecks",
        prompt: "Find N+1 queries, unnecessary re-renders, missing indexes.",
        tools: ["Read", "Grep", "Glob"],
        model: "haiku", // Cheaper model for simpler task
      },
    },
  },
}));
```

Claude's parent autonomously decides when to spawn subagents. Each gets an isolated context window, preventing cross-contamination.

**OpenAI — handoffs vs. agents-as-tools:**

```python
# Handoffs: specialist takes over the conversation
security_agent = Agent(name="Security Reviewer", instructions="...")
perf_agent = Agent(name="Performance Reviewer", instructions="...")

triage = Agent(
    name="Triage",
    instructions="Route to the appropriate specialist.",
    handoffs=[security_agent, perf_agent],  # LLM sees transfer_to_Security_Reviewer
)

result = await Runner.run(triage, "Review for security and performance")
# result.last_agent tells you which specialist handled it

# Agents-as-tools: manager retains control, aggregates results
orchestrator = Agent(
    name="Orchestrator",
    instructions="Get both security and performance reviews, then synthesize.",
    tools=[
        security_agent.as_tool(
            tool_name="get_security_review",
            tool_description="Run a security review on the codebase",
        ),
        perf_agent.as_tool(
            tool_name="get_performance_review",
            tool_description="Run a performance review on the codebase",
        ),
    ],
)

result = await Runner.run(orchestrator, "Review for security and performance")
# Orchestrator sees both results, synthesizes final output
```

OpenAI gives you two distinct patterns: **handoffs** (specialist takes over) and **agents-as-tools** (manager retains control). This is the SDK's standout contribution — a clean answer to "who owns the conversation?"

**Google ADK — workflow agents for deterministic orchestration:**

```python
security_agent = Agent(
    name="SecurityReviewer",
    model="gemini-2.5-flash",
    instruction="Find security vulnerabilities.",
    tools=[read_file, search_code],
    output_key="security_findings"
)

perf_agent = Agent(
    name="PerfReviewer",
    model="gemini-2.5-flash",
    instruction="Find performance issues.",
    tools=[read_file, search_code],
    output_key="perf_findings"
)

synthesizer = Agent(
    name="Synthesizer",
    model="gemini-2.5-flash",
    instruction="Combine {security_findings} and {perf_findings} into a report.",
)

# Deterministic: parallel review, then sequential synthesis
review_pipeline = SequentialAgent(
    name="ReviewPipeline",
    sub_agents=[
        ParallelAgent(name="Reviews", sub_agents=[security_agent, perf_agent]),
        synthesizer,
    ]
)
```

ADK's approach is unique: instead of the LLM deciding when to run reviews in parallel, you _declare_ it with `ParallelAgent`. The orchestration is deterministic — only the individual review steps use LLM reasoning.

### Hooks and Lifecycle

**Claude Agent SDK** has the most granular hook system — 18 event types that let you intercept nearly every agent action:

```typescript
hooks: {
  PreToolUse: [{
    matcher: "Bash",  // Regex on tool name
    hooks: [async (input) => {
      // Block destructive commands
      if (input.tool_input.command?.match(/rm -rf|drop table/i)) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "Destructive command blocked"
          }
        };
      }
      return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
    }]
  }],
  SubagentStop: [{
    hooks: [(input) => {
      console.log(`Subagent ${input.agent_type} completed`);
    }]
  }]
}
```

**OpenAI Agents SDK** uses lifecycle hooks on two scopes — `RunHooks` (entire run) and `AgentHooks` (per-agent):

```python
class MyHooks(RunHooks):
    async def on_agent_start(self, context, agent): ...
    async def on_agent_end(self, context, agent, output): ...
    async def on_tool_start(self, context, agent, tool): ...
    async def on_tool_end(self, context, agent, tool, result): ...
    async def on_handoff(self, context, from_agent, to_agent): ...

result = await Runner.run(agent, input, hooks=MyHooks())
```

**Google ADK** uses before/after callbacks on tools:

```python
agent = Agent(
    before_tool_callback=my_before_hook,
    after_tool_callback=my_after_hook,
)
```

| Hook capability             | Claude Agent SDK        | OpenAI Agents SDK             | Google ADK                  |
| --------------------------- | ----------------------- | ----------------------------- | --------------------------- |
| **Block tool calls**        | Yes (PreToolUse → deny) | No (observe only)             | Yes (before_tool_callback)  |
| **Modify tool input**       | Yes (updatedInput)      | No                            | Yes (return modified input) |
| **Inject context to model** | Yes (additionalContext) | No (use dynamic instructions) | Yes (via state)             |
| **Observe handoffs**        | SubagentStart/Stop      | on_handoff                    | Via events                  |
| **Session lifecycle**       | SessionStart/End, Setup | No                            | Via SessionService          |
| **Total event types**       | 18                      | 7                             | ~4                          |

### Guardrails and Permissions

**Claude Agent SDK** uses a 4-layer permission system instead of explicit guardrails:

```
PreToolUse hooks  →  Permission rules (settings.json)  →  Permission mode  →  canUseTool callback
```

Deny wins at every layer. This is a **permission model**, not a guardrail model — the difference matters. Permissions prevent actions from happening. Guardrails validate inputs/outputs and halt if something is wrong.

**OpenAI Agents SDK** has guardrails as a first-class primitive — the SDK's most distinctive feature after handoffs:

```python
@input_guardrail
async def content_safety(ctx, agent, input):
    # Can use a cheaper, faster model for the check
    result = await Runner.run(safety_agent, input, context=ctx.context)
    return GuardrailFunctionOutput(
        output_info={"reason": result.final_output},
        tripwire_triggered=result.final_output.is_unsafe
    )

# Parallel: guardrail runs alongside the main agent (saves latency)
# Blocking: guardrail must pass before agent starts (prevents token waste)
agent = Agent(input_guardrails=[content_safety])
```

The **parallel tripwire pattern** is particularly clever: the guardrail runs concurrently with the main agent. If the tripwire fires, the agent's execution is cancelled. If it doesn't, no latency penalty. This maps directly to the [Guardrails & Circuit Breakers](../guardrails/README.md) pattern from this repo.

**Google ADK** handles guardrails through callbacks and tool-level validation rather than a dedicated abstraction.

### Sessions and State

| Capability               | Claude Agent SDK                  | OpenAI Agents SDK                    | Google ADK                        |
| ------------------------ | --------------------------------- | ------------------------------------ | --------------------------------- |
| **Resume conversation**  | `resume: sessionId`               | `session=session`                    | Session ID + SessionService       |
| **Fork conversation**    | `forkSession: true`               | Not built-in                         | Not built-in                      |
| **State persistence**    | Session files on disk             | SQLite, Redis, SQLAlchemy, encrypted | InMemory, Database, VertexAI      |
| **State scoping**        | Per-session                       | Per-session                          | `app:`, `user:`, `temp:`, session |
| **Cross-session memory** | Session listing, resume           | SummarizingSession                   | MemoryService (searchable)        |
| **History management**   | Auto-compaction (PreCompact hook) | TrimmingSession, SummarizingSession  | Via MemoryService                 |

Claude's **session fork** is unique and powerful — create an alternative branch from any point in a conversation without modifying the original. Think git branch for agent conversations.

Google's **state prefix system** is the most granular — `app:` state persists across all sessions, `user:` across a user's sessions, plain state per-session, and `temp:` only for the current invocation.

### MCP Support

| MCP Feature                 | Claude Agent SDK                  | OpenAI Agents SDK                           | Google ADK      |
| --------------------------- | --------------------------------- | ------------------------------------------- | --------------- |
| **Stdio servers**           | Yes                               | Yes (MCPServerStdio)                        | Yes             |
| **HTTP/SSE servers**        | Yes                               | Yes (MCPServerStreamableHttp, MCPServerSse) | Yes             |
| **In-process tools**        | `createSdkMcpServer()` + `tool()` | N/A                                         | N/A             |
| **Hosted MCP**              | N/A                               | HostedMCPTool (OpenAI-hosted)               | N/A             |
| **Multi-server management** | Via mcpServers config             | MCPServerManager                            | Native          |
| **Dynamic runtime control** | reconnect, toggle, set servers    | reconnect, filtering                        | Via config      |
| **Tool naming**             | `mcp__<server>__<tool>`           | Configurable                                | Via integration |

Claude's **in-process MCP servers** are a standout — define tools with Zod schemas that run in your process, no subprocess needed:

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const metricsServer = createSdkMcpServer({
  name: "metrics",
  version: "1.0.0",
  tools: [
    tool(
      "get_latency",
      "Get p95 latency for a service",
      { service: z.string().describe("Service name") },
      async (args) => ({
        content: [{ type: "text", text: `p95: ${await getLatency(args.service)}ms` }],
      }),
    ),
  ],
});

for await (const msg of query({
  prompt: "Check latency for the auth service",
  options: {
    mcpServers: { metrics: metricsServer },
    allowedTools: ["mcp__metrics__get_latency"],
  },
}));
```

### Tracing and Observability

**OpenAI Agents SDK** has the strongest built-in tracing — automatic span creation for every agent run, LLM call, tool invocation, guardrail check, and handoff, viewable in OpenAI's dashboard:

```python
# Tracing is on by default — no configuration needed
result = await Runner.run(agent, "Analyze this code")

# Group multiple runs into one trace
with trace("Code Review Workflow"):
    analysis = await Runner.run(analyzer, code)
    review = await Runner.run(reviewer, analysis.final_output)
```

20+ ecosystem integrations: Weights & Biases, Langfuse, MLflow, Braintrust, AgentOps, and more.

**Claude Agent SDK** provides cost tracking per query (`total_cost_usd`, `usage`, `modelUsage`) but relies on hooks for custom tracing. No built-in tracing dashboard.

**Google ADK** integrates with Google Cloud monitoring and supports third-party observability tools.

### Model Support

| SDK                   | Primary models                 | Other models                                      |
| --------------------- | ------------------------------ | ------------------------------------------------- |
| **Claude Agent SDK**  | Claude (Opus, Sonnet, Haiku)   | Claude-only (Bedrock, Vertex, Azure endpoints)    |
| **OpenAI Agents SDK** | GPT-4.1, GPT-5.x, o4-mini      | 100+ via LiteLLM (`litellm/anthropic/claude-...`) |
| **Google ADK**        | Gemini 2.5 Flash, Gemini 3 Pro | 100+ via LiteLLM and Vertex AI Model Garden       |

Claude Agent SDK is the most locked in — Claude models only, though you can route through Bedrock, Vertex, or Azure endpoints. OpenAI and Google both support LiteLLM for multi-model access, though both work best with their own models.

---

## The Same Task in Three SDKs

To make the comparison concrete, here's the same task — "find files with TODO comments and create a prioritized summary" — in all three SDKs:

### Claude Agent SDK (TypeScript)

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt:
    "Find all TODO comments in src/. Categorize by priority (high/medium/low) based on context. Write a summary to TODO_REPORT.md.",
  options: {
    model: "claude-sonnet-4-6",
    allowedTools: ["Glob", "Grep", "Read", "Write"],
    maxBudgetUsd: 0.5,
  },
})) {
  if (message.type === "assistant") {
    for (const block of message.content) {
      if (block.type === "text") process.stdout.write(block.text);
    }
  }
  if (message.type === "result") {
    console.log(`\nDone. Cost: $${message.total_cost_usd}`);
  }
}
```

**11 lines of application code.** No tool implementations. The agent uses built-in `Glob` to find files, `Grep` to search for TODOs, `Read` to understand context, and `Write` to create the report.

### OpenAI Agents SDK (Python)

```python
import glob, re
from agents import Agent, Runner, function_tool

@function_tool
async def find_files(pattern: str = "src/**/*.ts") -> str:
    """Find files matching a glob pattern."""
    return "\n".join(glob.glob(pattern, recursive=True))

@function_tool
async def search_in_file(file_path: str, pattern: str = "TODO") -> str:
    """Search for a pattern in a file, returning matching lines with numbers."""
    results = []
    with open(file_path) as f:
        for i, line in enumerate(f, 1):
            if re.search(pattern, line):
                results.append(f"{file_path}:{i}: {line.strip()}")
    return "\n".join(results) or "No matches found."

@function_tool
async def read_file(file_path: str) -> str:
    """Read the contents of a file."""
    with open(file_path) as f:
        return f.read()

@function_tool
async def write_file(file_path: str, content: str) -> str:
    """Write content to a file."""
    with open(file_path, "w") as f:
        f.write(content)
    return f"Written to {file_path}"

agent = Agent(
    name="TODO Analyzer",
    instructions="Find all TODO comments in src/. Categorize by priority. Write a summary to TODO_REPORT.md.",
    tools=[find_files, search_in_file, read_file, write_file],
    model="gpt-4.1",
)

result = await Runner.run(agent, "Find and categorize TODOs")
print(result.final_output)
```

**~35 lines.** You implement every tool. The tradeoff: you control exactly what each tool does, but you're writing file I/O and glob matching that Claude's SDK provides for free.

### Google ADK (Python)

```python
import glob, re
from google.adk import Agent, SequentialAgent, Runner
from google.adk.sessions import InMemorySessionService

def find_files(pattern: str = "src/**/*.ts", tool_context=None) -> str:
    """Find files matching a glob pattern."""
    return "\n".join(glob.glob(pattern, recursive=True))

def search_todos(file_path: str, tool_context=None) -> str:
    """Search for TODO comments in a file."""
    results = []
    with open(file_path) as f:
        for i, line in enumerate(f, 1):
            if "TODO" in line:
                results.append(f"{file_path}:{i}: {line.strip()}")
    if tool_context:
        tool_context.state["found_todos"] = results
    return "\n".join(results) or "No TODOs found."

scanner = Agent(
    name="Scanner",
    model="gemini-2.5-flash",
    instruction="Find all TODO comments in src/ using the available tools.",
    tools=[find_files, search_todos],
    output_key="todos"
)

analyzer = Agent(
    name="Analyzer",
    model="gemini-2.5-flash",
    instruction="Categorize these TODOs by priority: {todos}. Write to TODO_REPORT.md.",
    tools=[write_file],
)

pipeline = SequentialAgent(name="Pipeline", sub_agents=[scanner, analyzer])
session_service = InMemorySessionService()
runner = Runner(agent=pipeline, app_name="todos", session_service=session_service)
```

**~35 lines.** Similar to OpenAI, you implement tools yourself, but the `SequentialAgent` makes the scan→analyze pipeline deterministic. `output_key` passes results through session state, and `tool_context.state` gives tools direct state access.

### The Pattern

| Aspect                   | Claude                     | OpenAI                     | Google                       |
| ------------------------ | -------------------------- | -------------------------- | ---------------------------- |
| **Lines of code**        | ~11                        | ~35                        | ~35                          |
| **Tool implementations** | 0 (built-in)               | 4 functions                | 3 functions                  |
| **Orchestration**        | Agent decides autonomously | Agent decides autonomously | Declared via SequentialAgent |
| **Cost visibility**      | Built-in per-query         | Via tracing                | Via Cloud monitoring         |
| **File sandbox**         | Subprocess isolation       | Your process               | Your process                 |

---

## Mapping to Patterns You've Already Built

Every SDK implements patterns from this repo. Here's how they map:

| This Repo's Pattern                                       | Claude Agent SDK                    | OpenAI Agents SDK                   | Google ADK                            |
| --------------------------------------------------------- | ----------------------------------- | ----------------------------------- | ------------------------------------- |
| [ReAct Loop](../react/README.md)                          | Built-in TAOR loop inside CLI       | `Runner.run()` while-loop           | LLM Agent with tool invocation        |
| [Plan+Execute](../plan-execute/README.md)                 | Agent plans internally              | Not built-in; compose with tools    | `SequentialAgent` wrapping LLM agents |
| [Guardrails](../guardrails/README.md)                     | Hook system (PreToolUse → deny)     | First-class guardrails (tripwire)   | Callbacks (before/after_tool)         |
| [Human-in-the-Loop](../human-in-the-loop/README.md)       | `AskUserQuestion` tool + canUseTool | `needs_approval` + `interruptions`  | Custom tool pausing for input         |
| [Multi-Agent Routing](../multi-agent-routing/README.md)   | Subagents via Task tool             | Handoffs (transfer_to)              | AutoFlow agent transfer               |
| [Sub-Agent Delegation](../sub-agent-delegation/README.md) | Background subagents                | `agent.as_tool()` (manager pattern) | `AgentTool` + workflow agents         |
| [Streaming](../streaming/README.md)                       | Async generator of SDKMessage       | `Runner.run_streamed()`             | Event streaming + bidi audio/video    |
| [Context Management](../context-management/README.md)     | Auto-compaction (PreCompact hook)   | Manual / SummarizingSession         | State prefixes + MemoryService        |
| [Persistent Memory](../persistent-memory/README.md)       | Session resume/fork                 | Session backends (SQLite, Redis)    | SessionService + MemoryService        |
| [Self-Validation](../self-validation/README.md)           | PostToolUse hooks                   | Output guardrails                   | after_tool_callback                   |
| [Evaluation Patterns](../evaluation-patterns/README.md)   | Not built-in                        | Not built-in                        | Built-in eval framework (7 criteria)  |
| [Cost Tracking](../cost-tracking/README.md)               | `total_cost_usd` per query          | Via tracing metadata                | Via Google Cloud                      |
| [Tool Descriptions](../tool-descriptions/README.md)       | Built-in tool descriptions          | Docstring-inferred schemas          | Auto-generated from signatures        |
| [Middleware Pipeline](../middleware-pipeline/README.md)   | Hooks (18 events, sequential)       | RunHooks + AgentHooks               | Callbacks                             |

The key insight: **every SDK implements the same `while(true)` ReAct loop from `src/react/agent.ts`**. What differs is the infrastructure around it.

---

## In the Wild: Coding Agent Harnesses

The vendor SDKs aren't just "libraries you use to build apps" — they are the exact infrastructure powering the vendors' flagship coding agents.

### Claude Agent SDK = Claude Code's Runtime

The Claude Agent SDK gives you the same tools, agent loop, and context management that power Claude Code. When you use `query()` with `allowedTools: ["Read", "Edit", "Bash", "Grep"]`, you're running the same tool implementations that Claude Code uses to make 135,000 GitHub commits per day.

The relationship is direct: Claude Code and Claude Cowork are both built on the Claude Agent SDK. The SDK was originally called the "Claude Code SDK" — it was renamed to "Claude Agent SDK" in September 2025 when Anthropic recognized the runtime was general enough for any agentic workflow, not just coding.

This means the SDK is battle-tested at scale. Context compaction, session management, file checkpointing — these features were built for the most-used coding agent and exposed as an SDK. The flip side: you're constrained to what Claude Code's runtime supports. Custom tool implementations require MCP servers rather than simple function definitions.

### OpenAI Agents SDK + Codex CLI

OpenAI separates its pieces differently. The Agents SDK is the orchestration layer. Codex CLI is the code-execution sandbox. They're complementary:

```python
# Use Codex as a tool within an Agents SDK workflow
from agents.extensions.experimental.codex import codex_tool

agent = Agent(
    tools=[codex_tool(
        sandbox_mode="workspace-write",
        working_directory="/path/to/repo",
    )]
)
```

OpenAI also exposes Codex CLI as an MCP server, letting you orchestrate it from any MCP-compatible system. This modular architecture means you can use the Agents SDK for routing and orchestration while delegating code execution to Codex's sandboxed environment.

### Google ADK + Vertex AI

Google's play is different — ADK agents deploy to Vertex AI Agent Engine with a single command (`adk deploy agent_engine`), getting managed session state, scaling, and monitoring for free. The connection between ADK and Google's cloud platform is tighter than either Claude's or OpenAI's.

---

## When to Choose Each

### Choose Claude Agent SDK when:

- **You need a capable single agent** that reads files, runs commands, and edits code — and you don't want to implement those tools yourself
- **Long-running tasks** requiring sustained context over many turns (auto-compaction handles context management)
- **Regulated environments** requiring explicit permission models (the 4-layer permission system is the most granular)
- **You're already using Claude** and want the smoothest path from API calls to agent
- **CI/CD automation** — the SDK was built for this (code review, test generation, migration)

**Watch out for:** Claude-only model lock-in, subprocess architecture complicating deployment, resource management in production (OOM reports), ~12s per-query overhead in some configurations.

### Choose OpenAI Agents SDK when:

- **Multi-agent handoff routing** is your primary pattern (the SDK's standout feature)
- **Rapid prototyping** — the fewest primitives to learn, fastest to start
- **Model flexibility matters** — LiteLLM gives you 100+ providers
- **Observability is critical** — automatic tracing with zero configuration, 20+ integrations
- **You want guardrails as a first-class concept** — parallel tripwire pattern is elegant

**Watch out for:** You implement every tool yourself, the Assistants API deprecation precedent concerns some developers, state management is outsourced to your code.

### Choose Google ADK when:

- **Enterprise multi-agent orchestration** — workflow agents (Sequential, Parallel, Loop) are unmatched
- **Google Cloud ecosystem** — BigQuery, Vertex AI, managed deployment
- **Agent-to-agent communication** — A2A protocol for cross-network agents
- **Built-in evaluation** — 7 evaluation criteria, user simulation, pytest integration
- **4-language support** — Python, TypeScript, Java, Go

**Watch out for:** Steeper learning curve (most concepts to learn), Google Cloud dependency for managed features, newer ecosystem with less community tooling.

### Skip vendor SDKs entirely when:

- Your agent is a single `while(true)` loop with 2-3 tools — just call the API directly
- You need multi-model support as a hard requirement — LiteLLM claims are aspirational for edge cases
- You're already using a framework (LangGraph, CrewAI) that handles what you need
- The patterns from this repo, composed directly, give you sufficient control

As Harrison Chase put it: "Own your cognitive architecture, outsource your infrastructure." If a vendor SDK is your cognitive architecture rather than your infrastructure, you've coupled too tightly.

---

## The Broader Landscape

The three SDKs compared here aren't the only vendor offerings:

| SDK                           | Vendor       | Approach                          | Notes                                                                |
| ----------------------------- | ------------ | --------------------------------- | -------------------------------------------------------------------- |
| **AWS Strands**               | Amazon       | Model-driven, OpenTelemetry-first | Bedrock-native, MCP-compatible, swarm/graph/hierarchical multi-agent |
| **Microsoft Agent Framework** | Microsoft    | Semantic Kernel + AutoGen merger  | .NET-focused, enterprise governance, VS Code AI Toolkit              |
| **smolagents**                | Hugging Face | ~1,000 lines, code-first          | Agents write Python instead of JSON tool calls, model-agnostic       |

The trend is clear: every major LLM maker now ships an agent SDK. The differentiation is increasingly in **developer experience** and **ecosystem integration** rather than in fundamentally different architectural approaches. Protocols (MCP, A2A — both donated to the Linux Foundation's Agentic AI Foundation in December 2025) are the escape valve from vendor lock-in.

---

## Key Takeaways

1. **Same loop, different wrappers.** All three SDKs implement the ReAct `while(true)` loop you built in Chapter 1. The difference is what surrounds it — built-in tools, hooks, guardrails, workflow agents, session management.

2. **The fundamental split is thick vs. thin.** Claude Agent SDK ships a full runtime (you configure). OpenAI Agents SDK ships four primitives (you build). Google ADK ships a platform (you compose). There is no "best" — it depends on whether you want more control or more convenience.

3. **Handoffs are OpenAI's standout contribution.** The clean separation between "specialist takes over" (handoffs) and "manager retains control" (agents-as-tools) is the most novel pattern to come from any vendor SDK.

4. **Workflow agents are ADK's standout contribution.** SequentialAgent, ParallelAgent, and LoopAgent let you declare deterministic orchestration around LLM reasoning — a pattern the other SDKs don't have.

5. **The permission model is Claude's standout contribution.** The 4-layer system (hooks → rules → modes → callback) with deny-wins semantics gives you deterministic control over non-deterministic agents.

6. **Vendor lock-in is real but manageable.** Claude SDK is Claude-only. OpenAI and Google support LiteLLM but work best with their own models. MCP is the emerging standardization layer that helps — all three SDKs support it.

7. **You might not need one.** The most successful production agents tend to use simple patterns composed directly. A vendor SDK earns its place when the built-in tools/hooks/guardrails/sessions save you more implementation effort than the abstraction costs in transparency.

---

## Sources & Further Reading

### Official Documentation

- [Claude Agent SDK — Overview](https://docs.anthropic.com/en/docs/agents-and-tools/claude-agent-sdk/overview)
- [Claude Agent SDK — TypeScript Reference](https://docs.anthropic.com/en/docs/agents-and-tools/claude-agent-sdk/typescript)
- [Claude Agent SDK — Python Reference](https://docs.anthropic.com/en/docs/agents-and-tools/claude-agent-sdk/python)
- [OpenAI Agents SDK Documentation](https://openai.github.io/openai-agents-python/)
- [OpenAI Agents SDK — Multi-Agent Orchestration](https://openai.github.io/openai-agents-python/multi_agent/)
- [OpenAI Agents SDK — Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [OpenAI Agents SDK — Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- [Google ADK Documentation](https://google.github.io/adk-docs/)
- [Google Developers — Multi-Agent Patterns in ADK](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/)

### Engineering Blog Posts

- [Building Agents with the Claude Agent SDK — Anthropic](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [New Tools for Building Agents — OpenAI](https://openai.com/index/new-tools-for-building-agents/)
- [Agent Development Kit: Easy to Build Multi-Agent Applications — Google](https://developers.googleblog.com/en/agent-development-kit-easy-to-build-multi-agent-applications/)
- [Building Effective Agents — Anthropic](https://www.anthropic.com/research/building-effective-agents)

### Comparisons & Analysis

- [OpenAI Agents SDK vs Claude Agent SDK — AgentPatch](https://agentpatch.ai/blog/openai-agents-sdk-vs-claude-agent-sdk/)
- [OpenAI Agent SDK vs Google ADK — W3villa](https://www.w3villa.com/blog/openai-agent-sdk-vs-google-adk-enterprise-agentic-frameworks)
- [Claude Agent SDK vs OpenAI AgentKit — Bind AI](https://blog.getbind.co/openai-agentkit-vs-claude-agents-sdk-which-is-better/)
- [AI Framework Comparison 2025 — Enhancial](https://enhancial.substack.com/p/choosing-the-right-ai-framework-a)
- [OpenAI vs Claude for Production — Zen Van Riel](https://zenvanriel.com/ai-engineer-blog/openai-vs-claude-for-production/)
- [Claude Agent SDK vs Google ADK — Prabha.ai](https://prabha.ai/writing/2025/12/21/claude-agent-sdk-vs-google-adk/)

### Academic Papers

- [Towards a Science of Scaling Agent Systems (arXiv:2512.08296)](https://arxiv.org/abs/2512.08296) — 180 configurations, 5 architectures, scaling laws
- [AgentArch: Enterprise Agent Architecture Benchmark (arXiv:2509.10769)](https://arxiv.org/abs/2509.10769) — no universally optimal architecture
- [Agent Scaling via Diversity (arXiv:2602.03794)](https://arxiv.org/abs/2602.03794) — 2 diverse agents can match 16 homogeneous
- [A Survey of Agent Interoperability Protocols (arXiv:2505.02279)](https://arxiv.org/abs/2505.02279) — MCP, ACP, A2A, ANP comparison

### Framework & Ecosystem

- [How to Think About Agent Frameworks — LangChain](https://blog.langchain.com/how-to-think-about-agent-frameworks/)
- [Own Your Cognitive Architecture — LangChain](https://blog.langchain.com/why-you-should-outsource-your-agentic-infrastructure-but-own-your-cognitive-architecture/)
- [Comparing Open-Source AI Agent Frameworks — Langfuse](https://langfuse.com/blog/2025-03-19-ai-agent-comparison)
- [Introducing Strands Agents — AWS](https://aws.amazon.com/blogs/opensource/introducing-strands-agents-an-open-source-ai-agents-sdk/)
- [Introducing Microsoft Agent Framework](https://azure.microsoft.com/en-us/blog/introducing-microsoft-agent-framework/)

---

[Agent Patterns — TypeScript](../../README.md)
