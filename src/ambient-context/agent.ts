import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";
import type { ContextStore } from "./types.js";

// ─── System Prompt Builder ───────────────────────────────────────────────────
//
// The core of the ambient context pattern: before each LLM call, we assemble
// the system prompt from a base instruction + serialized ambient contexts.
// The agent doesn't need to ask "what are you looking at?" — it already knows.

const BASE_PROMPT = `You are a helpful e-commerce shopping assistant for a consumer electronics and outdoor gear store.

You help users browse products, manage their cart, check order history, and make purchase decisions. Be conversational and helpful.

When recommending products, consider the user's membership tier, past purchases, and what they're currently looking at. If you can see product details in the context, reference them directly — don't ask the user to describe something that's already on their screen.

Available tools let you search products, view details, manage the cart, and check orders.`;

function buildSystemPrompt(store: ContextStore): string {
  const ambient = store.serialize();

  if (ambient) {
    return `${BASE_PROMPT}

## Current Context

The following context describes what the user is currently viewing in the app. Use this to provide relevant, contextual responses without asking the user to repeat information they can already see on screen:

${ambient}`;
  }
  return BASE_PROMPT;
}

// ─── Agent Result ────────────────────────────────────────────────────────────

export interface AgentResult {
  messages: Message[];
  contextStats: {
    active: number;
    excluded: number;
    temporary: number;
    serializedLength: number;
  };
}

// ─── ReAct Loop with Ambient Context ─────────────────────────────────────────

export async function runAgent(
  userMessage: string,
  history: Message[],
  store: ContextStore,
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  // Build system prompt with current ambient context
  const systemPrompt = buildSystemPrompt(store);
  const stats = store.getStats();

  while (true) {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: systemPrompt,
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
      logToolCall(name, args as Record<string, string>, result, { maxResultLength: 200 });
      messages.push({ role: "tool", content: result });
    }
  }

  return {
    messages,
    contextStats: {
      active: stats.active,
      excluded: stats.excluded,
      temporary: stats.temporary,
      serializedLength: store.serialize().length,
    },
  };
}
