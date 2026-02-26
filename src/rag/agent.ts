import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "./types.js";

// ─── System Prompts ─────────────────────────────────────────────────────────

const RAG_SYSTEM_PROMPT = `You are a documentation assistant for NexusDB, a high-performance document database.

IMPORTANT: You must ALWAYS use the search_docs tool before answering any question about NexusDB.
Do NOT answer from memory — NexusDB has specific details (port numbers, CLI commands, configuration keys)
that you must look up in the documentation. If the search results don't contain the answer, say so honestly.

When answering:
- Cite specific details from the documentation (port numbers, command syntax, config keys)
- If the docs don't cover something, say "I couldn't find information about that in the NexusDB documentation"
- Keep answers concise and practical — include code examples when relevant`;

const NO_RAG_SYSTEM_PROMPT = `You are a helpful assistant. Answer questions about NexusDB to the best of your knowledge.
If you're not sure about specific details, do your best to provide a helpful answer.`;

// ─── Agent ──────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 8;

export async function runAgent(
  userMessage: string,
  history: Message[],
  ragEnabled: boolean,
): Promise<Message[]> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const systemPrompt = ragEnabled ? RAG_SYSTEM_PROMPT : NO_RAG_SYSTEM_PROMPT;

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: systemPrompt,
      messages,
      // Only provide tools when RAG is enabled
      ...(ragEnabled ? { tools } : {}),
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // No tool calls → agent is done
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute tool calls (async — search may call embedding API)
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const result = await executeTool(name, args as Record<string, string>);

      logToolCall(name, args as Record<string, string>, result, {
        maxResultLength: 300,
      });

      messages.push({ role: "tool", content: result });
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    console.log(`\n  ⚠️  Hit max iterations (${MAX_ITERATIONS})`);
  }

  return messages;
}
