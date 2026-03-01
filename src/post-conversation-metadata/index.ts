import "dotenv/config";
import { createCLI } from "../shared/cli.js";
import { runAgent } from "./agent.js";
import type { AgentMode } from "./tools.js";

// ─── CLI ─────────────────────────────────────────────────────────────────────

const mode: AgentMode = process.argv.includes("--no-metadata") ? "no-metadata" : "with-metadata";

const cli = createCLI({
  title: `Post-Conversation Metadata — ${mode} mode`,
  emoji: "\uD83C\uDFF7\uFE0F",
  goodbye: "Goodbye!",
  agentLabel: "Support",
  welcomeLines: [
    `    Mode: ${mode === "with-metadata" ? "\uD83C\uDFF7\uFE0F  With Metadata (response \u2192 secondary LLM call \u2192 metadata)" : "\u26A1 No Metadata (response only, no secondary call)"}`,
    "",
    "  Try these prompts:",
    '    \u2022 "Can you look up the account for Acme Corp?"',
    '    \u2022 "Are there any known issues right now?"',
    '    \u2022 "How do I set up SSO with SAML?"',
    '    \u2022 "I want to upgrade from Starter to Business plan"',
    "",
  ],
  onMessage: async (input, history) => {
    const result = await runAgent(input, history, mode);
    const s = result.stats;

    const statsLines: string[] = [
      "",
      `  \uD83D\uDCCA Stats: ${s.llmCalls} LLM calls, ${s.toolCalls} tool calls [${s.mode} mode]`,
    ];

    // Show metadata block when available
    if (s.metadataResult) {
      const mr = s.metadataResult;
      statsLines.push(`  \u23F1\uFE0F  Metadata latency: ${mr.latencyMs}ms`);

      if (mr.metadata) {
        const m = mr.metadata;
        statsLines.push("");
        statsLines.push(`  \uD83C\uDFF7\uFE0F  Thread: ${m.threadName}`);
        statsLines.push(`  \uD83D\uDCC2 Category: ${m.category}`);

        const flagEmoji = m.securityFlag === "none" ? "\u2705" : "\u26A0\uFE0F";
        statsLines.push(`  ${flagEmoji} Security: ${m.securityFlag}`);

        statsLines.push("  \uD83D\uDCA1 Suggestions:");
        for (let i = 0; i < m.suggestions.length; i++) {
          statsLines.push(`     ${i + 1}. ${m.suggestions[i].label}`);
        }
      } else if (mr.error) {
        statsLines.push(`  \u274C Metadata error: ${mr.error}`);
      }
    }

    return {
      messages: result.messages,
      stats: statsLines,
    };
  },
});

cli.start();
