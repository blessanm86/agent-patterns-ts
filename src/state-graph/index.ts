import { runGraphAgent } from "./agent.js";
import { createCLI } from "../shared/cli.js";

// ─── CLI Chat Loop ────────────────────────────────────────────────────────────

createCLI({
  title: "State Graph Demo — The Grand TypeScript Hotel",
  emoji: "🏨",
  goodbye: "Goodbye! 🏨",
  dividerWidth: 60,
  welcomeLines: [
    "💡  Same hotel agent, now running as a state graph.",
    "    Watch the [graph] → logs to see node transitions.",
    "",
    '    Try: "I\'d like to book a double room from 2026-03-01 to 2026-03-05"',
    '    Try: "What rooms do you have available next weekend?"',
    '    Try: "How much does a suite cost for 3 nights?"',
  ],
  async onMessage(input, history) {
    const result = await runGraphAgent(input, history);
    return {
      messages: result.messages,
      stats: [
        `\n  📊 Trace: ${result.nodeTrace.join(" -> ")}`,
        `     Iterations: ${result.iterations}`,
      ],
    };
  },
}).start();
