import * as readline from "readline";
import { runStatelessAgent } from "./agent.js";
import { WorkerPool } from "./worker-pool.js";
import {
  getOrCreateConversation,
  appendMessages,
  toModelMessages,
  clearStore,
} from "./history-store.js";
import { MODEL } from "../shared/config.js";
import type { Message } from "../shared/types.js";

// ─── Stateless Agent CLI ─────────────────────────────────────────────────────
//
// Demonstrates the stateless agent pattern:
//
//   1. Worker pool of 3 workers — each turn picks a random one
//   2. External JSON store holds the canonical conversation history
//   3. Each turn: load history → pick worker → run fresh agent → save new messages
//   4. Commands: /kill, /revive, /status, /workers to interact with the pool

const THREAD_ID = `thread-${Date.now()}`;
const pool = new WorkerPool(3);

// Start fresh
clearStore();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function printDivider() {
  console.log("\n" + "─".repeat(60));
}

function printWelcome() {
  console.log("\n🍽️  The TypeScript Bistro — Stateless Agent Demo");
  console.log(`    Powered by Ollama + ${MODEL}`);
  console.log("    Worker pool: 3 stateless workers\n");
  console.log("  Commands:");
  console.log('    /kill <n>    — kill worker n (e.g. "/kill 2")');
  console.log('    /revive <n>  — revive worker n (e.g. "/revive 2")');
  console.log("    /workers     — show worker pool status");
  console.log("    exit         — quit\n");
  console.log('  Try: "Show me the menu" → then place an order → /kill a worker → keep going\n');
}

function printWorkerStatus() {
  const status = pool.getStatus();
  console.log("\n  Worker Pool Status:");
  for (const w of status) {
    const icon = w.alive ? "🟢" : "🔴";
    console.log(
      `    ${icon} ${w.name} — ${w.alive ? "alive" : "DEAD"} (${w.turnsServed} turns served)`,
    );
  }
  console.log();
}

function handleCommand(input: string): boolean {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === "/workers" || cmd === "/status") {
    printWorkerStatus();
    return true;
  }

  if (cmd === "/kill") {
    const n = parseInt(parts[1], 10);
    if (isNaN(n) || n < 1 || n > 3) {
      console.log("  Usage: /kill <1|2|3>");
      return true;
    }
    const killed = pool.kill(`worker-${n}`);
    if (killed) {
      console.log(`\n  💀 Worker ${n} killed! (${pool.aliveCount()} workers remaining)`);
      if (pool.aliveCount() === 0) {
        console.log("  ⚠️  All workers are dead! Revive one with /revive <n>");
      } else {
        console.log("  Next turn will seamlessly route to a surviving worker.\n");
      }
    } else {
      console.log(`  Worker ${n} is already dead.`);
    }
    return true;
  }

  if (cmd === "/revive") {
    const n = parseInt(parts[1], 10);
    if (isNaN(n) || n < 1 || n > 3) {
      console.log("  Usage: /revive <1|2|3>");
      return true;
    }
    const revived = pool.revive(`worker-${n}`);
    if (revived) {
      console.log(`\n  ✅ Worker ${n} revived! (${pool.aliveCount()} workers alive)\n`);
    } else {
      console.log(`  Worker ${n} is already alive.`);
    }
    return true;
  }

  return false;
}

async function chat() {
  printDivider();
  process.stdout.write("You: ");

  rl.once("line", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return chat();
    if (trimmed.toLowerCase() === "exit") {
      console.log("\nGoodbye! 🍽️\n");
      rl.close();
      return;
    }

    // Handle commands
    if (trimmed.startsWith("/")) {
      if (!handleCommand(trimmed)) {
        console.log(`  Unknown command: ${trimmed}`);
      }
      return chat();
    }

    try {
      // ── The Stateless Pattern in Action ───────────────────────────────────
      //
      // Step 1: Load full history from external store
      const record = getOrCreateConversation(THREAD_ID);
      const history: Message[] = toModelMessages(record);

      // Step 2: Pick a random worker (no sticky routing)
      const worker = pool.pickRandom();

      // Step 3: Run a FRESH agent session — worker has no memory
      console.log(`\n  📡 Routed to ${worker.name} (re-injecting ${history.length} messages)`);

      const result = await runStatelessAgent(trimmed, history, worker);

      // Step 4: Save new messages to external store
      appendMessages(THREAD_ID, result.newMessages);

      // Display response
      const lastAssistant = [...result.newMessages].reverse().find((m) => m.role === "assistant");

      printDivider();
      if (lastAssistant) {
        console.log(`\nAssistant: ${lastAssistant.content}`);
      }

      // Stats
      console.log(
        `\n  ℹ️  Served by: ${worker.name} | ` +
          `History re-injected: ${result.historySize} msgs | ` +
          `ReAct iterations: ${result.iterations}`,
      );
    } catch (err) {
      const error = err as Error;
      if (error.message?.includes("ECONNREFUSED")) {
        console.error("\n❌ Could not connect to Ollama.");
        console.error("   Make sure Ollama is running: ollama serve");
        console.error(`   And that you have the model pulled: ollama pull ${MODEL}\n`);
        rl.close();
        return;
      }
      if (error.message?.includes("No alive workers")) {
        console.error("\n  ❌ No alive workers! Use /revive <n> to bring one back.\n");
        return chat();
      }
      console.error("\n❌ Error:", error.message);
    }

    chat();
  });
}

printWelcome();
chat();
