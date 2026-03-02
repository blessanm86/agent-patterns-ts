import ollama from "ollama";
import { basicTools, agenticTools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message, AgentStats, AgentResult } from "./types.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const SEARCH_BUDGET = 5;
const BASIC_MAX_ITERATIONS = 3;
const AGENTIC_MAX_ITERATIONS = 10;

// ─── System Prompts ─────────────────────────────────────────────────────────

const BASIC_SYSTEM_PROMPT = `You are a NexusDB documentation assistant.

Search the docs ONCE using search_docs, then answer the user's question based on what you find.
Do NOT search multiple times — one search, then answer.
If the search results don't contain the answer, say so honestly.
ONLY state facts from the documentation search results.`;

const AGENTIC_SYSTEM_PROMPT = `You are a NexusDB documentation research assistant.

When answering questions, follow this reasoning process:

1. PLAN — What information do you need? Consider using list_sources to see what documentation exists.
2. SEARCH — Call search_docs with a specific, targeted query using keywords (not full sentences).
3. EVALUATE — Do the results fully answer the question? Identify what you found and what's still missing.
4. REFINE — If gaps remain, formulate a DIFFERENT query targeting the missing information and search again.

Guidelines:
- Each search should target a different aspect — don't repeat the same query
- State your reasoning before each search: "I found X but still need Y, so I'll search for Z"
- You have a budget of ${SEARCH_BUDGET} searches — use them wisely
- When you have enough information OR your budget is exhausted, stop and synthesize a complete answer
- ONLY state facts from the documentation — do not make up details
- Combine information from multiple searches into a cohesive, well-organized answer`;

// ─── Basic RAG Agent ────────────────────────────────────────────────────────
//
// Single search, then answer. The baseline for comparison.

export async function runBasicAgent(userMessage: string, history: Message[]): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const stats: AgentStats = {
    mode: "basic",
    llmCalls: 0,
    searchCalls: 0,
    searchBudget: 1,
    budgetExhausted: false,
  };

  let iterations = 0;

  while (iterations < BASIC_MAX_ITERATIONS) {
    iterations++;
    stats.llmCalls++;

    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: BASIC_SYSTEM_PROMPT,
      messages,
      tools: basicTools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      stats.searchCalls++;

      const result = await executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result, { maxResultLength: 300 });
      messages.push({ role: "tool", content: result });
    }
  }

  return { messages, stats };
}

// ─── Agentic RAG Agent ─────────────────────────────────────────────────────
//
// Iterative retrieval: the agent plans queries, evaluates results, and
// refines its search strategy until it has enough information or exhausts
// its search budget. This is what makes it "agentic" — the agent controls
// the retrieval loop, not a fixed pipeline.

export async function runAgenticAgent(
  userMessage: string,
  history: Message[],
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const stats: AgentStats = {
    mode: "agentic",
    llmCalls: 0,
    searchCalls: 0,
    searchBudget: SEARCH_BUDGET,
    budgetExhausted: false,
  };

  let iterations = 0;

  while (iterations < AGENTIC_MAX_ITERATIONS) {
    iterations++;
    stats.llmCalls++;

    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: AGENTIC_SYSTEM_PROMPT,
      messages,
      tools: agenticTools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;

      // search_docs costs 1 from the budget; list_sources is free
      if (name === "search_docs") {
        if (stats.searchCalls >= SEARCH_BUDGET) {
          stats.budgetExhausted = true;
          const budgetMsg =
            `Search budget exhausted (${SEARCH_BUDGET}/${SEARCH_BUDGET} searches used). ` +
            "Please synthesize your answer from the information you've already gathered.";
          logToolCall(name, args as Record<string, string>, budgetMsg, { maxResultLength: 300 });
          messages.push({ role: "tool", content: JSON.stringify({ error: budgetMsg }) });
          continue;
        }
        stats.searchCalls++;
      }

      const result = await executeTool(name, args as Record<string, string>);
      logToolCall(name, args as Record<string, string>, result, { maxResultLength: 300 });
      messages.push({ role: "tool", content: result });
    }
  }

  if (iterations >= AGENTIC_MAX_ITERATIONS) {
    console.log(`\n  ⚠️  Hit max iterations (${AGENTIC_MAX_ITERATIONS})`);
  }

  return { messages, stats };
}
