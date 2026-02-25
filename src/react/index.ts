import { runAgent } from "./agent.js";
import { createCLI } from "../shared/cli.js";

// ─── CLI Chat Loop ────────────────────────────────────────────────────────────
//
// Maintains conversation history across turns so the agent remembers
// everything said so far. Each call to runAgent appends to this history.

createCLI({
  title: "The Grand TypeScript Hotel — Reservation Agent",
  emoji: "🏨",
  goodbye: "Goodbye! 🏨",
  welcomeLines: [
    "💡  Tool calls will be shown in the console so you can see the ReAct loop in action.",
    "",
    '    Try: "I\'d like to book a double room from 2026-03-01 to 2026-03-05"',
    '    Try: "What rooms do you have available next weekend?"',
    '    Try: "How much does a suite cost for 3 nights?"',
  ],
  async onMessage(input, history) {
    const messages = await runAgent(input, history);
    return { messages };
  },
}).start();
