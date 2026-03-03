// ─── Tool Bundle System — CLI Entry Point ────────────────────────────────────
//
// A CI/CD pipeline assistant serving multiple orgs. Each org has different
// integrations enabled (GitHub, Slack, Jira). Switch orgs with /org <name>
// to see the tool set change dynamically.
//
// Usage:
//   pnpm dev:tool-bundle

import "dotenv/config";
import { createCLI } from "../shared/cli.js";
import { runAgent } from "./agent.js";
import { buildSessionConfig, BUNDLE_REGISTRY, type SessionToolConfig } from "./bundles.js";
import { listOrgs } from "./data.js";

// ─── State ───────────────────────────────────────────────────────────────────

let currentConfig: SessionToolConfig = buildSessionConfig("acme");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function printToolSet(config: SessionToolConfig) {
  console.log(`\n  Organization: ${config.orgName} (${config.orgId})`);
  console.log(`  Active bundles: ${config.activeBundles.join(", ")}`);
  console.log(`  Available tools (${config.tools.length}):`);
  for (const tool of config.tools) {
    console.log(`    - ${tool.function.name}`);
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const cli = createCLI({
  title: "Tool Bundle System",
  emoji: "\uD83D\uDCE6",
  goodbye: "Goodbye!",
  agentLabel: "Assistant",
  inputPrompt: () => `[${currentConfig.orgName}] You: `,
  welcomeLines: [
    `    Active org: ${currentConfig.orgName}`,
    `    Bundles: ${currentConfig.activeBundles.join(", ")} (${currentConfig.tools.length} tools)`,
    "",
    "  Commands:",
    "    /org <name>  — switch organization",
    "    /orgs        — list all organizations",
    "    /bundles     — show all available bundles",
    "    /tools       — show current tool set",
    "    /reset       — clear conversation history",
    "",
    "  Try these prompts:",
    '    - "Create a PR for the auth-fix branch"',
    '    - "List all open bug issues"',
    '    - "Check CI status on main"',
    '    - "Send a message to #deployments"',
    "",
  ],
  onCommand: (command, _history) => {
    const parts = command.split(/\s+/);
    const cmd = parts[0];

    if (cmd === "/org") {
      const orgId = parts[1]?.toLowerCase();
      if (!orgId) {
        console.log("  Usage: /org <name> (acme, globex, initech)");
        return true;
      }
      try {
        currentConfig = buildSessionConfig(orgId);
        printToolSet(currentConfig);
        return { handled: true, newHistory: [] };
      } catch {
        console.log(`  Unknown org: ${orgId}. Try: /orgs`);
        return true;
      }
    }

    if (cmd === "/orgs") {
      console.log("\n  Available organizations:");
      for (const org of listOrgs()) {
        const marker = org.id === currentConfig.orgId ? " (active)" : "";
        console.log(`    - ${org.id}: ${org.name} [${org.enabledBundles.join(", ")}]${marker}`);
      }
      return true;
    }

    if (cmd === "/bundles") {
      console.log("\n  All bundles in registry:");
      for (const [name, bundle] of Object.entries(BUNDLE_REGISTRY)) {
        const active = currentConfig.activeBundles.includes(name) ? " [active]" : "";
        console.log(`    ${name}${active}: ${bundle.description}`);
        for (const tool of bundle.tools) {
          console.log(`      - ${tool.function.name}`);
        }
      }
      return true;
    }

    if (cmd === "/tools") {
      printToolSet(currentConfig);
      return true;
    }

    if (cmd === "/reset") {
      console.log("  Conversation history cleared.");
      return { handled: true, newHistory: [] };
    }

    return false;
  },
  onMessage: async (input, history) => {
    const result = await runAgent(input, history, currentConfig);
    const s = result.stats;

    return {
      messages: result.messages,
      stats: [
        "",
        `  \uD83D\uDCCA Stats: ${s.llmCalls} LLM calls, ${s.toolCalls} tool calls | ${s.orgName} [${s.activeBundles.join("+")}] (${s.availableTools} tools)`,
      ],
    };
  },
});

cli.start();
