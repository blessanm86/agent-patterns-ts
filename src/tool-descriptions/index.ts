import { runAgent } from "./agent.js";
import { weakTools, strongTools } from "./tools.js";
import { createCLI } from "../shared/cli.js";

// ─── Mode Selection ───────────────────────────────────────────────────────────
//
// Pass --weak to run with minimal tool descriptions and see where the model
// goes wrong. The default (no flag) runs with engineered descriptions.

const useWeak = process.argv.includes("--weak");
const tools = useWeak ? weakTools : strongTools;
const modeName = useWeak ? "WEAK descriptions" : "STRONG descriptions";

// ─── CLI Chat Loop ────────────────────────────────────────────────────────────

const welcomeLines: string[] = [`    Mode: ${modeName}`, ""];

if (useWeak) {
  welcomeLines.push(
    "⚠️   Running with WEAK tool descriptions.",
    "    Watch for: wrong parameter formats, skipped steps, over-escalation.",
    "",
  );
} else {
  welcomeLines.push(
    "✅  Running with STRONG tool descriptions.",
    "    Compare with: pnpm dev:tool-descriptions:weak",
    "",
  );
}

welcomeLines.push(
  "💡  Try these prompts to expose description quality differences:",
  '    "I want a refund for customer John Smith on order ORD-001"',
  "       → Weak: passes a name instead of an email",
  '    "Give me a refund on ORD-001" (no lookup first)',
  "       → Weak: may skip get_order_details and jump to issue_refund",
  '    "I already got a refund but I want another one for ORD-002"',
  "       → Weak: may attempt to refund an already-refunded order",
  '    "I just have a quick question about my order status"',
  "       → Weak: may unnecessarily escalate_to_human",
  "",
);

createCLI({
  title: "Customer Support Agent — Tool Description Engineering",
  emoji: "📋",
  goodbye: "Goodbye! 📋",
  welcomeLines,
  async onMessage(input, history) {
    const messages = await runAgent(input, history, tools);
    return { messages };
  },
}).start();
