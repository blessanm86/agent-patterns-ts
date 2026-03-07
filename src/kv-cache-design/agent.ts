import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import type { Message } from "../shared/types.js";
import type { ContextStrategy, TurnMetrics } from "./types.js";

// ─── Agent Loop with Configurable Context Strategy ──────────────────────────
//
// Runs a single turn: sends the prompt (assembled via strategy) to Ollama,
// executes any tool calls, and returns metrics + updated history.
//
// The strategy controls three things:
//   1. System prompt construction (timestamps? dynamic content?)
//   2. Tool definition ordering (stable? shuffled?)
//   3. History processing (append-only? mutated? compressed?)

const nsToMs = (ns: number) => Math.round(ns / 1_000_000);

export async function runTurn(
  userMessage: string,
  history: Message[],
  turn: number,
  strategy: ContextStrategy,
): Promise<{ history: Message[]; metrics: TurnMetrics }> {
  // 1. Add the new user message (append-only — this always goes at the end)
  const rawHistory: Message[] = [...history, { role: "user", content: userMessage }];

  // 2. Let the strategy process the history (may compress, mutate, or pass through)
  const processedHistory = strategy.processHistory(rawHistory, turn);

  // 3. Build the system prompt and tools via strategy
  const systemPrompt = strategy.buildSystemPrompt(turn);
  const turnTools = strategy.buildTools(turn, tools);

  // 4. Send to Ollama — the response includes timing metadata
  const response = await ollama.chat({
    model: MODEL,
    // @ts-expect-error — system not in ChatRequest types but works at runtime
    system: systemPrompt,
    messages: processedHistory,
    tools: turnTools,
  });

  const assistantMessage = response.message as Message;
  rawHistory.push(assistantMessage);

  // 5. Execute tool calls if any (single round — no recursive loop for benchmark)
  if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const result = executeTool(name, args as Record<string, string>);
      rawHistory.push({ role: "tool", content: result });
    }
  }

  // 6. Extract metrics from Ollama's response
  const metrics: TurnMetrics = {
    turn,
    question: userMessage,
    promptTokens: response.prompt_eval_count ?? 0,
    promptEvalMs: nsToMs(response.prompt_eval_duration ?? 0),
    responseTokens: response.eval_count ?? 0,
    responseEvalMs: nsToMs(response.eval_duration ?? 0),
    totalMs: nsToMs(response.total_duration ?? 0),
  };

  return { history: rawHistory, metrics };
}
