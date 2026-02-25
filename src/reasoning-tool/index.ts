import { runAgent } from "./agent.js";
import { createCLI } from "../shared/cli.js";

// ─── CLI Chat Loop ────────────────────────────────────────────────────────────
//
// Maintains conversation history across turns so the agent remembers
// everything said so far. Each call to runAgent appends to this history.

createCLI({
  title: "Refund Decision Agent — Reasoning Tool Pattern",
  emoji: "🔄",
  goodbye: "Goodbye! 🔄",
  welcomeLines: [
    "💡  Think tool calls will be shown so you can see structured reasoning in action.",
    "",
    '    Try: "I want a refund on order ORD-001"',
    '    Try: "Process a refund for ORD-002"',
    '    Try: "Can I get a refund for ORD-004?"',
    "",
  ],
  async onMessage(input, history) {
    const messages = await runAgent(input, history);
    return { messages };
  },
}).start();
