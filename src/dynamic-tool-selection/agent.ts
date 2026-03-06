import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import { allTools, executeTool } from "./tools.js";
import { selectTools, formatSelectionStats, buildEmbeddingIndex } from "./tool-selector.js";
import type { Message } from "../shared/types.js";
import type { SelectionStrategy, SelectionResult } from "./types.js";

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  `You are a helpful multi-domain assistant that can help with e-commerce shopping, ` +
  `cooking recipes, and travel planning. Use the available tools to answer questions. ` +
  `Always use the appropriate tool rather than making up information. ` +
  `Be concise and helpful.`;

// ─── Agent ───────────────────────────────────────────────────────────────────
//
// Standard ReAct loop with one key addition: before each LLM call, the tool
// set is filtered by the selected strategy. The model only sees the tools
// that the selector deems relevant to the current query.

let initialized = false;

export async function initAgent(strategy: SelectionStrategy): Promise<void> {
  if (strategy === "embedding" && !initialized) {
    await buildEmbeddingIndex(allTools);
    initialized = true;
  }
}

export async function runAgent(
  userMessage: string,
  history: Message[],
  strategy: SelectionStrategy,
): Promise<{ messages: Message[]; stats: string[] }> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  // ── Dynamic Tool Selection ──────────────────────────────────────────────
  //
  // This is the key step. Instead of always sending all 27 tools:
  //   - "all" strategy: sends all 27 (baseline for comparison)
  //   - "embedding" strategy: embeds the query, cosine similarity, top-5
  //   - "llm" strategy: asks the model which tools are relevant, top-5
  //
  // The selected tools are what the model sees in its tool definitions.
  // Fewer tools = less context waste, better tool selection accuracy.

  const selection: SelectionResult = await selectTools(userMessage, allTools, strategy);
  const stats = formatSelectionStats(selection);

  // ── ReAct Loop ──────────────────────────────────────────────────────────

  while (true) {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: SYSTEM_PROMPT,
      messages,
      tools: selection.selectedTools, // Only the filtered tools!
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const result = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result);

      messages.push({ role: "tool", content: result });
    }
  }

  return { messages, stats };
}
