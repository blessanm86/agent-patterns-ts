// ─── ReAct Agent with Dependency Injection ───────────────────────────────────
//
// The key difference from src/react/agent.ts: tools are INJECTED, not imported.
// The agent doesn't know (or care) whether tools came from an MCP server or
// from a static array. This is the whole point of MCP — decouple tool
// existence from tool usage.

import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message, ToolDefinition } from "../shared/types.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export type AgentMode = "mcp" | "static";

export interface AgentConfig {
  tools: ToolDefinition[];
  executeTool: (name: string, args: Record<string, string>) => string | Promise<string>;
  serverInstructions?: string;
  mode: AgentMode;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface AgentStats {
  mode: AgentMode;
  llmCalls: number;
  toolCalls: number;
  discoveredTools: number;
}

export interface AgentResult {
  messages: Message[];
  stats: AgentStats;
}

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(config: AgentConfig): string {
  const base = `You are a helpful recipe assistant. You help users find recipes, get cooking instructions, and convert between measurement units.

Be concise and helpful. When a user asks about recipes, search first, then get full details if they want more info.`;

  if (config.serverInstructions) {
    return `${base}\n\n${config.serverInstructions}`;
  }

  return base;
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────

export async function runAgent(
  userMessage: string,
  history: Message[],
  config: AgentConfig,
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const systemPrompt = buildSystemPrompt(config);

  let llmCalls = 0;
  let toolCalls = 0;

  // ── The ReAct Loop ──────────────────────────────────────────────────────────
  // Identical to src/react/agent.ts — the only difference is where
  // `config.tools` and `config.executeTool` came from.

  while (true) {
    llmCalls++;
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: systemPrompt,
      messages,
      tools: config.tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // No tool calls → agent is done reasoning
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute each tool call — await handles both sync and async executeTool
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      toolCalls++;

      const result = await config.executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result);

      messages.push({ role: "tool", content: result });
    }
  }

  return {
    messages,
    stats: {
      mode: config.mode,
      llmCalls,
      toolCalls,
      discoveredTools: config.tools.length,
    },
  };
}
