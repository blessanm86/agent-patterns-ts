// ─── Sub-Agent Event Demultiplexing ─────────────────────────────────────────
//
// Demonstrates normalizing heterogeneous sub-agent streaming protocols.
//
// Two sub-agents emit events in different protocols:
//   - Flight agent: Anthropic-like (content_block_start/delta/stop, index routing)
//   - Hotel agent:  OpenAI-like (response.output_text.delta, output_index routing)
//
// Usage:
//   pnpm dev:event-demux          # run both raw and demux modes
//   pnpm dev:event-demux --raw    # raw mode only (shows the problem)
//   pnpm dev:event-demux --demux  # demux mode only (shows the solution)

import { runRawMode, runDemuxMode } from "./orchestrator.js";

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rawOnly = args.includes("--raw");
  const demuxOnly = args.includes("--demux");

  const query = "Plan a trip from Seattle to Portland on March 15, with hotels for 2 nights";

  console.log(`\n${BOLD}  Sub-Agent Event Demultiplexing${RESET}`);
  console.log(`  ${DIM}Normalizing heterogeneous streaming protocols${RESET}`);
  console.log(`  ${DIM}Query: "${query}"${RESET}`);

  if (!demuxOnly) {
    await runRawMode(query);
  }

  if (!rawOnly) {
    if (!demuxOnly) {
      console.log(`\n  ${"─".repeat(60)}\n`);
    }
    await runDemuxMode(query);
  }

  console.log();
}

main().catch(console.error);
