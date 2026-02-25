import { runAgentWithRecovery, MAX_TOOL_RETRIES } from "./agent.js";
import { resetMockData } from "./tools.js";
import { createCLI } from "../shared/cli.js";
import type { RecoveryMode } from "./agent.js";

// ─── CLI Chat Loop ────────────────────────────────────────────────────────────
//
// Demonstrates three error recovery strategies side-by-side.
// Use /crash, /blind, /corrective to switch modes mid-conversation.
// Use /reset to restore mock room data between experiments.

let mode: RecoveryMode = "corrective";

function modeLabel(m: RecoveryMode): string {
  return {
    crash: "💥 crash",
    blind: "🔁 blind",
    corrective: "💡 corrective",
  }[m];
}

function printStats(
  toolStats: { calls: number; errors: number; recovered: number; failed: number },
  currentMode: RecoveryMode,
): string[] {
  const { calls, errors, recovered, failed } = toolStats;
  if (calls > 0) {
    return [
      `\n  📊 Tool calls: ${calls}  |  Errors: ${errors}  |  Recovered: ${recovered}  |  Failed: ${failed}  |  Mode: ${currentMode}`,
    ];
  }
  return [];
}

createCLI({
  title: "The Grand TypeScript Hotel — Error Recovery Demo",
  emoji: "🏨",
  goodbye: "Goodbye! 🏨",
  dividerWidth: 60,
  welcomeLines: [
    `    Current mode: ${modeLabel("corrective")} (max retries: ${MAX_TOOL_RETRIES})`,
    "",
    "  Commands:",
    "    /corrective  — corrective mode (default): error + specific hint",
    "    /blind       — blind mode: raw error only, model must guess",
    "    /crash       — crash mode: stop immediately on any error",
    "    /reset       — restore room availability (rooms booked in-session)",
    "    exit         — quit",
    "",
    "  Prompts that trigger errors:",
    '    Date format error:   "Book a room checking in next friday to March 10"',
    '    Unknown room type:   "I want a premium room for March 1 to March 5"',
    '    Missing guest name:  "Book a double room from 2026-03-01 to 2026-03-05"',
    '    Normal flow:         "Book a double room from 2026-03-01 to 2026-03-05 for Jane Smith"',
  ],
  inputPrompt: () => `You [${mode}]: `,
  async onMessage(input, history) {
    const result = await runAgentWithRecovery(input, history, mode);
    return {
      messages: result.messages,
      stats: printStats(result.toolStats, result.mode),
    };
  },
  onCommand(cmd) {
    switch (cmd) {
      case "/corrective":
        mode = "corrective";
        console.log(`\nMode: ${modeLabel(mode)} — errors returned with specific fix hints`);
        return true;
      case "/blind":
        mode = "blind";
        console.log(`\nMode: ${modeLabel(mode)} — raw error only, model guesses the fix`);
        return true;
      case "/crash":
        mode = "crash";
        console.log(`\nMode: ${modeLabel(mode)} — agent stops immediately on any error`);
        return true;
      case "/reset":
        resetMockData();
        console.log("\n✅ Room data reset. Conversation cleared.");
        return { handled: true, newHistory: [] };
      default:
        return false;
    }
  },
}).start();
