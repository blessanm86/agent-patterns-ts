import readline from "node:readline";
import { AgentServer } from "./protocol.js";
import type { JsonRpcRequest, JsonRpcResponse, ProtocolEvent } from "./types.js";

// ─── Stdio / JSONL Transport ─────────────────────────────────────────────────
//
// Reads JSONL from stdin, writes JSONL to stdout. Two kinds of outbound
// messages share the same pipe:
//
//   { "jsonrpc": "2.0", ... }  — JSON-RPC responses (have an `id` field)
//   { "type": "item.delta", ...} — protocol events (have a `type` field)
//
// The client distinguishes them by checking for "jsonrpc" key.

export function startStdioTransport(server: AgentServer): void {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  // Write a message to stdout as JSONL
  function send(msg: JsonRpcResponse | ProtocolEvent): void {
    process.stdout.write(JSON.stringify(msg) + "\n");
  }

  // Subscribe to ALL events (stdio serves a single client)
  server.subscribeAll((event: ProtocolEvent) => {
    send(event);
  });

  // Read JSONL lines from stdin
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed);
    } catch {
      send({
        jsonrpc: "2.0",
        id: 0,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }

    const response = await server.handleRequest(request);
    send(response);
  });

  // Graceful shutdown
  rl.on("close", () => {
    process.exit(0);
  });

  // Signal readiness
  process.stderr.write("Agent protocol server ready (stdio)\n");
}
