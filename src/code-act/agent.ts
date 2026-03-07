// ─── CodeAct Agent + JSON Comparison Agent ──────────────────────────────────────
//
// CodeAct: the LLM's action format is Python code, not JSON tool calls.
//   - No `tools` array sent to the model
//   - The model responds with ```python ... ``` blocks
//   - We execute the code, capture stdout/stderr, and inject as an observation
//   - Loop continues until the model produces a response with no code block
//
// JSON: the traditional approach for comparison.
//   - Tools sent as JSON schemas
//   - Model responds with tool_calls
//   - We dispatch each call, feed results back as tool messages

import ollama from "ollama";
import { executePython, executeJsonTool, jsonTools, TOOL_DOCS } from "./tools.js";
import { MODEL } from "../shared/config.js";
import type { Message } from "../shared/types.js";

// ─── Agent Stats ──────────────────────────────────────────────────────────────

export interface AgentStats {
  llmCalls: number;
  actionCalls: number; // code blocks executed (CodeAct) or tool calls dispatched (JSON)
  inputTokens: number;
  outputTokens: number;
}

// ─── CodeAct Agent ────────────────────────────────────────────────────────────
//
// System prompt: describes available Python functions instead of JSON schemas.
// The model writes code; we run it; the output becomes the next observation.

const CODEACT_SYSTEM_PROMPT = `You are a meal planning assistant. You answer questions by writing Python code.

Available functions (already in scope — no import needed):
${TOOL_DOCS}

HOW TO USE:
Write a Python code block to call functions and print results:

\`\`\`python
# Example — always print your results
results = search_recipes("low carb")
for r in results:
    info = get_nutritional_info(r)
    print(f"{r}: {info['calories']} cal/serving, {info['protein_g']}g protein")
\`\`\`

When you have enough information to give a complete answer, write it as plain text with NO code block.

Rules:
- Always use print() — output is your only way to see results
- Combine multiple operations in one code block when possible (loop over results, compute totals, etc.)
- Give your final answer as plain text once you have what you need`;

const MAX_ITERATIONS = 8;

function extractCodeBlocks(content: string): string[] {
  const blocks: string[] = [];
  const regex = /```python\n?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const code = match[1].trim();
    if (code) blocks.push(code);
  }
  return blocks;
}

function formatObservation(result: Awaited<ReturnType<typeof executePython>>): string {
  const parts: string[] = [];
  if (result.timedOut) parts.push("[timed out after 10s]");
  if (result.stdout.trim()) parts.push(result.stdout.trimEnd());
  if (result.stderr.trim()) parts.push(`[stderr]\n${result.stderr.trimEnd()}`);
  return parts.join("\n") || "(no output)";
}

export async function runCodeActAgent(
  userMessage: string,
  history: Message[],
): Promise<{ messages: Message[]; stats: AgentStats }> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const stats: AgentStats = { llmCalls: 0, actionCalls: 0, inputTokens: 0, outputTokens: 0 };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: CODEACT_SYSTEM_PROMPT,
      messages,
    });
    stats.llmCalls++;
    stats.inputTokens += response.prompt_eval_count ?? 0;
    stats.outputTokens += response.eval_count ?? 0;

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    const codeBlocks = extractCodeBlocks(assistantMessage.content ?? "");

    // No code block → agent has its final answer
    if (codeBlocks.length === 0) break;

    // Execute each code block and collect outputs
    const observations: string[] = [];
    for (const code of codeBlocks) {
      stats.actionCalls++;
      const result = await executePython(code);
      const observation = formatObservation(result);
      console.log(`\n  [code] ${code.split("\n")[0].slice(0, 60)}...`);
      console.log(`  [out]  ${observation.split("\n")[0].slice(0, 80)}`);
      observations.push(observation);
    }

    // Inject observation back as a user message (standard CodeAct pattern)
    messages.push({
      role: "user",
      content: `Observation:\n${observations.join("\n\n---\n\n")}`,
    });
  }

  return { messages, stats };
}

// ─── JSON Tool-Calling Agent (comparison) ────────────────────────────────────
//
// Standard ReAct loop with JSON tool schemas. Identical capabilities to the
// CodeAct agent but the model must call tools one at a time via JSON.

const JSON_SYSTEM_PROMPT = `You are a meal planning assistant. Use the available tools to answer questions about recipes and meal planning. Call tools one at a time as needed.`;

export async function runJsonAgent(
  userMessage: string,
  history: Message[],
): Promise<{ messages: Message[]; stats: AgentStats }> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const stats: AgentStats = { llmCalls: 0, actionCalls: 0, inputTokens: 0, outputTokens: 0 };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: JSON_SYSTEM_PROMPT,
      messages,
      tools: jsonTools,
    });
    stats.llmCalls++;
    stats.inputTokens += response.prompt_eval_count ?? 0;
    stats.outputTokens += response.eval_count ?? 0;

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) break;

    for (const toolCall of assistantMessage.tool_calls) {
      stats.actionCalls++;
      const result = executeJsonTool(
        toolCall.function.name,
        toolCall.function.arguments as Record<string, string>,
      );
      console.log(
        `\n  [tool] ${toolCall.function.name}(${JSON.stringify(toolCall.function.arguments).slice(0, 60)})`,
      );
      messages.push({ role: "tool", content: result });
    }
  }

  return { messages, stats };
}
