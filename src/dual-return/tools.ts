import type { ToolDefinition } from "../shared/types.js";
import type {
  DualReturn,
  ServiceInfo,
  ErrorLogEntry,
  MetricsSnapshot,
  IncidentSummary,
} from "./types.js";

// ─── Tool Definitions ───────────────────────────────────────────────────────
//
// 4 monitoring tools. The definitions are the same regardless of mode —
// what changes is how the dispatcher formats the return value.

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_services",
      description:
        "Lists all monitored microservices with their current status (healthy, degraded, down), " +
        "uptime percentage, and last deployment time. " +
        "Use this to get an overview of system health before drilling into specific services.",
      parameters: {
        type: "object",
        properties: {
          status_filter: {
            type: "string",
            description: "Optional filter by service status. Omit to return all services.",
            enum: ["healthy", "degraded", "down"],
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_error_logs",
      description:
        "Retrieves recent error log entries for a specific service. " +
        "Returns timestamps, severity levels, error messages, and trace IDs. " +
        "Use this after list_services identifies a degraded or down service.",
      parameters: {
        type: "object",
        properties: {
          service: {
            type: "string",
            description:
              "The service name to query, e.g. 'checkout-service'. " +
              "Must match a name from list_services.",
          },
          severity: {
            type: "string",
            description: "Optional filter by severity. Omit to return all severities.",
            enum: ["info", "warning", "error", "critical"],
          },
        },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_metrics",
      description:
        "Retrieves latency percentiles (p50, p95, p99), success rate, request volume, " +
        "and error breakdown for a specific service. " +
        "Use this to understand performance characteristics and identify bottlenecks.",
      parameters: {
        type: "object",
        properties: {
          service: {
            type: "string",
            description:
              "The service name to query, e.g. 'checkout-service'. " +
              "Must match a name from list_services.",
          },
          period: {
            type: "string",
            description: "Time period for metrics. Defaults to '1h' if omitted.",
            enum: ["15m", "1h", "6h", "24h"],
          },
        },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_incidents",
      description:
        "Lists all active incidents across services, with priority, status, and assignee. " +
        "Use this to understand ongoing issues and their resolution status.",
      parameters: {
        type: "object",
        properties: {
          priority: {
            type: "string",
            description: "Optional filter by incident priority. Omit to return all priorities.",
            enum: ["low", "medium", "high", "critical"],
          },
        },
        required: [],
      },
    },
  },
];

// ─── Mock Data ──────────────────────────────────────────────────────────────
//
// 8 microservices, 50 error log entries, per-service metrics, 5 incidents.
// Enough volume that the LLM shouldn't need to read every entry.

const SERVICES: ServiceInfo[] = [
  {
    name: "api-gateway",
    status: "healthy",
    uptime: "99.99%",
    lastDeployed: "2026-02-25T10:30:00Z",
    errorRate: "0.01%",
  },
  {
    name: "auth-service",
    status: "healthy",
    uptime: "99.97%",
    lastDeployed: "2026-02-24T14:15:00Z",
    errorRate: "0.03%",
  },
  {
    name: "checkout-service",
    status: "degraded",
    uptime: "97.20%",
    lastDeployed: "2026-02-26T02:00:00Z",
    errorRate: "2.80%",
  },
  {
    name: "inventory-service",
    status: "healthy",
    uptime: "99.95%",
    lastDeployed: "2026-02-23T09:00:00Z",
    errorRate: "0.05%",
  },
  {
    name: "notification-service",
    status: "healthy",
    uptime: "99.90%",
    lastDeployed: "2026-02-25T16:45:00Z",
    errorRate: "0.10%",
  },
  {
    name: "payment-gateway",
    status: "down",
    uptime: "94.50%",
    lastDeployed: "2026-02-26T01:30:00Z",
    errorRate: "5.50%",
  },
  {
    name: "search-service",
    status: "degraded",
    uptime: "98.10%",
    lastDeployed: "2026-02-25T22:00:00Z",
    errorRate: "1.90%",
  },
  {
    name: "user-service",
    status: "healthy",
    uptime: "99.98%",
    lastDeployed: "2026-02-24T11:00:00Z",
    errorRate: "0.02%",
  },
];

const ERROR_LOGS: ErrorLogEntry[] = [
  // checkout-service errors (23 entries) — the most problematic service
  {
    timestamp: "2026-02-26T08:01:12Z",
    service: "checkout-service",
    severity: "error",
    message: "Connection timeout to payment-gateway after 30s",
    traceId: "trc-a001",
  },
  {
    timestamp: "2026-02-26T08:01:45Z",
    service: "checkout-service",
    severity: "error",
    message: "Connection timeout to payment-gateway after 30s",
    traceId: "trc-a002",
  },
  {
    timestamp: "2026-02-26T08:02:03Z",
    service: "checkout-service",
    severity: "error",
    message: "Connection timeout to payment-gateway after 30s",
    traceId: "trc-a003",
  },
  {
    timestamp: "2026-02-26T08:02:18Z",
    service: "checkout-service",
    severity: "error",
    message: "Connection timeout to payment-gateway after 30s",
    traceId: "trc-a004",
  },
  {
    timestamp: "2026-02-26T08:02:55Z",
    service: "checkout-service",
    severity: "error",
    message: "Connection timeout to payment-gateway after 30s",
    traceId: "trc-a005",
  },
  {
    timestamp: "2026-02-26T08:03:30Z",
    service: "checkout-service",
    severity: "error",
    message: "Connection timeout to payment-gateway after 30s",
    traceId: "trc-a006",
  },
  {
    timestamp: "2026-02-26T08:04:01Z",
    service: "checkout-service",
    severity: "error",
    message: "Connection timeout to payment-gateway after 30s",
    traceId: "trc-a007",
  },
  {
    timestamp: "2026-02-26T08:04:22Z",
    service: "checkout-service",
    severity: "error",
    message: "Connection timeout to payment-gateway after 30s",
    traceId: "trc-a008",
  },
  {
    timestamp: "2026-02-26T08:05:10Z",
    service: "checkout-service",
    severity: "error",
    message: "Connection timeout to payment-gateway after 30s",
    traceId: "trc-a009",
  },
  {
    timestamp: "2026-02-26T08:05:48Z",
    service: "checkout-service",
    severity: "error",
    message: "Connection timeout to payment-gateway after 30s",
    traceId: "trc-a010",
  },
  {
    timestamp: "2026-02-26T08:06:15Z",
    service: "checkout-service",
    severity: "error",
    message: "Connection timeout to payment-gateway after 30s",
    traceId: "trc-a011",
  },
  {
    timestamp: "2026-02-26T08:06:59Z",
    service: "checkout-service",
    severity: "error",
    message: "Connection timeout to payment-gateway after 30s",
    traceId: "trc-a012",
  },
  {
    timestamp: "2026-02-26T08:03:05Z",
    service: "checkout-service",
    severity: "error",
    message: "Failed to serialize cart: invalid item ID null",
    traceId: "trc-a013",
  },
  {
    timestamp: "2026-02-26T08:04:12Z",
    service: "checkout-service",
    severity: "error",
    message: "Failed to serialize cart: invalid item ID null",
    traceId: "trc-a014",
  },
  {
    timestamp: "2026-02-26T08:05:30Z",
    service: "checkout-service",
    severity: "error",
    message: "Failed to serialize cart: invalid item ID null",
    traceId: "trc-a015",
  },
  {
    timestamp: "2026-02-26T08:06:44Z",
    service: "checkout-service",
    severity: "error",
    message: "Failed to serialize cart: invalid item ID null",
    traceId: "trc-a016",
  },
  {
    timestamp: "2026-02-26T08:07:20Z",
    service: "checkout-service",
    severity: "error",
    message: "Failed to serialize cart: invalid item ID null",
    traceId: "trc-a017",
  },
  {
    timestamp: "2026-02-26T08:02:30Z",
    service: "checkout-service",
    severity: "critical",
    message: "Circuit breaker OPEN for payment-gateway — 80% failure rate",
    traceId: "trc-a018",
  },
  {
    timestamp: "2026-02-26T08:05:00Z",
    service: "checkout-service",
    severity: "critical",
    message: "Circuit breaker OPEN for payment-gateway — 80% failure rate",
    traceId: "trc-a019",
  },
  {
    timestamp: "2026-02-26T08:07:30Z",
    service: "checkout-service",
    severity: "critical",
    message: "Circuit breaker OPEN for payment-gateway — 80% failure rate",
    traceId: "trc-a020",
  },
  {
    timestamp: "2026-02-26T08:01:30Z",
    service: "checkout-service",
    severity: "warning",
    message: "Retry attempt 2/3 for payment-gateway request",
    traceId: "trc-a021",
  },
  {
    timestamp: "2026-02-26T08:03:45Z",
    service: "checkout-service",
    severity: "warning",
    message: "Retry attempt 2/3 for payment-gateway request",
    traceId: "trc-a022",
  },
  {
    timestamp: "2026-02-26T08:06:00Z",
    service: "checkout-service",
    severity: "warning",
    message: "Retry attempt 3/3 for payment-gateway request",
    traceId: "trc-a023",
  },
  // payment-gateway errors (12 entries)
  {
    timestamp: "2026-02-26T08:00:45Z",
    service: "payment-gateway",
    severity: "critical",
    message: "Database connection pool exhausted (0/50 available)",
    traceId: "trc-b001",
  },
  {
    timestamp: "2026-02-26T08:01:00Z",
    service: "payment-gateway",
    severity: "critical",
    message: "Database connection pool exhausted (0/50 available)",
    traceId: "trc-b002",
  },
  {
    timestamp: "2026-02-26T08:02:00Z",
    service: "payment-gateway",
    severity: "critical",
    message: "Database connection pool exhausted (0/50 available)",
    traceId: "trc-b003",
  },
  {
    timestamp: "2026-02-26T08:03:00Z",
    service: "payment-gateway",
    severity: "critical",
    message: "Database connection pool exhausted (0/50 available)",
    traceId: "trc-b004",
  },
  {
    timestamp: "2026-02-26T08:04:00Z",
    service: "payment-gateway",
    severity: "critical",
    message: "Database connection pool exhausted (0/50 available)",
    traceId: "trc-b005",
  },
  {
    timestamp: "2026-02-26T08:00:30Z",
    service: "payment-gateway",
    severity: "error",
    message: "TLS handshake timeout to Stripe API",
    traceId: "trc-b006",
  },
  {
    timestamp: "2026-02-26T08:01:15Z",
    service: "payment-gateway",
    severity: "error",
    message: "TLS handshake timeout to Stripe API",
    traceId: "trc-b007",
  },
  {
    timestamp: "2026-02-26T08:02:30Z",
    service: "payment-gateway",
    severity: "error",
    message: "TLS handshake timeout to Stripe API",
    traceId: "trc-b008",
  },
  {
    timestamp: "2026-02-26T08:03:45Z",
    service: "payment-gateway",
    severity: "error",
    message: "TLS handshake timeout to Stripe API",
    traceId: "trc-b009",
  },
  {
    timestamp: "2026-02-26T08:01:50Z",
    service: "payment-gateway",
    severity: "error",
    message: "Transaction rollback: insufficient funds check failed",
    traceId: "trc-b010",
  },
  {
    timestamp: "2026-02-26T08:03:20Z",
    service: "payment-gateway",
    severity: "warning",
    message: "Connection pool at 90% capacity (45/50)",
    traceId: "trc-b011",
  },
  {
    timestamp: "2026-02-26T08:00:15Z",
    service: "payment-gateway",
    severity: "warning",
    message: "Connection pool at 90% capacity (45/50)",
    traceId: "trc-b012",
  },
  // search-service errors (8 entries)
  {
    timestamp: "2026-02-26T07:55:00Z",
    service: "search-service",
    severity: "error",
    message: "Elasticsearch cluster yellow — 1 replica shard unassigned",
    traceId: "trc-c001",
  },
  {
    timestamp: "2026-02-26T08:00:00Z",
    service: "search-service",
    severity: "error",
    message: "Elasticsearch cluster yellow — 1 replica shard unassigned",
    traceId: "trc-c002",
  },
  {
    timestamp: "2026-02-26T08:05:00Z",
    service: "search-service",
    severity: "error",
    message: "Elasticsearch cluster yellow — 1 replica shard unassigned",
    traceId: "trc-c003",
  },
  {
    timestamp: "2026-02-26T07:58:30Z",
    service: "search-service",
    severity: "error",
    message: "Query timeout after 5s: product search 'wireless headphones'",
    traceId: "trc-c004",
  },
  {
    timestamp: "2026-02-26T08:02:15Z",
    service: "search-service",
    severity: "error",
    message: "Query timeout after 5s: product search 'bluetooth speaker'",
    traceId: "trc-c005",
  },
  {
    timestamp: "2026-02-26T08:04:45Z",
    service: "search-service",
    severity: "warning",
    message: "Search latency p99 > 3s threshold",
    traceId: "trc-c006",
  },
  {
    timestamp: "2026-02-26T08:06:30Z",
    service: "search-service",
    severity: "warning",
    message: "Search latency p99 > 3s threshold",
    traceId: "trc-c007",
  },
  {
    timestamp: "2026-02-26T08:07:00Z",
    service: "search-service",
    severity: "info",
    message: "Index rebuild triggered for product catalog",
    traceId: "trc-c008",
  },
  // Scattered errors from healthy services (7 entries)
  {
    timestamp: "2026-02-26T07:50:00Z",
    service: "api-gateway",
    severity: "warning",
    message: "Rate limit exceeded for IP 192.168.1.45",
    traceId: "trc-d001",
  },
  {
    timestamp: "2026-02-26T08:00:30Z",
    service: "api-gateway",
    severity: "info",
    message: "Health check passed — all upstream services responding",
    traceId: "trc-d002",
  },
  {
    timestamp: "2026-02-26T07:45:00Z",
    service: "auth-service",
    severity: "warning",
    message: "JWT token expired for user user-7821",
    traceId: "trc-e001",
  },
  {
    timestamp: "2026-02-26T08:01:00Z",
    service: "auth-service",
    severity: "info",
    message: "OAuth token refresh completed for client app-mobile",
    traceId: "trc-e002",
  },
  {
    timestamp: "2026-02-26T07:52:00Z",
    service: "notification-service",
    severity: "warning",
    message: "Email delivery delayed: queue depth 142",
    traceId: "trc-f001",
  },
  {
    timestamp: "2026-02-26T08:03:00Z",
    service: "notification-service",
    severity: "info",
    message: "Queue depth normalized: 12 pending",
    traceId: "trc-f002",
  },
  {
    timestamp: "2026-02-26T08:05:30Z",
    service: "inventory-service",
    severity: "warning",
    message: "Stock sync lag: 45s behind warehouse feed",
    traceId: "trc-g001",
  },
];

const METRICS: Record<string, MetricsSnapshot> = {
  "api-gateway": {
    service: "api-gateway",
    period: "1h",
    latency: { p50: 12, p95: 45, p99: 120 },
    successRate: 99.99,
    requestsPerMinute: 2400,
    errorBreakdown: { "429 Too Many Requests": 3, "502 Bad Gateway": 1 },
  },
  "auth-service": {
    service: "auth-service",
    period: "1h",
    latency: { p50: 25, p95: 80, p99: 200 },
    successRate: 99.97,
    requestsPerMinute: 800,
    errorBreakdown: { "401 Unauthorized": 12, "500 Internal": 2 },
  },
  "checkout-service": {
    service: "checkout-service",
    period: "1h",
    latency: { p50: 450, p95: 2300, p99: 8900 },
    successRate: 97.2,
    requestsPerMinute: 350,
    errorBreakdown: { "504 Gateway Timeout": 42, "500 Internal": 12, "502 Bad Gateway": 3 },
  },
  "inventory-service": {
    service: "inventory-service",
    period: "1h",
    latency: { p50: 18, p95: 55, p99: 150 },
    successRate: 99.95,
    requestsPerMinute: 600,
    errorBreakdown: { "409 Conflict": 3 },
  },
  "notification-service": {
    service: "notification-service",
    period: "1h",
    latency: { p50: 35, p95: 120, p99: 350 },
    successRate: 99.9,
    requestsPerMinute: 450,
    errorBreakdown: { "429 Too Many Requests": 8, "503 Unavailable": 1 },
  },
  "payment-gateway": {
    service: "payment-gateway",
    period: "1h",
    latency: { p50: 1200, p95: 5600, p99: 15000 },
    successRate: 94.5,
    requestsPerMinute: 180,
    errorBreakdown: { "503 Unavailable": 38, "504 Timeout": 22, "500 Internal": 8 },
  },
  "search-service": {
    service: "search-service",
    period: "1h",
    latency: { p50: 85, p95: 1200, p99: 3500 },
    successRate: 98.1,
    requestsPerMinute: 1100,
    errorBreakdown: { "504 Timeout": 15, "500 Internal": 4 },
  },
  "user-service": {
    service: "user-service",
    period: "1h",
    latency: { p50: 15, p95: 50, p99: 130 },
    successRate: 99.98,
    requestsPerMinute: 950,
    errorBreakdown: { "404 Not Found": 2 },
  },
};

const INCIDENTS: IncidentSummary[] = [
  {
    id: "INC-001",
    title: "Payment gateway timeout — database pool exhausted",
    priority: "critical",
    service: "payment-gateway",
    status: "active",
    startedAt: "2026-02-26T08:00:00Z",
    assignee: "alice@ops.com",
    description:
      "Database connection pool fully exhausted. All payment processing halted. Stripe API calls timing out due to upstream DB lock contention. Suspected cause: long-running analytics query on production replica.",
  },
  {
    id: "INC-002",
    title: "Checkout service degraded — cascading from payment gateway",
    priority: "high",
    service: "checkout-service",
    status: "investigating",
    startedAt: "2026-02-26T08:01:30Z",
    assignee: "bob@ops.com",
    description:
      "Checkout flow failing at payment step due to payment-gateway being down. Circuit breaker activated. Cart abandonment rate spiking. 80% of checkout attempts failing.",
  },
  {
    id: "INC-003",
    title: "Search latency spike — Elasticsearch replica unassigned",
    priority: "medium",
    service: "search-service",
    status: "investigating",
    startedAt: "2026-02-26T07:55:00Z",
    assignee: "carol@ops.com",
    description:
      "One Elasticsearch replica shard went unassigned after node restart. Queries falling back to primary only, causing p99 latency to spike above 3s. Auto-recovery expected within 30 minutes.",
  },
  {
    id: "INC-004",
    title: "Notification email delivery delays",
    priority: "low",
    service: "notification-service",
    status: "investigating",
    startedAt: "2026-02-26T07:50:00Z",
    assignee: "dave@ops.com",
    description:
      "Email queue backed up to 142 messages due to rate limiting from SendGrid. Queue now draining. Expected to clear within 15 minutes.",
  },
  {
    id: "INC-005",
    title: "Inventory sync lag from warehouse feed",
    priority: "low",
    service: "inventory-service",
    status: "active",
    startedAt: "2026-02-26T07:52:00Z",
    assignee: "eve@ops.com",
    description:
      "Warehouse inventory feed running 45s behind real-time. Caused by batch processing backlog at warehouse API. Stock levels may be slightly stale.",
  },
];

// ─── Dual-Return Tool Implementations ───────────────────────────────────────
//
// Each function returns a DualReturn: concise content for the LLM,
// full structured artifact for the UI.

function listServices(args: Record<string, string>): DualReturn {
  const filtered = args.status_filter
    ? SERVICES.filter((s) => s.status === args.status_filter)
    : SERVICES;

  const byStat = { healthy: 0, degraded: 0, down: 0 };
  for (const s of filtered) {
    byStat[s.status]++;
  }

  const parts = [];
  if (byStat.healthy > 0) parts.push(`${byStat.healthy} healthy`);
  if (byStat.degraded > 0) parts.push(`${byStat.degraded} degraded`);
  if (byStat.down > 0) parts.push(`${byStat.down} down`);

  const troubled = filtered.filter((s) => s.status !== "healthy");
  const troubleDetail =
    troubled.length > 0
      ? `. Issues: ${troubled.map((s) => `${s.name} (${s.status}, ${s.errorRate} errors)`).join(", ")}`
      : "";

  return {
    content: `${filtered.length} services: ${parts.join(", ")}${troubleDetail}`,
    artifact: {
      type: "table",
      title: "Service Overview",
      data: filtered,
    },
  };
}

function getErrorLogs(args: Record<string, string>): DualReturn {
  const serviceName = args.service;
  let logs = ERROR_LOGS.filter((e) => e.service === serviceName);

  if (args.severity) {
    logs = logs.filter((e) => e.severity === args.severity);
  }

  if (logs.length === 0) {
    return {
      content: `No error logs found for ${serviceName}${args.severity ? ` with severity ${args.severity}` : ""}.`,
      artifact: null,
    };
  }

  // Group by message to find top errors
  const counts: Record<string, number> = {};
  for (const log of logs) {
    counts[log.message] = (counts[log.message] ?? 0) + 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const topErrors = sorted
    .slice(0, 3)
    .map(([msg, count]) => `'${msg}' (${count}x)`)
    .join("; ");

  const severityCounts: Record<string, number> = {};
  for (const log of logs) {
    severityCounts[log.severity] = (severityCounts[log.severity] ?? 0) + 1;
  }
  const severityParts = Object.entries(severityCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([sev, count]) => `${count} ${sev}`)
    .join(", ");

  return {
    content: `${logs.length} log entries for ${serviceName} (${severityParts}). Top errors: ${topErrors}`,
    artifact: {
      type: "table",
      title: `Error Logs — ${serviceName}`,
      data: logs,
    },
  };
}

function getMetrics(args: Record<string, string>): DualReturn {
  const serviceName = args.service;
  const metrics = METRICS[serviceName];

  if (!metrics) {
    return {
      content: `No metrics found for service '${serviceName}'. Use list_services to see available services.`,
      artifact: null,
    };
  }

  const { latency, successRate, requestsPerMinute, errorBreakdown } = metrics;

  const topErrors = Object.entries(errorBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([err, count]) => `${err}: ${count}`)
    .join(", ");

  return {
    content:
      `${serviceName} metrics (${args.period ?? "1h"}): ` +
      `p50=${latency.p50}ms, p95=${latency.p95}ms, p99=${latency.p99}ms. ` +
      `${successRate}% success rate, ${requestsPerMinute} req/min. ` +
      `Top errors: ${topErrors}`,
    artifact: {
      type: "json",
      title: `Metrics — ${serviceName}`,
      data: metrics,
    },
  };
}

function getIncidents(args: Record<string, string>): DualReturn {
  const filtered = args.priority
    ? INCIDENTS.filter((i) => i.priority === args.priority)
    : INCIDENTS;

  if (filtered.length === 0) {
    return {
      content: `No active incidents${args.priority ? ` with priority ${args.priority}` : ""}.`,
      artifact: null,
    };
  }

  const byPriority: Record<string, number> = {};
  for (const inc of filtered) {
    byPriority[inc.priority] = (byPriority[inc.priority] ?? 0) + 1;
  }

  const priorityParts = Object.entries(byPriority)
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a[0] as keyof typeof order] ?? 4) - (order[b[0] as keyof typeof order] ?? 4);
    })
    .map(([p, count]) => `${count} ${p}`)
    .join(", ");

  const critical = filtered.filter((i) => i.priority === "critical" || i.priority === "high");
  const urgentDetail =
    critical.length > 0
      ? `. Urgent: ${critical.map((i) => `${i.title} [${i.priority}] (${i.status})`).join("; ")}`
      : "";

  return {
    content: `${filtered.length} active incidents (${priorityParts})${urgentDetail}`,
    artifact: {
      type: "list",
      title: "Active Incidents",
      data: filtered,
    },
  };
}

// ─── Mode-Aware Dispatcher ──────────────────────────────────────────────────
//
// "dual":   returns concise content + full artifact (the pattern)
// "simple": serializes artifact.data as the content string (simulates the naive approach)

export type ToolMode = "simple" | "dual";

export function executeTool(
  name: string,
  args: Record<string, string>,
  mode: ToolMode,
): DualReturn {
  let result: DualReturn;

  switch (name) {
    case "list_services":
      result = listServices(args);
      break;
    case "get_error_logs":
      result = getErrorLogs(args);
      break;
    case "get_metrics":
      result = getMetrics(args);
      break;
    case "get_incidents":
      result = getIncidents(args);
      break;
    default:
      return { content: JSON.stringify({ error: `Unknown tool: ${name}` }), artifact: null };
  }

  if (mode === "simple") {
    // Naive mode: dump everything into content, no artifact separation
    const fullData = result.artifact?.data
      ? JSON.stringify(result.artifact.data, null, 2)
      : result.content;
    return { content: fullData, artifact: null };
  }

  return result;
}
