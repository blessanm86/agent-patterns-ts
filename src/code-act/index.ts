import { createCLI } from "../shared/cli.js";
import { runCodeActAgent, runJsonAgent, type AgentStats } from "./agent.js";

// ─── Compare Mode ─────────────────────────────────────────────────────────────
//
// /compare runs the same message through both the CodeAct agent and the JSON
// tool-calling agent, then shows a side-by-side breakdown of LLM calls and
// token usage. This makes the efficiency difference concrete and measurable.

let compareMode = false;

// ─── Stats Formatting ─────────────────────────────────────────────────────────

function formatStats(stats: AgentStats): string[] {
  return [
    "",
    `  LLM calls:       ${stats.llmCalls}`,
    `  Code executions: ${stats.actionCalls}`,
    `  Input tokens:    ${stats.inputTokens}`,
    `  Output tokens:   ${stats.outputTokens}`,
    "",
  ];
}

function formatComparison(codeAct: AgentStats, json: AgentStats): string[] {
  const llmDiff =
    codeAct.llmCalls > 0 ? ((json.llmCalls - codeAct.llmCalls) / codeAct.llmCalls) * 100 : 0;
  const tokenDiff =
    codeAct.inputTokens > 0
      ? ((json.inputTokens - codeAct.inputTokens) / codeAct.inputTokens) * 100
      : 0;

  const w = 22;
  return [
    "",
    "  CodeAct vs JSON Tool-Calling:",
    `  ${"".padEnd(w)} ${"CodeAct".padEnd(w)} JSON`,
    `  ${"─".repeat(w)} ${"─".repeat(w)} ${"─".repeat(w)}`,
    `  ${"LLM calls".padEnd(w)} ${String(codeAct.llmCalls).padEnd(w)} ${json.llmCalls}`,
    `  ${"Actions dispatched".padEnd(w)} ${String(codeAct.actionCalls).padEnd(w)} ${json.actionCalls}`,
    `  ${"Input tokens".padEnd(w)} ${String(codeAct.inputTokens).padEnd(w)} ${json.inputTokens}`,
    `  ${"Output tokens".padEnd(w)} ${String(codeAct.outputTokens).padEnd(w)} ${json.outputTokens}`,
    `  ${"─".repeat(w)} ${"─".repeat(w)} ${"─".repeat(w)}`,
    llmDiff > 0
      ? `  JSON used ${llmDiff.toFixed(0)}% more LLM calls, ${tokenDiff.toFixed(0)}% more input tokens`
      : `  Similar performance on this task`,
    "",
    "  Key: CodeAct combines multiple tool calls into one code block.",
    "  JSON must call each tool separately, one LLM turn per call.",
    "",
  ];
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

createCLI({
  title: "CodeAct — Meal Planning Agent",
  emoji: "🐍",
  goodbye: "Agent shut down.",
  agentLabel: "Agent",
  welcomeLines: [
    "  Tools are Python functions, not JSON schemas.",
    "  The agent writes code — you see it execute in real time.",
    "",
    "  Available functions:",
    "    search_recipes(query)                    find recipes by keyword",
    "    get_nutritional_info(name)               calories, protein, carbs, fat",
    "    calculate_meal_plan(recipes, calories)   build a daily plan",
    "",
    '  Try: "Plan a 1500 calorie day with low carb options"',
    '  Try: "Which recipes have the most protein per serving?"',
    '  Try: "Find all vegetarian recipes and rank by calories"',
    "",
    "  Commands:",
    "    /compare  run next message with both CodeAct AND JSON tool-calling",
    "",
  ],

  onCommand(command) {
    if (command === "/compare") {
      compareMode = true;
      console.log(
        "\n  Compare mode ON — next message runs CodeAct then JSON. Results will differ.\n",
      );
      return true;
    }
    return false;
  },

  async onMessage(input, history) {
    if (compareMode) {
      compareMode = false;

      console.log("\n  [CodeAct] Running...");
      const codeActResult = await runCodeActAgent(input, history);

      console.log("\n  [JSON] Running...");
      const jsonResult = await runJsonAgent(input, history);

      // Show CodeAct's answer; JSON answer may differ slightly but that's fine
      return {
        messages: codeActResult.messages,
        stats: formatComparison(codeActResult.stats, jsonResult.stats),
      };
    }

    const { messages, stats } = await runCodeActAgent(input, history);
    return { messages, stats: formatStats(stats) };
  },
}).start();
