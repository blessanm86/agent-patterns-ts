import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message, ToolDefinition } from "./types.js";
import { executeTool } from "./tools.js";

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a customer support agent for an e-commerce platform.

Your job is to help customers with order issues including refunds, status checks, and escalations.

Follow this workflow:
1. Look up the order using the available tools
2. Check the details before taking any action
3. Process the appropriate resolution (refund, message, or escalation)
4. Confirm the outcome to the customer

Always use tools to verify information — never assume order details.`;

// ─── Agent ────────────────────────────────────────────────────────────────────
//
// Identical ReAct loop to src/react/agent.ts, but accepts tools as a parameter.
// This lets the caller swap between weakTools and strongTools without any
// change to the agent logic — the only variable is the tool descriptions.

export async function runAgent(
  userMessage: string,
  history: Message[],
  tools: ToolDefinition[],
): Promise<Message[]> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  while (true) {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;

      const result = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result);

      messages.push({ role: "tool", content: result });
    }
  }

  return messages;
}
