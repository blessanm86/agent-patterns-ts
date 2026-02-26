// ─── Token Estimation ───────────────────────────────────────────────────────
//
// Simple chars/4 heuristic for estimating token counts.
// Good enough for demonstrating the dual-return savings pattern.
// Not extracted to shared yet — per CLAUDE.md, wait until a second copy appears.

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
