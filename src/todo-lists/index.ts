import "dotenv/config";
import { createCLI } from "../shared/cli.js";
import { runAgent } from "./agent.js";
import { TodoState } from "./todo-state.js";
import { resetPipelineState, type AgentMode } from "./tools.js";

// ─── CLI ─────────────────────────────────────────────────────────────────────

const mode: AgentMode = process.argv.includes("--no-todos") ? "no-todos" : "with-todos";

// Single TodoState instance — persists across conversation turns.
// This is the key architectural choice: TODO state lives outside messages,
// survives context window summarization, and is injected fresh each iteration.
const todoState = new TodoState();

const cli = createCLI({
  title: `Agent-Authored TODO Lists \u2014 ${mode} mode`,
  emoji: "\uD83D\uDCCB",
  goodbye: "Goodbye!",
  agentLabel: "ShipIt",
  welcomeLines: [
    `    Mode: ${mode === "with-todos" ? "\uD83D\uDCCB With TODOs (persistent reasoning scaffold)" : "\u26A1 No TODOs (standard ReAct loop)"}`,
    "",
    "  Try these prompts:",
    '    \u2022 "Set up a deployment pipeline for webapp-frontend"',
    '    \u2022 "Configure a CI/CD pipeline for api-service"',
    '    \u2022 "I need a pipeline for data-pipeline"',
    "",
  ],
  onMessage: async (input, history) => {
    // Reset pipeline state for fresh configuration each turn
    resetPipelineState();

    const result = await runAgent(input, history, mode, todoState);
    const s = result.stats;

    const todoInfo =
      mode === "with-todos"
        ? ` | ${s.todoUpdates} TODO updates, ${todoState.getCompletionRatio()} completed`
        : "";

    return {
      messages: result.messages,
      stats: [
        "",
        `  \uD83D\uDCCA Stats: ${s.llmCalls} LLM calls, ${s.toolCalls} tool calls${todoInfo} [${s.mode} mode]`,
      ],
    };
  },
});

cli.start();
