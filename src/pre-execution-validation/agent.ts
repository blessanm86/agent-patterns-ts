// ─── Pre-Execution Validation Agent ──────────────────────────────────────────
//
// ReAct loop with shadow workspace validation. When the agent calls edit_recipe:
//
// Shadow mode:
//   1. Clone workspace to shadow copy
//   2. Apply edit to shadow
//   3. Run 3-layer validation (JSON syntax → Zod schema → semantic rules)
//   4. If valid → promote shadow to real workspace, return success
//   5. If invalid → discard shadow, return diagnostics → agent self-corrects
//
// Direct mode:
//   Edit applied immediately with no validation (for A/B comparison).

import ollama from "ollama";
import { tools, executeTool, type AgentMode, type ToolStats } from "./tools.js";
import { MODEL } from "../shared/config.js";
import type { Message } from "../shared/types.js";
import type { Workspace } from "./shadow.js";

// ─── System Prompts ──────────────────────────────────────────────────────────

function buildSystemPrompt(mode: AgentMode): string {
  const base = `You are a recipe collection manager. You help users create and edit recipe files stored as JSON in a workspace.

When a user asks you to create or modify a recipe:
1. If editing an existing recipe, first read it with read_recipe
2. Create or update the recipe using edit_recipe with the complete recipe JSON`;

  if (mode === "shadow") {
    return `${base}
3. If the edit is rejected with validation errors, carefully fix ALL reported issues and call edit_recipe again
4. Keep fixing and retrying until the edit is accepted (status: "promoted")
5. Only tell the user the edit is done after it has been promoted

The edit_recipe tool validates your JSON in an isolated shadow workspace before applying it. If validation fails, you'll get specific diagnostics — fix every reported issue.`;
  }

  return `${base}
3. Tell the user the edit is complete

The edit_recipe tool applies changes directly with no validation.`;
}

// ─── Agent Stats ─────────────────────────────────────────────────────────────

export interface AgentStats {
  mode: AgentMode;
  llmCalls: number;
  toolCalls: number;
  shadowValidations: number;
  validationPasses: number;
  validationFailures: number;
  promotions: number;
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 15;

export interface AgentResult {
  messages: Message[];
  stats: AgentStats;
}

export async function runAgent(
  userMessage: string,
  history: Message[],
  workspace: Workspace,
  mode: AgentMode = "shadow",
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const systemPrompt = buildSystemPrompt(mode);

  const toolStats: ToolStats = {
    shadowValidations: 0,
    validationPasses: 0,
    validationFailures: 0,
    promotions: 0,
  };

  let llmCalls = 0;
  let toolCalls = 0;

  // ── ReAct Loop ─────────────────────────────────────────────────────────────

  for (let i = 0; i < MAX_ITERATIONS; i++) {
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

      const result = executeTool(name, args as Record<string, string>, workspace, mode, toolStats);
      messages.push({ role: "tool", content: result });
    }
  }

  return {
    messages,
    stats: {
      mode,
      llmCalls,
      toolCalls,
      ...toolStats,
    },
  };
}
