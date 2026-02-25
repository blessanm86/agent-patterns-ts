import { runRoutedAgent } from "./agent.js";
import type { AgentMode } from "./agent.js";
import { createCLI } from "../shared/cli.js";

// ─── CLI Chat Loop ───────────────────────────────────────────────────────────
//
// Demonstrates multi-agent routing with mode toggling:
// - /routed  — LLM router picks a specialist agent per turn (default)
// - /single  — all 6 tools given to one general agent (baseline)
// - /reset   — clears conversation history

let mode: AgentMode = "routed";

function modeLabel(m: AgentMode): string {
  return m === "routed" ? "routed" : "single";
}

createCLI({
  title: "Travel Assistant — Multi-Agent Routing Demo",
  emoji: "🔀",
  goodbye: "Goodbye! ✈️",
  dividerWidth: 60,
  welcomeLines: [
    `    Current mode: ${modeLabel("routed")}`,
    "",
    "  Commands:",
    "    /routed  — routed mode (default): LLM picks a specialist per turn",
    "    /single  — single mode: one agent with all 6 tools (baseline)",
    "    /reset   — clear conversation history",
    "    exit     — quit",
    "",
    "  Try these prompts:",
    '    "Find flights from New York to Paris"     → flight_agent',
    '    "Hotels in Tokyo for next week"            → hotel_agent',
    '    "Best restaurants in Lisbon"               → activity_agent',
    '    "Hello, help me plan a trip"               → general_agent (low confidence)',
  ],
  inputPrompt: () => `You [${mode}]: `,
  async onMessage(input, history) {
    const result = await runRoutedAgent(input, history, mode);

    const stats: string[] = [];
    if (result.routingDecision) {
      stats.push(
        `\n  📊 Routed to: ${result.profile.name} | Confidence: ${result.routingDecision.confidence.toFixed(2)} | Tools used: ${result.toolCallCount}`,
      );
    } else {
      stats.push(
        `\n  📊 Mode: single | Agent: ${result.profile.name} | Tools used: ${result.toolCallCount}`,
      );
    }

    return {
      messages: result.messages,
      stats,
    };
  },
  onCommand(cmd) {
    switch (cmd) {
      case "/routed":
        mode = "routed";
        console.log("\nMode: routed — LLM router picks a specialist agent per turn");
        return true;
      case "/single":
        mode = "single";
        console.log("\nMode: single — one general agent with all 6 tools");
        return true;
      case "/reset":
        console.log("\n✅ Conversation cleared.");
        return { handled: true, newHistory: [] };
      default:
        return false;
    }
  },
}).start();
