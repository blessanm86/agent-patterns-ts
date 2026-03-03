// ─── ReAct Agent with Tool Bundle Injection ──────────────────────────────────
//
// Follows src/mcp/agent.ts exactly. The agent doesn't know where its tools
// came from — it receives a SessionToolConfig with tools + executeTool.
// The bundle system (bundles.ts) handles which tools are available and
// which credentials to inject. The agent just runs the ReAct loop.

import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";
import type { SessionToolConfig } from "./bundles.js";

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface AgentResult {
  messages: Message[];
  stats: {
    orgName: string;
    activeBundles: string[];
    llmCalls: number;
    toolCalls: number;
    availableTools: number;
  };
}

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(config: SessionToolConfig): string {
  const bundleList = config.activeBundles
    .map((b) => b.charAt(0).toUpperCase() + b.slice(1))
    .join(", ");

  return `You are a CI/CD pipeline assistant for ${config.orgName}. You help engineers manage pull requests, issues, CI status, messaging, and project tracking.

Your available integrations: ${bundleList}.

Use the tools provided to help users. Be concise and helpful. When a user asks you to do something, use the appropriate tool. If the user asks about a service you don't have access to, let them know that integration is not configured for their organization.`;
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────

export async function runAgent(
  userMessage: string,
  history: Message[],
  config: SessionToolConfig,
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const systemPrompt = buildSystemPrompt(config);

  let llmCalls = 0;
  let toolCalls = 0;

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

    // Execute each tool call via the injected executeTool
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      toolCalls++;

      const result = config.executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result);

      messages.push({ role: "tool", content: result });
    }
  }

  return {
    messages,
    stats: {
      orgName: config.orgName,
      activeBundles: config.activeBundles,
      llmCalls,
      toolCalls,
      availableTools: config.tools.length,
    },
  };
}
