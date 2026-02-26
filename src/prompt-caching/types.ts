// ─── Prompt Caching — Types ──────────────────────────────────────────────────

export interface CacheMetrics {
  promptTokens: number; // prompt_eval_count from Ollama
  responseTokens: number; // eval_count from Ollama
  promptEvalMs: number; // prompt_eval_duration (converted to ms)
  responseEvalMs: number; // eval_duration (converted to ms)
  totalMs: number; // total_duration (converted to ms)
}

export interface BenchmarkRun {
  label: string;
  question: string;
  metrics: CacheMetrics;
}

export interface BenchmarkResult {
  stablePrefix: BenchmarkRun[]; // same system prompt + tools each request
  rotatingPrefix: BenchmarkRun[]; // slightly different system prompt each request
}

export interface ProviderCost {
  provider: string;
  withoutCaching: number; // total cost in dollars
  withCaching: number; // total cost with cache hits
  savings: number; // absolute savings
  savingsPercent: number; // savings as percentage
}
