import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";
import { tools, executeTool, type ToolMode } from "./tools.js";
import { estimateTokens } from "./token-counter.js";
import type { AgentResult, ArtifactEntry, TokenStats } from "./types.js";

// ─── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a service monitoring assistant for a microservices platform.

Your job is to help engineers understand system health, investigate issues, and triage incidents. You have access to tools that query live monitoring data.

Follow this workflow:
1. Start with list_services to get an overview of system health
2. Use get_error_logs and get_metrics to drill into specific services
3. Check get_incidents for ongoing issues and their status

Important:
- Always use tools to check real data — never guess at service status
- Summarize findings concisely — engineers need actionable information, not raw data
- When multiple services are affected, identify the root cause (e.g. cascading failures)
- Prioritize critical and high-priority issues in your response`;

// ─── Agent Loop ─────────────────────────────────────────────────────────────
//
// Standard ReAct loop with one key difference: executeTool returns
// { content, artifact } instead of a plain string.
//
// - Only `content` goes into the message history (LLM context)
// - `artifact` accumulates in a side channel for the UI
// - Token stats track what the LLM sees vs what was kept out

const MAX_ITERATIONS = 10;

export async function runAgent(
  userMessage: string,
  history: Message[],
  mode: ToolMode,
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const artifacts: ArtifactEntry[] = [];
  let contentTokensTotal = 0;
  let artifactTokensTotal = 0;

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;

      const { content, artifact } = executeTool(name, args as Record<string, string>, mode);
      const contentTokens = estimateTokens(content);
      contentTokensTotal += contentTokens;

      logToolCall(name, args as Record<string, string>, content, { maxResultLength: 120 });

      // Only content enters the LLM's context
      messages.push({ role: "tool", content });

      // Artifact goes to the side channel
      if (artifact) {
        const fullDataStr = JSON.stringify(artifact.data);
        const artifactTokens = estimateTokens(fullDataStr);
        artifactTokensTotal += artifactTokens;

        artifacts.push({
          toolName: name,
          artifact,
          tokensSaved: artifactTokens - contentTokens,
        });
      }
    }
  }

  const totalTokens = contentTokensTotal + artifactTokensTotal;
  const tokenStats: TokenStats = {
    contentTokens: contentTokensTotal,
    artifactTokens: artifactTokensTotal,
    savedTokens: artifactTokensTotal > 0 ? artifactTokensTotal - contentTokensTotal : 0,
    savingsPercent:
      totalTokens > 0 ? ((artifactTokensTotal - contentTokensTotal) / totalTokens) * 100 : 0,
  };

  // In simple mode, all data went into content — calculate differently
  if (mode === "simple") {
    tokenStats.artifactTokens = 0;
    tokenStats.savedTokens = 0;
    tokenStats.savingsPercent = 0;
  }

  return { messages, artifacts, tokenStats };
}
