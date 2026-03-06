# Sub-Agent Event Demultiplexing

[Agent Patterns -- TypeScript](../../README.md)

> Builds on [Sub-Agent Delegation](../sub-agent-delegation/README.md) and [Streaming Responses](../streaming/README.md)

When a parent agent delegates to sub-agents that use different streaming protocols, you need a **stateful transformer** that normalizes the foreign event streams into your host's typed message schema. Without it, events from different protocols interleave into an unattributable mess -- text from two agents merges into one blob, tool call arguments concatenate across agent boundaries, and there's no way to track which agent is still running.

This is the **event demultiplexing** problem: taking a flat stream of heterogeneous events and routing each one to the correct per-agent accumulator.

## The Two-Layer Problem

Event demultiplexing has two distinct layers, and you need both:

```
Layer 1: Provider Normalization
  Anthropic SSE events  ──┐
                           ├──→  Canonical Events (start/delta/end)
  OpenAI Response events ──┘

Layer 2: Sub-Agent Routing
  Canonical events ──→ Demultiplexer ──→ Per-agent accumulators
  (all interleaved)     (routes by         (flight agent text,
                         sourceAgentId)     hotel agent tools...)
```

**Layer 1** solves the schema problem: Anthropic uses `content_block_delta` with an `index` field; OpenAI uses `response.output_text.delta` with `output_index`/`content_index`. These are structurally incompatible. A protocol adapter translates each into a canonical format.

**Layer 2** solves the attribution problem: once events are normalized, a demultiplexer routes them by source. Every canonical event carries a `sourceAgentId` tag -- the demultiplexing key.

## Why the Protocols Are Incompatible

The two dominant LLM streaming protocols route deltas differently:

| Concern               | Anthropic                                                   | OpenAI Responses API                                  |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| **Routing key**       | `index` on content blocks                                   | `(output_index, content_index)`                       |
| **Text deltas**       | `content_block_delta` with `delta.type: "text_delta"`       | `response.output_text.delta` with flat `delta` string |
| **Tool arg deltas**   | `content_block_delta` with `delta.type: "input_json_delta"` | `response.function_call_arguments.delta`              |
| **Completion signal** | `message_stop`                                              | `response.completed`                                  |
| **Ground truth**      | Accumulated deltas are authoritative                        | `.done` events override accumulated deltas            |
| **Keepalives**        | `ping` events interspersed                                  | None                                                  |
| **Hierarchy**         | Message > Content Blocks                                    | Response > Output Items > Content Parts               |

A naive consumer that just extracts "text-like" fields from both protocols gets garbled output:

```
"I found Here are the top hotel opseveral tions in Portland..."
```

That's flight agent text ("I found several flights...") interleaved word-by-word with hotel agent text ("Here are the top hotel options..."). Unusable.

## The Canonical Event Schema

Our canonical schema uses the **start/delta/end lifecycle** pattern that's converging as an industry standard across Vercel AI SDK, AG-UI (CopilotKit), and the Strands SDK:

```typescript
// Every event carries the demultiplexing key
interface TextDelta {
  type: "text_delta";
  sourceAgentId: string; // ← the demux key
  blockId: string; // ← routes to correct accumulator
  text: string;
}
```

The full event set:

| Event                                    | Purpose                                    |
| ---------------------------------------- | ------------------------------------------ |
| `agent_start` / `agent_end`              | Lifecycle boundaries per sub-agent         |
| `text_start` / `text_delta` / `text_end` | Text content with progressive accumulation |
| `tool_start` / `tool_delta` / `tool_end` | Tool calls with streamed arguments         |
| `error`                                  | In-band error reporting                    |

This is intentionally minimal. A production system might add `thinking_start`/`thinking_delta`/`thinking_end` for extended thinking, `source` events for citations, or `usage` events for token tracking. The pattern is the same: `{type}_start` initializes, `{type}_delta` accumulates, `{type}_end` finalizes.

## Protocol Adapters

Each adapter is a stateful class that maintains per-block accumulators and maps foreign events to canonical ones. Here's the Anthropic adapter's core logic:

```typescript
class AnthropicAdapter {
  private blocks: Map<number, BlockState> = new Map();

  transform(event: AnthropicEvent): CanonicalEvent[] {
    switch (event.type) {
      case "content_block_start": {
        // Index tells us which block this is (0 = text, 1 = tool_use, etc.)
        const blockId = `${this.agentId}:block-${event.index}`;
        if (event.content_block.type === "text") {
          this.blocks.set(event.index, { type: "text", accumulated: "" });
          return [{ type: "text_start", sourceAgentId: this.agentId, blockId }];
        } else {
          this.blocks.set(event.index, {
            type: "tool_use",
            accumulated: "",
            toolName: event.content_block.name,
          });
          return [
            {
              type: "tool_start",
              sourceAgentId: this.agentId,
              blockId,
              toolName: event.content_block.name,
            },
          ];
        }
      }

      case "content_block_delta": {
        // Route delta to correct block using the index
        const block = this.blocks.get(event.index);
        if (event.delta.type === "text_delta") {
          block.accumulated += event.delta.text;
          return [
            { type: "text_delta", sourceAgentId: this.agentId, blockId, text: event.delta.text },
          ];
        }
        // ... handle input_json_delta for tool args
      }

      case "ping":
        return []; // Filter protocol-specific keepalives
    }
  }
}
```

The OpenAI adapter follows the same pattern but uses `(output_index, content_index)` as its routing key and trusts `.done` events as ground truth rather than accumulated deltas.

Key design decisions in the adapters:

1. **One-to-many mapping**: A single foreign event can produce zero or more canonical events. `ping` produces zero; most produce one; a future `message_start` with pre-populated content could produce several.
2. **Stateful accumulation**: Adapters track in-progress blocks so `text_end` can include the full accumulated text. This means adapters must be per-agent instances, not shared.
3. **Protocol-specific filtering**: Anthropic `ping` events, OpenAI `response.output_item.done` structural events -- these have no canonical equivalent and are silently dropped.

## The Demultiplexer

Once events are canonical, the `EventDemultiplexer` routes them by `sourceAgentId`:

```typescript
class EventDemultiplexer {
  private agents: Map<string, AgentAccumulator> = new Map();

  process(event: CanonicalEvent): void {
    switch (event.type) {
      case "agent_start":
        this.agents.set(event.sourceAgentId, {
          agentId: event.sourceAgentId,
          blocks: [],
          started: true,
          ended: false,
        });
        break;

      case "text_delta": {
        const agent = this.agents.get(event.sourceAgentId);
        const block = agent?.blocks.find((b) => b.blockId === event.blockId);
        if (block) block.content += event.text;
        break;
      }
      // ... similar for tool events
    }
  }

  allComplete(): boolean {
    return [...this.agents.values()].every((a) => a.ended);
  }
}
```

The demultiplexer is deliberately simple -- just a `Map<string, AgentAccumulator>` keyed by agent ID. This is the same approach Claude Code uses with `parent_tool_use_id`: a flat tag on every event, a simple equality check for grouping. No namespace hierarchies, no state machines tracking "active agent" transitions.

## The Demo

Run both modes to see the contrast:

```bash
pnpm dev:event-demux        # both raw and demux modes
pnpm dev:event-demux --raw  # raw mode only (the problem)
pnpm dev:event-demux --demux # demux mode only (the solution)
```

**Raw mode** consumes events from both protocols without normalization. Text from the flight agent (Anthropic-like) and hotel agent (OpenAI-like) merges into one unreadable blob. Tool arguments concatenate across agents. There's no lifecycle tracking.

**Demux mode** passes each agent's events through the appropriate protocol adapter into canonical events, then through the demultiplexer. Output is color-coded per agent, text accumulates correctly, tool calls are properly attributed, and completion is tracked per agent.

## How the Industry Approaches This

Five distinct patterns have emerged for sub-agent event demultiplexing:

### 1. Flat Tag (Claude Code, VoltAgent)

Every event carries a source identifier. Claude Code uses `parent_tool_use_id` on every `StreamEvent` -- `null` for the main agent, set to the parent Task tool's ID for sub-agents. VoltAgent goes further with `subAgentId`, `subAgentName`, `parentAgentId`, and `agentPath` (full trace from supervisor to executor).

**Tradeoff**: Simplest to implement and consume. Only works cleanly when sub-agents don't spawn sub-sub-agents (Claude Code enforces this structurally). Our demo uses this pattern.

### 2. Namespace Hierarchy (LangGraph)

Events become `(namespace_tuple, data)` tuples. The namespace is hierarchical: `("parent_node:<task_id>", "child_node:<task_id>")`. Supports arbitrary nesting depth.

**Tradeoff**: Most expressive, but fragile -- known bugs with RemoteGraph namespaces (#6604) and combining multiple stream modes with subgraphs (#5932). The complexity tax is real.

### 3. Active Agent State Machine (OpenAI Agents SDK)

No per-event tags. Instead, `AgentUpdatedStreamEvent` fires on handoffs, and the consumer tracks which agent is "current." Events are attributed by temporal ordering.

**Tradeoff**: Simple for sequential handoffs. Breaks entirely for parallel sub-agents -- you can't track two "current" agents at once. OpenAI is adding `agentName` annotations to fix this gap (openai-agents-js #705).

### 4. Avoid the Problem (Cursor, Aider, Anthropic's own multi-agent system)

Run sub-agents in isolated contexts (separate sessions, separate worktrees, separate processes) and wait for complete results. No interleaved events means no demultiplexing needed.

**Tradeoff**: Simplest architecture. But the UI freezes during sub-agent execution -- no progressive output. Anthropic's multi-agent research system uses this approach: "our lead agents execute subagents synchronously, waiting for each set of subagents to complete before proceeding."

### 5. Canonical Event Envelope (Vercel AI SDK)

Define a universal `start/delta/end` lifecycle format. Provider-specific adapters translate native events into this canonical schema. Used by OpenCode and other harnesses built on the AI SDK.

**Tradeoff**: Clean abstraction but doesn't address sub-agent routing by itself -- you need to add a routing key on top.

## Common Pitfalls

**Event duplication at adapter boundaries.** When an adapter wraps foreign events, it can produce both the wrapper and the original if not careful. Google ADK's A2A integration hit this: the A2A executor echoed request messages back as server events and also sent native ADK events for the same content (#3207).

**Buffering instead of forwarding.** Multi-agent orchestrators often accumulate sub-agent output and release it in batches. GitHub Copilot SDK's sub-agent events queued for 9-47 seconds then burst out simultaneously (#477). The Strands Agents SDK had the same issue -- single agents streamed but multi-agent orchestrations buffered everything until completion (#912).

**Provider-specific chunk sizes.** Anthropic sends small per-token chunks. OpenAI sends slightly larger chunks. Gemini sends entire sentences. A naive accumulator that assumes consistent chunk sizes will render differently per provider.

**Lost provenance on merge.** When events from multiple sub-agents merge into one stream without source metadata, the parent can't attribute results. This is the core problem our demo shows in raw mode -- once the text is merged, you can't un-merge it.

**Usage/metadata timing.** OpenAI sends token usage only in the final `response.completed` event. Anthropic spreads it across `message_start` and `message_delta`. A normalizer that expects usage at a fixed point in the stream will miss it for one provider.

## In the Wild: Coding Agent Harnesses

**Claude Code** has the most explicit demultiplexing of any coding harness. Every `StreamEvent` in the Claude Agent SDK carries a `parent_tool_use_id: string | null` field. When a streaming event comes from a sub-agent (spawned via the Task tool), this field is set to the Task tool's use ID. The main agent's events have it set to `null`. Multiple sub-agents can run concurrently (background tasks via Ctrl+B), producing interleaved events separated by this key. Claude Code also prevents recursive nesting -- sub-agents cannot spawn sub-agents -- which bounds demux complexity to one level.

**Cline** handles the provider normalization layer through its `ApiHandler`/`ApiStream` pattern. All 35+ LLM providers implement `createMessage() -> ApiStream`, which yields normalized chunks. Internally, Cline uses Anthropic's message format as canonical and transforms OpenAI-format providers to match. The `parseAssistantMessageV2()` parser then demuxes the normalized stream into `TextStreamContent` and `ToolUse` discriminated types. Cline CLI 2.0 introduced sub-cline spawning, but execution is currently sequential -- no interleaved event streams yet.

**OpenCode** (Go-based) defines a clean typed event union (`content_start`, `tool_use_start`, `content_delta`, etc.) built on the Vercel AI SDK's `streamText`. A pub/sub broker broadcasts `AgentEvent`s system-wide, and the TUI subscribes to this bus. Sub-agents run in separate sessions with separate event buses, avoiding the interleaving problem entirely.

**Cursor** takes the most radical approach: up to 8 parallel agents run in separate git worktrees, each with their own event stream and UI panel. There is no event demultiplexing because there is no event multiplexing -- isolation at the process level.

The industry pattern is clear: most harnesses avoid true event demultiplexing by running sub-agents in isolation. Only Claude Code multiplexes sub-agent events onto a single stream and provides a first-class demux key.

## Key Takeaways

1. **The problem has two layers**: provider normalization (schema translation) and sub-agent routing (attribution). You need both for multi-provider multi-agent systems.

2. **start/delta/end is the canonical lifecycle**: This three-phase pattern is converging as an industry standard. It handles partial accumulation cleanly -- start initializes, deltas accumulate, end finalizes.

3. **Tag every event with its source**: A flat `sourceAgentId` on every canonical event is simpler and more robust than namespace hierarchies or active-agent state machines. It's what Claude Code uses in production.

4. **Adapters must be stateful**: Protocol adapters need per-block accumulators to reconstruct complete messages from deltas. They must be per-agent instances, not shared.

5. **Most production systems avoid the problem entirely**: Running sub-agents in isolated contexts and waiting for complete results is the dominant pattern. True streaming demultiplexing is harder but provides a better user experience (progressive output instead of a frozen UI).

## Sources & Further Reading

- [Anthropic Messages Streaming](https://docs.anthropic.com/en/api/messages-streaming) -- Claude SSE event types with index-based routing
- [OpenAI Responses API Streaming](https://platform.openai.com/docs/api-reference/responses-streaming) -- 53 event types with output_index/content_index routing
- [OpenAI Agents SDK Streaming](https://openai.github.io/openai-agents-python/streaming/) -- RawResponsesStreamEvent, RunItemStreamEvent, AgentUpdatedStreamEvent
- [openai-agents-js #705](https://github.com/openai/openai-agents-js/issues/705) -- proposed `agentName` annotation for unified sub-agent streaming
- [LangGraph Subgraph Streaming](https://langchain-ai.github.io/langgraph/how-tos/streaming-subgraphs/) -- namespace tuple demultiplexing
- [Vercel AI SDK Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) -- canonical start/delta/end lifecycle
- [Claude Agent SDK Streaming](https://platform.claude.com/docs/en/agent-sdk/streaming-output) -- `parent_tool_use_id` demux key
- [VoltAgent Sub-Agents](https://voltagent.dev/docs/agents/sub-agents/) -- hierarchical metadata forwarding with agentPath
- [Anthropic Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system) -- synchronous sub-agent execution (avoiding the problem)
- [Google ADK Streaming](https://developers.googleblog.com/en/beyond-request-response-architecting-real-time-bidirectional-streaming-multi-agent-system/) -- session-based streaming with signal segmentation
- [How Streaming LLM APIs Work (Simon Willison)](https://til.simonwillison.net/llms/streaming-llm-apis) -- concrete differences between provider SSE formats
- [Survey of Agent Interoperability Protocols (arXiv:2505.02279)](https://arxiv.org/html/2505.02279v1) -- MCP, ACP, A2A, ANP comparison
- [AG-UI Protocol (CopilotKit)](https://www.copilotkit.ai/blog/ag-ui-protocol-bridging-agents-to-any-front-end) -- typed event protocol for agent-to-UI communication
