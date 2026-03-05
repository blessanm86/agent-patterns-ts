// ─── Shared Types ────────────────────────────────────────────────────────────

export type { Message, ToolCall, ToolDefinition } from "../shared/types.js";

// ─── JSON-RPC Protocol ──────────────────────────────────────────────────────
//
// Newline-delimited JSON-RPC 2.0 over stdin/stdout — the same transport MCP uses.
// Each message is a single JSON object terminated by \n.

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: string;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// Standard JSON-RPC error codes + custom extensions
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom errors for the tool bridge protocol
  DESCRIBE_REQUIRED: -32001,
  AUTH_FAILED: -32002,
  TIMEOUT: -32003,
} as const;

// ─── Tool Registry Types ─────────────────────────────────────────────────────

export interface ToolParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
}

export interface NamespacedTool {
  namespace: string;
  name: string;
  fullName: string; // "namespace.name"
  description: string;
  parameters: Record<string, ToolParameterSchema>;
  required: string[];
  implementation: (args: Record<string, string>) => string;
}

// ─── Bridge Session ──────────────────────────────────────────────────────────

export interface BridgeSession {
  token: string;
  describedTools: Set<string>; // fullNames that have been described
  createdAt: number;
}

// ─── IPC Messages (Host ↔ Sandbox) ──────────────────────────────────────────
//
// These are the envelope messages sent over stdin/stdout between the host
// process and the sandbox subprocess. JSON-RPC messages from the CLI binary
// are embedded inside these.

export interface ShellCommandMessage {
  type: "shell_command";
  id: string;
  command: string;
  token: string;
}

export interface ShellResultMessage {
  type: "shell_result";
  id: string;
  output: string;
  exitCode: number;
}

export interface JsonRpcFromSandbox {
  type: "jsonrpc_request";
  id: string;
  request: JsonRpcRequest;
}

export interface JsonRpcToSandbox {
  type: "jsonrpc_response";
  id: string;
  response: JsonRpcResponse;
}

export interface SandboxReadyMessage {
  type: "ready";
}

export type HostToSandboxMessage = ShellCommandMessage | JsonRpcToSandbox;
export type SandboxToHostMessage = ShellResultMessage | JsonRpcFromSandbox | SandboxReadyMessage;
