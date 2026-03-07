import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";

// ─── System Prompt ────────────────────────────────────────────────────────────
//
// The system prompt teaches the agent the read-before-edit workflow.
// It also explains the uniqueness constraint — the most common failure mode
// when using search/replace style editing.

const SYSTEM_PROMPT = `You are a menu management agent for Bella Italia restaurant.

You have access to a virtual filesystem containing the restaurant's menu file.

Available files:
- menu.ts — the restaurant's current menu (starters, mains, desserts)

EDITING WORKFLOW — follow this exactly:
1. Call read_file to get the current file content before any edit.
2. Choose an old_str that uniquely identifies the target location.
   Include the full line you want to change plus 1-2 neighboring lines.
   A short old_str (e.g. just 'description: "') will match every item and fail.
3. Call edit_file with old_str and new_str.
4. If edit_file returns an error, read the message carefully:
   - "No match found" → your old_str didn't match the file exactly; re-read and try again
   - "Found multiple matches" → your old_str matched more than one location; add more context lines

After a successful edit, confirm what you changed in plain language.
Do not call read_file again after a successful edit unless you need to verify something.`;

// ─── Agent Loop ───────────────────────────────────────────────────────────────

export async function runAgent(userMessage: string, history: Message[]): Promise<Message[]> {
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
      logToolCall(name, args as Record<string, string>, result, { maxResultLength: 300 });
      messages.push({ role: "tool", content: result });
    }
  }

  return messages;
}
