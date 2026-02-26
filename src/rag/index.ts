import "dotenv/config";
import { documents } from "./knowledge-base.js";
import { chunkDocuments } from "./chunker.js";
import { embedChunks } from "./vector-store.js";
import { configure, setSearchMode, getSearchMode } from "./tools.js";
import { runAgent } from "./agent.js";
import { createCLI } from "../shared/cli.js";
import type { SearchMode } from "./types.js";

// ─── RAG Demo — NexusDB Documentation Assistant ────────────────────────────
//
// Demonstrates Retrieval-Augmented Generation:
//   1. Chunks 12 NexusDB docs into searchable pieces
//   2. Embeds all chunks via Ollama (nomic-embed-text)
//   3. On each question, searches docs and injects results into LLM context
//   4. Toggle RAG on/off to compare grounded vs ungrounded answers

let ragEnabled = true;

async function main() {
  console.log("\n⏳ Building knowledge base index...\n");

  // Chunk documents
  const chunks = chunkDocuments(documents);
  console.log(`  📄 ${documents.length} docs → ${chunks.length} chunks`);

  // Embed all chunks
  const embeddedChunks = await embedChunks(chunks);
  console.log(`  ✅ Index ready\n`);

  // Configure the search module with chunks
  configure(embeddedChunks, "hybrid");

  // Start CLI
  const cli = createCLI({
    title: "NexusDB Documentation Assistant (RAG)",
    emoji: "📚",
    goodbye: "👋 Goodbye!",
    agentLabel: "Assistant",
    welcomeLines: [
      "    Ask any question about NexusDB.",
      "",
      "    Commands:",
      "      /rag        — enable RAG (search docs before answering)",
      "      /norag      — disable RAG (answer from LLM knowledge only)",
      `      /mode <m>   — search mode: keyword | semantic | hybrid`,
      "",
      `    Status: RAG ON | Mode: ${getSearchMode()}`,
    ],
    inputPrompt: () => {
      const status = ragEnabled ? "RAG" : "no-RAG";
      const mode = ragEnabled ? ` | ${getSearchMode()}` : "";
      return `[${status}${mode}] You: `;
    },

    onCommand(command, _history) {
      const parts = command.trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();

      if (cmd === "/rag") {
        ragEnabled = true;
        console.log("  ✅ RAG enabled — will search docs before answering");
        return true;
      }

      if (cmd === "/norag") {
        ragEnabled = false;
        console.log("  ❌ RAG disabled — answering from LLM knowledge only");
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
      const messages = await runAgent(input, history, ragEnabled);
      return { messages };
    },
  });

  cli.start();
}

main().catch(console.error);
