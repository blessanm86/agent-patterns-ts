import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL, VISION_MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { VisionMessage } from "./types.js";

// ─── System Prompt ───────────────────────────────────────────────────────────

const FOOD_SYSTEM_PROMPT = `You are a food assistant that helps identify dishes, read menus, find nutritional information, and search for recipes.

When you receive an image:
- Carefully examine what you see in the image
- Describe the visual details (ingredients, plating, cooking style)
- Use your observations to call the appropriate tools

When no image is provided, rely on the user's text description to help them.

Always use the available tools to provide structured information rather than guessing.`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export interface VisionAgentOptions {
  textOnly?: boolean; // Use text-only model instead of vision model
}

export async function runVisionAgent(
  userMessage: string,
  images: string[],
  history: VisionMessage[],
  options: VisionAgentOptions = {},
): Promise<VisionMessage[]> {
  const model = options.textOnly ? MODEL : VISION_MODEL;

  // Build the user message — attach images if present
  const userMsg: VisionMessage = {
    role: "user",
    content: userMessage,
  };
  if (images.length > 0 && !options.textOnly) {
    userMsg.images = images;
  }

  const messages: VisionMessage[] = [...history, userMsg];

  // ── The ReAct Loop (with vision) ────────────────────────────────────────────
  //
  // Same loop as src/react/agent.ts, but:
  //   1. Uses a vision-language model that can see images
  //   2. Images are attached to user messages via the `images` field
  //   3. The model reasons about what it sees and decides which tools to call
  //
  // The key insight: images are INPUT, not a tool. The model processes them
  // natively and then uses regular tools for structured operations.

  while (true) {
    const response = await ollama.chat({
      model,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: FOOD_SYSTEM_PROMPT,
      messages,
      tools,
    });

    const assistantMessage = response.message as VisionMessage;
    messages.push(assistantMessage);

    // No tool calls → agent is done, reply to user
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute each tool call and feed results back
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;

      const result = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result);

      messages.push({
        role: "tool",
        content: result,
      });
    }
  }

  return messages;
}
