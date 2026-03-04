// ─── Sandbox Worker ───────────────────────────────────────────────────────────
//
// This file runs as a separate Node.js process via child_process.fork().
// It receives code from the orchestrator, executes it in a vm context with
// limited globals, and sends results back over IPC.
//
// The worker also provides a callTool() bridge: sandbox code can request
// tool execution from the orchestrator by sending an IPC message and waiting
// for the result.

import * as vm from "node:vm";
import type {
  OrchestratorMessage,
  WorkerResultMessage,
  WorkerToolRequestMessage,
  WorkerReadyMessage,
  WorkerHeartbeatMessage,
  WorkerToolResultMessage,
} from "./types.js";

// ─── Pending Tool Calls ──────────────────────────────────────────────────────
//
// When sandbox code calls callTool(), we send an IPC request and wait for
// a matching tool_result. This map holds the resolve functions keyed by
// correlation ID.

const pendingToolCalls = new Map<string, (result: string) => void>();
let toolCallCounter = 0;
let currentToken: string | undefined;

// ─── IPC Send Helpers ─────────────────────────────────────────────────────────

function sendResult(msg: WorkerResultMessage): void {
  process.send?.(msg);
}

function sendToolRequest(msg: WorkerToolRequestMessage): void {
  process.send?.(msg);
}

function sendReady(msg: WorkerReadyMessage): void {
  process.send?.(msg);
}

function sendHeartbeat(msg: WorkerHeartbeatMessage): void {
  process.send?.(msg);
}

// ─── callTool Bridge ──────────────────────────────────────────────────────────
//
// This function is exposed inside the vm context. When sandbox code calls
// callTool("get_recipe_data", { name: "pad thai" }), it:
//   1. Sends a tool_request IPC message to the orchestrator
//   2. Returns a Promise that resolves when the orchestrator sends tool_result

function callTool(name: string, args: Record<string, string>): Promise<string> {
  const id = `tool-${++toolCallCounter}`;
  return new Promise((resolve) => {
    pendingToolCalls.set(id, resolve);
    sendToolRequest({
      type: "tool_request",
      id,
      name,
      args,
      token: currentToken ?? "",
    });
  });
}

// ─── Execute Code in VM Context ──────────────────────────────────────────────

async function executeCode(id: string, code: string, timeout: number): Promise<void> {
  const start = Date.now();
  const logs: string[] = [];

  // Limited globals — only safe built-ins + callTool bridge
  const context = vm.createContext({
    console: {
      log: (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      },
    },
    Math,
    JSON,
    Date,
    parseInt,
    parseFloat,
    Number,
    String,
    Array,
    Object,
    Map,
    Set,
    Promise,
    callTool,
  });

  try {
    // Wrap in async IIFE to support await callTool()
    const wrapped = `(async () => { ${code} })()`;
    const script = new vm.Script(wrapped);
    const result = await script.runInContext(context, { timeout });

    const output =
      logs.length > 0 ? logs.join("\n") : result !== undefined ? String(result) : "(no output)";

    sendResult({
      type: "result",
      id,
      success: true,
      output,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    const error = err as Error;
    sendResult({
      type: "result",
      id,
      success: false,
      output: logs.join("\n"),
      error: error.message,
      durationMs: Date.now() - start,
    });
  }
}

// ─── IPC Message Handler ──────────────────────────────────────────────────────

process.on("message", (raw: unknown) => {
  const msg = raw as OrchestratorMessage;

  if (msg.type === "execute") {
    currentToken = msg.token;
    executeCode(msg.id, msg.code, msg.timeout);
    return;
  }

  if (msg.type === "tool_result") {
    const toolResult = msg as WorkerToolResultMessage;
    const resolve = pendingToolCalls.get(toolResult.id);
    if (resolve) {
      pendingToolCalls.delete(toolResult.id);
      resolve(toolResult.result);
    }
  }
});

// ─── Heartbeat ────────────────────────────────────────────────────────────────

setInterval(() => {
  sendHeartbeat({ type: "heartbeat" });
}, 3_000);

// ─── Ready Signal ─────────────────────────────────────────────────────────────

sendReady({ type: "ready" });
