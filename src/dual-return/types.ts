// ─── Dual Return Types ──────────────────────────────────────────────────────
//
// The core pattern: every tool returns two things.
// - content: a concise text summary that goes into the LLM's context window
// - artifact: the full structured data that goes to the UI for rendering
//
// The LLM never sees the artifact. The UI never needs to parse the LLM's text.

export interface ToolArtifact {
  type: "table" | "json" | "list";
  title: string;
  data: unknown;
}

export interface DualReturn {
  content: string;
  artifact: ToolArtifact | null;
}

export interface ArtifactEntry {
  toolName: string;
  artifact: ToolArtifact;
  tokensSaved: number;
}

export interface TokenStats {
  contentTokens: number;
  artifactTokens: number;
  savedTokens: number;
  savingsPercent: number;
}

export interface AgentResult {
  messages: import("../shared/types.js").Message[];
  artifacts: ArtifactEntry[];
  tokenStats: TokenStats;
}

// ─── Domain Types ───────────────────────────────────────────────────────────

export type ServiceStatus = "healthy" | "degraded" | "down";

export interface ServiceInfo {
  name: string;
  status: ServiceStatus;
  uptime: string;
  lastDeployed: string;
  errorRate: string;
}

export type Severity = "info" | "warning" | "error" | "critical";

export interface ErrorLogEntry {
  timestamp: string;
  service: string;
  severity: Severity;
  message: string;
  traceId: string;
}

export interface MetricsSnapshot {
  service: string;
  period: string;
  latency: { p50: number; p95: number; p99: number };
  successRate: number;
  requestsPerMinute: number;
  errorBreakdown: Record<string, number>;
}

export type IncidentPriority = "low" | "medium" | "high" | "critical";

export interface IncidentSummary {
  id: string;
  title: string;
  priority: IncidentPriority;
  service: string;
  status: "active" | "investigating" | "resolved";
  startedAt: string;
  assignee: string;
  description: string;
}
