import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { classifyQuery } from "./router.js";
import { HOTEL_SYSTEM_PROMPT } from "../shared/prompts.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "./types.js";
import type { CostTracker } from "./costs.js";

// ─── Model Tier Map ───────────────────────────────────────────────────────────

export interface ModelMap {
  fast: string;
  standard: string;
  capable: string;
}

// ─── Cost-Tracked ReAct Agent ─────────────────────────────────────────────────
//
// Same ReAct loop as src/react/agent.ts, but with two additions:
//
// 1. ROUTING — before the loop, the fast model classifies the query to pick
//    which model handles reasoning. Simple queries use a cheaper model.
//
// 2. COST TRACKING — every ollama.chat() call records its token counts via
//    the CostTracker, so the CLI can show per-turn cost breakdowns.

export async function runAgent(
  userMessage: string,
  history: Message[],
  models: ModelMap,
  costTracker: CostTracker,
): Promise<Message[]> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  // ── Step 1: Classify the query ──────────────────────────────────────────
  const classification = await classifyQuery(userMessage, history, models.fast);
  costTracker.record(
    models.fast,
    "fast",
    classification.inputTokens,
    classification.outputTokens,
    "Router",
  );

  const selectedModel = models[classification.tier];
  console.log(
    `\n  \u2192 Router: ${classification.tier} (${selectedModel}) \u2014 ${classification.reason}`,
  );

  // ── Step 2: For "fast" tier, answer without tools ───────────────────────
  if (classification.tier === "fast") {
    const response = await ollama.chat({
      model: selectedModel,
      messages: [{ role: "system", content: HOTEL_SYSTEM_PROMPT }, ...messages],
    });

    costTracker.record(
      selectedModel,
      "fast",
      response.prompt_eval_count ?? 0,
      response.eval_count ?? 0,
      "Response",
    );

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);
    return messages;
  }

  // ── Step 3: ReAct loop with the selected model ──────────────────────────
  let iteration = 0;
  while (true) {
    iteration++;

    const response = await ollama.chat({
      model: selectedModel,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: HOTEL_SYSTEM_PROMPT,
      messages,
      tools,
    });

    costTracker.record(
      selectedModel,
      classification.tier,
      response.prompt_eval_count ?? 0,
      response.eval_count ?? 0,
      iteration === 1 ? "Reasoning" : `Reasoning #${iteration}`,
    );

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    // No tool calls → agent is done
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute each tool call
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const result = executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result);
      messages.push({ role: "tool", content: result });
    }

    // Safety: prevent infinite loops
    if (iteration >= 10) {
      console.log("  \u26A0 Max iterations reached, stopping.");
      break;
    }
  }

  return messages;
}
