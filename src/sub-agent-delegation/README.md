# Promise.all() for AI — Delegating Work to Sub-Agents

[Agent Patterns — TypeScript](../../README.md)

> **Previous concept:** [Multi-Agent Routing](../multi-agent-routing/README.md) — picking ONE specialist per query. This concept extends that: when a query needs ALL the specialists at once.

---

"Plan a weekend trip to Portland from Seattle."

The router from [Multi-Agent Routing](../multi-agent-routing/README.md) would route this to... which agent? Flights? Hotels? Activities? It needs all three. A single routing decision can't decompose a multi-domain task — it can only pick one specialist or fall back to a generalist with all 30 tools.

Sub-agent delegation solves this. A **parent agent** decomposes the task, spawns **child agents** in parallel, and synthesizes a unified itinerary from their results. It's `Promise.all()` for AI work.

## The Architecture

```
                         ┌─────────────────────┐
                         │    User Message      │
                         │ "Plan a trip to PDX" │
                         └──────────┬───────────┘
                                    │
                         ┌──────────▼───────────┐
                         │    Parent Agent       │
                         │    (orchestrator)     │
                         │                       │
                         │  "I need flights,     │
                         │   hotels, AND         │
                         │   activities"         │
                         └──────────┬───────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
     ┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐
     │  flight_agent   │  │  hotel_agent    │  │ activity_agent  │
     │                 │  │                 │  │                 │
     │ Fresh context   │  │ Fresh context   │  │ Fresh context   │
     │ Scoped tools    │  │ Scoped tools    │  │ Scoped tools    │
     │ Own ReAct loop  │  │ Own ReAct loop  │  │ Own ReAct loop  │
     └────────┬────────┘  └────────┬────────┘  └────────┬────────┘
              │                     │                     │
              └─────────────────────┼─────────────────────┘
                                    │
                         ┌──────────▼───────────┐
                         │  Parent synthesizes   │
                         │  unified itinerary    │
                         └───────────────────────┘
```

Each child is a full ReAct agent with its own tool set, system prompt, and conversation context. The parent never touches flight search or hotel lookup directly — it only delegates.

## Delegation as Tool Calls

The key design insight: delegation is expressed as **tool calls** in the parent's ReAct loop. The parent has three tools:

```typescript
const delegationTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "delegate_flight_research",
      description: "Delegate flight research to a specialist flight agent...",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Natural language task for the flight agent",
          },
        },
        required: ["task"],
      },
    },
  },
  // delegate_hotel_research, delegate_activity_research...
];
```

When the parent "calls a tool," it's actually spawning a child agent:

```typescript
async function executeDelegationTool(name, args, depth) {
  const agentName = DELEGATION_MAP[name]; // delegate_flight_research → flight_agent
  const profile = getChildProfile(agentName);

  const { result, toolCallCount } = await runChildAgent(args.task, profile, depth + 1);
  return result; // compressed — just the final answer
}
```

This is the **agents-as-tools** pattern. The parent's ReAct loop doesn't need special delegation logic — it calls tools like normal, and some of those "tools" happen to be entire agents.

## Context Isolation

Each child agent gets a **fresh context** — an empty message array with just the task:

```typescript
async function runChildAgent(task, profile, depth) {
  // Fresh context — no parent history
  const messages: Message[] = [{ role: "user", content: task }];

  while (true) {
    const response = await ollama.chat({
      model: MODEL,
      system: profile.systemPrompt,
      messages, // only the child's own messages
      tools: profile.tools,
    });
    // ... standard ReAct loop
  }

  // Return only the final assistant text
  return { result: lastAssistant.content, toolCallCount };
}
```

This prevents **context cancer** — when children inherit the parent's growing context and start making confused tool calls based on irrelevant information. The child only sees its task and its own tool results.

The tradeoff: children lose conversational context. If the user said "I prefer morning flights" three turns ago, the child won't know. The parent must include relevant preferences in the delegation task string.

## Depth Control

Without limits, agents can spawn agents that spawn agents forever. Two guards prevent this:

**Structural guard:** Children don't have delegation tools in their tool set. A flight agent can call `search_flights` and `compare_flight_prices`, but it can't call `delegate_hotel_research`. It's structurally impossible for children to delegate further.

**Numeric guard:** Belt-and-suspenders. A depth counter tracks nesting level:

```typescript
const MAX_DEPTH = 2;

async function runChildAgent(task, profile, depth) {
  if (depth >= MAX_DEPTH) {
    return {
      result: "[Depth limit reached. Cannot spawn further children.]",
      toolCallCount: 0,
    };
  }
  // ... run the agent
}
```

In this demo, depth 0 is the parent, depth 1 is the child. Children can't spawn grandchildren because (a) they don't have delegation tools and (b) the depth counter would block it anyway.

## Sequential vs. Parallel Execution

This demo supports two modes that expose the key tradeoff:

### Sequential Mode (default)

The parent's standard ReAct loop calls delegation tools one at a time:

```
Parent thinks → calls delegate_flight_research → waits → result
Parent thinks → calls delegate_hotel_research  → waits → result
Parent thinks → calls delegate_activity_research → waits → result
Parent synthesizes final response
```

Each child takes ~3-5 seconds (model inference + tool calls). Three sequential children = ~9-15 seconds total.

**Advantage:** Natural for the model. The parent sees each child's result before deciding what to delegate next. It can adjust — if flights are expensive, maybe search for a closer destination.

### Parallel Mode

A three-phase pipeline:

1. **Decompose** — One LLM call to identify all needed delegations (structured JSON)
2. **Execute** — `Promise.allSettled()` over all children simultaneously
3. **Synthesize** — One LLM call to combine results

```typescript
// Phase 2: all children run simultaneously
const childPromises = decomposed.delegations.map((d) =>
  executeDelegationTool(d.tool, { task: d.task }, 0),
);
const children = await Promise.allSettled(childPromises);
```

Three parallel children = ~3-5 seconds total (limited by the slowest child, not the sum).

**Advantage:** Massive latency reduction for independent tasks. A weekend trip plan is 3 independent research tasks — there's no reason to wait for flights before searching hotels.

**`Promise.allSettled` not `Promise.all`** — If the hotel agent fails, we still get flight and activity results. The parent synthesizes with whatever came back, noting the gap. Partial results beat total failure.

## When Each Mode Fits

| Scenario                                             | Best Mode  | Why                                  |
| ---------------------------------------------------- | ---------- | ------------------------------------ |
| "Plan a trip to Portland"                            | Parallel   | All domains independent              |
| "Find a hotel near my flight's arrival airport"      | Sequential | Hotel depends on flight result       |
| "What should I do this weekend?"                     | Parallel   | Activities + restaurants independent |
| "Find the cheapest option across flights and trains" | Sequential | Need to compare across domains       |

## Routing vs. Delegation vs. Single Agent

|                      | Single Agent           | Routing               | Delegation (this)               |
| -------------------- | ---------------------- | --------------------- | ------------------------------- |
| **Tools per turn**   | All 30                 | 2-4 (specialist)      | 2-4 per child                   |
| **Domains per turn** | 1 (confused with many) | 1 (routed)            | N (parallel children)           |
| **LLM calls**        | N tool loops           | 1 router + N loops    | 1 parent + N×(child loops)      |
| **Best for**         | Simple tasks           | Single-domain queries | Multi-domain decomposition      |
| **Failure mode**     | Confused tool calls    | Wrong routing         | Over-delegation of simple tasks |

The three patterns compose naturally. A production system might:

1. **Route** simple queries to a specialist ([Multi-Agent Routing](../multi-agent-routing/README.md))
2. **Delegate** complex queries to multiple specialists (this concept)
3. Each specialist runs a **ReAct loop** with scoped tools ([ReAct](../react/README.md))

## Reusing Multi-Agent Routing's Profiles

The specialist profiles from Multi-Agent Routing ARE the child agents. No duplication:

```typescript
import { getProfileByName } from "../multi-agent-routing/profiles.js";
import { flightTools, hotelTools, activityTools } from "../multi-agent-routing/tools.js";

function getChildProfile(agentName: string): AgentProfile {
  const base = getProfileByName(agentName);
  // Override with Portland-aware dispatchers
  switch (agentName) {
    case "flight_agent":
      return { ...base, tools: flightTools, executeTool: executeFlightToolWithPortland };
    // ...
  }
}
```

This is the composability payoff from Multi-Agent Routing's `AgentProfile` interface. The same profiles work for routing (pick one) and delegation (spawn many).

## In the Wild: Coding Agent Harnesses

The spectrum of sub-agent delegation in production coding tools reveals a central architectural question: how much isolation does each child need? The answer ranges from lightweight in-process spawning to full virtual machine separation, and the tradeoffs mirror the sequential-vs-parallel and context-isolation decisions we explored above.

**Claude Code** offers the most layered delegation architecture of any coding harness, with three distinct tiers that map directly to different isolation needs. At the lightest level, [sub-agents](https://code.claude.com/docs/en/sub-agents) spawn inline within the parent session — each gets its own context window but shares the same process, reports results back to the caller, and never communicates with sibling sub-agents. This is the agents-as-tools pattern from this demo, almost exactly. For heavier work, the [Task tool](https://code.claude.com/docs/en/sub-agents) runs background agents that can operate longer without blocking the main conversation. The heaviest tier is [Agent Teams](https://code.claude.com/docs/en/agent-teams) (experimental as of early 2026): the lead agent spawns fully independent Claude Code instances as teammates, each with its own context window, and they coordinate through a shared task list with file-lock-based claiming and peer-to-peer messaging. Teammates can message each other directly and even challenge each other's findings — a level of inter-agent communication that goes well beyond the parent-child delegation model. The key design tradeoff Claude Code makes explicit: sub-agents are cheaper (results summarized back to one context) while Agent Teams are costlier but support collaboration that requires discussion between workers.

**Roo Code** takes the most philosophically extreme position on delegation with its [Boomerang orchestrator pattern](https://docs.roocode.com/features/boomerang-tasks). The orchestrator mode is intentionally stripped of all tools — it cannot read files, write code, execute commands, or call MCPs. It can only delegate via the `new_task` tool, which spawns a subtask in a specialized mode (Code, Architect, Debug, etc.) with explicit instructions. When the subtask finishes, it "boomerangs" a completion summary back to the orchestrator via `attempt_completion`. This is context isolation taken to the extreme: the orchestrator never sees the child's working context, only the summary. The design prevents what Roo Code calls "context poisoning" — the equivalent of the "context cancer" problem this demo addresses. It is the purest implementation of the delegation-only parent agent: structurally incapable of doing work itself, forced to decompose and delegate everything.

**Cursor** solves the isolation problem at the filesystem level. [Parallel agents](https://cursor.com/docs/configuration/worktrees) (shipped in Cursor 2.0) use git worktrees to give each agent its own complete copy of the codebase — separate working directory, separate branch, no file conflicts. Up to 20 worktrees can exist per workspace, and Cursor automatically cleans up the oldest ones when the limit is hit. This is heavier than Claude Code's in-process sub-agents but lighter than full VM isolation. The merge step is explicit: changes flow back through Cursor's conflict resolution UI, not automatically. For even heavier isolation, Cursor's background agents run in remote VMs and create pull requests — the child's "result" is a PR rather than a text summary. The interesting architectural contrast with this demo: Cursor's parallel agents don't communicate with each other at all. There is no shared task list, no messaging. They are fully independent workers whose results merge at the git level, making it a pure `Promise.allSettled` model where synthesis happens in version control rather than in an LLM call.

**Devin** pushes isolation to its logical maximum with [fleet execution](https://cognition.ai/blog/devin-2). One Devin instance dispatches tasks to other Devin instances, each running in its own virtual machine with a full cloud development environment. During a large bank's migration project, a fleet of Devins executed across repositories in parallel, completing each migration in 3-4 hours versus 30-40 for a human engineer. This is sub-agent delegation where each "child" is an entire sandboxed operating system — the heaviest possible isolation, but it eliminates any chance of interference between children. Devin's architecture also separates the "brain" (stateless reasoning) from the "devbox" (stateful VM), meaning the delegation layer and execution layer are physically distinct. Where this demo uses `Promise.allSettled` over async functions, Devin uses `Promise.allSettled` over virtual machines.

The pattern across all four harnesses confirms the core lesson from this demo: the parent decomposes and delegates, children work in isolation with scoped capabilities, and results flow back up for synthesis. What varies is the weight of isolation (in-process context window to full VM), the communication model (report-to-parent-only to peer-to-peer messaging), and where synthesis happens (LLM call, git merge, or human review of PRs). Production systems tend toward heavier isolation than this demo uses, because real codebases have file conflicts, long-running tasks, and failure modes that demand stronger boundaries between children.

## Key Takeaways

1. **Delegation is `Promise.all()` for agents.** Independent subtasks run as parallel child agents, with results synthesized by the parent.

2. **Agents-as-tools is the cleanest pattern.** Express delegation as tool calls in a standard ReAct loop. No special orchestration code needed.

3. **Context isolation prevents "context cancer."** Children get fresh context with just their task. They don't inherit the parent's growing conversation history.

4. **Two depth guards: structural + numeric.** Children don't have delegation tools (can't delegate). Depth counter is belt-and-suspenders safety.

5. **`Promise.allSettled` > `Promise.all`.** Partial results from 2 out of 3 children beat a total failure because one child crashed.

6. **Sequential for dependent tasks, parallel for independent ones.** "Plan a trip" is parallel. "Find a hotel near my flight" is sequential. Both use the same child agents.

---

## Run It

```bash
pnpm dev:sub-agent-delegation
```

Commands:

- `/sequential` — parent delegates one child at a time (default)
- `/parallel` — all children run simultaneously
- `/reset` — clear history

---

## Sources

### LLM Makers

- [Building Effective Agents — Anthropic](https://www.anthropic.com/research/building-effective-agents) — orchestrator-workers pattern, parallelization workflow
- [Multi-Agent Research System — Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system) — production sub-agent architecture with lead agent delegating to sub-agents
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/) — handoffs and agent-as-tool pattern
- [Orchestrating Agents — OpenAI Cookbook](https://cookbook.openai.com/examples/orchestrating_agents) — routines and handoffs design patterns

### Research

- [AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation](https://arxiv.org/abs/2308.08155) — Wu et al. (Microsoft Research), ICLR 2024 — hierarchical multi-agent conversations with recursive invocation
- [ReDel: A Toolkit for LLM-Powered Recursive Multi-Agent Systems](https://www.cis.upenn.edu/~ccb/publications/recursive-multi-agent-llms.pdf) — Zhu et al. (UPenn), ACL 2024 — recursive sub-agent spawning with depth control
- [Plan-and-Solve Prompting](https://arxiv.org/abs/2305.04091) — Wang et al., ACL 2023 — decompose → delegate → synthesize

### Frameworks

- [LangGraph Multi-Agent Workflows](https://blog.langchain.com/langgraph-multi-agent-workflows/) — supervisor and hierarchical patterns
- [CrewAI](https://www.crewai.com/) — role-based multi-agent orchestration with hierarchical process
