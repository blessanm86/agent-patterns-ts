// ─── Tool Definitions & Implementations ─────────────────────────────────────
//
// Two tool sets for the same domain:
//
//   Raw:     query_raw(query: string) — LLM writes the full MetricsQL string
//   Builder: query_metrics(metric, aggregation, filters, ...) — LLM fills structured params
//
// Both include list_metrics so the LLM knows what's available.
// The dispatcher routes to the right implementation based on mode.

import type { ToolDefinition } from "../shared/types.js";
import type { QueryMode, QueryResult } from "./types.js";
import { buildQuery, listAvailableMetrics, METRICS, parseRawQuery } from "./query-engine.js";

// ─── Shared Tool: list_metrics ──────────────────────────────────────────────

const listMetricsTool: ToolDefinition = {
  type: "function",
  function: {
    name: "list_metrics",
    description:
      "Lists all available metrics, their descriptions, and valid labels. " +
      "Call this first to understand what metrics and labels are available before querying.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

// ─── Raw Tool Set ───────────────────────────────────────────────────────────

const queryRawTool: ToolDefinition = {
  type: "function",
  function: {
    name: "query_raw",
    description:
      "Execute a metrics query using MetricsQL syntax. " +
      'Format: metric_name{label="value", label="value"} | aggregation [time_range]\n' +
      "Optional group by: metric_name{...} | aggregation by(label) [time_range]\n" +
      'Example: http_requests_total{service="api-gateway", status="500"} | count [1h]\n' +
      'Example: http_request_duration_ms{service="checkout-service"} | p99 by(method) [15m]\n' +
      "Label values MUST be quoted. The '|' separator before aggregation is required.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The MetricsQL query string. Use list_metrics to see available metrics and labels.",
        },
      },
      required: ["query"],
    },
  },
};

export const rawTools: ToolDefinition[] = [listMetricsTool, queryRawTool];

// ─── Builder Tool Set ───────────────────────────────────────────────────────

const queryMetricsTool: ToolDefinition = {
  type: "function",
  function: {
    name: "query_metrics",
    description:
      "Query metrics using structured parameters. The system constructs the query for you — " +
      "just specify what you want to measure. Use list_metrics first to see available metrics and labels.",
    parameters: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          description: "The metric to query",
          enum: METRICS.map((m) => m.name),
        },
        aggregation: {
          type: "string",
          description: "How to aggregate the metric values",
          enum: ["count", "sum", "avg", "max", "min", "rate", "p50", "p95", "p99"],
        },
        filters: {
          type: "string",
          description:
            'JSON array of label filters. Each filter: {"label": "name", "op": "eq|neq|gt|lt|gte|lte|regex", "value": "val"}. ' +
            'Example: [{"label": "service", "op": "eq", "value": "api-gateway"}]',
        },
        group_by: {
          type: "string",
          description: "Label to group results by (e.g. 'service', 'method', 'status')",
        },
        time_range: {
          type: "string",
          description: "Time window for the query. Defaults to 1h if omitted.",
          enum: ["5m", "15m", "1h", "6h", "24h"],
        },
      },
      required: ["metric", "aggregation"],
    },
  },
};

export const builderTools: ToolDefinition[] = [listMetricsTool, queryMetricsTool];

// ─── Tool Implementations ───────────────────────────────────────────────────

function handleListMetrics(): string {
  return listAvailableMetrics();
}

function handleQueryRaw(args: Record<string, string>): QueryResult {
  const queryStr = args.query ?? "";
  return parseRawQuery(queryStr);
}

function handleQueryMetrics(args: Record<string, string>): QueryResult {
  // Parse filters from JSON string (LLM sends it as a string param)
  let filters;
  if (args.filters) {
    try {
      filters = JSON.parse(args.filters);
    } catch {
      return {
        success: false,
        query: "",
        data: null,
        error: `Invalid filters JSON: ${args.filters}. Expected format: [{"label": "service", "op": "eq", "value": "api-gateway"}]`,
        rows: 0,
      };
    }
  }

  return buildQuery({
    metric: args.metric,
    aggregation: args.aggregation as import("./types.js").Aggregation,
    filters,
    group_by: args.group_by,
    time_range: args.time_range as import("./types.js").TimeRange | undefined,
  });
}

// ─── Mode-Aware Dispatcher ──────────────────────────────────────────────────

export interface ToolResult {
  content: string;
  queryResult: QueryResult | null;
}

export function executeTool(
  name: string,
  args: Record<string, string>,
  mode: QueryMode,
): ToolResult {
  if (name === "list_metrics") {
    return { content: handleListMetrics(), queryResult: null };
  }

  if (mode === "raw" && name === "query_raw") {
    const result = handleQueryRaw(args);
    return {
      content: formatQueryResult(result),
      queryResult: result,
    };
  }

  if (mode === "builder" && name === "query_metrics") {
    const result = handleQueryMetrics(args);
    return {
      content: formatQueryResult(result),
      queryResult: result,
    };
  }

  return {
    content: JSON.stringify({ error: `Unknown tool: ${name}` }),
    queryResult: null,
  };
}

function formatQueryResult(result: QueryResult): string {
  if (!result.success) {
    return `Query error: ${result.error}`;
  }

  if (result.rows === 0) {
    return `Query: ${result.query}\nNo results found.`;
  }

  const dataStr = JSON.stringify(result.data, null, 2);
  return `Query: ${result.query}\nResults (${result.rows} rows):\n${dataStr}`;
}

// ─── Tool Set Selector ──────────────────────────────────────────────────────

export function getTools(mode: QueryMode): ToolDefinition[] {
  return mode === "raw" ? rawTools : builderTools;
}
