// ─── MCP Client ──────────────────────────────────────────────────────────────
//
// Connects to an MCP server, discovers its tools, and translates them into
// the repo's ToolDefinition format so the agent can use them seamlessly.
//
// This is the integration point — the schema translation function
// (mcpToolToDefinition) is where MCP's JSON Schema meets our agent's types.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDefinition, ToolParameter, ToolParameters } from "../shared/types.js";

// ─── Public Interface ────────────────────────────────────────────────────────

export interface McpConnection {
  tools: ToolDefinition[]; // MCP schemas translated to repo format
  executeTool: (name: string, args: Record<string, string>) => Promise<string>;
  serverInstructions?: string; // From server's instructions field
  close: () => Promise<void>;
}

// ─── Schema Translation ─────────────────────────────────────────────────────
//
// MCP tools use JSON Schema for their inputSchema. Our repo uses a simpler
// ToolDefinition format (see src/shared/types.ts). This function bridges them.
//
// This is the core teaching function of this demo — it shows what happens
// at the boundary between two systems that describe tools differently.

export function mcpToolToDefinition(mcpTool: McpTool): ToolDefinition {
  const inputSchema = mcpTool.inputSchema as {
    type: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };

  const properties: Record<string, ToolParameter> = {};

  if (inputSchema.properties) {
    for (const [key, prop] of Object.entries(inputSchema.properties)) {
      properties[key] = {
        type: (prop.type as string) ?? "string",
        description: prop.description as string | undefined,
      };
      if (prop.enum) {
        properties[key].enum = prop.enum as string[];
      }
    }
  }

  const parameters: ToolParameters = {
    type: "object",
    properties,
    required: inputSchema.required ?? [],
  };

  return {
    type: "function",
    function: {
      name: mcpTool.name,
      description: mcpTool.description ?? "",
      parameters,
    },
  };
}

// ─── Connect to MCP Server ───────────────────────────────────────────────────

export async function connectToMcpServer(command: string, args: string[]): Promise<McpConnection> {
  const client = new Client({ name: "recipe-client", version: "1.0.0" });

  // Spawn the server as a subprocess — stdio transport uses stdin/stdout
  const transport = new StdioClientTransport({ command, args });

  // MCP handshake: capabilities negotiation, protocol version check
  await client.connect(transport);

  // Discover tools — the server advertises what it can do
  const { tools: mcpTools } = await client.listTools();

  // Translate MCP schemas → repo's ToolDefinition format
  const tools = mcpTools.map(mcpToolToDefinition);

  // Server instructions — optional context the server wants in the system prompt
  const serverInstructions = client.getInstructions();

  // Route tool calls through the MCP protocol
  async function executeTool(name: string, toolArgs: Record<string, string>): Promise<string> {
    // Parse numeric values for tools that expect numbers (like convert_units)
    const parsedArgs: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(toolArgs)) {
      const num = Number(val);
      parsedArgs[key] = !Number.isNaN(num) && val !== "" ? num : val;
    }

    const result = await client.callTool({ name, arguments: parsedArgs });

    // Extract text content from the MCP response
    const textContent = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    return textContent || JSON.stringify(result.content);
  }

  async function close(): Promise<void> {
    await client.close();
  }

  return { tools, executeTool, serverInstructions, close };
}
