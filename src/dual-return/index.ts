import { runAgent } from "./agent.js";
import { createCLI } from "../shared/cli.js";
import { formatTokenStats, formatArtifactEntries } from "./display.js";
import type { ToolMode } from "./tools.js";

// ─── Mode Selection ─────────────────────────────────────────────────────────
//
// --simple: dump all tool data into LLM context (simulates naive approach)
// default:  dual return — concise content for LLM, artifacts for UI

const mode: ToolMode = process.argv.includes("--simple") ? "simple" : "dual";
const modeName =
  mode === "simple" ? "SIMPLE (all data in context)" : "DUAL RETURN (content + artifact)";

// ─── CLI Chat Loop ──────────────────────────────────────────────────────────

const welcomeLines: string[] = [`    Mode: ${modeName}`, ""];

if (mode === "simple") {
  welcomeLines.push(
    "    Running in SIMPLE mode — full tool data goes into LLM context.",
    "    Watch the token count grow. Compare with: pnpm dev:dual-return",
    "",
  );
} else {
  welcomeLines.push(
    "    Running in DUAL RETURN mode — concise summaries for LLM, full artifacts for UI.",
    "    Compare with: pnpm dev:dual-return:simple",
    "",
  );
}

welcomeLines.push(
  "    Try these prompts:",
  '    "What services are having issues?"',
  '    "Show me error logs for checkout-service"',
  '    "What are the current incidents?"',
  '    "Give me metrics for the payment gateway"',
  "",
);

createCLI({
  title: "Service Monitor — Dual Return Pattern",
  emoji: "📊",
  goodbye: "Goodbye! 📊",
  welcomeLines,
  async onMessage(input, history) {
    const result = await runAgent(input, history, mode);

    const stats: string[] = [];

    // In dual mode, render artifact panels
    if (mode === "dual" && result.artifacts.length > 0) {
      stats.push(...formatArtifactEntries(result.artifacts));
    }

    // Always show token stats
    stats.push(...formatTokenStats(result.tokenStats));

    return { messages: result.messages, stats };
  },
}).start();
