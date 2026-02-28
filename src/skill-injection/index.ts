import "dotenv/config";
import { createCLI } from "../shared/cli.js";
import { runAgent } from "./agent.js";
import type { AgentMode } from "./tools.js";

// ─── CLI ─────────────────────────────────────────────────────────────────────

const mode: AgentMode = process.argv.includes("--no-skills") ? "no-skills" : "skills";

const cli = createCLI({
  title: `On-Demand Skill Injection — ${mode} mode`,
  emoji: "🎯",
  goodbye: "Goodbye!",
  agentLabel: "Support",
  welcomeLines: [
    `    Mode: ${mode === "skills" ? "🎯 Skills (concise tools + get_skill meta-tool)" : "📝 No-Skills (verbose tool descriptions)"}`,
    "",
    "  Try these prompts:",
    '    • "A customer says their order ORD-1001 arrived damaged, can you help?"',
    '    • "Process a return and refund for order ORD-1001"',
    '    • "Check if we can fulfill any backorders"',
    '    • "Handle the ORD-1001 complaint end-to-end"',
    "",
  ],
  onMessage: async (input, history) => {
    const result = await runAgent(input, history, mode);
    const s = result.stats;

    return {
      messages: result.messages,
      stats: [
        "",
        `  📊 Stats: ${s.llmCalls} LLM calls, ${s.toolCalls} tool calls${s.getSkillCalls > 0 ? ` (${s.getSkillCalls} get_skill)` : ""} [${s.mode} mode]`,
        `  📏 Prompt size: ${s.systemPromptChars.toLocaleString()} system + ${s.toolDescriptionChars.toLocaleString()} tool defs = ${s.totalPromptChars.toLocaleString()} total chars`,
      ],
    };
  },
});

cli.start();
