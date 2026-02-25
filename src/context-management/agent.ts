import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { estimateMessageTokens } from "./token-counter.js";
import type { Message } from "../shared/types.js";
import type { ContextStrategy, ContextStats } from "./strategies/types.js";

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a tech research assistant with access to a knowledge base of articles about software engineering and AI.

Your goal is to help the user research topics by searching for articles, reading them, and synthesizing findings. Follow this workflow:

1. When the user asks about a topic, use search_articles to find relevant articles
2. Use read_article to read full articles that look relevant
3. Use save_note to record key findings as you research
4. Synthesize information across multiple articles to give comprehensive answers

Important rules:
- Always search before answering — don't make up information
- Read the full article when a summary isn't sufficient
- Save important findings as notes for later reference
- If no articles match, say so honestly
- Be thorough but concise in your responses`;

// ─── Agent Result ────────────────────────────────────────────────────────────

export interface AgentResult {
  messages: Message[];
  iterations: number;
  contextStats: ContextStats;
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────
//
// ReAct loop with context management strategy middleware.
// Before each LLM call, strategy.prepare() trims the messages to fit the budget.

const MODEL = process.env.MODEL ?? "qwen2.5:7b";
const MAX_ITERATIONS = 10;

export async function runAgent(
  userMessage: string,
  history: Message[],
  strategy: ContextStrategy | null,
  tokenBudget: number,
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  let iterations = 0;

  // Track context stats from the first LLM call
  const tokensBefore = estimateMessageTokens(messages);
  let tokensAfter = tokensBefore;
  let triggered = false;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // ── Apply context management strategy before each LLM call ─────────────
    const prepared = strategy ? await strategy.prepare(messages, tokenBudget) : messages;

    const preparedTokens = estimateMessageTokens(prepared);
    if (preparedTokens < estimateMessageTokens(messages)) {
      triggered = true;
    }
    tokensAfter = preparedTokens;

    const response = await ollama.chat({
      model: MODEL,
      system: SYSTEM_PROMPT,
      messages: prepared,
      tools,
    });

    const assistantMessage = response.message;

    // Add assistant's response to the FULL history (not the prepared one)
    messages.push(assistantMessage);

    // No tool calls → agent is done reasoning
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    // Execute tool calls and feed results back
    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;

      console.log(`\n  🔧 Tool call: ${name}`);
      console.log(`     Args: ${JSON.stringify(args, null, 2).replace(/\n/g, "\n     ")}`);

      const result = executeTool(name, args as Record<string, string>);

      const preview = result.length > 120 ? `${result.slice(0, 120)}...` : result;
      console.log(`     Result: ${preview}`);

      messages.push({ role: "tool", content: result });
    }
  }

  return {
    messages,
    iterations,
    contextStats: {
      tokensBefore: estimateMessageTokens(messages),
      tokensAfter,
      strategyName: strategy?.name ?? "none",
      triggered,
    },
  };
}
