// ─── Recipe Migration — Long-Running Agents & Checkpointing ─────────────────
//
// Non-interactive batch runner. Migrates 20 messy old-format recipes into
// clean structured records. Checkpoints after each recipe so the process
// can resume after crashes or Ctrl+C.
//
// Usage:
//   pnpm dev:long-running              Start fresh (or resume if checkpoint exists)
//   pnpm dev:long-running --fresh      Ignore checkpoints, start fresh

import "dotenv/config";
import * as readline from "node:readline";
import { runMigration, CheckpointStore } from "./agent.js";

// ─── Parse Args ─────────────────────────────────────────────────────────────

const forceFresh = process.argv.includes("--fresh");

// ─── Banner ─────────────────────────────────────────────────────────────────

console.log("");
console.log("  ╔════════════════════════════════════════════════════╗");
console.log("  ║  Recipe Migration — Long-Running Checkpointing    ║");
console.log("  ╚════════════════════════════════════════════════════╝");
console.log("");
console.log("  Migrates 20 old-format recipes → clean structured format.");
console.log("  Each recipe goes through: fetch → transform (LLM) → validate → save");
console.log("  Checkpoints after each recipe. Ctrl+C to pause, re-run to resume.");
console.log("");

// ─── SIGINT Handling ────────────────────────────────────────────────────────
//
// First Ctrl+C: set abort flag, let current recipe finish, checkpoint, exit.
// Second Ctrl+C: force exit immediately.

const controller = new AbortController();
let cancelCount = 0;

process.on("SIGINT", () => {
  cancelCount++;
  if (cancelCount === 1) {
    console.log("\n\n  ⚠ Ctrl+C received — finishing current recipe, then saving checkpoint…");
    controller.abort();
  } else {
    console.log("\n  Force exit.");
    process.exit(1);
  }
});

// ─── Check for Resumable Checkpoint ─────────────────────────────────────────

async function promptResume(store: CheckpointStore): Promise<string | null> {
  if (forceFresh) return null;

  const inProgress = store.findInProgress();
  if (inProgress.length === 0) return null;

  const cp = inProgress[0];
  console.log(`  Found in-progress checkpoint:`);
  console.log(`    Run:       ${cp.runId.slice(0, 8)}…`);
  console.log(`    Progress:  ${cp.completedItems}/${cp.totalItems} recipes`);
  console.log(`    Updated:   ${cp.updatedAt}`);
  console.log("");

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("  Resume from checkpoint? (Y/n) ", (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === "" || a === "y" || a === "yes") {
        resolve(cp.runId);
      } else {
        resolve(null);
      }
    });
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const store = new CheckpointStore();
  const resumeRunId = await promptResume(store);

  await runMigration({ runId: resumeRunId ?? undefined }, { signal: controller.signal });
}

main().catch((err) => {
  console.error("\n  Fatal error:", err.message ?? err);
  process.exit(1);
});
