import ollama from "ollama";
import { buildTools, executeTool, getDomainToolNames, type AgentMode } from "./tools.js";
import { getSkillInstructions, buildSkillCatalog } from "./skills.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message, ToolDefinition } from "../shared/types.js";

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface AgentStats {
  mode: AgentMode;
  llmCalls: number;
  toolCalls: number;
  getSkillCalls: number;
  systemPromptChars: number;
  toolDescriptionChars: number;
  totalPromptChars: number;
}

// ─── System Prompts ──────────────────────────────────────────────────────────

function buildSystemPrompt(mode: AgentMode): string {
  const base = `You are a customer support agent for an e-commerce store. You help customers with order issues including complaints, returns, refunds, shipping updates, and inventory questions.

Be helpful, empathetic, and thorough. Always investigate before taking action.`;

  if (mode === "skills") {
    const toolNames = getDomainToolNames();
    const catalog = buildSkillCatalog(toolNames);
    return `${base}

${catalog}

IMPORTANT: When a customer request involves a multi-step procedure (like investigating a complaint, processing a return, or handling an escalation), ALWAYS call get_skill first to load the step-by-step instructions before starting. This ensures you follow the correct procedure.`;
  }

  return `${base}

Use the tools available to you to investigate and resolve customer issues. Each tool description contains workflow instructions — follow them carefully.`;
}

function measureToolDescriptionChars(tools: ToolDefinition[]): number {
  return tools.reduce((sum, t) => sum + JSON.stringify(t).length, 0);
}

// ─── Agent Loop ──────────────────────────────────────────────────────────────

export interface AgentResult {
  messages: Message[];
  stats: AgentStats;
}

export async function runAgent(
  userMessage: string,
  history: Message[],
  mode: AgentMode = "skills",
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const tools = buildTools(mode);
  const systemPrompt = buildSystemPrompt(mode);

  let llmCalls = 0;
  let toolCalls = 0;
  let getSkillCalls = 0;

  // ── ReAct Loop ─────────────────────────────────────────────────────────────

  while (true) {
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

      if (name === "get_skill") {
        // ── Meta-tool: load skill instructions ──────────────────────────────
        getSkillCalls++;
        const skillName = (args as Record<string, string>).skill_name;
        const result = getSkillInstructions(skillName);
        logToolCall(name, args as Record<string, string>, result);
        messages.push({ role: "tool", content: result });
      } else {
        // ── Domain tool ─────────────────────────────────────────────────────
        const result = executeTool(name, args as Record<string, string>);
        logToolCall(name, args as Record<string, string>, result);
        messages.push({ role: "tool", content: result });
      }
    }
  }

  const toolDescriptionChars = measureToolDescriptionChars(tools);

  return {
    messages,
    stats: {
      mode,
      llmCalls,
      toolCalls,
      getSkillCalls,
      systemPromptChars: systemPrompt.length,
      toolDescriptionChars,
      totalPromptChars: systemPrompt.length + toolDescriptionChars,
    },
  };
}
