import ollama from "ollama";
import { buildTools, executeTool, type AgentMode } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface AgentStats {
  mode: AgentMode;
  llmCalls: number;
  toolCalls: number;
  validationAttempts: number;
  validationPassed: boolean;
  firstAttemptPassed: boolean;
}

// ─── System Prompts ──────────────────────────────────────────────────────────

function buildSystemPrompt(mode: AgentMode): string {
  const base = `You are a restaurant menu configuration assistant. You help restaurant owners create structured menu configurations.

When a user asks for a menu, you should:
1. First check available ingredients and existing menus using the list_ingredients and list_existing_menus tools
2. Generate a menu configuration as a JSON object based on the user's requirements`;

  if (mode === "validated") {
    return `${base}
3. ALWAYS validate your menu configuration using the validate_menu tool BEFORE delivering it to the user
4. If validation fails, fix ALL reported errors and re-validate until it passes
5. Only present the menu to the user AFTER it has passed validation

The menu JSON must be a valid JSON object with:
- restaurantName: non-empty string
- cuisine: non-empty string
- categories: array of 1-4 category objects
- currency: one of "USD", "EUR", "GBP"
- lastUpdated: date in YYYY-MM-DD format

Each category must have:
- category: one of "appetizers", "mains", "desserts", "drinks"
- items: array of 1-20 items, each with:
  - name: non-empty string
  - description: non-empty string
  - price: number between 0.50 and 500
  - dietaryTags: array of tags from: "vegetarian", "vegan", "gluten-free", "nut-free", "spicy"
  - prepTime: integer between 1 and 180 (minutes)

When calling validate_menu, pass the complete menu JSON as a string in the menu_json parameter.`;
  }

  return `${base}
3. Present the menu configuration directly to the user as a JSON code block

The menu JSON should have: restaurantName, cuisine, categories (1-4), currency (USD/EUR/GBP), and lastUpdated (YYYY-MM-DD).
Each category should have: category name and items array.
Each item should have: name, description, price, dietaryTags, and prepTime.`;
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────

export interface AgentResult {
  messages: Message[];
  stats: AgentStats;
}

export async function runAgent(
  userMessage: string,
  history: Message[],
  mode: AgentMode = "validated",
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const tools = buildTools(mode);
  const systemPrompt = buildSystemPrompt(mode);

  let llmCalls = 0;
  let toolCalls = 0;
  let validationAttempts = 0;
  let validationPassed = false;
  let firstAttemptPassed = false;

  // ── ReAct Loop ─────────────────────────────────────────────────────────────

  while (true) {
    llmCalls++;
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: systemPrompt,
      messages,
      tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // No tool calls → agent is done reasoning
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute each tool call
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      toolCalls++;

      const result = executeTool(name, args as Record<string, string>);

      if (name === "validate_menu") {
        validationAttempts++;
        const parsed = JSON.parse(result);
        if (parsed.valid) {
          validationPassed = true;
          if (validationAttempts === 1) {
            firstAttemptPassed = true;
          }
        }
        logToolCall(name, { menu_json: "(menu config)" }, result);
      } else {
        logToolCall(name, args as Record<string, string>, result);
      }

      messages.push({ role: "tool", content: result });
    }
  }

  return {
    messages,
    stats: {
      mode,
      llmCalls,
      toolCalls,
      validationAttempts,
      validationPassed,
      firstAttemptPassed,
    },
  };
}
