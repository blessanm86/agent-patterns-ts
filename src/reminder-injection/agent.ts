import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";
import { tools, executeTool } from "./tools.js";
import { wrapToolResponse, REMINDER_TOKEN_ESTIMATE } from "./reminder.js";

// ─── System Prompt ───────────────────────────────────────────────────────────
//
// Five strict formatting rules. Without reminder injection, the model
// follows these for the first few tool calls then gradually drifts —
// especially on metric units (echoing the imperial values from tool data)
// and source citations (dropping them as context grows).

const SYSTEM_PROMPT = `You are an Italian dinner party planning assistant. Help users plan a complete 4-course Italian dinner with recipes, wine pairings, shopping lists, and cooking timelines.

STRICT FORMATTING RULES — you MUST follow these in EVERY response:

1. SOURCE CITATION: After every recipe or wine mention, include [Source: <name>] — e.g., "Cacio e Pepe [Source: Rome Sustainable Food Project]"
2. METRIC UNITS ONLY: Always use grams, ml, and °C. NEVER use cups, oz, tablespoons, teaspoons, or °F. Convert any imperial units from tool data to metric before presenting them.
3. ALLERGEN TAGS: End every dish description with a line: ⚠️ Allergens: <comma-separated list>
4. STEP NUMBERING: When listing steps, use "Step 1:", "Step 2:", etc. Never use bare numbers, bullets, or dashes.
5. COURSE LABELS: Prefix every dish name with its course in brackets: [Appetizer], [Primo], [Secondo], or [Dessert]

These rules apply to ALL your responses, including summaries, recommendations, and final plans.`;

// ─── Agent Stats ─────────────────────────────────────────────────────────────

export interface AgentStats {
  toolCalls: number;
  llmCalls: number;
  reminderTokensInjected: number;
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export type ReminderMode = "reminders" | "no-reminders";

export async function runAgent(
  userMessage: string,
  history: Message[],
  mode: ReminderMode,
): Promise<{ messages: Message[]; stats: AgentStats }> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const stats: AgentStats = { toolCalls: 0, llmCalls: 0, reminderTokensInjected: 0 };

  while (true) {
    stats.llmCalls++;

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

      const rawResult = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, rawResult, { maxResultLength: 200 });

      // ── The one-line difference ──────────────────────────────────────
      // In "reminders" mode, append the reminder block to every tool result.
      // In "no-reminders" mode, pass through the raw result unchanged.
      const result = mode === "reminders" ? wrapToolResponse(rawResult) : rawResult;

      if (mode === "reminders") {
        stats.reminderTokensInjected += REMINDER_TOKEN_ESTIMATE;
      }

      stats.toolCalls++;
      messages.push({ role: "tool", content: result });
    }
  }

  return { messages, stats };
}
