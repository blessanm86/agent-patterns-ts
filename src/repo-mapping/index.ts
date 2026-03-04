// ─── Repository Mapping — CLI Entry Point ───────────────────────────────────
//
// Demonstrates how a structural repo map (AST + PageRank) lets an agent
// navigate a codebase more efficiently than blind exploration.
//
// Two modes:
//   /map    — agent has the repo map in its system prompt (default)
//   /nomap  — agent explores blindly with tools only
//
// After each response, stats are displayed showing tool calls and files read.

import "dotenv/config";
import * as path from "path";
import { fileURLToPath } from "url";
import { createCLI } from "../shared/cli.js";
import { runAgent } from "./agent.js";
import { setProjectRoot } from "./tools.js";
import { generateRepoMap } from "./repo-map.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleProjectDir = path.join(__dirname, "sample-project");

// Generate the repo map on startup
setProjectRoot(sampleProjectDir);
const { map, stats: mapStats } = generateRepoMap({
  rootDir: sampleProjectDir,
  tokenBudget: 1024,
  personalizedFiles: [],
});

let useMap = true;

console.log("\n  Repository Map generated:");
console.log(`    Files: ${mapStats.totalFiles} found, ${mapStats.filesInMap} in map`);
console.log(`    Definitions: ${mapStats.totalDefinitions}`);
console.log(`    References: ${mapStats.totalReferences}`);
console.log(`    Tokens: ~${mapStats.estimatedTokens}`);
console.log("\n  Map preview:");
for (const line of map.split("\n").slice(0, 12)) {
  console.log(`    ${line}`);
}
if (map.split("\n").length > 12) {
  console.log("    ...");
}

createCLI({
  title: "Repository Mapping — Code Navigation Agent",
  emoji: "🗺️",
  goodbye: "Goodbye!",
  welcomeLines: [
    `  Mode: ${useMap ? "/map (repo map enabled)" : "/nomap (blind exploration)"}`,
    "",
    "  Try asking:",
    '    "How does authentication work?"',
    '    "What happens when a user places an order?"',
    '    "How are products and inventory connected?"',
    "",
    "  Commands: /map (enable map), /nomap (disable map), /show (print map)",
  ],
  onCommand(command, _history) {
    if (command === "/map") {
      useMap = true;
      console.log("\n  Repo map ENABLED — agent can see the codebase structure");
      return { handled: true, newHistory: [] };
    }
    if (command === "/nomap") {
      useMap = false;
      console.log("\n  Repo map DISABLED — agent must explore blindly");
      return { handled: true, newHistory: [] };
    }
    if (command === "/show") {
      console.log("\n  Current repo map:\n");
      for (const line of map.split("\n")) {
        console.log(`    ${line}`);
      }
      return true;
    }
    return false;
  },
  async onMessage(input, history) {
    const { messages, stats } = await runAgent(input, history, {
      repoMap: useMap ? map : undefined,
    });

    return {
      messages,
      stats: [
        "",
        `  📊 Stats: ${stats.llmCalls} LLM calls, ${stats.toolCalls} tool calls, ${stats.filesRead} files read`,
        `  Mode: ${useMap ? "repo map" : "blind exploration"}`,
      ],
    };
  },
}).start();
