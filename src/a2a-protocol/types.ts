// ─── A2A Protocol Types ───────────────────────────────────────────────────────
//
// Based on A2A specification v0.2.3 / v0.3.0
// https://a2a-protocol.org/latest/specification/
//
// The A2A protocol defines a standard language for agent-to-agent communication
// over HTTP. These types cover the three core concepts:
//
//   1. AgentCard   — the discoverable "business card" served at /.well-known/
//   2. Task        — the stateful unit of work with a defined lifecycle
//   3. Message     — a structured communication turn with typed Parts

// ─── Agent Card ───────────────────────────────────────────────────────────────
//
// Served at GET /.well-known/agent-card.json
// Describes the agent's identity, endpoint, capabilities, and skills.
// This is how A2A clients discover what a server can do before connecting.

export interface AgentCard {
  name: string;
  description: string;
  url: string; // The JSON-RPC endpoint URL
  version: string; // Agent version (semver)
  protocolVersion: string; // A2A spec version (e.g. "0.3.0")
  capabilities: AgentCapabilities;
  skills: AgentSkill[];
  defaultInputModes: string[]; // e.g. ["text", "data"]
  defaultOutputModes: string[]; // e.g. ["text"]
  provider?: AgentProvider;
  authentication?: AgentAuthentication;
}

export interface AgentCapabilities {
  streaming: boolean; // supports message/stream (SSE)
  pushNotifications: boolean; // supports push notification webhooks
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  inputModes?: string[];
  outputModes?: string[];
  examples?: string[]; // Example queries for this skill
}

export interface AgentProvider {
  organization: string;
  url?: string;
}

export interface AgentAuthentication {
  schemes: string[]; // e.g. ["Bearer", "ApiKey"]
}

// ─── Task ─────────────────────────────────────────────────────────────────────
//
// The fundamental unit of work in A2A. Tasks are stateful and identified
// by a unique ID. The contextId groups related tasks into a conversation.
//
// Lifecycle:
//   submitted → working → completed
//                      ↘ input-required → working → completed
//                      ↘ failed
//                      ↘ canceled

export type TaskState =
  | "submitted" // Task received, not yet started
  | "working" // Agent is actively processing
  | "input-required" // Agent needs clarification before continuing
  | "completed" // Task finished successfully
  | "failed" // Task ended in error
  | "canceled"; // Client requested cancellation

export interface TaskStatus {
  state: TaskState;
  message?: Message; // Optional agent message accompanying the status
  timestamp: string; // ISO 8601
}

export interface Task {
  id: string;
  contextId: string; // Groups related tasks (e.g. one conversation)
  status: TaskStatus;
  history?: Message[]; // Full message exchange history
  artifacts?: Artifact[]; // Outputs produced by the agent
}

// ─── Messages ─────────────────────────────────────────────────────────────────
//
// A Message is one turn in the exchange — either from the user (client)
// or from the agent (server). It contains one or more Parts.

export interface Message {
  messageId: string;
  role: "user" | "agent";
  parts: Part[];
  contextId?: string;
  taskId?: string;
}

// ─── Parts ────────────────────────────────────────────────────────────────────
//
// The smallest content unit. A single message can mix text, files, and
// structured data in one payload.

export type Part = TextPart | FilePart | DataPart;

export interface TextPart {
  kind: "text";
  text: string;
}

export interface FilePart {
  kind: "file";
  file: {
    name?: string;
    mimeType?: string;
    uri?: string; // Remote file
    bytes?: string; // Base64-encoded inline data
  };
}

export interface DataPart {
  kind: "data";
  data: Record<string, unknown>; // Arbitrary structured JSON
}

// ─── Artifacts ────────────────────────────────────────────────────────────────
//
// Tangible outputs from task processing — documents, images, structured data.
// Associated with a Task and composed of one or more Parts.
// Can be streamed incrementally (lastChunk signals the final fragment).

export interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  index?: number; // For ordering multiple artifacts
  lastChunk?: boolean; // True on the final chunk of a streaming artifact
}

// ─── JSON-RPC 2.0 ─────────────────────────────────────────────────────────────
//
// A2A uses JSON-RPC 2.0 as the wire protocol. All requests are POST to the
// agent's URL with Content-Type: application/json.

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params: unknown;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: T;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ─── RPC Method Params ────────────────────────────────────────────────────────

export interface MessageSendParams {
  message: Message;
  configuration?: {
    acceptedOutputModes?: string[];
  };
}

export interface TaskGetParams {
  id: string;
  historyLength?: number;
}

export interface TaskCancelParams {
  id: string;
}

// ─── SSE Stream Events ────────────────────────────────────────────────────────
//
// When the client calls message/stream, the server responds with
// Content-Type: text/event-stream and sends these events as the task progresses.
//
// Each line is:  data: <JSON>\n\n
//
// Events are sent until final=true on a status-update event.

export interface TaskStatusUpdateEvent {
  kind: "status-update";
  taskId: string;
  contextId: string;
  status: TaskStatus;
  final: boolean; // true on the last event — client should close the stream
}

export interface TaskArtifactUpdateEvent {
  kind: "artifact-update";
  taskId: string;
  contextId: string;
  artifact: Artifact;
}

export type A2AStreamEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;
