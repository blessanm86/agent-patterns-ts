import "dotenv/config";
import { documents } from "./knowledge-base.js";
import { chunkDocuments } from "./chunker.js";
import { embedChunks } from "./vector-store.js";
import { configure, setSearchMode, getSearchMode } from "./tools.js";
import { runBasicAgent, runAgenticAgent } from "./agent.js";
import { createCLI } from "../shared/cli.js";
import type { SearchMode, AgentStats } from "./types.js";

// ─── Agentic RAG Demo — NexusDB Documentation Research Assistant ────────────
//
// Demonstrates the difference between basic RAG (search once) and agentic RAG
// (iterative retrieval). The agent formulates queries, evaluates results,
// refines its search strategy, and iterates until it has enough information.
//
// Commands:
//   /agentic  — switch to agentic RAG mode (default)
//   /basic    — switch to basic RAG mode
//   /compare  — run next question in BOTH modes, show side-by-side with stats
//   /mode     — change search strategy (keyword | semantic | hybrid)

type AgentMode = "basic" | "agentic" | "compare";
let currentMode: AgentMode = "agentic";

function formatStats(stats: AgentStats): string[] {
  const lines = [
    "",
    `  📊 Stats [${stats.mode}]:`,
    `     LLM calls: ${stats.llmCalls}`,
    `     Searches:  ${stats.searchCalls}/${stats.searchBudget}${stats.budgetExhausted ? " (budget exhausted)" : ""}`,
  ];
  return lines;
}

async function main() {
  console.log("\n⏳ Building knowledge base index...\n");

  const chunks = chunkDocuments(documents);
  console.log(`  📄 ${documents.length} docs → ${chunks.length} chunks`);

  const embeddedChunks = await embedChunks(chunks);
  console.log(`  ✅ Index ready\n`);

  configure(embeddedChunks, "hybrid", documents);

  const cli = createCLI({
    title: "NexusDB Documentation Research Assistant (Agentic RAG)",
    emoji: "🔬",
    goodbye: "👋 Goodbye!",
    agentLabel: "Assistant",
    welcomeLines: [
      "    Ask any question about NexusDB. Agentic mode iterates to find",
      "    complete answers; basic mode searches once and hopes for the best.",
      "",
      "    Commands:",
      "      /agentic   — agentic RAG: iterative retrieval (default)",
      "      /basic     — basic RAG: single search, then answer",
      "      /compare   — run in BOTH modes side-by-side",
      `      /mode <m>  — search mode: keyword | semantic | hybrid`,
      "",
      `    Mode: agentic | Search: ${getSearchMode()}`,
      "",
      "    Try these questions to see the difference:",
      '      "How do I set up replication and configure automated backups?"',
      '      "My NexusDB is running out of memory and queries are slow"',
      '      "What\'s the complete security setup for a production deployment?"',
    ],
    inputPrompt: () => {
      if (currentMode === "compare") {
        return `[compare | ${getSearchMode()}] You: `;
      }
      const budget = currentMode === "agentic" ? " | budget:5" : "";
      return `[${currentMode}${budget} | ${getSearchMode()}] You: `;
    },

    onCommand(command, _history) {
      const parts = command.trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();

      if (cmd === "/agentic") {
        currentMode = "agentic";
        console.log("  🔬 Agentic RAG — iterative retrieval with search budget");
        return true;
      }

      if (cmd === "/basic") {
        currentMode = "basic";
        console.log("  📋 Basic RAG — single search, then answer");
        return true;
      }

      if (cmd === "/compare") {
        currentMode = "compare";
        console.log("  ⚖️  Compare mode — next question runs in BOTH modes");
        return true;
      }

      if (cmd === "/mode") {
        const mode = parts[1]?.toLowerCase();
        if (mode === "keyword" || mode === "semantic" || mode === "hybrid") {
          setSearchMode(mode as SearchMode);
          console.log(`  🔍 Search mode: ${mode}`);
          return true;
        }
        console.log("  Usage: /mode <keyword|semantic|hybrid>");
        return true;
      }

      return false;
    },

    async onMessage(input, history) {
      if (currentMode === "compare") {
        // Run both modes and show side-by-side
        console.log("\n  ── Basic RAG ────────────────────────────────────");
        const basicResult = await runBasicAgent(input, []);

        console.log("\n  ── Agentic RAG ──────────────────────────────────");
        const agenticResult = await runAgenticAgent(input, []);

        // Find the final text answers
        const basicAnswer = lastAssistantText(basicResult.messages);
        const agenticAnswer = lastAssistantText(agenticResult.messages);

        const stats = [
          "\n" + "─".repeat(50),
          "\n⚖️  Side-by-Side Comparison:",
          "",
          "  📋 BASIC RAG:",
          indent(basicAnswer, "     "),
          ...formatStats(basicResult.stats),
          "",
          "  🔬 AGENTIC RAG:",
          indent(agenticAnswer, "     "),
          ...formatStats(agenticResult.stats),
        ];

        // Return the agentic result as the history continuation
        return { messages: agenticResult.messages, stats };
      }

      const runner = currentMode === "basic" ? runBasicAgent : runAgenticAgent;
      const result = await runner(input, history);
      return { messages: result.messages, stats: formatStats(result.stats) };
    },
  });

  cli.start();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function lastAssistantText(
  messages: { role: string; content: string; tool_calls?: unknown[] }[],
): string {
  const textMessages = messages.filter(
    (m) => m.role === "assistant" && (!m.tool_calls || (m.tool_calls as unknown[]).length === 0),
  );
  return textMessages[textMessages.length - 1]?.content ?? "(no response)";
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

main().catch(console.error);
