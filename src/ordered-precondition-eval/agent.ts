import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import type { Message } from "../shared/types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolExecutorFn = (name: string, args: Record<string, string>) => string;

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a customer support agent for an e-commerce store.

When a customer asks about their order, follow this process:
1. Search for their orders using search_orders
2. Get full details for the relevant order using get_order_details
3. If they ask about shipping, check shipping status using check_shipping_status
4. If they want a refund, process it using process_refund

Rules:
- Always search for orders first before looking up details
- Always get order details before checking shipping or processing refunds
- Never invent order information — always use tools
- Report errors clearly to the customer`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export async function runOrderAgent(
  userMessage: string,
  history: Message[],
  options: { executorFn?: ToolExecutorFn } = {},
): Promise<Message[]> {
  const executor = options.executorFn ?? executeTool;
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
      const result = executor(name, args as Record<string, string>);
      messages.push({ role: "tool", content: result });
    }
  }

  return messages;
}
