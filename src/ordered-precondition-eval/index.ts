import * as readline from "node:readline";
import { runOrderAgent } from "./agent.js";
import { createSimulationExecutor, createOrderInvestigationRules } from "./simulation.js";
import { extractToolCallNames } from "../react/eval-utils.js";
import type { Message } from "../shared/types.js";

// ─── CLI Demo ────────────────────────────────────────────────────────────────
//
// Runs the order investigation agent with the simulation harness active.
// After each agent turn, prints the simulation report showing which calls
// were valid, which violated preconditions, and the precision/recall scores.

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let history: Message[] = [];

console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║  Ordered Precondition Evaluation — Order Investigation  ║");
console.log("╠══════════════════════════════════════════════════════════╣");
console.log("║  Ask about orders, shipping, or refunds.               ║");
console.log("║  The simulation harness tracks tool call ordering.      ║");
console.log("║  Type 'quit' to exit.                                   ║");
console.log("╚══════════════════════════════════════════════════════════╝");
console.log();

function prompt() {
  rl.question("You: ", async (input) => {
    const trimmed = input.trim();
    if (!trimmed || trimmed.toLowerCase() === "quit") {
      rl.close();
      return;
    }

    // Determine expected tools based on input keywords
    const expectedTools = ["search_orders", "get_order_details"];
    if (/ship|track|deliver/i.test(trimmed)) {
      expectedTools.push("check_shipping_status");
    }
    if (/refund|return|money back/i.test(trimmed)) {
      expectedTools.push("process_refund");
    }

    // Create simulation harness for this turn
    const rules = createOrderInvestigationRules();
    const { executor, getReport } = createSimulationExecutor(rules, expectedTools);

    history = await runOrderAgent(trimmed, history, { executorFn: executor });

    // Print the agent's response
    const lastMsg = history.filter((m) => m.role === "assistant").pop();
    if (lastMsg?.content) {
      console.log(`\nAgent: ${lastMsg.content}`);
    }

    // Print the simulation report
    const report = getReport();
    const toolNames = extractToolCallNames(history);

    console.log("\n┌─ Simulation Report ─────────────────────────────────┐");
    console.log(`│  Tools called: ${toolNames.join(" → ") || "(none)"}`);
    console.log(
      `│  Total: ${report.totalCalls}  Valid: ${report.validCalls}  Invalid: ${report.invalidCalls}`,
    );
    console.log(
      `│  Precision: ${(report.precision * 100).toFixed(0)}%  Recall: ${(report.recall * 100).toFixed(0)}%`,
    );

    if (report.violations.length > 0) {
      console.log("│");
      console.log("│  Violations:");
      for (const v of report.violations) {
        console.log(`│    ${v.tool}: ${v.description}`);
      }
    }

    console.log("└─────────────────────────────────────────────────────┘\n");

    prompt();
  });
}

prompt();
