import { runAgent } from "./agent.js";
import { createCLI } from "../shared/cli.js";

// ─── CLI Chat Loop — Working Version ─────────────────────────────────────────
//
// The history array lives inside createCLI and grows across every turn.
// Each call to runAgent receives the full history and returns an updated copy.
// This is the CORRECT way to maintain conversation memory.

createCLI({
  title: "Recipe Assistant — with memory",
  emoji: " ",
  goodbye: "Goodbye!",
  agentLabel: "Assistant",
  welcomeLines: [
    "  Try this sequence to see memory in action:",
    "    1. \"I'm allergic to nuts. What's a good snack?\"",
    '    2. "What about something chocolatey?"',
    '    3. "What am I allergic to?"',
  ],
  async onMessage(input, history) {
    const messages = await runAgent(input, history);
    return { messages };
  },
}).start();
