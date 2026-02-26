// ─── Query Builder Types ─────────────────────────────────────────────────────
//
// The core distinction: raw mode gives the LLM a free-text query string,
// builder mode gives it structured parameters. Same underlying data either way.

import type { Message } from "../shared/types.js";

// ─── Query Domain Types ──────────────────────────────────────────────────────

export type Aggregation = "count" | "sum" | "avg" | "max" | "min" | "rate" | "p50" | "p95" | "p99";

export type TimeRange = "5m" | "15m" | "1h" | "6h" | "24h";

export type FilterOp = "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "regex";

export interface QueryFilter {
  label: string;
  op: FilterOp;
  value: string;
}

export interface BuilderQuery {
  metric: string;
  aggregation: Aggregation;
  filters?: QueryFilter[];
  group_by?: string;
  time_range?: TimeRange;
}

export interface QueryResult {
  success: boolean;
  query: string;
  data: Record<string, unknown>[] | null;
  error: string | null;
  rows: number;
}

// ─── Agent Types ─────────────────────────────────────────────────────────────

export type QueryMode = "raw" | "builder";

export interface QueryStats {
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  errors: string[];
}

export interface AgentResult {
  messages: Message[];
  queryStats: QueryStats;
}
