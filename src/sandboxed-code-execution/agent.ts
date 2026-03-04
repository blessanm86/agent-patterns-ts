// ─── Recipe Calculator Agent ──────────────────────────────────────────────────
//
// ReAct loop with sandbox lifecycle management. On each user turn:
//   1. Acquire a sandbox (affinity-aware — reuses same sandbox for conversation)
//   2. Run the standard reason + act loop with tool calls
//   3. Release the sandbox back to the pool (affinity binding persists)

import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import type { Message } from "./types.js";
import type { SandboxPool } from "./sandbox-pool.js";

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a recipe calculator assistant. You help users with cooking calculations by writing and executing JavaScript code in a sandboxed environment.

Your capabilities:
- Scale recipes to different serving sizes
- Compare nutritional information across recipes
- Convert between units (metric/imperial)
- Calculate total calories, macros, and ingredient quantities
- Perform any cooking math the user needs

Available tools:
1. **get_recipe_data** — look up a recipe by name to get ingredients, nutrition, and servings
2. **execute_code** — run JavaScript code in a sandbox. Available globals:
   - console.log() — output results (ALWAYS use this to show results)
   - Math, JSON, Date, parseInt, parseFloat, Number, String, Array, Object
   - callTool(name, args) — call tools from inside the sandbox (e.g. await callTool('get_recipe_data', { name: 'pad thai' }))
3. **pool_status** — check the sandbox pool status

Workflow:
1. First fetch recipe data using get_recipe_data
2. Then write JavaScript code that processes the data and console.log() the results
3. In your code, you can also call get_recipe_data from inside the sandbox using: const data = JSON.parse(await callTool('get_recipe_data', { name: '...' }))

Available recipes: chicken tikka masala, caesar salad, banana bread, pad thai, greek salad, spaghetti carbonara, chocolate chip cookies, vegetable stir fry

Always show your calculations clearly with console.log(). Format output as readable text, not raw JSON.`;

// ─── Agent Stats ──────────────────────────────────────────────────────────────

export interface AgentStats {
  llmCalls: number;
  toolCalls: number;
  codeExecutions: number;
  sandboxId: string;
  affinityReused: boolean;
}

// ─── Agent ────────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 10;

export async function runAgent(
  userMessage: string,
  history: Message[],
  pool: SandboxPool,
  conversationId: string,
): Promise<{ messages: Message[]; stats: AgentStats }> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  // Acquire a sandbox for this turn
  const priorSandbox = pool.getAffinitySandbox(conversationId);
  const sandbox = pool.acquire(conversationId);
  const affinityReused = priorSandbox === sandbox.id;

  const stats: AgentStats = {
    llmCalls: 0,
    toolCalls: 0,
    codeExecutions: 0,
    sandboxId: sandbox.id,
    affinityReused,
  };

  try {
    // ── ReAct Loop ────────────────────────────────────────────────────────────

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await ollama.chat({
        model: MODEL,
        // @ts-expect-error — system not in ChatRequest types but works at runtime
        system: SYSTEM_PROMPT,
        messages,
        tools,
      });
      stats.llmCalls++;

      const assistantMessage = response.message as Message;
      messages.push(assistantMessage);

      // No tool calls → agent is done reasoning
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        break;
      }

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const { name, arguments: args } = toolCall.function;
        stats.toolCalls++;
        if (name === "execute_code") stats.codeExecutions++;

        const result = await executeTool(name, args as Record<string, string>, pool, sandbox.id);

        messages.push({ role: "tool", content: result });
      }
    }
  } finally {
    // Always release the sandbox back to the pool
    pool.release(sandbox.id);
  }

  return { messages, stats };
}
