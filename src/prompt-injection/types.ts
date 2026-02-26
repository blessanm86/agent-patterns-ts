// ─── Detection Types ─────────────────────────────────────────────────────────
//
// Shared types for the three-layer prompt injection detection pipeline.
// Each layer returns a DetectionResult; the pipeline short-circuits on first block.

export type DetectionLayer = "heuristic" | "llm-judge" | "canary" | "none";

export type AttackCategory =
  | "role-override"
  | "prompt-extraction"
  | "instruction-override"
  | "context-poisoning"
  | "delimiter-escape";

export interface DetectionResult {
  blocked: boolean;
  layer: DetectionLayer;
  pattern?: string; // which regex matched (heuristic layer)
  confidence?: number; // 0-1 (LLM judge layer)
  reason?: string; // human-readable explanation
}

export interface DetectionStats {
  totalChecks: number;
  blocked: number;
  byLayer: Record<DetectionLayer, number>;
}

export type DefenseMode = "protected" | "unprotected";

export function createEmptyStats(): DetectionStats {
  return {
    totalChecks: 0,
    blocked: 0,
    byLayer: { heuristic: 0, "llm-judge": 0, canary: 0, none: 0 },
  };
}
