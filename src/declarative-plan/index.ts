import "dotenv/config";
import { createCLI } from "../shared/cli.js";
import { runAgent } from "./agent.js";
import type { ExecutionMode, PlanArtifact } from "./types.js";

// ─── CLI ─────────────────────────────────────────────────────────────────────

const mode: ExecutionMode = process.argv.includes("--individual") ? "individual" : "declarative";

function printArtifact(artifact: PlanArtifact) {
  console.log("\n  ┌─────────────────────────────────────────────────┐");
  console.log(`  │  Plan Artifact: ${artifact.goal.slice(0, 32).padEnd(32)}│`);
  console.log("  ├─────────────────────────────────────────────────┤");

  for (const step of artifact.steps) {
    const status = step.error ? "❌" : "✅";
    const argsStr = Object.entries(step.resolvedArgs)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    console.log(`  │  ${status} Step ${step.stepIndex + 1}: ${step.tool}(${argsStr.slice(0, 30)})`);
    console.log(`  │     ${step.summary.slice(0, 45)}`);
    console.log(`  │     ${step.durationMs}ms`);
  }

  console.log("  ├─────────────────────────────────────────────────┤");
  console.log(
    `  │  ${artifact.stepsSucceeded} succeeded, ${artifact.stepsFailed} failed | ${artifact.totalDurationMs}ms total │`,
  );
  console.log("  └─────────────────────────────────────────────────┘");
}

const cli = createCLI({
  title: `Declarative Plan Execution — ${mode} mode`,
  emoji: "📋",
  goodbye: "Goodbye!",
  agentLabel: "Monitor",
  welcomeLines: [
    `    Mode: ${mode === "declarative" ? "📋 Declarative (execute_plan meta-tool enabled)" : "🔧 Individual (tool-by-tool)"}`,
    "",
    "  Try these prompts:",
    '    • "List all compute metrics, query CPU usage, and check if it\'s above 80%"',
    '    • "What is the current HTTP error rate? Is it above 5%?"',
    '    • "Show me all network metrics and their current values"',
    "",
  ],
  onMessage: async (input, history) => {
    const result = await runAgent(input, history, mode);

    if (result.artifact) {
      printArtifact(result.artifact);
    }

    return {
      messages: result.messages,
      stats: [
        "",
        `  📊 Stats: ${result.stats.llmCalls} LLM calls, ${result.stats.toolCalls} tool calls, ${result.stats.totalDurationMs}ms total [${result.stats.mode} mode]`,
      ],
    };
  },
});

cli.start();
