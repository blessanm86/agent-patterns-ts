import ollama from "ollama";
import { tools, executeTool, type AgentMode } from "./tools.js";
import { generateMetadata, type MetadataResult } from "./metadata.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface AgentStats {
  mode: AgentMode;
  llmCalls: number;
  toolCalls: number;
  metadataResult: MetadataResult | null;
}

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a customer support agent for CloudStack, a cloud SaaS platform. You help customers with billing questions, technical issues, account management, and feature requests.

Guidelines:
- Be helpful, professional, and concise
- Use the available tools to look up account information, check subscriptions, find known issues, and search documentation
- If you can't find relevant information, say so honestly rather than guessing
- For billing disputes or account changes, explain what you found and suggest next steps
- Reference specific documentation links when relevant
- If a customer reports an issue that matches a known incident, let them know`;

// ─── Agent Loop ──────────────────────────────────────────────────────────────

export interface AgentResult {
  messages: Message[];
  stats: AgentStats;
}

export async function runAgent(
  userMessage: string,
  history: Message[],
  mode: AgentMode = "with-metadata",
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  let llmCalls = 0;
  let toolCalls = 0;

  // ── ReAct Loop ─────────────────────────────────────────────────────────────

  while (true) {
    llmCalls++;
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // No tool calls → agent is done reasoning
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute each tool call
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      toolCalls++;

      const result = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result);

      messages.push({ role: "tool", content: result });
    }
  }

  // ── Post-Conversation Metadata ─────────────────────────────────────────────
  //
  // After the ReAct loop completes and the agent has produced its final text
  // response, fire a secondary LLM call to generate structured metadata.
  // This is the "hidden second call" pattern: the user sees the response
  // immediately, and metadata is generated as a post-processing step.

  let metadataResult: MetadataResult | null = null;

  if (mode === "with-metadata") {
    metadataResult = await generateMetadata(messages);
    llmCalls++; // Count the metadata call in total LLM calls
  }

  return {
    messages,
    stats: {
      mode,
      llmCalls,
      toolCalls,
      metadataResult,
    },
  };
}
