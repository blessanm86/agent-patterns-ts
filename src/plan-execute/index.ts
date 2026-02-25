import { runPlanExecuteAgent } from "./agent.js";
import { createCLI } from "../shared/cli.js";

// ─── CLI Chat Loop ────────────────────────────────────────────────────────────
//
// Same structure as src/index.ts — maintains conversation history across turns.
// Each call to runPlanExecuteAgent appends to this history.

createCLI({
  title: "Trip Planner — Plan+Execute Agent",
  emoji: "✈️",
  goodbye: "Safe travels! ✈️",
  welcomeLines: [
    "💡  This agent uses the Plan+Execute pattern:",
    "    1. It creates a full research plan BEFORE calling any tools",
    "    2. Then executes all tool calls mechanically",
    "    3. Finally synthesizes the results into an itinerary",
    "",
    '    Try: "Plan a 3-day trip to Paris from New York, departing 2026-07-10"',
  ],
  async onMessage(input, history) {
    const messages = await runPlanExecuteAgent(input, history);
    return { messages };
  },
}).start();
