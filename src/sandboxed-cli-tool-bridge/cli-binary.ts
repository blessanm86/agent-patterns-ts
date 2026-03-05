// ─── CLI Binary: "tools" Command Interface ──────────────────────────────────
//
// This module acts as the "tools" CLI that the sandbox uses to interact with
// the host's tool registry. It parses subcommands (list, describe, invoke)
// and translates them into JSON-RPC requests sent back to the host.
//
// Usage from the sandbox:
//   tools list                           → list all available tools
//   tools describe weather.lookup        → get parameter schema for a tool
//   tools invoke weather.lookup --args='{"city":"Paris"}'  → call a tool

import type { JsonRpcRequest, JsonRpcResponse, JsonRpcErrorResponse } from "./types.js";

let requestCounter = 0;

function nextId(): string {
  return `req-${++requestCounter}`;
}

function isErrorResponse(response: JsonRpcResponse): response is JsonRpcErrorResponse {
  return "error" in response;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handleToolsCommand(
  argv: string[],
  sendRequest: (request: JsonRpcRequest) => Promise<JsonRpcResponse>,
  token: string,
): Promise<string> {
  const subcommand = argv[0];

  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    return USAGE_TEXT;
  }

  switch (subcommand) {
    case "list":
      return handleList(sendRequest, token);
    case "describe":
      return handleDescribe(argv.slice(1), sendRequest, token);
    case "invoke":
      return handleInvoke(argv.slice(1), sendRequest, token);
    default:
      return `Unknown subcommand: ${subcommand}\n\n${USAGE_TEXT}`;
  }
}

// ─── Subcommand Handlers ─────────────────────────────────────────────────────

async function handleList(
  sendRequest: (request: JsonRpcRequest) => Promise<JsonRpcResponse>,
  token: string,
): Promise<string> {
  const response = await sendRequest({
    jsonrpc: "2.0",
    id: nextId(),
    method: "tools.list",
    params: { token },
  });

  if (isErrorResponse(response)) {
    return `Error: ${response.error.message}`;
  }

  const tools = response.result as Array<{ fullName: string; description: string }>;
  if (tools.length === 0) {
    return "No tools available.";
  }

  const lines = ["Available tools:", ""];
  for (const tool of tools) {
    lines.push(`  ${tool.fullName}`);
    lines.push(`    ${tool.description}`);
    lines.push("");
  }
  lines.push(
    `${tools.length} tool(s) available. Use "tools describe <name>" for parameter details.`,
  );
  return lines.join("\n");
}

async function handleDescribe(
  argv: string[],
  sendRequest: (request: JsonRpcRequest) => Promise<JsonRpcResponse>,
  token: string,
): Promise<string> {
  const toolName = argv[0];
  if (!toolName) {
    return "Usage: tools describe <tool-name>\nExample: tools describe weather.lookup";
  }

  const response = await sendRequest({
    jsonrpc: "2.0",
    id: nextId(),
    method: "tools.describe",
    params: { name: toolName, token },
  });

  if (isErrorResponse(response)) {
    return `Error: ${response.error.message}`;
  }

  const tool = response.result as {
    fullName: string;
    description: string;
    parameters: Record<string, { type: string; description?: string }>;
    required: string[];
  };

  const lines = [`Tool: ${tool.fullName}`, `Description: ${tool.description}`, "", "Parameters:"];

  for (const [name, schema] of Object.entries(tool.parameters)) {
    const req = tool.required.includes(name) ? " (required)" : " (optional)";
    lines.push(`  ${name}: ${schema.type}${req}`);
    if (schema.description) {
      lines.push(`    ${schema.description}`);
    }
  }

  lines.push("");
  lines.push(
    `Example: tools invoke ${tool.fullName} --args='${buildExampleArgs(tool.parameters, tool.required)}'`,
  );
  return lines.join("\n");
}

async function handleInvoke(
  argv: string[],
  sendRequest: (request: JsonRpcRequest) => Promise<JsonRpcResponse>,
  token: string,
): Promise<string> {
  const toolName = argv[0];
  if (!toolName) {
    return "Usage: tools invoke <tool-name> --args='{...}'\nExample: tools invoke weather.lookup --args='{\"city\":\"Paris\"}'";
  }

  // Parse --args='...' from remaining argv
  const argsStr = argv.slice(1).join(" ");
  const argsMatch = argsStr.match(/--args=(?:'([^']*)'|"([^"]*)"|(\S+))/);
  let args: Record<string, string> = {};

  if (argsMatch) {
    const rawArgs = argsMatch[1] ?? argsMatch[2] ?? argsMatch[3];
    try {
      args = JSON.parse(rawArgs);
    } catch {
      return `Error: Invalid JSON in --args: ${rawArgs}`;
    }
  }

  const response = await sendRequest({
    jsonrpc: "2.0",
    id: nextId(),
    method: "tools.invoke",
    params: { name: toolName, args, token },
  });

  if (isErrorResponse(response)) {
    return `Error: ${response.error.message}`;
  }

  // Invoke returns raw JSON — the model parses this directly
  return typeof response.result === "string"
    ? response.result
    : JSON.stringify(response.result, null, 2);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildExampleArgs(
  parameters: Record<string, { type: string }>,
  required: string[],
): string {
  const example: Record<string, string> = {};
  for (const name of required) {
    example[name] = parameters[name]?.type === "number" ? "0" : "...";
  }
  return JSON.stringify(example);
}

const USAGE_TEXT = `Usage: tools <subcommand> [options]

Subcommands:
  list                        List all available tools
  describe <tool-name>        Show tool parameters and usage
  invoke <tool-name> --args='{"key":"value"}'
                              Invoke a tool with JSON arguments

Examples:
  tools list
  tools describe weather.lookup
  tools invoke weather.lookup --args='{"city":"Paris"}'
  tools invoke math.evaluate --args='{"expression":"sqrt(144) + 25"}'`;
