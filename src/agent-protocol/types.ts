import type { Message, ToolCall, ToolDefinition } from "../shared/types.js";

// Re-export shared types so consumers only need one import
export type { Message, ToolCall, ToolDefinition };

// ─── Item Types ──────────────────────────────────────────────────────────────
//
// An Item is the atomic unit of protocol output. Every visible thing in the
// conversation — a message, a tool execution, an approval prompt — is an Item.
//
// Lifecycle: started → streaming (optional, for text) → completed

export type ItemType = "user_message" | "agent_message" | "tool_execution" | "approval_request";
export type ItemStatus = "started" | "streaming" | "completed";

export interface BaseItem {
  id: string;
  turnId: string;
  threadId: string;
  type: ItemType;
  status: ItemStatus;
  createdAt: number;
}

export interface UserMessageItem extends BaseItem {
  type: "user_message";
  content: string;
}

export interface AgentMessageItem extends BaseItem {
  type: "agent_message";
  content: string;
}

export interface ToolExecutionItem extends BaseItem {
  type: "tool_execution";
  toolName: string;
  toolArgs: Record<string, string>;
  result?: string;
  durationMs?: number;
}

export interface ApprovalRequestItem extends BaseItem {
  type: "approval_request";
  toolName: string;
  toolArgs: Record<string, string>;
  riskLevel: string;
  description: string;
  resolution?: "approved" | "denied";
}

export type Item = UserMessageItem | AgentMessageItem | ToolExecutionItem | ApprovalRequestItem;

// ─── Turn Types ──────────────────────────────────────────────────────────────
//
// A Turn groups all items from one agent work cycle (user sends input →
// agent thinks + acts → agent finishes). One user message always starts
// one turn. The turn may pause if an approval is needed.

export type TurnStatus = "in_progress" | "awaiting_approval" | "completed";

export interface Turn {
  id: string;
  threadId: string;
  status: TurnStatus;
  items: Item[];
  createdAt: number;
}

// ─── Thread Types ────────────────────────────────────────────────────────────
//
// A Thread is the durable session container. It holds the full conversation
// history (Message[]) and all turns. Clients can disconnect and reconnect —
// the thread retains all state.

export interface Thread {
  id: string;
  title: string;
  history: Message[];
  turns: Turn[];
  createdAt: number;
  updatedAt: number;
}

// ─── JSON-RPC 2.0 ────────────────────────────────────────────────────────────
//
// Standard JSON-RPC 2.0 types. Five methods:
//   thread.create  — start a new session
//   thread.list    — list all sessions
//   thread.get     — full session state (for resume/reconnect)
//   turn.submit    — send user input, start agent processing
//   turn.approve   — respond to an approval request

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── Protocol Events ─────────────────────────────────────────────────────────
//
// Server-push events, sent over SSE (HTTP) or JSONL (stdio).
// Discriminated union on `type` field.

export interface ItemStartedEvent {
  type: "item.started";
  threadId: string;
  turnId: string;
  item: Item;
}

export interface ItemDeltaEvent {
  type: "item.delta";
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ItemCompletedEvent {
  type: "item.completed";
  threadId: string;
  turnId: string;
  item: Item;
}

export interface TurnStartedEvent {
  type: "turn.started";
  threadId: string;
  turn: Turn;
}

export interface TurnAwaitingApprovalEvent {
  type: "turn.awaiting_approval";
  threadId: string;
  turnId: string;
  item: ApprovalRequestItem;
}

export interface TurnCompletedEvent {
  type: "turn.completed";
  threadId: string;
  turn: Turn;
}

export interface ErrorEvent {
  type: "error";
  threadId?: string;
  message: string;
}

export type ProtocolEvent =
  | ItemStartedEvent
  | ItemDeltaEvent
  | ItemCompletedEvent
  | TurnStartedEvent
  | TurnAwaitingApprovalEvent
  | TurnCompletedEvent
  | ErrorEvent;
