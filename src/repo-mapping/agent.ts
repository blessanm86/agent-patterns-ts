// ─── ReAct Agent with Repo Map ───────────────────────────────────────────────
//
// Two modes:
//   1. WITH repo map — map injected into system prompt, agent knows the structure
//   2. WITHOUT repo map — agent must explore blindly using tools
//
// Tracks stats (llmCalls, toolCalls, filesRead) so the CLI can show the
// efficiency difference between modes.

import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import type { Message } from "../shared/types.js";
import { logToolCall } from "../shared/logging.js";
import { tools, executeTool } from "./tools.js";

const MAX_ITERATIONS = 10;

export interface AgentStats {
  llmCalls: number;
  toolCalls: number;
  filesRead: number;
}

export interface AgentOptions {
  repoMap?: string;
}

function buildSystemPrompt(repoMap?: string): string {
  const base = `You are a code assistant helping a developer understand a TypeScript e-commerce project.
You have tools to list files, read file contents, and search for code patterns.
Answer questions accurately by reading the relevant source files. Be concise and specific — cite file paths and function names.`;

  if (!repoMap) {
    return `${base}

You do not have a map of the codebase. Use list_files to discover files, search_code to find relevant code, and read_file to examine specific files.`;
  }

  return `${base}

Here is a structural map of the codebase showing the most important files and their exports:

<repo-map>
${repoMap}
</repo-map>

Use this map to understand the codebase architecture. When answering questions, go directly to the relevant files shown in the map rather than searching blindly. Read specific files to confirm details before answering.`;
}

export async function runAgent(
  userMessage: string,
  history: Message[],
  options: AgentOptions = {},
): Promise<{ messages: Message[]; stats: AgentStats }> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const systemPrompt = buildSystemPrompt(options.repoMap);
  const stats: AgentStats = { llmCalls: 0, toolCalls: 0, filesRead: 0 };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: systemPrompt,
      messages,
      tools,
    });
    stats.llmCalls++;

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const result = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result, { maxResultLength: 200 });
      stats.toolCalls++;
      if (name === "read_file") stats.filesRead++;
      messages.push({ role: "tool", content: result });
    }
  }

  return { messages, stats };
}
