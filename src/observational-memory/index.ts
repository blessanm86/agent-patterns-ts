import "dotenv/config";
import { createCLI } from "../shared/cli.js";
import {
  runAgent,
  createMemoryState,
  OBSERVER_TOKEN_THRESHOLD,
  REFLECTOR_TOKEN_THRESHOLD,
  type AgentMode,
} from "./agent.js";
import { estimateTokens, estimateMessageTokens, formatTokenCount } from "./token-counter.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const mode: AgentMode = process.argv.includes("--no-observe") ? "no-observe" : "observe";
const memory = createMemoryState();

// ─── CLI ────────────────────────────────────────────────────────────────────

const cli = createCLI({
  title: `Observational Memory — Recipe Assistant (${mode})`,
  emoji: "👁️",
  goodbye: "Goodbye! Your observations are preserved for next time.",
  agentLabel: "Assistant",
  welcomeLines:
    mode === "observe"
      ? [
          `    Mode: 👁️ Observational Memory`,
          `    Observer threshold: ${formatTokenCount(OBSERVER_TOKEN_THRESHOLD)} tokens`,
          `    Reflector threshold: ${formatTokenCount(REFLECTOR_TOKEN_THRESHOLD)} tokens`,
          "",
          "  Commands:",
          "    /observations  — show current observation log",
          "    /stats         — show token counts for each memory block",
          "    /clear         — clear all observations and history",
          "",
          "  Try this multi-turn walkthrough:",
          '    1. "I\'m vegan and allergic to nuts"',
          '    2. "I love Thai and Mediterranean food"',
          '    3. "Find me an easy weeknight dinner"',
          '    4. "What about something more challenging?"',
          '    5. "I\'m cooking for 6 people this Saturday"',
          "    6. /observations — see what the Observer captured",
          '    7. "Recommend a recipe for Saturday" — watch it use observations!',
          "",
        ]
      : [
          `    Mode: ⚡ No Observations (baseline — drops oldest messages when full)`,
          "",
          "  Try the same walkthrough — early preferences get truncated",
          "  and the agent forgets what you told it.",
          "",
        ],

  onMessage: async (input, _history) => {
    // We manage history through memory.rawMessages, not through the CLI's history
    const result = await runAgent(input, memory, mode);
    const s = result.stats;

    const statsLines: string[] = [
      "",
      `  📊 Stats: ${s.llmCalls} LLM calls, ${s.toolCalls} tool calls [${s.mode}]`,
    ];

    if (mode === "observe") {
      statsLines.push(
        `  📦 Context: ${formatTokenCount(s.observationTokens)} observations + ${formatTokenCount(s.rawMessageTokens)} raw → ${formatTokenCount(s.totalContextTokens)} total`,
      );

      const events: string[] = [];
      if (s.observerTriggered) events.push("Observer fired");
      if (s.reflectorTriggered) events.push("Reflector fired");
      if (events.length > 0) {
        statsLines.push(`  ⚡ Events: ${events.join(", ")}`);
      }
    }

    return { messages: result.messages, stats: statsLines };
  },

  onCommand: (command, _history) => {
    if (mode === "no-observe") {
      console.log("  Memory commands are not available in no-observe mode.");
      return true;
    }

    if (command === "/observations") {
      if (!memory.observations) {
        console.log("\n  👁️ No observations yet (Observer hasn't triggered).");
        console.log(
          `     Raw messages: ${formatTokenCount(estimateMessageTokens(memory.rawMessages))} tokens`,
        );
        console.log(
          `     Observer triggers at: ${formatTokenCount(OBSERVER_TOKEN_THRESHOLD)} tokens`,
        );
      } else {
        console.log("\n  👁️ Current Observations:\n");
        for (const line of memory.observations.split("\n")) {
          console.log(`    ${line}`);
        }
        console.log(`\n    (${formatTokenCount(estimateTokens(memory.observations))} tokens)`);
      }
      return true;
    }

    if (command === "/stats") {
      const rawTokens = estimateMessageTokens(memory.rawMessages);
      const obsTokens = estimateTokens(memory.observations);
      const rawMsgCount = memory.rawMessages.length;
      const obsLineCount = memory.observations
        ? memory.observations.split("\n").filter((l) => l.startsWith("- ")).length
        : 0;

      console.log("\n  📊 Memory Stats:");
      console.log(
        `     Observations: ${obsLineCount} entries, ${formatTokenCount(obsTokens)} tokens`,
      );
      console.log(
        `     Raw messages: ${rawMsgCount} messages, ${formatTokenCount(rawTokens)} tokens`,
      );
      console.log(
        `     Observer threshold:  ${formatTokenCount(OBSERVER_TOKEN_THRESHOLD)} tokens (${rawTokens > OBSERVER_TOKEN_THRESHOLD ? "exceeded ✓" : `${OBSERVER_TOKEN_THRESHOLD - rawTokens} tokens remaining`})`,
      );
      console.log(
        `     Reflector threshold: ${formatTokenCount(REFLECTOR_TOKEN_THRESHOLD)} tokens (${obsTokens > REFLECTOR_TOKEN_THRESHOLD ? "exceeded ✓" : `${REFLECTOR_TOKEN_THRESHOLD - obsTokens} tokens remaining`})`,
      );
      return true;
    }

    if (command === "/clear") {
      memory.observations = "";
      memory.rawMessages = [];
      console.log("\n  🗑️ Cleared all observations and message history.");
      return { handled: true, newHistory: [] };
    }

    return false;
  },
});

cli.start();
