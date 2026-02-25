import ollama from "ollama";
import { tools, executeTool } from "../react/tools.js";
import type { Message } from "../shared/types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

// The injectable executor interface.
// Default: the real executeTool from src/react/tools.ts.
// In evals: pass a mock executor from fixtures/mock-tools.ts to control outputs.
export type ToolExecutorFn = (name: string, args: Record<string, string>) => string;

// ─── System Prompt ────────────────────────────────────────────────────────────
//
// More directive than the conversational react/agent.ts prompt.
// Designed for eval reliability: the agent completes the task in one pass
// without prompting for information the user already provided.

const SYSTEM_PROMPT = `You are a hotel reservation assistant for The Grand TypeScript Hotel.

When a guest provides their name, dates, and room type, complete the booking immediately:
1. Call check_availability for the requested dates
2. Call get_room_price to confirm the total cost
3. Call create_reservation to complete the booking
4. Confirm the reservation ID in your response

If the guest is only asking about availability or pricing (not booking), call the appropriate
tool and respond without creating a reservation.

Rules:
- Always use tools — never invent availability or prices
- Pass dates as YYYY-MM-DD when calling tools
- If a tool returns an error, report it clearly to the guest`;

const MODEL = process.env.MODEL ?? "qwen2.5:7b";

// ─── Agent ────────────────────────────────────────────────────────────────────
//
// runHotelAgent is structurally identical to runAgent in src/react/agent.ts
// with one key addition: the optional executorFn parameter.
//
// When executorFn is provided (in evals), it replaces executeTool().
// The LLM still receives real tool schemas — only implementations are swapped.
// This is the testability seam that unlocks all eval patterns in evals/.
//
// Note: no console.log here. Evals should be silent — output noise breaks
// the evalite UI and obscures which test is failing.

export async function runHotelAgent(
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

    const assistantMessage = response.message;
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
