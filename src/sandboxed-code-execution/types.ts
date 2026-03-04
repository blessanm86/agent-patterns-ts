// ─── Sandbox Types ────────────────────────────────────────────────────────────

export type { Message, ToolCall, ToolDefinition } from "../shared/types.js";

// ─── Sandbox Lifecycle ────────────────────────────────────────────────────────

export type SandboxStatus = "booting" | "idle" | "busy" | "dead";

export interface SandboxInfo {
  id: string;
  status: SandboxStatus;
  pid: number | undefined;
  conversationId: string | undefined;
  token: string | undefined;
  createdAt: number;
  lastUsedAt: number;
  executionCount: number;
}

// ─── IPC Messages: Orchestrator → Worker ──────────────────────────────────────

export interface WorkerExecuteMessage {
  type: "execute";
  id: string;
  code: string;
  timeout: number;
  token: string;
}

export interface WorkerToolResultMessage {
  type: "tool_result";
  id: string;
  result: string;
}

export type OrchestratorMessage = WorkerExecuteMessage | WorkerToolResultMessage;

// ─── IPC Messages: Worker → Orchestrator ──────────────────────────────────────

export interface WorkerResultMessage {
  type: "result";
  id: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

export interface WorkerToolRequestMessage {
  type: "tool_request";
  id: string;
  name: string;
  args: Record<string, string>;
  token: string;
}

export interface WorkerReadyMessage {
  type: "ready";
}

export interface WorkerHeartbeatMessage {
  type: "heartbeat";
}

export type WorkerMessage =
  | WorkerResultMessage
  | WorkerToolRequestMessage
  | WorkerReadyMessage
  | WorkerHeartbeatMessage;

// ─── Pool Configuration ──────────────────────────────────────────────────────

export interface PoolConfig {
  poolSize: number;
  maxIdleMs: number;
  executionTimeoutMs: number;
  maxBackoffMs: number;
  heartbeatIntervalMs: number;
}

export const DEFAULT_POOL_CONFIG: PoolConfig = {
  poolSize: 3,
  maxIdleMs: 60_000,
  executionTimeoutMs: 5_000,
  maxBackoffMs: 16_000,
  heartbeatIntervalMs: 3_000,
};

// ─── Provider Abstraction ─────────────────────────────────────────────────────

export interface SandboxHandle {
  pid: number | undefined;
  send(message: OrchestratorMessage): void;
  onMessage(handler: (message: WorkerMessage) => void): void;
  onExit(handler: (code: number | null) => void): void;
  kill(): void;
}

export interface SandboxProvider {
  spawn(): Promise<SandboxHandle>;
  destroy(handle: SandboxHandle): Promise<void>;
}
