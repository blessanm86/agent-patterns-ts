import type { ToolDefinition } from "../shared/types.js";

// ─── Mock Data ───────────────────────────────────────────────────────────────
//
// 10 system metrics with realistic time-series data. Every metric the LLM
// might pick needs an entry here so queries never 404.

interface MetricInfo {
  name: string;
  description: string;
  unit: string;
  category: string;
}

interface DataPoint {
  timestamp: string;
  value: number;
}

interface MockSeries {
  current: number;
  points: DataPoint[];
}

const METRIC_CATALOG: MetricInfo[] = [
  { name: "cpu_usage", description: "CPU utilization percentage", unit: "%", category: "compute" },
  {
    name: "memory_usage",
    description: "Memory utilization percentage",
    unit: "%",
    category: "compute",
  },
  { name: "disk_io_read", description: "Disk read throughput", unit: "MB/s", category: "storage" },
  {
    name: "disk_io_write",
    description: "Disk write throughput",
    unit: "MB/s",
    category: "storage",
  },
  {
    name: "http_request_count",
    description: "Total HTTP requests per minute",
    unit: "req/min",
    category: "network",
  },
  {
    name: "http_error_rate",
    description: "HTTP 5xx error rate",
    unit: "%",
    category: "network",
  },
  {
    name: "response_latency_p99",
    description: "99th percentile response latency",
    unit: "ms",
    category: "network",
  },
  {
    name: "network_bytes_in",
    description: "Inbound network traffic",
    unit: "MB/s",
    category: "network",
  },
  {
    name: "network_bytes_out",
    description: "Outbound network traffic",
    unit: "MB/s",
    category: "network",
  },
  {
    name: "tcp_connections",
    description: "Active TCP connections",
    unit: "count",
    category: "network",
  },
];

function makeTimestamps(): string[] {
  const now = Date.now();
  return Array.from({ length: 5 }, (_, i) => new Date(now - (4 - i) * 60_000).toISOString());
}

const TS = makeTimestamps();

const MOCK_SERIES: Record<string, MockSeries> = {
  cpu_usage: {
    current: 72.5,
    points: [
      { timestamp: TS[0], value: 65.2 },
      { timestamp: TS[1], value: 68.1 },
      { timestamp: TS[2], value: 70.3 },
      { timestamp: TS[3], value: 71.8 },
      { timestamp: TS[4], value: 72.5 },
    ],
  },
  memory_usage: {
    current: 58.3,
    points: [
      { timestamp: TS[0], value: 55.0 },
      { timestamp: TS[1], value: 56.2 },
      { timestamp: TS[2], value: 57.1 },
      { timestamp: TS[3], value: 57.9 },
      { timestamp: TS[4], value: 58.3 },
    ],
  },
  disk_io_read: {
    current: 124.7,
    points: [
      { timestamp: TS[0], value: 110.3 },
      { timestamp: TS[1], value: 115.8 },
      { timestamp: TS[2], value: 120.1 },
      { timestamp: TS[3], value: 122.4 },
      { timestamp: TS[4], value: 124.7 },
    ],
  },
  disk_io_write: {
    current: 89.2,
    points: [
      { timestamp: TS[0], value: 82.5 },
      { timestamp: TS[1], value: 84.3 },
      { timestamp: TS[2], value: 86.7 },
      { timestamp: TS[3], value: 88.1 },
      { timestamp: TS[4], value: 89.2 },
    ],
  },
  http_request_count: {
    current: 1247,
    points: [
      { timestamp: TS[0], value: 1102 },
      { timestamp: TS[1], value: 1158 },
      { timestamp: TS[2], value: 1201 },
      { timestamp: TS[3], value: 1224 },
      { timestamp: TS[4], value: 1247 },
    ],
  },
  http_error_rate: {
    current: 2.3,
    points: [
      { timestamp: TS[0], value: 1.8 },
      { timestamp: TS[1], value: 2.0 },
      { timestamp: TS[2], value: 2.1 },
      { timestamp: TS[3], value: 2.2 },
      { timestamp: TS[4], value: 2.3 },
    ],
  },
  response_latency_p99: {
    current: 342,
    points: [
      { timestamp: TS[0], value: 310 },
      { timestamp: TS[1], value: 318 },
      { timestamp: TS[2], value: 325 },
      { timestamp: TS[3], value: 335 },
      { timestamp: TS[4], value: 342 },
    ],
  },
  network_bytes_in: {
    current: 45.6,
    points: [
      { timestamp: TS[0], value: 40.2 },
      { timestamp: TS[1], value: 42.1 },
      { timestamp: TS[2], value: 43.5 },
      { timestamp: TS[3], value: 44.8 },
      { timestamp: TS[4], value: 45.6 },
    ],
  },
  network_bytes_out: {
    current: 32.1,
    points: [
      { timestamp: TS[0], value: 28.5 },
      { timestamp: TS[1], value: 29.8 },
      { timestamp: TS[2], value: 30.7 },
      { timestamp: TS[3], value: 31.4 },
      { timestamp: TS[4], value: 32.1 },
    ],
  },
  tcp_connections: {
    current: 856,
    points: [
      { timestamp: TS[0], value: 790 },
      { timestamp: TS[1], value: 812 },
      { timestamp: TS[2], value: 830 },
      { timestamp: TS[3], value: 845 },
      { timestamp: TS[4], value: 856 },
    ],
  },
};

// ─── Tool Definitions (sent to the model) ────────────────────────────────────

export const metricTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_metrics",
      description:
        "List available system metrics, optionally filtered by category. Returns metric name, description, unit, and category for each.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description:
              'Optional category filter: "compute", "storage", or "network". Omit to list all metrics.',
            enum: ["compute", "storage", "network"],
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_metric",
      description:
        "Query a specific metric by name. Returns 5 recent data points with timestamps and the current value.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "The metric name to query (e.g. cpu_usage, memory_usage, http_request_count)",
          },
          period: {
            type: "string",
            description: 'Time period: "1m", "5m", "15m", "1h". Defaults to "5m".',
          },
          host: {
            type: "string",
            description: "Optional hostname filter. Defaults to all hosts.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_threshold",
      description:
        "Check if a metric's current value exceeds a threshold. Returns the current value, threshold, whether the check passed, and a status message.",
      parameters: {
        type: "object",
        properties: {
          metric_name: {
            type: "string",
            description: "The metric name to check",
          },
          threshold: {
            type: "string",
            description: "The threshold value to compare against (as a string number)",
          },
          operator: {
            type: "string",
            description: "Comparison operator",
            enum: ["gt", "lt", "gte", "lte", "eq"],
          },
        },
        required: ["metric_name", "threshold", "operator"],
      },
    },
  },
];

/** The execute_plan meta-tool — accepts a full plan as a JSON string */
export const executePlanTool: ToolDefinition = {
  type: "function",
  function: {
    name: "execute_plan",
    description: `Execute a multi-step plan in a single call. The plan is a JSON object with a "goal" string and a "steps" array. Each step has "tool" (one of: list_metrics, query_metric, check_threshold), "args" (tool arguments), and "description" (why this step is needed).

Steps can reference prior step outputs using $ref objects in args. For example:
{
  "goal": "Find metrics and query the first one",
  "steps": [
    {
      "tool": "list_metrics",
      "args": { "category": "compute" },
      "description": "Get available compute metrics"
    },
    {
      "tool": "query_metric",
      "args": { "name": { "$ref": "steps[0].result.metrics[0].name" } },
      "description": "Query the first compute metric"
    }
  ]
}

The $ref path format is: steps[N].result.<path> where <path> uses dot notation with array indices.
Use this tool when you know the full sequence of steps upfront — it eliminates round-trips between steps.`,
    parameters: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description: "The full plan as a JSON string",
        },
      },
      required: ["plan"],
    },
  },
};

/** All tools available in declarative mode */
export const allTools: ToolDefinition[] = [...metricTools, executePlanTool];

/** Tool names the plan executor is allowed to dispatch */
export const ALLOWED_TOOL_NAMES = metricTools.map((t) => t.function.name);

// ─── Tool Implementations ────────────────────────────────────────────────────

function listMetrics(args: { category?: string }): string {
  let metrics = METRIC_CATALOG;
  if (args.category) {
    metrics = metrics.filter((m) => m.category === args.category);
  }
  return JSON.stringify({ metrics, total: metrics.length });
}

function queryMetric(args: { name: string; period?: string; host?: string }): string {
  const series = MOCK_SERIES[args.name];
  if (!series) {
    return JSON.stringify({ error: `Unknown metric: ${args.name}` });
  }

  const info = METRIC_CATALOG.find((m) => m.name === args.name);

  return JSON.stringify({
    metric: args.name,
    unit: info?.unit ?? "unknown",
    period: args.period ?? "5m",
    host: args.host ?? "all",
    current: series.current,
    dataPoints: series.points,
  });
}

function checkThreshold(args: {
  metric_name: string;
  threshold: string;
  operator: string;
}): string {
  const series = MOCK_SERIES[args.metric_name];
  if (!series) {
    return JSON.stringify({ error: `Unknown metric: ${args.metric_name}` });
  }

  const threshold = parseFloat(args.threshold);
  const current = series.current;
  const info = METRIC_CATALOG.find((m) => m.name === args.metric_name);

  const ops: Record<string, (a: number, b: number) => boolean> = {
    gt: (a, b) => a > b,
    lt: (a, b) => a < b,
    gte: (a, b) => a >= b,
    lte: (a, b) => a <= b,
    eq: (a, b) => a === b,
  };

  const compare = ops[args.operator];
  if (!compare) {
    return JSON.stringify({ error: `Unknown operator: ${args.operator}` });
  }

  const exceeded = compare(current, threshold);
  const opLabels: Record<string, string> = {
    gt: ">",
    lt: "<",
    gte: ">=",
    lte: "<=",
    eq: "==",
  };

  return JSON.stringify({
    metric: args.metric_name,
    current,
    threshold,
    operator: opLabels[args.operator],
    exceeded,
    unit: info?.unit ?? "unknown",
    status: exceeded
      ? `ALERT: ${args.metric_name} is ${current}${info?.unit ?? ""} (${opLabels[args.operator]} ${threshold})`
      : `OK: ${args.metric_name} is ${current}${info?.unit ?? ""} (within threshold)`,
  });
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeMetricTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "list_metrics":
      return listMetrics(args as Parameters<typeof listMetrics>[0]);
    case "query_metric":
      return queryMetric(args as Parameters<typeof queryMetric>[0]);
    case "check_threshold":
      return checkThreshold(args as Parameters<typeof checkThreshold>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
