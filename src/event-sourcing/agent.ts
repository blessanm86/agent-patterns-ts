// ─── Event-Sourcing Agent ─────────────────────────────────────────────────────
//
// Standard ReAct loop — the event sourcing magic lives in the tools, not here.
//
// The agent calls tools like create_order, change_address, apply_discount.
// Each tool emits an "intention" to the orchestrator. The orchestrator validates
// against business rules and appends an event (or rejection) to the event store.
// The agent sees the result and reasons about it.
//
// The agent loop itself is unchanged from the basic ReAct pattern.
// This demonstrates that event sourcing is an infrastructure concern,
// not an agent-architecture concern — you layer it underneath.

import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an e-commerce order management assistant. You help customers create and manage their orders.

You can:
- Create orders with items and a shipping address
- Change the shipping address on an order
- Add items to an existing order
- Apply discount codes (SAVE10, SAVE20, VIP25, WELCOME15)
- Confirm orders for processing
- Ship confirmed orders
- Check order status

Important rules:
- When creating an order, format items as a JSON array: [{"name":"Item","price":99,"quantity":1}]
- Always tell the customer the order ID after creating an order
- If an action is rejected, explain why to the customer and suggest alternatives
- Prices are in USD

Be helpful and conversational. Guide customers through the order process.`;

// ─── Agent ───────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 15;

export async function runAgent(userMessage: string, history: Message[]): Promise<Message[]> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // No tool calls → agent is done, return to user
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute each tool call — each one may emit an intention to the orchestrator
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;

      const result = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result);

      messages.push({ role: "tool", content: result });
    }
  }

  return messages;
}
