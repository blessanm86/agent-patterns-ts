import { runAgent } from "./agent.js";
import { createCLI } from "../shared/cli.js";
import { getVirtualFS } from "./tools.js";

// ─── CLI Entry Point ──────────────────────────────────────────────────────────
//
// Shows the current menu state at startup, then runs the agent loop.
// The agent edits the in-memory virtual filesystem — changes persist for the
// duration of the session. Restart to get a fresh menu.

createCLI({
  title: "Bella Italia — Menu Management Agent",
  emoji: "🍝",
  goodbye: "Goodbye! 🍝",
  agentLabel: "Agent",
  welcomeLines: [
    "💡  Tool calls + cascade strategy will be shown in the console.",
    "",
    "    Available file: menu.ts",
    "",
    '    Try: "Change the price of Tiramisu to $9.50"',
    '    Try: "Update the Bruschetta description to mention garlic"',
    '    Try: "Add a new starter: Arancini, $11.00, crispy risotto balls with mozzarella"',
    '    Try: "Remove Calamari Fritti from the menu"',
    "",
    "    Current menu.ts:",
    ...getVirtualFS()
      .get("menu.ts")!
      .split("\n")
      .map((l) => `      ${l}`),
  ],
  async onMessage(input, history) {
    const messages = await runAgent(input, history);
    return { messages };
  },
  onCommand(command) {
    if (command === "/menu") {
      const content = getVirtualFS().get("menu.ts");
      console.log("\n  Current menu.ts:\n");
      for (const line of (content ?? "").split("\n")) {
        console.log(`    ${line}`);
      }
      return true;
    }
    return false;
  },
}).start();
