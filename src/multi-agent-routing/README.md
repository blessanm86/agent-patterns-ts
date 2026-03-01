# One Agent, Many Hats — How Multi-Agent Routing Works

[Agent Patterns — TypeScript](../../README.md)

> **Previous concept:** [Context Window Management](../context-management/README.md) — managing long conversations. This concept builds on the ReAct loop from [ReAct](../react/README.md) and the state graph ideas from [State Graph](../state-graph/README.md).

---

A single agent with 30 tools is confused and slow. Give it a flight search, a hotel lookup, a restaurant finder, a currency converter, a weather API, and a dozen more — and watch it call the wrong tool, hallucinate parameters, or loop through irrelevant options before stumbling onto the right one.

The fix isn't a smarter model. It's **routing**: multiple specialized agents with narrow tool sets, and a classifier that picks the right one per turn.

This pattern adds one LLM call (the router) but saves many confused tool calls downstream. Research from Anthropic shows specialized agents with scoped tools outperform a single agent with all tools — their multi-agent research system showed a **90.2% improvement** over single-agent on internal evals.

## The Architecture

```
                         ┌─────────────────────┐
                         │    User Message      │
                         └──────────┬───────────┘
                                    │
                         ┌──────────▼───────────┐
                         │   LLM Router         │
                         │   (1 classify call)   │
                         │                       │
                         │   → agent name        │
                         │   → confidence score  │
                         │   → reasoning         │
                         └──────────┬───────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
             ┌──────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
             │flight_agent │ │hotel_agent │ │activity_agent│
             │             │ │            │ │              │
             │search_flights│ │search_hotels│ │find_attractions│
             │compare_prices│ │get_details │ │find_restaurants│
             └──────┬──────┘ └─────┬──────┘ └──────┬──────┘
                    │               │               │
                    └───────────────┼───────────────┘
                                    │
                         ┌──────────▼───────────┐
                         │   Specialist runs     │
                         │   standard ReAct loop │
                         │   with scoped tools   │
                         └───────────────────────┘

             Confidence < 0.5?  →  general_agent (all 6 tools)
```

The router doesn't do any work itself — it classifies and delegates. Each specialist runs the exact same ReAct loop, just with different tools and system prompts injected.

## Defining Agent Profiles

An `AgentProfile` is everything needed to run a scoped ReAct loop:

```typescript
interface AgentProfile {
  name: string; // machine-readable (used by router)
  label: string; // human-readable display name
  description: string; // for the router prompt
  systemPrompt: string; // domain-specific instructions
  tools: ToolDefinition[]; // scoped tool set
  executeTool: (name: string, args: Record<string, string>) => string;
}
```

Here's the flight specialist:

```typescript
const flightAgent: AgentProfile = {
  name: "flight_agent",
  label: "Flight Agent",
  description: "Handles flight searches, price comparisons, airline recommendations...",
  systemPrompt: `You are a flight specialist travel agent...`,
  tools: flightTools, // only search_flights + compare_flight_prices
  executeTool: executeFlightTool, // only dispatches flight tools
};
```

Four things make this work:

1. **Focused system prompt** — tells the agent it's a flight specialist, what to highlight, and to acknowledge when something is outside its domain
2. **Narrow tool set** — only 2 tools instead of 6. The model can't accidentally call `search_hotels` because it's not in the tool list
3. **Scoped dispatcher** — even if the model hallucinates a tool name, the dispatcher returns a clean error instead of silently executing the wrong thing
4. **Router description** — clear enough that the classifier can reliably pick this agent for flight-related queries

## The Router

The router is a single LLM call with `format: "json"` that reads the user's message and picks an agent:

```typescript
async function routeToAgent(userMessage, history) {
  const response = await ollama.chat({
    model: MODEL,
    system: buildRouterPrompt(), // lists agent names + descriptions
    messages: [...recentHistory, { role: "user", content: userMessage }],
    format: "json",
  });

  const decision = JSON.parse(response.message.content);
  // → { agent: "flight_agent", confidence: 0.85, reasoning: "..." }

  if (decision.confidence < 0.5) {
    return { profile: generalAgent, decision };
  }

  return { profile: getProfileByName(decision.agent), decision };
}
```

The router prompt lists each specialist with its description:

```
Available agents:
- "flight_agent": Handles flight searches, price comparisons, airline recommendations...
- "hotel_agent": Handles hotel searches, room details, amenities, neighborhoods...
- "activity_agent": Handles attractions, restaurants, things to do, sightseeing...
```

Two safety nets protect against bad routing:

- **Confidence threshold (0.5):** Low-confidence classifications fall through to the general agent, which has all 6 tools and can handle cross-domain queries
- **Parse failure fallback:** If the router returns unparseable JSON, the general agent handles it

## The Key Insight: The Loop Doesn't Change

Compare the specialized agent loop to the standard ReAct loop:

```typescript
// Standard ReAct loop (src/react/agent.ts)
while (true) {
  const response = await ollama.chat({
    model: MODEL,
    system: HOTEL_SYSTEM_PROMPT, // ← hardcoded
    messages,
    tools, // ← hardcoded
  });
  // ... execute tools with executeTool() ← hardcoded
}

// Scoped ReAct loop (this demo)
while (true) {
  const response = await ollama.chat({
    model: MODEL,
    system: profile.systemPrompt, // ← from profile
    messages,
    tools: profile.tools, // ← from profile
  });
  // ... execute tools with profile.executeTool() ← from profile
}
```

The loop is identical. Only three things are parameterized: system prompt, tool list, and dispatcher. Multi-agent routing isn't a new architecture — it's dependency injection for ReAct loops.

## Multi-Turn Re-Routing

The router runs on **every user message**, not just the first one. This handles natural topic switches:

```
You: Find flights from New York to Paris        → flight_agent (0.92)
You: What about hotels near the Eiffel Tower?   → hotel_agent (0.88)
You: Any good restaurants nearby?                → activity_agent (0.85)
```

The router sees the last ~4 messages for context, so it can handle follow-ups like "what about something cheaper?" — it knows from history whether you were discussing flights or hotels.

## Routed vs. Single Agent

This demo supports two modes (toggle with `/routed` and `/single`):

|                        | Routed Mode             | Single Mode          |
| ---------------------- | ----------------------- | -------------------- |
| **Tools per agent**    | 2 (specialist)          | 6 (all)              |
| **LLM calls per turn** | 1 router + N tool loops | N tool loops         |
| **System prompt**      | Domain-focused          | Generic              |
| **Best for**           | Clear domain queries    | Cross-domain queries |

The stats line after each response shows the routing decision and tool count, making it easy to compare:

```
📊 Routed to: flight_agent | Confidence: 0.92 | Tools used: 1
📊 Mode: single | Agent: general_agent | Tools used: 3
```

## When to Use Routing vs. a Single Agent

Based on research across Anthropic, OpenAI, and practitioner reports:

**Use routing when:**

- You have 15+ tools across distinct domains
- Optimizing prompts for one category degrades others
- You want to reduce confused tool calls
- Different domains need different system prompts

**Stick with a single agent when:**

- Fewer than 10 tools, all in a related domain
- Queries are predictable and don't vary much
- Latency matters and you can't afford the extra router call
- You're prototyping and routing adds premature complexity

Anthropic's guidance: _"Always start with the simplest solution — add routing only when you hit a measured ceiling."_

## Common Pitfalls

1. **Vague agent descriptions** — routing accuracy depends directly on description quality. "Handles hotels" is worse than "Handles hotel searches, room details, amenities, neighborhoods, accommodation options."

2. **Too many specialists** — accuracy gains saturate beyond ~4 agents. Three well-defined specialists beat seven overlapping ones.

3. **No fallback** — ambiguous queries will always exist. The general agent catches them instead of forcing a bad classification.

4. **Ignoring topic switches** — the router must see recent history, not just the latest message, to handle "what about something cheaper?" after a flight discussion.

5. **Over-specialization** — agents so narrow they can't answer basic follow-ups. A flight agent should be able to discuss "is a layover worth the savings?" even without a specific tool for it.

## Key Takeaways

1. **Routing is dependency injection for ReAct loops.** The loop doesn't change — you parameterize the system prompt, tools, and dispatcher.

2. **Tool scoping is the main win.** Fewer tools means fewer confused tool calls. The specialist doesn't need to be "smarter" — it just has less to be confused by.

3. **The router is cheap.** One JSON classification call per turn, using the same local model. The cost is one extra LLM call; the benefit is fewer wasted tool calls.

4. **Confidence thresholds matter.** Low-confidence routing to a fallback agent is better than high-confidence routing to the wrong specialist.

5. **Re-route every turn.** Users naturally switch topics. A statically-assigned agent can't follow.

---

## Run It

```bash
pnpm dev:multi-agent-routing
```

Commands:

- `/routed` — specialist routing (default)
- `/single` — single agent baseline
- `/reset` — clear history

---

## Sources

### LLM Makers

- [Building Effective Agents — Anthropic](https://www.anthropic.com/research/building-effective-agents) — routing as a workflow pattern, when to use single vs. multi-agent
- [Multi-Agent Research System — Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system) — 90.2% improvement over single-agent; production multi-agent architecture
- [OpenAI Swarm](https://github.com/openai/swarm) — lightweight educational framework; handoffs as functions returning Agent objects
- [Orchestrating Agents — OpenAI Cookbook](https://cookbook.openai.com/examples/orchestrating_agents) — routines and handoffs design document

### Frameworks

- [LangGraph Multi-Agent Workflows](https://blog.langchain.com/langgraph-multi-agent-workflows/) — supervisor pattern with LLM-powered routing and isolated tool scopes
- [Vercel AI SDK — Agents](https://ai-sdk.dev/docs/agents/overview) — TypeScript-native composable agents; cheap model for routing, expensive for reasoning

### Research

- [Mixture-of-Agents Enhances Large Language Model Capabilities](https://arxiv.org/abs/2406.04692) — Wang et al., 2024 — layered multi-model collaboration
- [Self-MoA](https://arxiv.org/abs/2502.00674) — 2025 — challenges MoA; single-model repetition outperforms diverse ensembles
- [MasRouter](https://arxiv.org/abs/2502.11133) — ACL 2025 — joint optimization of topology, roles, and model selection; 52% overhead reduction
- [AutoGen: Enabling Next-Gen LLM Applications](https://arxiv.org/abs/2308.08155) — Wu et al. (Microsoft Research), 2023 — multi-agent conversation with speaker selection strategies
