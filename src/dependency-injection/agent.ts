import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";
import type { RunContext, Deps } from "./context.js";

// ─── Dynamic System Prompt ──────────────────────────────────────────────────
//
// The system prompt references injected user info — the LLM sees the user's
// name and tier (for personalization), but never the DB connection or logger.
// This is the "dynamic system prompt" pattern: context shapes what the LLM
// sees without exposing implementation details.

function buildSystemPrompt(ctx: RunContext<Deps>): string {
  const { user } = ctx.deps;

  return `You are a helpful order support agent for TechGear, an electronics store.

Current customer: ${user.name} (${user.tier} tier member)

Your capabilities:
- Look up specific orders by ID
- List the customer's recent orders
- Process refunds for delivered or shipped orders
- Check loyalty points balance

Guidelines:
- Be friendly and professional
- Always verify order details before processing refunds
- Mention the customer's loyalty tier when relevant
- Keep responses concise and helpful`;
}

// ─── Agent ──────────────────────────────────────────────────────────────────
//
// Same ReAct loop as the base pattern, with one key difference:
// RunContext<Deps> flows through to executeTool on every tool call.
// The context is created ONCE at the run boundary and threaded through.

export async function runAgent(
  userMessage: string,
  history: Message[],
  ctx: RunContext<Deps>,
): Promise<Message[]> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  while (true) {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: buildSystemPrompt(ctx),
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

      // The key line: ctx flows to the tool dispatcher
      const result = executeTool(name, args as Record<string, string>, ctx);
      logToolCall(name, args as Record<string, string>, result);

      messages.push({ role: "tool", content: result });
    }
  }

  return messages;
}
