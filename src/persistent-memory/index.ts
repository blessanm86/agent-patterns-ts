import "dotenv/config";
import * as path from "path";
import { createCLI } from "../shared/cli.js";
import { runAgent, type AgentMode } from "./agent.js";
import { PersistentMemoryStore } from "./memory-store.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const mode: AgentMode = process.argv.includes("--no-memory") ? "no-memory" : "with-memory";
const MEMORY_FILE = path.resolve("memory/restaurant-assistant.json");
const memoryStore = mode === "with-memory" ? new PersistentMemoryStore(MEMORY_FILE) : undefined;

// ─── CLI ────────────────────────────────────────────────────────────────────

const cli = createCLI({
  title: `Persistent Memory — Restaurant Assistant (${mode})`,
  emoji: "🧠",
  goodbye: "Goodbye! Your memories are saved for next time.",
  agentLabel: "Assistant",
  welcomeLines:
    mode === "with-memory"
      ? [
          `    Mode: 🧠 With Memory (memories persist across sessions)`,
          `    Session: ${memoryStore!.currentSession} | Stored facts: ${memoryStore!.factCount}`,
          "",
          "  Commands:",
          "    /memories    — show all stored facts with scores",
          "    /forget <x>  — remove memories matching <x>",
          "    /new-session — start a new session (keeps memories, clears chat)",
          "    /clear-all   — delete all memories",
          "    /stats       — show memory counts by category",
          "",
          "  Try this 3-session walkthrough:",
          '    1. "I\'m vegetarian and live near Midtown"',
          "    2. /new-session",
          '    3. "I also love Thai food"',
          "    4. /new-session",
          '    5. "What do you recommend?" — watch the agent use all 3 facts',
          "",
        ]
      : [
          `    Mode: ⚡ No Memory (standard agent, forgets between sessions)`,
          "",
          '  Try: "I\'m vegetarian and live near Midtown"',
          '  Then: "What do you recommend?" — agent has no memory of preferences',
          "",
        ],

  onMessage: async (input, history) => {
    const result = await runAgent(input, history, mode, memoryStore);
    const s = result.stats;

    const statsLines: string[] = [
      "",
      `  📊 Stats: ${s.llmCalls} LLM calls, ${s.toolCalls} tool calls [${s.mode}]`,
    ];

    if (mode === "with-memory") {
      const memParts: string[] = [];
      if (s.memoriesInjected > 0) memParts.push(`${s.memoriesInjected} injected`);
      if (s.memoriesExtracted > 0) memParts.push(`${s.memoriesExtracted} extracted`);
      if (s.memoriesForgotten > 0) memParts.push(`${s.memoriesForgotten} forgotten`);
      if (s.privacyBlocked > 0) memParts.push(`${s.privacyBlocked} blocked (PII)`);
      if (memParts.length > 0) {
        statsLines.push(`  🧠 Memory: ${memParts.join(", ")}`);
      }
    }

    return { messages: result.messages, stats: statsLines };
  },

  onCommand: (command, _history) => {
    if (mode === "no-memory") {
      console.log("  Memory commands are not available in no-memory mode.");
      return true;
    }

    const store = memoryStore!;

    if (command === "/memories") {
      console.log("\n  🧠 Stored Memories:");
      for (const line of store.toDisplayLines()) {
        console.log(line);
      }
      return true;
    }

    if (command.startsWith("/forget ")) {
      const text = command.slice("/forget ".length).trim();
      if (!text) {
        console.log("  Usage: /forget <text>");
        return true;
      }
      const removed = store.forgetByContent(text);
      if (removed.length === 0) {
        console.log(`  No memories matching "${text}" found.`);
      } else {
        for (const fact of removed) {
          console.log(`  🗑️  Forgot: "${fact.content}"`);
        }
      }
      return true;
    }

    if (command === "/new-session") {
      const newSession = store.nextSession();
      console.log(`\n  🔄 Started session ${newSession} (chat history cleared, memories kept)`);
      console.log(`     ${store.factCount} memories available`);
      return { handled: true, newHistory: [] };
    }

    if (command === "/clear-all") {
      const count = store.clearAll();
      console.log(`\n  🗑️  Cleared ${count} memories. Starting fresh.`);
      return { handled: true, newHistory: [] };
    }

    if (command === "/stats") {
      const catStats = store.getCategoryStats();
      console.log(`\n  📊 Memory Stats (session ${store.currentSession}):`);
      console.log(`     Total facts: ${store.factCount}`);
      for (const [cat, count] of Object.entries(catStats)) {
        console.log(`     ${cat}: ${count}`);
      }
      return true;
    }

    return false;
  },
});

cli.start();
