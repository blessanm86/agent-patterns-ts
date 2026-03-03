// ─── Re-exports ──────────────────────────────────────────────────────────────

export type { Message, ToolCall, ToolDefinition } from "../shared/types.js";

// ─── Webhook Event Types ─────────────────────────────────────────────────────
//
// Modeled after GitHub webhook payloads. Each event carries a delivery_id
// (for idempotency) and a timestamp (for replay protection).

export interface PullRequestEvent {
  type: "pull_request.opened";
  delivery_id: string;
  timestamp: number;
  payload: {
    number: number;
    title: string;
    author: string;
    base_branch: string;
    head_branch: string;
    files_changed: number;
  };
}

export interface CheckRunEvent {
  type: "check_run.completed";
  delivery_id: string;
  timestamp: number;
  payload: {
    name: string;
    conclusion: "failure" | "success";
    pr_number: number;
    sha: string;
    run_id: number;
  };
}

export interface IssueCommentEvent {
  type: "issue_comment.created";
  delivery_id: string;
  timestamp: number;
  payload: {
    issue_number: number;
    author: string;
    body: string;
  };
}

export type WebhookEvent = PullRequestEvent | CheckRunEvent | IssueCommentEvent;

// ─── SSE Event Types ─────────────────────────────────────────────────────────
//
// Events broadcast to all connected browsers via Server-Sent Events.
// Every event carries a sessionId so the UI can group events by session.

export interface WebhookReceivedEvent {
  type: "webhook_received";
  sessionId: string;
  eventType: string;
  deliveryId: string;
  timestamp: number;
}

export interface AckEvent {
  type: "ack";
  sessionId: string;
  ackTimeMs: number;
}

export interface HeartbeatEvent {
  type: "heartbeat";
  sessionId: string;
  message: string;
}

export interface PlatformPostEvent {
  type: "platform_post";
  sessionId: string;
  target: string;
  body: string;
}

export interface DuplicateEvent {
  type: "duplicate";
  sessionId: string;
  deliveryId: string;
}

export interface TextEvent {
  type: "text";
  sessionId: string;
  content: string;
}

export interface ToolCallEvent {
  type: "tool_call";
  sessionId: string;
  name: string;
  arguments: Record<string, string>;
}

export interface ToolResultEvent {
  type: "tool_result";
  sessionId: string;
  name: string;
  result: string;
  durationMs: number;
}

export interface DoneEvent {
  type: "done";
  sessionId: string;
  totalDurationMs: number;
  toolCallCount: number;
}

export interface ErrorEvent {
  type: "error";
  sessionId: string;
  message: string;
}

export type SSEEvent =
  | WebhookReceivedEvent
  | AckEvent
  | HeartbeatEvent
  | PlatformPostEvent
  | DuplicateEvent
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | DoneEvent
  | ErrorEvent;
