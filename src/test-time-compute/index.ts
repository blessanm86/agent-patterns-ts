import "dotenv/config";
import { createCLI } from "../shared/cli.js";
import { runAgent, type Strategy } from "./agent.js";

// ─── CLI ─────────────────────────────────────────────────────────────────────

const strategy: Strategy = process.argv.includes("--single")
  ? "single"
  : process.argv.includes("--uniform")
    ? "uniform"
    : "adaptive";

const strategyLabels: Record<Strategy, string> = {
  single: "Single Pass (1 trajectory, cheapest)",
  uniform: "Uniform Scaling (3 trajectories + judge, always)",
  adaptive: "Adaptive Scaling (1 trajectory + confidence check, scale up if uncertain)",
};

const cli = createCLI({
  title: `Test-Time Compute Scaling \u2014 ${strategy} mode`,
  emoji: "\u{1F9E0}",
  goodbye: "Goodbye!",
  agentLabel: "Recipe",
  welcomeLines: [
    `    Strategy: ${strategyLabels[strategy]}`,
    "",
    "  Try these prompts (varying difficulty):",
    '    Easy:   "What\'s in a Caesar salad?"',
    '    Medium: "Find me a vegan dinner under 300 calories"',
    '    Hard:   "Plan a 3-course gluten-free, dairy-free dinner under 900 total calories"',
    "",
    "  Compare strategies:",
    "    pnpm dev:test-time-compute --single    (cheapest, sometimes incomplete)",
    "    pnpm dev:test-time-compute --uniform   (always 3x cost, most reliable)",
    "    pnpm dev:test-time-compute             (adaptive \u2014 cheap on easy, scales on hard)",
    "",
  ],
  onMessage: async (input, history) => {
    const result = await runAgent(input, history, strategy);

    const stats = [
      "",
      `  \u{1F4CA} Stats: ${result.trajectoryCount} trajectorie(s), ${result.totalLLMCalls} LLM calls, ${result.totalToolCalls} tool calls, ${result.totalTokens} tokens`,
    ];

    if (result.strategy === "adaptive") {
      const confidenceInfo = result.confidenceScore
        ? `confidence ${result.confidenceScore}/5`
        : "no confidence check";
      const scalingInfo = result.scaledUp ? "SCALED UP" : "stayed at 1";
      stats.push(`  \u{1F3AF} Adaptive: ${confidenceInfo} \u2192 ${scalingInfo}`);
    }

    stats.push(`  \u{1F4B0} Strategy: ${strategyLabels[strategy]}`);

    return {
      messages: result.finalMessages,
      stats,
    };
  },
});

cli.start();
