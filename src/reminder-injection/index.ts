import { runAgent, type ReminderMode } from "./agent.js";
import { createCLI } from "../shared/cli.js";

// ─── Mode Selection ──────────────────────────────────────────────────────────
//
// Default: reminders enabled (the whole point of the demo)
// --no-reminders: raw tool responses, to show formatting drift

const noReminders = process.argv.includes("--no-reminders");
const mode: ReminderMode = noReminders ? "no-reminders" : "reminders";
const modeName = noReminders ? "NO REMINDERS (drift expected)" : "REMINDERS ENABLED";

// ─── CLI ─────────────────────────────────────────────────────────────────────

const welcomeLines: string[] = [`    Mode: ${modeName}`, ""];

if (noReminders) {
  welcomeLines.push(
    "    Running WITHOUT reminder injection.",
    "    Watch for formatting drift after 8-10 tool calls:",
    "      - Missing [Source: ...] citations",
    "      - Imperial units leaking through (cups, °F, tablespoons)",
    "      - Missing allergen tags",
    "      - Bare numbers or bullets instead of Step N:",
    "      - Missing [Appetizer]/[Primo]/[Secondo]/[Dessert] labels",
    "",
  );
} else {
  welcomeLines.push(
    "    Running WITH reminder injection on every tool response.",
    "    Compare with: pnpm dev:reminder-injection:no-reminders",
    "",
  );
}

welcomeLines.push(
  "    Try this prompt to trigger a long tool chain (10+ calls):",
  "",
  '    "Plan a 4-course Italian dinner party for 6 guests.',
  "     Search recipes for each course, get full details for the best",
  "     option per course, find wine pairings, check ingredient availability,",
  '     build a shopping list, and create a prep timeline for 7 PM service."',
  "",
);

createCLI({
  title: "Italian Dinner Party Planner — Reminder Injection",
  emoji: "🍝",
  goodbye: "Buon appetito! 🍝",
  welcomeLines,
  async onMessage(input, history) {
    const { messages, stats } = await runAgent(input, history, mode);
    return {
      messages,
      stats: [
        "",
        `  📊 Stats: ${stats.toolCalls} tool calls, ${stats.llmCalls} LLM calls, ~${stats.reminderTokensInjected} reminder tokens injected`,
      ],
    };
  },
}).start();
