import "dotenv/config";
import { createCLI } from "../shared/cli.js";
import { runAgent } from "./agent.js";
import type { AgentMode } from "./tools.js";

// ─── CLI ─────────────────────────────────────────────────────────────────────

const mode: AgentMode = process.argv.includes("--one-shot") ? "one-shot" : "validated";

const cli = createCLI({
  title: `Self-Validation Tool (QA Gate) \u2014 ${mode} mode`,
  emoji: "\u2705",
  goodbye: "Goodbye!",
  agentLabel: "Menu",
  welcomeLines: [
    `    Mode: ${mode === "validated" ? "\u2705 Validated (generate \u2192 validate \u2192 fix loop)" : "\u26a1 One-Shot (generate \u2192 deliver, no validation)"}`,
    "",
    "  Try these prompts:",
    '    \u2022 "Create an Italian restaurant menu with appetizers and mains"',
    '    \u2022 "Build a vegan-friendly dinner menu with desserts and drinks"',
    '    \u2022 "I need a Japanese restaurant menu with 3 categories"',
    '    \u2022 "Make a complete menu for a steakhouse in EUR"',
    "",
  ],
  onMessage: async (input, history) => {
    const result = await runAgent(input, history, mode);
    const s = result.stats;

    const validationInfo =
      s.validationAttempts > 0
        ? ` | ${s.validationAttempts} validation attempt${s.validationAttempts > 1 ? "s" : ""}, ${s.validationPassed ? "PASSED" : "FAILED"}${s.firstAttemptPassed ? " (first try)" : ""}`
        : " | no validation";

    return {
      messages: result.messages,
      stats: [
        "",
        `  \ud83d\udcca Stats: ${s.llmCalls} LLM calls, ${s.toolCalls} tool calls${validationInfo} [${s.mode} mode]`,
      ],
    };
  },
});

cli.start();
