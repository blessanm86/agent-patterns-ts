import type { CostRecord, CostSummary, ModelTier } from "./types.js";

// ─── Reference Pricing ───────────────────────────────────────────────────────
//
// Ollama runs locally for free, but in production you'd pay per token.
// These reference prices use cloud API equivalents so the demo shows
// realistic cost comparisons. Ratios mirror Haiku / Sonnet / Opus tiers:
//   Fast    ~1x   (small, cheap — routing + simple queries)
//   Standard ~11x  (medium — main reasoning + tool calls)
//   Capable ~28x  (large — complex multi-step synthesis)

export const MODEL_PRICING: Record<string, { inputCostPer1M: number; outputCostPer1M: number }> = {
  // Fast tier — small models
  "qwen2.5:0.5b": { inputCostPer1M: 0.05, outputCostPer1M: 0.2 },
  "qwen2.5:1.5b": { inputCostPer1M: 0.1, outputCostPer1M: 0.4 },
  "qwen2.5:3b": { inputCostPer1M: 0.2, outputCostPer1M: 0.8 },

  // Standard tier — medium models
  "qwen2.5:7b": { inputCostPer1M: 1.1, outputCostPer1M: 4.4 },
  "llama3.1:8b": { inputCostPer1M: 1.1, outputCostPer1M: 4.4 },
  "mistral:7b": { inputCostPer1M: 1.1, outputCostPer1M: 4.4 },

  // Capable tier — large models
  "qwen2.5:14b": { inputCostPer1M: 2.8, outputCostPer1M: 11.2 },
  "qwen2.5:32b": { inputCostPer1M: 5.0, outputCostPer1M: 20.0 },
  "llama3.1:70b": { inputCostPer1M: 8.0, outputCostPer1M: 32.0 },
};

// Fallback pricing for unknown models — uses standard tier rates
const DEFAULT_PRICING = { inputCostPer1M: 1.1, outputCostPer1M: 4.4 };

function getPricing(model: string): { inputCostPer1M: number; outputCostPer1M: number } {
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getPricing(model);
  return (
    (inputTokens * pricing.inputCostPer1M + outputTokens * pricing.outputCostPer1M) / 1_000_000
  );
}

// ─── Cost Tracker ─────────────────────────────────────────────────────────────
//
// Records per-call cost data and produces summaries with baseline comparisons.
// Reset between user turns so each turn shows its own cost breakdown.

export class CostTracker {
  private records: CostRecord[] = [];

  record(
    model: string,
    tier: ModelTier,
    inputTokens: number,
    outputTokens: number,
    purpose: string,
  ): void {
    const cost = calculateCost(model, inputTokens, outputTokens);
    this.records.push({ model, tier, inputTokens, outputTokens, cost, purpose });
  }

  getSummary(capableModel: string): CostSummary {
    const totalInputTokens = this.records.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutputTokens = this.records.reduce((sum, r) => sum + r.outputTokens, 0);
    const totalCost = this.records.reduce((sum, r) => sum + r.cost, 0);

    // Baseline: what it would cost if every call used the capable model
    const baselineCost = calculateCost(capableModel, totalInputTokens, totalOutputTokens);

    const savingsPercent =
      baselineCost > 0 ? Math.round(((baselineCost - totalCost) / baselineCost) * 100) : 0;

    return {
      records: [...this.records],
      totalInputTokens,
      totalOutputTokens,
      totalCost,
      baselineCost,
      savingsPercent,
    };
  }

  formatSummary(capableModel: string): string[] {
    const summary = this.getSummary(capableModel);
    const lines: string[] = [
      "",
      "  \u2500\u2500 Cost Summary \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    ];

    for (const record of summary.records) {
      const tokens = `${record.inputTokens} in + ${record.outputTokens} out`;
      const pad = " ".repeat(Math.max(0, 12 - record.purpose.length));
      lines.push(
        `  ${record.purpose}:${pad}${record.model.padEnd(16)} \u2192  ${tokens.padEnd(22)} = $${record.cost.toFixed(4)}`,
      );
    }

    lines.push(
      `  Total:        ${summary.totalInputTokens} in + ${summary.totalOutputTokens} out tokens`.padEnd(
        56,
      ) + `= $${summary.totalCost.toFixed(4)}`,
    );
    lines.push(
      `  Baseline:     if all ${capableModel}`.padEnd(56) + `= $${summary.baselineCost.toFixed(4)}`,
    );
    lines.push(`  Savings:      ${summary.savingsPercent}% vs all-capable baseline`);
    lines.push(
      "  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    );

    return lines;
  }

  reset(): void {
    this.records = [];
  }
}
