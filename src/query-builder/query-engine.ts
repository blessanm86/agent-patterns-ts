// ─── Query Engine ────────────────────────────────────────────────────────────
//
// Two paths to the same data:
//   1. Raw parser:   LLM writes a MetricsQL string → strict parser validates → execute
//   2. Builder:      LLM fills structured params    → code constructs query  → execute
//
// Both paths end at executeQuery(), which looks up pre-computed mock data.
// The raw parser is deliberately strict — real query languages are unforgiving.

import type {
  Aggregation,
  BuilderQuery,
  FilterOp,
  QueryFilter,
  QueryResult,
  TimeRange,
} from "./types.js";

// ─── Metric Schema ──────────────────────────────────────────────────────────

export interface MetricSchema {
  name: string;
  description: string;
  labels: string[];
}

export const METRICS: MetricSchema[] = [
  {
    name: "http_requests_total",
    description: "Total HTTP requests received",
    labels: ["service", "method", "status", "endpoint"],
  },
  {
    name: "http_request_duration_ms",
    description: "HTTP request latency in milliseconds",
    labels: ["service", "method", "endpoint"],
  },
  {
    name: "error_rate",
    description: "Error rate as a percentage (0-100)",
    labels: ["service", "error_type"],
  },
  {
    name: "memory_usage_bytes",
    description: "Memory usage in bytes",
    labels: ["service", "instance"],
  },
  {
    name: "cpu_usage_percent",
    description: "CPU usage as a percentage (0-100)",
    labels: ["service", "instance"],
  },
];

const VALID_METRICS = new Set(METRICS.map((m) => m.name));
const VALID_AGGREGATIONS = new Set<string>([
  "count",
  "sum",
  "avg",
  "max",
  "min",
  "rate",
  "p50",
  "p95",
  "p99",
]);
const VALID_TIME_RANGES = new Set<string>(["5m", "15m", "1h", "6h", "24h"]);

const SERVICES = [
  "api-gateway",
  "auth-service",
  "checkout-service",
  "inventory-service",
  "notification-service",
  "payment-gateway",
  "search-service",
  "user-service",
];

// ─── Mock Data ──────────────────────────────────────────────────────────────
//
// Pre-computed result sets for each metric. Each entry is a row of data
// matching a specific label combination. Real monitoring systems would
// query a time-series DB; here we return canned results.

interface MockRow {
  metric: string;
  labels: Record<string, string>;
  value: number;
  timestamp: string;
}

const MOCK_DATA: MockRow[] = [];

// http_requests_total — per service, method, status
for (const service of SERVICES) {
  for (const method of ["GET", "POST", "PUT", "DELETE"]) {
    for (const status of ["200", "201", "400", "404", "500", "503"]) {
      const base =
        service === "api-gateway"
          ? 12000
          : service === "search-service"
            ? 8000
            : service === "checkout-service"
              ? 3500
              : 2000;
      const methodMult = method === "GET" ? 4 : method === "POST" ? 2 : 1;
      const statusMult =
        status === "200" || status === "201"
          ? 1
          : status === "400" || status === "404"
            ? 0.02
            : 0.005;
      const value = Math.round(base * methodMult * statusMult);
      if (value > 0) {
        MOCK_DATA.push({
          metric: "http_requests_total",
          labels: { service, method, status, endpoint: `/api/${service.split("-")[0]}` },
          value,
          timestamp: "2026-02-26T08:00:00Z",
        });
      }
    }
  }
}

// http_request_duration_ms — per service
for (const service of SERVICES) {
  const baseLat =
    service === "payment-gateway"
      ? 1200
      : service === "checkout-service"
        ? 450
        : service === "search-service"
          ? 85
          : 25;
  for (const method of ["GET", "POST"]) {
    MOCK_DATA.push({
      metric: "http_request_duration_ms",
      labels: { service, method, endpoint: `/api/${service.split("-")[0]}` },
      value: Math.round(baseLat * (method === "POST" ? 1.5 : 1)),
      timestamp: "2026-02-26T08:00:00Z",
    });
  }
}

// error_rate — per service + error type
const errorRates: Record<string, Record<string, number>> = {
  "api-gateway": { timeout: 0.01, bad_request: 0.05 },
  "auth-service": { unauthorized: 0.8, expired_token: 0.3 },
  "checkout-service": { timeout: 2.1, invalid_cart: 0.5, payment_failed: 1.2 },
  "inventory-service": { conflict: 0.03, out_of_stock: 0.1 },
  "notification-service": { rate_limit: 0.4, delivery_failed: 0.08 },
  "payment-gateway": { timeout: 3.5, db_connection: 2.0, tls_error: 1.1 },
  "search-service": { timeout: 1.2, index_error: 0.5 },
  "user-service": { not_found: 0.02 },
};

for (const [service, errors] of Object.entries(errorRates)) {
  for (const [errorType, rate] of Object.entries(errors)) {
    MOCK_DATA.push({
      metric: "error_rate",
      labels: { service, error_type: errorType },
      value: rate,
      timestamp: "2026-02-26T08:00:00Z",
    });
  }
}

// memory_usage_bytes — per service + instance
for (const service of SERVICES) {
  const baseMem = service === "search-service" ? 4_200_000_000 : 512_000_000;
  for (const instance of ["i-001", "i-002"]) {
    MOCK_DATA.push({
      metric: "memory_usage_bytes",
      labels: { service, instance },
      value: baseMem + Math.round(Math.random() * 100_000_000),
      timestamp: "2026-02-26T08:00:00Z",
    });
  }
}

// cpu_usage_percent — per service + instance
for (const service of SERVICES) {
  const baseCpu = service === "payment-gateway" ? 82 : service === "checkout-service" ? 65 : 30;
  for (const instance of ["i-001", "i-002"]) {
    MOCK_DATA.push({
      metric: "cpu_usage_percent",
      labels: { service, instance },
      value: baseCpu + Math.round(Math.random() * 10),
      timestamp: "2026-02-26T08:00:00Z",
    });
  }
}

// ─── Query Execution ────────────────────────────────────────────────────────
//
// Both raw and builder paths produce a normalized query object, then
// call executeQuery() which filters MOCK_DATA.

interface NormalizedQuery {
  metric: string;
  aggregation: Aggregation;
  filters: QueryFilter[];
  groupBy: string | null;
  timeRange: TimeRange;
}

function matchesFilter(row: MockRow, filter: QueryFilter): boolean {
  const labelValue = row.labels[filter.label];
  if (labelValue === undefined) return false;

  switch (filter.op) {
    case "eq":
      return labelValue === filter.value;
    case "neq":
      return labelValue !== filter.value;
    case "gt":
      return Number(labelValue) > Number(filter.value);
    case "lt":
      return Number(labelValue) < Number(filter.value);
    case "gte":
      return Number(labelValue) >= Number(filter.value);
    case "lte":
      return Number(labelValue) <= Number(filter.value);
    case "regex":
      try {
        return new RegExp(filter.value).test(labelValue);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function aggregate(values: number[], agg: Aggregation): number {
  if (values.length === 0) return 0;
  switch (agg) {
    case "count":
      return values.length;
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    case "rate":
      return values.reduce((a, b) => a + b, 0) / 60; // per-second rate
    case "p50":
      return percentile(values, 50);
    case "p95":
      return percentile(values, 95);
    case "p99":
      return percentile(values, 99);
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function executeQuery(query: NormalizedQuery): QueryResult {
  // Filter rows by metric name
  let rows = MOCK_DATA.filter((r) => r.metric === query.metric);

  // Apply filters
  for (const filter of query.filters) {
    rows = rows.filter((r) => matchesFilter(r, filter));
  }

  if (rows.length === 0) {
    const queryStr = formatQueryString(query);
    return {
      success: true,
      query: queryStr,
      data: [],
      error: null,
      rows: 0,
    };
  }

  // Group and aggregate
  const queryStr = formatQueryString(query);

  if (query.groupBy) {
    const groups: Record<string, number[]> = {};
    for (const row of rows) {
      const key = row.labels[query.groupBy] ?? "unknown";
      if (!groups[key]) groups[key] = [];
      groups[key].push(row.value);
    }

    const data = Object.entries(groups).map(([key, values]) => ({
      [query.groupBy!]: key,
      [query.aggregation]: Math.round(aggregate(values, query.aggregation) * 100) / 100,
      samples: values.length,
    }));

    return { success: true, query: queryStr, data, error: null, rows: data.length };
  }

  // No grouping — single aggregated result
  const values = rows.map((r) => r.value);
  const result = Math.round(aggregate(values, query.aggregation) * 100) / 100;

  return {
    success: true,
    query: queryStr,
    data: [{ metric: query.metric, [query.aggregation]: result, samples: values.length }],
    error: null,
    rows: 1,
  };
}

function formatQueryString(query: NormalizedQuery): string {
  let qs = query.metric;
  if (query.filters.length > 0) {
    const parts = query.filters.map((f) => {
      const opStr =
        f.op === "eq"
          ? "="
          : f.op === "neq"
            ? "!="
            : f.op === "gt"
              ? ">"
              : f.op === "lt"
                ? "<"
                : f.op === "gte"
                  ? ">="
                  : f.op === "lte"
                    ? "<="
                    : "=~";
      return `${f.label}${opStr}"${f.value}"`;
    });
    qs += `{${parts.join(", ")}}`;
  }
  qs += ` | ${query.aggregation}`;
  if (query.groupBy) qs += ` by(${query.groupBy})`;
  qs += ` [${query.timeRange}]`;
  return qs;
}

// ─── Builder Path ───────────────────────────────────────────────────────────
//
// Structured params → validated → normalized query → execute.
// Can only fail on semantic issues (label doesn't exist on this metric).

export function buildQuery(params: BuilderQuery): QueryResult {
  // Validate metric
  const metricSchema = METRICS.find((m) => m.name === params.metric);
  if (!metricSchema) {
    return {
      success: false,
      query: "",
      data: null,
      error: `Unknown metric '${params.metric}'. Valid metrics: ${METRICS.map((m) => m.name).join(", ")}`,
      rows: 0,
    };
  }

  // Validate aggregation (should be caught by enum, but defensive)
  if (!VALID_AGGREGATIONS.has(params.aggregation)) {
    return {
      success: false,
      query: "",
      data: null,
      error: `Unknown aggregation '${params.aggregation}'. Valid: ${[...VALID_AGGREGATIONS].join(", ")}`,
      rows: 0,
    };
  }

  // Validate filters reference valid labels
  const filters: QueryFilter[] = [];
  if (params.filters) {
    for (const f of params.filters) {
      if (!metricSchema.labels.includes(f.label)) {
        return {
          success: false,
          query: "",
          data: null,
          error: `Unknown label '${f.label}' for metric '${params.metric}'. Valid labels: ${metricSchema.labels.join(", ")}`,
          rows: 0,
        };
      }
      filters.push(f);
    }
  }

  // Validate group_by
  if (params.group_by && !metricSchema.labels.includes(params.group_by)) {
    return {
      success: false,
      query: "",
      data: null,
      error: `Cannot group by '${params.group_by}' — not a valid label for '${params.metric}'. Valid labels: ${metricSchema.labels.join(", ")}`,
      rows: 0,
    };
  }

  // Validate time range
  const timeRange = params.time_range ?? "1h";
  if (!VALID_TIME_RANGES.has(timeRange)) {
    return {
      success: false,
      query: "",
      data: null,
      error: `Invalid time range '${timeRange}'. Valid: ${[...VALID_TIME_RANGES].join(", ")}`,
      rows: 0,
    };
  }

  const normalized: NormalizedQuery = {
    metric: params.metric,
    aggregation: params.aggregation,
    filters,
    groupBy: params.group_by ?? null,
    timeRange: timeRange as TimeRange,
  };

  return executeQuery(normalized);
}

// ─── Raw Parser Path ────────────────────────────────────────────────────────
//
// LLM writes a MetricsQL string → strict parser → normalized query → execute.
//
// Expected format:
//   metric_name{label="value", label="value"} | aggregation [time_range]
//   metric_name{label="value"} | aggregation by(field) [time_range]
//   metric_name | aggregation [time_range]
//
// The parser is deliberately strict. Real query languages are unforgiving,
// and that's exactly the point: LLMs make syntax errors frequently.

export function parseRawQuery(queryStr: string): QueryResult {
  const trimmed = queryStr.trim();

  if (!trimmed) {
    return { success: false, query: queryStr, data: null, error: "Empty query string", rows: 0 };
  }

  // Step 1: Extract metric name (everything before '{' or '|')
  const metricMatch = trimmed.match(/^([a-z_][a-z0-9_]*)/);
  if (!metricMatch) {
    return {
      success: false,
      query: queryStr,
      data: null,
      error: `Invalid query syntax. Expected metric name at start. Got: '${trimmed.slice(0, 20)}'`,
      rows: 0,
    };
  }

  const metricName = metricMatch[1];

  // Validate metric exists
  if (!VALID_METRICS.has(metricName)) {
    const suggestions = [...VALID_METRICS].filter(
      (m) => m.includes(metricName) || metricName.includes(m.split("_")[0]),
    );
    const hint =
      suggestions.length > 0
        ? ` Did you mean '${suggestions[0]}'?`
        : ` Valid metrics: ${[...VALID_METRICS].join(", ")}`;
    return {
      success: false,
      query: queryStr,
      data: null,
      error: `Unknown metric '${metricName}'.${hint}`,
      rows: 0,
    };
  }

  const metricSchema = METRICS.find((m) => m.name === metricName)!;
  let remaining = trimmed.slice(metricName.length).trim();

  // Step 2: Parse optional label selector {label="value", ...}
  const filters: QueryFilter[] = [];

  if (remaining.startsWith("{")) {
    const closeBrace = remaining.indexOf("}");
    if (closeBrace === -1) {
      return {
        success: false,
        query: queryStr,
        data: null,
        error: "Unclosed label selector — missing '}'",
        rows: 0,
      };
    }

    const labelSection = remaining.slice(1, closeBrace);
    remaining = remaining.slice(closeBrace + 1).trim();

    if (labelSection.trim()) {
      // Parse individual label filters: label="value" or label!="value"
      const labelParts = labelSection.split(",").map((p) => p.trim());

      for (const part of labelParts) {
        if (!part) continue;

        // Match: label operator "value"
        const filterMatch = part.match(/^([a-z_][a-z0-9_]*)\s*(=~|!=|>=|<=|>|<|=)\s*"([^"]*)"$/);
        if (!filterMatch) {
          // Check for common mistake: unquoted value
          const unquotedMatch = part.match(/^([a-z_][a-z0-9_]*)\s*=\s*([^"]\S*)$/);
          if (unquotedMatch) {
            return {
              success: false,
              query: queryStr,
              data: null,
              error: `Label values must be quoted: ${unquotedMatch[1]}="${unquotedMatch[2]}"`,
              rows: 0,
            };
          }
          return {
            success: false,
            query: queryStr,
            data: null,
            error: `Invalid label filter syntax: '${part}'. Expected format: label="value"`,
            rows: 0,
          };
        }

        const [, label, opStr, value] = filterMatch;

        // Validate label name
        if (!metricSchema.labels.includes(label)) {
          return {
            success: false,
            query: queryStr,
            data: null,
            error: `Unknown label '${label}' for metric '${metricName}'. Valid labels: ${metricSchema.labels.join(", ")}`,
            rows: 0,
          };
        }

        const op: FilterOp =
          opStr === "="
            ? "eq"
            : opStr === "!="
              ? "neq"
              : opStr === ">"
                ? "gt"
                : opStr === "<"
                  ? "lt"
                  : opStr === ">="
                    ? "gte"
                    : opStr === "<="
                      ? "lte"
                      : "regex";

        filters.push({ label, op, value });
      }
    }
  }

  // Step 3: Parse aggregation — must have '|' separator
  if (!remaining.startsWith("|")) {
    if (remaining.match(/^(count|sum|avg|max|min|rate|p50|p95|p99)/)) {
      return {
        success: false,
        query: queryStr,
        data: null,
        error: `Expected '|' before aggregation. Write: ${metricName}${filters.length > 0 ? "{...}" : ""} | ${remaining.split(/\s/)[0]}`,
        rows: 0,
      };
    }
    if (remaining.length > 0) {
      return {
        success: false,
        query: queryStr,
        data: null,
        error: `Unexpected characters after metric selector: '${remaining.slice(0, 30)}'`,
        rows: 0,
      };
    }
    return {
      success: false,
      query: queryStr,
      data: null,
      error: "Missing aggregation. Expected: | aggregation [time_range]",
      rows: 0,
    };
  }

  remaining = remaining.slice(1).trim();

  // Extract aggregation name
  const aggMatch = remaining.match(/^([a-z0-9_]+)/);
  if (!aggMatch) {
    return {
      success: false,
      query: queryStr,
      data: null,
      error: `Missing aggregation after '|'. Valid aggregations: ${[...VALID_AGGREGATIONS].join(", ")}`,
      rows: 0,
    };
  }

  const aggName = aggMatch[1];
  if (!VALID_AGGREGATIONS.has(aggName)) {
    // Suggest common mistakes
    const aliases: Record<string, string> = {
      average: "avg",
      mean: "avg",
      total: "sum",
      maximum: "max",
      minimum: "min",
      percentile50: "p50",
      percentile95: "p95",
      percentile99: "p99",
    };
    const suggestion = aliases[aggName];
    const hint = suggestion
      ? ` Did you mean '${suggestion}'?`
      : ` Valid: ${[...VALID_AGGREGATIONS].join(", ")}`;
    return {
      success: false,
      query: queryStr,
      data: null,
      error: `Unknown aggregation '${aggName}'.${hint}`,
      rows: 0,
    };
  }

  remaining = remaining.slice(aggName.length).trim();

  // Step 4: Parse optional group_by: by(field)
  let groupBy: string | null = null;

  const byMatch = remaining.match(/^by\s*\(\s*([a-z_][a-z0-9_]*)\s*\)/);
  if (byMatch) {
    groupBy = byMatch[1];
    if (!metricSchema.labels.includes(groupBy)) {
      return {
        success: false,
        query: queryStr,
        data: null,
        error: `Cannot group by '${groupBy}' — not a valid label for '${metricName}'. Valid labels: ${metricSchema.labels.join(", ")}`,
        rows: 0,
      };
    }
    remaining = remaining.slice(byMatch[0].length).trim();
  }

  // Step 5: Parse optional time range: [5m], [1h], etc.
  let timeRange: TimeRange = "1h"; // default

  const trMatch = remaining.match(/^\[\s*([^\]]+)\s*\]/);
  if (trMatch) {
    const trValue = trMatch[1].trim();
    if (!VALID_TIME_RANGES.has(trValue)) {
      return {
        success: false,
        query: queryStr,
        data: null,
        error: `Invalid time range '${trValue}'. Valid: ${[...VALID_TIME_RANGES].join(", ")}`,
        rows: 0,
      };
    }
    timeRange = trValue as TimeRange;
    remaining = remaining.slice(trMatch[0].length).trim();
  }

  // Check for trailing garbage
  if (remaining.length > 0) {
    return {
      success: false,
      query: queryStr,
      data: null,
      error: `Unexpected trailing content: '${remaining}'`,
      rows: 0,
    };
  }

  const normalized: NormalizedQuery = {
    metric: metricName,
    aggregation: aggName as Aggregation,
    filters,
    groupBy,
    timeRange,
  };

  return executeQuery(normalized);
}

// ─── List Available Metrics ─────────────────────────────────────────────────

export function listAvailableMetrics(): string {
  const lines = METRICS.map(
    (m) => `- ${m.name}: ${m.description}\n  Labels: ${m.labels.join(", ")}`,
  );
  return `Available metrics:\n${lines.join("\n")}\n\nValid aggregations: ${[...VALID_AGGREGATIONS].join(", ")}\nValid time ranges: ${[...VALID_TIME_RANGES].join(", ")}`;
}
