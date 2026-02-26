// ─── Query Builder Agent ─────────────────────────────────────────────────────
//
// Standard ReAct loop with mode-aware tool routing.
// Tracks query success/failure stats to quantify the raw vs builder difference.

import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";
import { executeTool, getTools } from "./tools.js";
import type { AgentResult, QueryMode, QueryStats } from "./types.js";

// ─── System Prompts ─────────────────────────────────────────────────────────

const RAW_SYSTEM_PROMPT = `You are a metrics monitoring assistant for a microservices platform.

Your job is to help engineers query and analyze system metrics. You have access to a MetricsQL query tool.

MetricsQL syntax:
  metric_name{label="value", label="value"} | aggregation [time_range]
  metric_name{label="value"} | aggregation by(label) [time_range]

Rules:
- Label values MUST be quoted with double quotes
- The | separator before the aggregation is REQUIRED
- Valid aggregations: count, sum, avg, max, min, rate, p50, p95, p99
- Valid time ranges: 5m, 15m, 1h, 6h, 24h (default: 1h)
- Use list_metrics first to see available metrics and their labels

Examples:
  http_requests_total{service="api-gateway"} | count [1h]
  http_request_duration_ms{service="checkout-service"} | p99 by(method) [15m]
  error_rate{service="payment-gateway"} | avg [24h]
  cpu_usage_percent | avg by(service) [1h]

If a query fails, read the error message carefully and fix the syntax.`;

const BUILDER_SYSTEM_PROMPT = `You are a metrics monitoring assistant for a microservices platform.

Your job is to help engineers query and analyze system metrics. You have access to a structured query tool that builds queries for you.

Workflow:
1. Call list_metrics to see available metrics, labels, and aggregations
2. Call query_metrics with structured parameters — the system constructs the query

The query_metrics tool accepts:
- metric: the metric name (from list_metrics)
- aggregation: how to aggregate (count, sum, avg, max, min, rate, p50, p95, p99)
- filters: JSON array of label filters (optional)
- group_by: label to group results by (optional)
- time_range: 5m, 15m, 1h, 6h, 24h (optional, default 1h)

Provide clear, concise summaries of the query results.`;

// ─── Agent Loop ─────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 15;

export async function runAgent(
  userMessage: string,
  history: Message[],
  mode: QueryMode,
): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const tools = getTools(mode);
  const systemPrompt = mode === "raw" ? RAW_SYSTEM_PROMPT : BUILDER_SYSTEM_PROMPT;

  const queryStats: QueryStats = {
    totalQueries: 0,
    successfulQueries: 0,
    failedQueries: 0,
    errors: [],
  };

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: systemPrompt,
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

      const { content, queryResult } = executeTool(name, args as Record<string, string>, mode);

      logToolCall(name, args as Record<string, string>, content, { maxResultLength: 200 });

      messages.push({ role: "tool", content });

      // Track query stats (skip list_metrics — it's informational, not a query)
      if (queryResult) {
        queryStats.totalQueries++;
        if (queryResult.success) {
          queryStats.successfulQueries++;
        } else {
          queryStats.failedQueries++;
          if (queryResult.error) {
            queryStats.errors.push(queryResult.error);
          }
        }
      }
    }
  }

  return { messages, queryStats };
}
