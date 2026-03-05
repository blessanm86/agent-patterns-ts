// ─── Terminal Progress Reporter ──────────────────────────────────────────────
//
// Renders an inline progress bar with ETA and per-item status lines.
// Uses \r to overwrite the progress line in-place, and full lines for
// completed items.

import type { MigrationResult } from "./recipes.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MigrationReport {
  runId: string;
  totalRecipes: number;
  succeeded: number;
  failed: number;
  skipped: number;
  totalDurationMs: number;
  results: MigrationResult[];
  resumedFromCheckpoint: boolean;
}

// ─── Reporter ───────────────────────────────────────────────────────────────

export class ProgressReporter {
  private totalItems: number;
  private startTime = 0;
  private completedCount = 0;
  private itemStartTimes = new Map<number, number>();

  constructor(totalItems: number) {
    this.totalItems = totalItems;
  }

  start(runId: string, resumedFrom?: number): void {
    this.startTime = Date.now();
    this.completedCount = resumedFrom ?? 0;

    console.log("");
    if (resumedFrom && resumedFrom > 0) {
      console.log(
        `  ⟳ Resuming run ${runId.slice(0, 8)}… from item ${resumedFrom}/${this.totalItems}`,
      );
    } else {
      console.log(`  ▶ Starting run ${runId.slice(0, 8)}… (${this.totalItems} recipes)`);
    }
    console.log("");
  }

  onItemStart(index: number, recipeName: string): void {
    this.itemStartTimes.set(index, Date.now());
    this.writeProgressBar(recipeName, "fetch");
  }

  onStepUpdate(recipeName: string, step: string): void {
    this.writeProgressBar(recipeName, step);
  }

  onItemComplete(index: number, recipeName: string, result: MigrationResult): void {
    this.completedCount++;
    const elapsed = Date.now() - (this.itemStartTimes.get(index) ?? Date.now());
    const elapsedStr = (elapsed / 1000).toFixed(1);

    // Clear the progress bar line
    process.stdout.write("\r\x1b[K");

    // Print completed item on its own line
    const icon = result.status === "success" ? "✓" : result.status === "skipped" ? "⊘" : "✗";
    const suffix = result.status === "failed" ? ` (${result.error})` : "";
    console.log(`  ${icon} ${result.recipeId} ${recipeName.padEnd(28)} ${elapsedStr}s${suffix}`);
  }

  onCancel(completedItems: number): void {
    process.stdout.write("\r\x1b[K");
    console.log(`\n  ⚠ Cancelled after ${completedItems}/${this.totalItems} recipes`);
  }

  complete(report: MigrationReport): void {
    const durationStr = formatDuration(report.totalDurationMs);

    console.log("");
    console.log("  ─── Migration Complete ───────────────────────────");
    console.log(`  Run:       ${report.runId.slice(0, 8)}…`);
    console.log(`  Duration:  ${durationStr}`);
    console.log(`  Total:     ${report.totalRecipes}`);
    console.log(`  Succeeded: ${report.succeeded}`);
    console.log(`  Failed:    ${report.failed}`);
    console.log(`  Skipped:   ${report.skipped}`);
    if (report.resumedFromCheckpoint) {
      console.log("  Resumed:   yes (from checkpoint)");
    }
    console.log("  ──────────────────────────────────────────────────");
    console.log("");
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private writeProgressBar(recipeName: string, step: string): void {
    const pct = this.completedCount / this.totalItems;
    const barWidth = 20;
    const filled = Math.round(pct * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
    const pctStr = `${Math.round(pct * 100)}%`;

    const elapsed = Date.now() - this.startTime;
    const elapsedStr = formatDuration(elapsed);

    let etaStr = "—";
    if (this.completedCount > 0) {
      const msPerItem = elapsed / this.completedCount;
      const remaining = (this.totalItems - this.completedCount) * msPerItem;
      etaStr = `~${formatDuration(remaining)}`;
    }

    const shortName = recipeName.length > 24 ? `${recipeName.slice(0, 21)}…` : recipeName;
    const line = `  [${bar}] ${pctStr} (${this.completedCount}/${this.totalItems}) | ${shortName} → ${step} | ${elapsedStr} elapsed, ${etaStr} remaining`;

    process.stdout.write(`\r\x1b[K${line}`);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m${secs.toString().padStart(2, "0")}s`;
}
