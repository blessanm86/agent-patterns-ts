# Replay, Debug, Audit -- Event Sourcing Patterns for AI Agents

[Agent Patterns -- TypeScript](../../README.md) | Builds on: [State Graph](../state-graph/README.md)

---

Your agent just made a bad decision at step 47 of a complex order workflow. The customer's address changed _after_ shipping started. With traditional state management, you see the current state and shrug -- the decision that led here is gone. With event sourcing, you replay the log to step 46, inspect exactly what the agent saw, and find the bug in three minutes.

Event sourcing is a well-established pattern from distributed systems. Applied to agents, it transforms opaque decision-making into a fully replayable, auditable, debuggable history. Every intention the agent has, every validation the orchestrator performs, every rejection -- it's all in the log.

## The Core Idea: Intentions, Not Mutations

In a normal agent, tools directly mutate state:

```
Agent calls change_address() --> database.update(order, { address: newAddr })
```

The old address is gone. There's no record of _what happened_ or _why_.

With event sourcing, the agent emits an **intention** -- a structured JSON object describing what it _wants_ to do. A **deterministic orchestrator** decides whether to allow it:

```
Agent emits intention         Orchestrator validates         Event Store
  { action: "CHANGE_ADDRESS",  --> checks business rules  --> appends event
    orderId: "ORD-001",         (is order shipped?)           { type: "ADDRESS_CHANGED",
    newAddress: "456 Oak Ave" }                                 seq: 3, timestamp: "..." }
                                                                     |
                                                               State Projection
                                                            (replay all events to
                                                             derive current state)
```

Three components, three responsibilities:

| Component        | Role                                        | Analogy                    |
| ---------------- | ------------------------------------------- | -------------------------- |
| **Agent**        | Emits structured intentions                 | A developer proposing a PR |
| **Orchestrator** | Validates intentions against business rules | CI checks + code review    |
| **Event Store**  | Append-only log of everything that happened | Git log                    |

The event store is the **source of truth**. Current state is always a **projection** -- derived by replaying the log. You never store "current state" separately. This means you can reconstruct the state at _any_ point in history.

## Walk Through the Implementation

### Event Types and the Store

Each event represents something that _happened_ -- past tense, immutable:

```typescript
export type OrderEvent =
  | { type: "ORDER_CREATED"; payload: { orderId: string; items: Item[]; address: string } }
  | { type: "ADDRESS_CHANGED"; payload: { orderId: string; newAddress: string } }
  | { type: "ITEM_ADDED"; payload: { orderId: string; item: Item } }
  | { type: "DISCOUNT_APPLIED"; payload: { orderId: string; code: string; percent: number } }
  | { type: "ORDER_CONFIRMED"; payload: { orderId: string } }
  | { type: "ORDER_SHIPPED"; payload: { orderId: string } }
  | {
      type: "INTENTION_REJECTED";
      payload: { orderId: string; attemptedAction: string; reason: string };
    };
```

Notice `INTENTION_REJECTED` is an event too. When the agent tries something invalid, the rejection goes into the log. Every decision -- accepted or rejected -- is recorded.

The `EventStore` class is straightforward:

```typescript
class EventStore {
  private log: StoredEvent[] = []; // append-only -- no updates, no deletes

  append(event: OrderEvent): StoredEvent; // add to log, return with seq + timestamp
  getEvents(): StoredEvent[]; // full log
  getEventsUpTo(seq: number): StoredEvent[]; // events up to sequence N
  projectState(): ProjectedState; // replay all --> current state
  projectStateAt(seq: number): ProjectedState; // replay to N --> past state
}
```

State is always derived by replaying events through a pure **reducer function**:

```typescript
function applyEvent(state: ProjectedState, stored: StoredEvent): ProjectedState {
  switch (stored.event.type) {
    case "ORDER_CREATED":
    // Create new order in state
    case "ADDRESS_CHANGED":
    // Update address on existing order
    case "DISCOUNT_APPLIED":
    // Add discount, recalculate total
    // ... every event type maps to a deterministic state transition
  }
}
```

This reducer is the _only_ place state transitions are defined. It's a pure function -- same events in, same state out. Always.

### The Orchestrator: Business Rules as a Gateway

The orchestrator sits between the agent and the event store. It validates intentions before they become events:

```typescript
class Orchestrator {
  processIntention(intention: Intention): IntentionResult {
    const currentState = this.store.projectState();
    const result = validateIntention(intention, currentState);

    if (result.valid) {
      const stored = this.store.append(result.event);
      return { accepted: true, event: result.event, seq: stored.seq };
    }

    // Rejection is itself an event -- it goes into the log
    const rejectionEvent = { type: "INTENTION_REJECTED", payload: { ... } };
    this.store.append(rejectionEvent);
    return { accepted: false, event: rejectionEvent };
  }
}
```

Business rules are explicit and testable:

- Can't change address after `ORDER_SHIPPED`
- Can't add items after `ORDER_CONFIRMED`
- Can't apply a discount code twice
- Can't confirm an order with zero items
- Can't ship an unconfirmed order

When the orchestrator rejects an intention, the agent gets a structured error message. It can reason about the rejection and suggest alternatives -- "I can't change the address because the order already shipped. Would you like to contact support?"

### Tools: Intentions, Not Executions

The tools look normal to the agent, but internally they create intentions instead of executing actions:

```typescript
function changeAddress(args: { order_id: string; new_address: string }): string {
  const intention: Intention = {
    action: "CHANGE_ADDRESS",
    orderId: args.order_id,
    newAddress: args.new_address,
  };
  return processIntention(intention); // orchestrator validates --> event store
}
```

The agent's ReAct loop is completely unchanged from the basic pattern. Event sourcing is layered underneath -- an infrastructure concern, not an agent-architecture concern.

## Time-Travel Debugging

This is the killer feature. The `/replay` command reconstructs state at any point in history:

```
/replay 3

  Time-travel replay: events 1-3
  #1 [21:14:26] ORDER_CREATED -- ORD-001 (2 items -> 123 Main St)
  #2 [21:14:27] ADDRESS_CHANGED -- ORD-001 -> 456 Oak Ave
  #3 [21:14:28] DISCOUNT_APPLIED -- ORD-001 (SAVE10 10%)

  State after event #3:
  ORD-001 [created]
    Address: 456 Oak Ave
    - Laptop x1 @ $999
    - Mouse x2 @ $29
    Discounts: SAVE10 (10%)
    Total: $951.30
```

At event #3, the order is still in `created` status with the discount applied. The confirmation and shipping haven't happened yet. You can see exactly what the agent knew at each decision point.

Compare this with traditional debugging: you'd need to reproduce the entire run, hope the LLM makes the same decisions (it won't -- LLMs are non-deterministic), and try to catch the moment things went wrong.

### How Determinism Works with Non-Deterministic LLMs

A common objection: "Event sourcing requires deterministic replay, but LLMs are non-deterministic."

The resolution is simple: **record the LLM's actual output as the event, not the input**. The event log captures "what the LLM decided," not "what we asked it." Replay uses the recorded decisions, never re-invokes the LLM.

This is the same approach used by Temporal (record Activity results) and the ESAA framework (record `agent.result` events). The orchestrator is deterministic; the LLM is not -- but the LLM's output is captured before the orchestrator processes it.

## When the Orchestrator Says No

Rejected intentions are first-class events. The full event log for a session might look like:

```
/events

  Event Log (8 events):
  #1 [21:14:26] ORDER_CREATED -- ORD-001 (2 items -> 123 Main St)
  #2 [21:14:27] ADDRESS_CHANGED -- ORD-001 -> 456 Oak Ave
  #3 [21:14:28] DISCOUNT_APPLIED -- ORD-001 (SAVE10 10%)
  #4 [21:14:30] ORDER_CONFIRMED -- ORD-001
  #5 [21:14:31] ORDER_SHIPPED -- ORD-001
  #6 [21:14:35] REJECTED -- ORD-001 tried CHANGE_ADDRESS: Cannot change address -- order has already shipped
  #7 [21:14:40] REJECTED -- ORD-001 tried ADD_ITEM: Cannot add items -- order is already shipped
  #8 [21:14:45] REJECTED -- ORD-001 tried APPLY_DISCOUNT: Cannot apply discount -- order is already shipped
```

Events #6-8 show the agent tried three things after shipping, and all were rejected. In a compliance audit, this is gold -- you can prove the system enforced the rules, and you can see exactly what the agent attempted.

## Tradeoffs: Event Sourcing Overhead vs. Direct Mutation

| Dimension            | Direct Mutation                     | Event Sourcing                                                 |
| -------------------- | ----------------------------------- | -------------------------------------------------------------- |
| **State access**     | O(1) -- read current state directly | O(n) -- replay events to derive state (mitigated by snapshots) |
| **Storage**          | Current state only                  | Full history (grows over time)                                 |
| **Debugging**        | Current state only -- past is lost  | Time-travel to any point                                       |
| **Audit trail**      | Must be built separately            | Free -- the log _is_ the audit trail                           |
| **Complexity**       | Simple -- just mutate               | More moving parts (store, orchestrator, projections)           |
| **Schema evolution** | Change the schema, migrate data     | Must handle old event formats (versioning)                     |
| **Undo/rollback**    | Difficult or impossible             | Natural -- replay to before the mistake                        |

**When event sourcing is worth the overhead for agents:**

- Multi-step workflows where debugging requires understanding step sequences
- Compliance/audit requirements demanding complete decision trails
- Production debugging of non-obvious failures in long-running tasks
- Multi-agent coordination where agents need shared visibility
- Undo/rollback capability is required

**When it's not worth it:**

- Simple single-turn Q&A (no state to track)
- Prototyping (overhead not justified yet)
- Team lacks event sourcing experience (operational complexity is real)

## Comparison with Framework Approaches

Different frameworks take different approaches to agent state persistence:

| Framework     | Approach                                                     | Time-Travel                   | Audit Trail                         |
| ------------- | ------------------------------------------------------------ | ----------------------------- | ----------------------------------- |
| **This demo** | True event sourcing (append-only events, state = projection) | Full replay to any seq        | Complete -- events + rejections     |
| **LangGraph** | Snapshot checkpointing (full state saved at each super-step) | Fork from any checkpoint      | Partial -- snapshots, not deltas    |
| **Temporal**  | Event history replay (closest to true ES in production)      | Automatic on crash recovery   | Complete -- every Activity recorded |
| **ESAA**      | Formal ES with SHA-256 hash verification                     | Verified deterministic replay | Hash-verified integrity chain       |

LangGraph stores full state snapshots -- simpler (O(1) state access) but larger and less granular. True event sourcing stores only the deltas -- more complex but enables richer analysis ("show me every address change across all orders").

The ESAA paper (arXiv 2602.23193, 2026) takes this furthest: LLMs as "intention emitters under contract" with JSON Schema validation, boundary contracts, and SHA-256 hash chains for forensic verification. Their case study ran 4 concurrent heterogeneous LLM agents across 50 tasks with zero rejected outputs and verified replay integrity.

## In the Wild: Coding Agent Harnesses

Event sourcing patterns appear across coding agent harnesses, though often in disguise.

**Aider** uses Git commits as its event store -- the most elegant implementation of the pattern. Every AI edit is automatically committed with a descriptive message. The `/undo` command reverts the last commit. Git provides everything event sourcing promises: an immutable append-only log, full state reconstruction from any point, diffable history, and attribution tracking. Aider didn't set out to build event sourcing; it just used the tool that already implements it.

**Claude Code** stores conversations in append-only `.jsonl` files -- one JSON object per turn with timestamp, session ID, and content. The `--resume` flag reconstructs a session from its JSONL file (replay). Double-Escape rewinds to a prior state. Automatic summarization when approaching token limits works like event stream compaction/snapshotting. The Enterprise Compliance API logs `claude_code.user_prompt` and `claude_code.tool_result` events for audit.

**OpenCode** is the most explicitly event-sourced harness. It takes Git tree snapshots (via `git write-tree` without committing) at each tool call and exposes an internal event bus via Server-Sent Events. Full `/undo`/`/redo` with file change restoration comes for free from the snapshot log.

**Cline** creates Git checkpoints at every tool call, enabling message-level workspace restore -- "infinite undo" powered by an event log of file system snapshots.

**Temporal** powers the infrastructure for several cloud agents (OpenAI Codex, Replit Agent). Its Event History records every workflow step and Activity result. On crash, the system replays the history to reconstruct state automatically -- true event sourcing applied to agent execution infrastructure.

The pattern surfaces differently in each harness, but the core value proposition is identical: an immutable log of what happened enables replay, debugging, and audit that direct state mutation cannot provide.

## Key Takeaways

1. **Agents should emit intentions, not execute actions.** A deterministic orchestrator validates and records every decision. This separation is the foundation of debuggable, auditable agents.

2. **The event log is the source of truth.** Current state is always derived by replaying events. This gives you time-travel debugging, audit trails, and undo for free.

3. **Rejected intentions are events too.** Recording what the agent _tried_ to do (and why it was blocked) is as valuable as recording what succeeded. For compliance, it's essential.

4. **Event sourcing is an infrastructure concern, not an agent architecture concern.** The ReAct loop is unchanged. You layer event sourcing underneath by making tools emit intentions instead of executing mutations.

5. **The determinism objection is solved by recording outputs, not inputs.** Record the LLM's actual decision as the event. Replay uses the recorded output, never re-invokes the LLM.

6. **Git is a natural event store.** Aider, OpenCode, and Cline all use Git (commits or tree snapshots) as their event log. If your agent modifies files, you may already have event sourcing -- you just need to formalize it.

## Sources & Further Reading

- [ESAA: Event Sourcing for Autonomous Agents](https://arxiv.org/abs/2602.23193) -- Santos Filho, 2026 -- formal treatment with forensic traceability, SHA-256 verification, and multi-agent case studies
- [Event Sourcing -- Martin Fowler](https://martinfowler.com/eaaDev/EventSourcing.html) -- the canonical reference for the pattern in software architecture
- [Four Design Patterns for Event-Driven Multi-Agent Systems](https://www.confluent.io/blog/event-driven-multi-agent-systems/) -- Confluent, 2025 -- orchestrator-worker, hierarchical, blackboard, and market-based patterns
- [LangGraph Persistence](https://langchain-ai.github.io/langgraph/concepts/persistence/) -- checkpoint-based approach to agent state with time-travel
- [Durable Execution Meets AI](https://temporal.io/blog/durable-execution-meets-ai-why-temporal-is-the-perfect-foundation-for-ai) -- Temporal -- event history replay for AI agent workflows
- [Event Sourcing: The Backbone of Agentic AI](https://akka.io/blog/event-sourcing-the-backbone-of-agentic-ai) -- Akka -- why ES is the central pillar for agent state management
- [Why We Built Our Multi-Agent System on Kafka](https://www.novatechflow.com/2026/02/why-we-built-our-multi-agent-system-on.html) -- NovaTechFlow -- production case study, debugging time from hours to 15 minutes
- [Debugging Non-Deterministic LLM Agents with Checkpoint-Based State Replay](https://dev.to/sreeni5018/debugging-non-deterministic-llm-agents-implementing-checkpoint-based-state-replay-with-langgraph-5171) -- practitioner walkthrough of LangGraph time-travel
