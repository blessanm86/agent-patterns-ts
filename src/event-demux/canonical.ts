// ─── Canonical Event Schema ─────────────────────────────────────────────────
//
// The normalized event format that the parent orchestrator works with.
// Follows the start/delta/end lifecycle pattern that's converging as an
// industry standard (Vercel AI SDK, AG-UI, Strands SDK all use it).
//
// Every event carries a sourceAgentId — the demultiplexing key. This is
// inspired by Claude Code's parent_tool_use_id: a flat tag on every event
// that lets consumers attribute events to the correct sub-agent.

// ─── Canonical Event Types ──────────────────────────────────────────────────

export interface TextStart {
  type: "text_start";
  sourceAgentId: string;
  blockId: string;
}

export interface TextDelta {
  type: "text_delta";
  sourceAgentId: string;
  blockId: string;
  text: string;
}

export interface TextEnd {
  type: "text_end";
  sourceAgentId: string;
  blockId: string;
  fullText: string;
}

export interface ToolStart {
  type: "tool_start";
  sourceAgentId: string;
  blockId: string;
  toolName: string;
}

export interface ToolDelta {
  type: "tool_delta";
  sourceAgentId: string;
  blockId: string;
  partialArgs: string;
}

export interface ToolEnd {
  type: "tool_end";
  sourceAgentId: string;
  blockId: string;
  toolName: string;
  arguments: string;
}

export interface AgentStart {
  type: "agent_start";
  sourceAgentId: string;
  agentName: string;
}

export interface AgentEnd {
  type: "agent_end";
  sourceAgentId: string;
  agentName: string;
}

export interface ErrorEvent {
  type: "error";
  sourceAgentId: string;
  message: string;
}

export type CanonicalEvent =
  | TextStart
  | TextDelta
  | TextEnd
  | ToolStart
  | ToolDelta
  | ToolEnd
  | AgentStart
  | AgentEnd
  | ErrorEvent;

// ─── Anthropic Adapter ──────────────────────────────────────────────────────
//
// Transforms Anthropic-like events into canonical events.
// Maintains per-index accumulators to track text and tool_use blocks.

import type { AnthropicEvent } from "./protocols.js";
import type { OpenAIEvent } from "./protocols.js";

interface AnthropicBlockState {
  type: "text" | "tool_use";
  accumulated: string;
  toolName?: string;
  toolId?: string;
}

export class AnthropicAdapter {
  private agentId: string;
  private agentName: string;
  private blocks: Map<number, AnthropicBlockState> = new Map();

  constructor(agentId: string, agentName: string) {
    this.agentId = agentId;
    this.agentName = agentName;
  }

  transform(event: AnthropicEvent): CanonicalEvent[] {
    const out: CanonicalEvent[] = [];

    switch (event.type) {
      case "message_start":
        out.push({ type: "agent_start", sourceAgentId: this.agentId, agentName: this.agentName });
        break;

      case "content_block_start": {
        const blockId = `${this.agentId}:block-${event.index}`;
        if (event.content_block.type === "text") {
          this.blocks.set(event.index, { type: "text", accumulated: "" });
          out.push({ type: "text_start", sourceAgentId: this.agentId, blockId });
        } else {
          this.blocks.set(event.index, {
            type: "tool_use",
            accumulated: "",
            toolName: event.content_block.name,
            toolId: event.content_block.id,
          });
          out.push({
            type: "tool_start",
            sourceAgentId: this.agentId,
            blockId,
            toolName: event.content_block.name,
          });
        }
        break;
      }

      case "content_block_delta": {
        const blockId = `${this.agentId}:block-${event.index}`;
        const block = this.blocks.get(event.index);
        if (!block) break;

        if (event.delta.type === "text_delta") {
          block.accumulated += event.delta.text;
          out.push({
            type: "text_delta",
            sourceAgentId: this.agentId,
            blockId,
            text: event.delta.text,
          });
        } else if (event.delta.type === "input_json_delta") {
          block.accumulated += event.delta.partial_json;
          out.push({
            type: "tool_delta",
            sourceAgentId: this.agentId,
            blockId,
            partialArgs: event.delta.partial_json,
          });
        }
        break;
      }

      case "content_block_stop": {
        const blockId = `${this.agentId}:block-${event.index}`;
        const block = this.blocks.get(event.index);
        if (!block) break;

        if (block.type === "text") {
          out.push({
            type: "text_end",
            sourceAgentId: this.agentId,
            blockId,
            fullText: block.accumulated,
          });
        } else {
          out.push({
            type: "tool_end",
            sourceAgentId: this.agentId,
            blockId,
            toolName: block.toolName!,
            arguments: block.accumulated,
          });
        }
        this.blocks.delete(event.index);
        break;
      }

      case "message_stop":
        out.push({ type: "agent_end", sourceAgentId: this.agentId, agentName: this.agentName });
        break;

      // ping and message_delta are protocol-level — no canonical equivalent
      case "ping":
      case "message_delta":
        break;
    }

    return out;
  }

  reset(): void {
    this.blocks.clear();
  }
}

// ─── OpenAI Adapter ─────────────────────────────────────────────────────────
//
// Transforms OpenAI-like events into canonical events.
// Uses output_index and content_index to route deltas to correct accumulators.

interface OpenAIBlockState {
  type: "text" | "function_call";
  accumulated: string;
  toolName?: string;
}

export class OpenAIAdapter {
  private agentId: string;
  private agentName: string;
  private blocks: Map<string, OpenAIBlockState> = new Map();

  constructor(agentId: string, agentName: string) {
    this.agentId = agentId;
    this.agentName = agentName;
  }

  private blockKey(outputIndex: number, contentIndex?: number): string {
    return contentIndex !== undefined ? `${outputIndex}:${contentIndex}` : `${outputIndex}`;
  }

  transform(event: OpenAIEvent): CanonicalEvent[] {
    const out: CanonicalEvent[] = [];

    switch (event.type) {
      case "response.created":
        out.push({ type: "agent_start", sourceAgentId: this.agentId, agentName: this.agentName });
        break;

      case "response.output_item.added": {
        if (event.item.type === "function_call") {
          const key = this.blockKey(event.output_index);
          const blockId = `${this.agentId}:out-${key}`;
          this.blocks.set(key, {
            type: "function_call",
            accumulated: "",
            toolName: event.item.name,
          });
          out.push({
            type: "tool_start",
            sourceAgentId: this.agentId,
            blockId,
            toolName: event.item.name ?? "unknown",
          });
        }
        break;
      }

      case "response.content_part.added": {
        if (event.part.type === "output_text") {
          const key = this.blockKey(event.output_index, event.content_index);
          const blockId = `${this.agentId}:out-${key}`;
          this.blocks.set(key, { type: "text", accumulated: "" });
          out.push({ type: "text_start", sourceAgentId: this.agentId, blockId });
        }
        break;
      }

      case "response.output_text.delta": {
        const key = this.blockKey(event.output_index, event.content_index);
        const blockId = `${this.agentId}:out-${key}`;
        const block = this.blocks.get(key);
        if (block) block.accumulated += event.delta;
        out.push({ type: "text_delta", sourceAgentId: this.agentId, blockId, text: event.delta });
        break;
      }

      case "response.function_call_arguments.delta": {
        const key = this.blockKey(event.output_index);
        const blockId = `${this.agentId}:out-${key}`;
        const block = this.blocks.get(key);
        if (block) block.accumulated += event.delta;
        out.push({
          type: "tool_delta",
          sourceAgentId: this.agentId,
          blockId,
          partialArgs: event.delta,
        });
        break;
      }

      case "response.output_text.done": {
        const key = this.blockKey(event.output_index, event.content_index);
        const blockId = `${this.agentId}:out-${key}`;
        // Trust the .done event as ground truth (OpenAI convention)
        out.push({ type: "text_end", sourceAgentId: this.agentId, blockId, fullText: event.text });
        this.blocks.delete(key);
        break;
      }

      case "response.function_call_arguments.done": {
        const key = this.blockKey(event.output_index);
        const blockId = `${this.agentId}:out-${key}`;
        const block = this.blocks.get(key);
        out.push({
          type: "tool_end",
          sourceAgentId: this.agentId,
          blockId,
          toolName: block?.toolName ?? "unknown",
          arguments: event.arguments,
        });
        this.blocks.delete(key);
        break;
      }

      case "response.completed":
        out.push({ type: "agent_end", sourceAgentId: this.agentId, agentName: this.agentName });
        break;

      // Structural events without canonical equivalent
      case "response.output_item.done":
        break;
    }

    return out;
  }

  reset(): void {
    this.blocks.clear();
  }
}

// ─── Demultiplexer ──────────────────────────────────────────────────────────
//
// Collects canonical events from multiple adapters and provides per-agent
// accumulation. This is the central piece: it takes a flat stream of
// canonical events (all interleaved) and groups them by sourceAgentId.

export interface AccumulatedBlock {
  blockId: string;
  type: "text" | "tool";
  content: string;
  toolName?: string;
  complete: boolean;
}

export interface AgentAccumulator {
  agentId: string;
  agentName: string;
  blocks: AccumulatedBlock[];
  started: boolean;
  ended: boolean;
}

export class EventDemultiplexer {
  private agents: Map<string, AgentAccumulator> = new Map();

  process(event: CanonicalEvent): void {
    switch (event.type) {
      case "agent_start": {
        this.agents.set(event.sourceAgentId, {
          agentId: event.sourceAgentId,
          agentName: event.agentName,
          blocks: [],
          started: true,
          ended: false,
        });
        break;
      }

      case "text_start": {
        const agent = this.agents.get(event.sourceAgentId);
        if (agent) {
          agent.blocks.push({ blockId: event.blockId, type: "text", content: "", complete: false });
        }
        break;
      }

      case "text_delta": {
        const agent = this.agents.get(event.sourceAgentId);
        const block = agent?.blocks.find((b) => b.blockId === event.blockId);
        if (block) block.content += event.text;
        break;
      }

      case "text_end": {
        const agent = this.agents.get(event.sourceAgentId);
        const block = agent?.blocks.find((b) => b.blockId === event.blockId);
        if (block) {
          block.content = event.fullText;
          block.complete = true;
        }
        break;
      }

      case "tool_start": {
        const agent = this.agents.get(event.sourceAgentId);
        if (agent) {
          agent.blocks.push({
            blockId: event.blockId,
            type: "tool",
            content: "",
            toolName: event.toolName,
            complete: false,
          });
        }
        break;
      }

      case "tool_delta": {
        const agent = this.agents.get(event.sourceAgentId);
        const block = agent?.blocks.find((b) => b.blockId === event.blockId);
        if (block) block.content += event.partialArgs;
        break;
      }

      case "tool_end": {
        const agent = this.agents.get(event.sourceAgentId);
        const block = agent?.blocks.find((b) => b.blockId === event.blockId);
        if (block) {
          block.content = event.arguments;
          block.toolName = event.toolName;
          block.complete = true;
        }
        break;
      }

      case "agent_end": {
        const agent = this.agents.get(event.sourceAgentId);
        if (agent) agent.ended = true;
        break;
      }

      case "error":
        break;
    }
  }

  getAgent(agentId: string): AgentAccumulator | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentAccumulator[] {
    return [...this.agents.values()];
  }

  allComplete(): boolean {
    return this.agents.size > 0 && [...this.agents.values()].every((a) => a.ended);
  }
}
