import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import { HOTEL_SYSTEM_PROMPT } from "../shared/prompts.js";
import type { Message } from "./types.js";

// ─── Agent ────────────────────────────────────────────────────────────────────

export async function runAgent(userMessage: string, history: Message[]): Promise<Message[]> {
  // Build the full message history including the new user message
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  // ── The ReAct Loop ──────────────────────────────────────────────────────────
  //
  // ReAct = Reason + Act
  //
  // Each iteration:
  //   1. Model REASONS about the conversation and decides what to do next
  //   2. If it needs info → it ACTs by calling a tool
  //   3. We execute the tool and feed the result back
  //   4. Loop until the model has enough info to respond directly to the user
  //
  // This loop is the entire "agent" — there's no magic, just iteration.

  while (true) {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: HOTEL_SYSTEM_PROMPT,
      messages,
      tools,
    });

    const assistantMessage = response.message as Message;

    // Add assistant's response (with or without tool calls) to history
    messages.push(assistantMessage);

    // ── No tool calls → agent is done reasoning, reply to user ───────────────
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // ── Tool calls → execute each one and feed results back ──────────────────
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;

      const result = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result);

      // Tool results go back into the message history
      // The model will see these on the next iteration and reason about them
      messages.push({
        role: "tool",
        content: result,
      });
    }

    // Loop back — model now reasons about the tool results
  }

  return messages;
}
