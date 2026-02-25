import { runParentAgent } from "./agent.js";
import type { DelegationMode } from "./agent.js";
import { createCLI } from "../shared/cli.js";

// ─── CLI Chat Loop ──────────────────────────────────────────────────────────
//
// Demonstrates sub-agent delegation with two execution modes:
// - /sequential — parent ReAct loop calls delegation tools one at a time (default)
// - /parallel   — decompose → Promise.allSettled() → synthesize
// - /reset      — clears conversation history

let mode: DelegationMode = "sequential";

createCLI({
  title: "Travel Assistant — Sub-Agent Delegation Demo",
  emoji: "👥",
  goodbye: "Goodbye! ✈️🏨🎭",
  dividerWidth: 60,
  welcomeLines: [
    `    Current mode: ${mode}`,
    "",
    "  Commands:",
    "    /sequential — sequential mode (default): parent delegates one at a time",
    "    /parallel   — parallel mode: all children run simultaneously",
    "    /reset      — clear conversation history",
    "    exit        — quit",
    "",
    "  Try these prompts:",
    '    "Plan a weekend trip to Portland from Seattle"  → spawns 3 children',
    '    "Find flights to Portland from San Francisco"   → spawns 1 child',
    '    "Hello"                                         → no delegation',
  ],
  inputPrompt: () => `You [${mode}]: `,
  async onMessage(input, history) {
    const result = await runParentAgent(input, history, mode);

    const stats: string[] = [];
    stats.push(
      `\n  📊 Mode: ${result.mode} | Children spawned: ${result.children.length} | Total: ${result.totalDurationMs}ms`,
    );

    if (result.children.length > 0) {
      for (const child of result.children) {
        const status = child.status === "fulfilled" ? "✅" : "❌";
        stats.push(
          `     ${status} ${child.agentName}: ${child.toolCallCount} tools, ${child.durationMs}ms`,
        );
      }

      // Show timing comparison in parallel mode
      if (result.mode === "parallel" && result.children.length > 1) {
        const sumSequential = result.children.reduce((sum, c) => sum + c.durationMs, 0);
        const savings = sumSequential - result.totalDurationMs;
        if (savings > 0) {
          stats.push(
            `     ⚡ Parallel saved ~${savings}ms vs sequential (${sumSequential}ms → ${result.totalDurationMs}ms)`,
          );
        }
      }
    }

    return {
      messages: result.messages,
      stats,
    };
  },
  onCommand(cmd) {
    switch (cmd) {
      case "/sequential":
        mode = "sequential";
        console.log("\nMode: sequential — parent delegates one child at a time");
        return true;
      case "/parallel":
        mode = "parallel";
        console.log("\nMode: parallel — all children run simultaneously");
        return true;
      case "/reset":
        console.log("\n✅ Conversation cleared.");
        return { handled: true, newHistory: [] };
      default:
        return false;
    }
  },
}).start();
