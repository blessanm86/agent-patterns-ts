import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";
import type { TimestampedMessage } from "./history-store.js";
import type { Worker } from "./worker-pool.js";

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a friendly restaurant order assistant for The TypeScript Bistro.

Your job is to help customers browse the menu, place orders, and check order status.

Workflow:
1. Greet the customer and ask how you can help
2. Use get_menu to show available items when asked
3. Use place_order when the customer decides what they want
4. Use check_order_status if they want to check on an existing order

Important rules:
- Always use tools to get real menu data — never make up items or prices
- Remember dietary preferences the customer mentions
- Be concise and friendly
- If the customer hasn't given their name yet, ask for it before placing an order`;

// ─── Agent Result ────────────────────────────────────────────────────────────

export interface AgentResult {
  /** New messages produced during this turn (user + assistant + tool messages) */
  newMessages: TimestampedMessage[];
  /** Number of ReAct iterations this turn */
  iterations: number;
  /** Worker that served this turn */
  workerId: string;
  /** Total messages re-injected from history */
  historySize: number;
}

// ─── Stateless Agent ─────────────────────────────────────────────────────────
//
// This function is the core of the stateless pattern:
//
//   1. Receive the FULL conversation history from the external store
//   2. Run a fresh ReAct loop — no memory from prior invocations
//   3. Return ONLY the new messages produced during this turn
//   4. The caller appends these to the external store
//
// Any worker can call this function with any conversation history.
// The function has zero state between invocations.

const MAX_ITERATIONS = 10;

export async function runStatelessAgent(
  userMessage: string,
  history: Message[],
  worker: Worker,
): Promise<AgentResult> {
  const historySize = history.length;

  // Build message list: full history + new user message
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  // Track new messages produced this turn (for appending to the store)
  const newMessages: TimestampedMessage[] = [
    {
      role: "user",
      content: userMessage,
      timestamp: new Date().toISOString(),
    },
  ];

  let iterations = 0;

  // ── ReAct Loop (fresh each invocation — no carried state) ────────────────
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

    const timestampedAssistant: TimestampedMessage = {
      ...assistantMessage,
      timestamp: new Date().toISOString(),
      workerId: worker.id,
    };
    newMessages.push(timestampedAssistant);

    // No tool calls → done
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute tool calls
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const result = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result, { maxResultLength: 120 });

      const toolMessage: Message = { role: "tool", content: result };
      messages.push(toolMessage);

      const timestampedTool: TimestampedMessage = {
        ...toolMessage,
        timestamp: new Date().toISOString(),
        workerId: worker.id,
      };
      newMessages.push(timestampedTool);
    }
  }

  return {
    newMessages,
    iterations,
    workerId: worker.id,
    historySize,
  };
}
