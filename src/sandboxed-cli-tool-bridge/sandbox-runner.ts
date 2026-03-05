// ─── Sandbox Runner (Subprocess) ─────────────────────────────────────────────
//
// This file runs as a child process spawned by the ToolBridge via
// child_process.spawn(). It communicates with the host over stdin/stdout
// using newline-delimited JSON — the same transport pattern MCP uses.
//
// The runner receives shell commands from the host, and when a command starts
// with "tools", routes it through the CLI binary (cli-binary.ts). The CLI
// binary generates JSON-RPC requests that are sent back to the host over
// stdout, and the host sends JSON-RPC responses back over stdin.
//
// Flow:
//   Host sends ShellCommandMessage → Runner parses command
//     → If "tools ..." → CLI binary creates JsonRpcRequest → sent to host
//     → Host routes to ToolRegistry → sends JsonRpcResponse back
//     → Runner receives response → CLI binary formats output
//     → Runner sends ShellResultMessage back to host

import { handleToolsCommand } from "./cli-binary.js";
import type {
  HostToSandboxMessage,
  SandboxToHostMessage,
  ShellCommandMessage,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types.js";

// ─── Pending JSON-RPC Requests ───────────────────────────────────────────────
//
// When the CLI binary sends a JSON-RPC request, we write it to stdout and
// wait for the host to respond. This map holds the resolve functions.

const pendingRequests = new Map<string, (response: JsonRpcResponse) => void>();

// ─── Stdout / Stdin Communication ────────────────────────────────────────────

function sendToHost(message: SandboxToHostMessage): void {
  process.stdout.write(JSON.stringify(message) + "\n");
}

// Buffer for handling partial lines from stdin
let inputBuffer = "";

process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk: string) => {
  inputBuffer += chunk;
  const lines = inputBuffer.split("\n");
  // Keep the last incomplete line in the buffer
  inputBuffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line) as HostToSandboxMessage;
      handleHostMessage(message);
    } catch {
      // Ignore malformed JSON
    }
  }
});

// ─── Host Message Handler ────────────────────────────────────────────────────

function handleHostMessage(message: HostToSandboxMessage): void {
  if (message.type === "shell_command") {
    handleShellCommand(message);
  } else if (message.type === "jsonrpc_response") {
    // Route JSON-RPC response to the pending request
    const resolve = pendingRequests.get(message.id);
    if (resolve) {
      pendingRequests.delete(message.id);
      resolve(message.response);
    }
  }
}

// ─── Shell Command Processing ────────────────────────────────────────────────

async function handleShellCommand(message: ShellCommandMessage): Promise<void> {
  const { id, command, token } = message;
  const trimmed = command.trim();

  try {
    let output: string;
    let exitCode = 0;

    if (trimmed.startsWith("tools")) {
      // Parse the "tools" command into argv
      const argv = parseArgv(trimmed.slice("tools".length).trim());
      output = await handleToolsCommand(argv, createRequestSender(id), token);
    } else if (trimmed === "help") {
      output = [
        "Available commands:",
        "  tools list                  - List available tools",
        "  tools describe <name>       - Describe a tool's parameters",
        "  tools invoke <name> --args  - Invoke a tool",
        "  echo <text>                 - Echo text back",
        "  help                        - Show this message",
      ].join("\n");
    } else if (trimmed.startsWith("echo ")) {
      output = trimmed.slice(5);
    } else {
      output = `Unknown command: ${trimmed.split(" ")[0]}. Type "help" for available commands.`;
      exitCode = 127;
    }

    sendToHost({ type: "shell_result", id, output, exitCode });
  } catch (err) {
    sendToHost({
      type: "shell_result",
      id,
      output: `Error: ${(err as Error).message}`,
      exitCode: 1,
    });
  }
}

// ─── JSON-RPC Request Sender ─────────────────────────────────────────────────
//
// Creates a callback that the CLI binary uses to send JSON-RPC requests.
// The callback writes the request to stdout (to the host) and returns a
// promise that resolves when the host sends back the response.

function createRequestSender(shellCommandId: string) {
  return (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
    return new Promise((resolve) => {
      pendingRequests.set(request.id, resolve);
      sendToHost({
        type: "jsonrpc_request",
        id: shellCommandId,
        request,
      });
    });
  };
}

// ─── Argument Parsing ────────────────────────────────────────────────────────
//
// Simple argv parser that handles quoted strings with --args='...'

function parseArgv(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
    } else if (char === " " && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}

// ─── Ready Signal ────────────────────────────────────────────────────────────

sendToHost({ type: "ready" });
