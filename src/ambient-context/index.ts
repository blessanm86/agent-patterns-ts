import * as path from "path";
import { createCLI } from "../shared/cli.js";
import { createContextStore } from "./context-store.js";
import { PAGES, navigateTo, type NavigationState } from "./pages.js";
import { runAgent } from "./agent.js";

// ─── State ───────────────────────────────────────────────────────────────────

const store = createContextStore();
const PERSIST_PATH = path.join(process.cwd(), ".ambient-contexts.json");

// Start on the catalog page
const nav: NavigationState = {
  currentPage: PAGES.catalog,
  currentArgs: undefined,
};

// Register initial page contexts
nav.currentPage.register(store);

// ─── CLI ─────────────────────────────────────────────────────────────────────

const cli = createCLI({
  title: "E-Commerce Shopping Assistant — Ambient Context Store",
  emoji: "🛍️",
  goodbye: "Thanks for shopping! Your contexts have been cleared.",
  agentLabel: "Assistant",
  welcomeLines: [
    "  Navigate between pages to see ambient context in action.",
    "  Each page auto-registers context that the agent can see.\n",
    "  Commands:",
    "    /catalog             Browse all products",
    "    /product <id>        View product details (e.g. /product P001)",
    "    /cart                View shopping cart",
    "    /orders              View order history",
    "    /account             View account settings",
    "    /contexts            Show all active contexts",
    "    /toggle <id>         Toggle context inclusion (e.g. /toggle cart:current)",
    "    /save                Persist contexts to file",
    "    /restore             Restore contexts from file\n",
    nav.currentPage.display(),
  ],

  inputPrompt: () => {
    const stats = store.getStats();
    const page = nav.currentPage.name;
    return `\n[${page}] (${stats.active} contexts) You: `;
  },

  async onMessage(input, history) {
    const result = await runAgent(input, history, store);
    const { active, excluded, serializedLength } = result.contextStats;

    return {
      messages: result.messages,
      stats: [
        `\n  📊 Ambient: ${active} active, ${excluded} excluded, ${serializedLength} chars injected`,
      ],
    };
  },

  onCommand(command, _history) {
    const parts = command.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ");

    // ── Navigation Commands ────────────────────────────────────────────────

    if (cmd === "/catalog") {
      navigateTo(nav, store, "catalog");
      console.log(nav.currentPage.display());
      return true;
    }

    if (cmd === "/product") {
      if (!arg) {
        console.log("  Usage: /product <id>  (e.g. /product P001)");
        return true;
      }
      const ok = navigateTo(nav, store, "product", arg.toUpperCase());
      if (ok) {
        console.log(nav.currentPage.display(nav.currentArgs));
      } else {
        console.log(`  Unknown page: product`);
      }
      return true;
    }

    if (cmd === "/cart") {
      navigateTo(nav, store, "cart");
      console.log(nav.currentPage.display());
      return true;
    }

    if (cmd === "/orders") {
      navigateTo(nav, store, "orders");
      console.log(nav.currentPage.display());
      return true;
    }

    if (cmd === "/account") {
      navigateTo(nav, store, "account");
      console.log(nav.currentPage.display());
      return true;
    }

    // ── Context Management Commands ────────────────────────────────────────

    if (cmd === "/contexts") {
      const chips = store.getDisplayChips();
      const stats = store.getStats();
      console.log("\n  Active Contexts:");
      for (const chip of chips) {
        console.log(chip);
      }
      console.log(
        `\n  Total: ${stats.total} | Active: ${stats.active} | Excluded: ${stats.excluded} | Temporary: ${stats.temporary}`,
      );

      const serialized = store.serialize();
      if (serialized) {
        console.log("\n  Serialized (injected into system prompt):");
        for (const line of serialized.split("\n")) {
          console.log(`  ${line}`);
        }
      }
      return true;
    }

    if (cmd === "/toggle") {
      if (!arg) {
        console.log("  Usage: /toggle <context-id>  (e.g. /toggle cart:current)");
        return true;
      }
      // Try to find the context — check if it's currently excluded or included
      const all = store.getAll();
      const ctx = all.find((c) => c.id === arg);
      if (!ctx) {
        console.log(`  Context not found: ${arg}`);
        console.log("  Use /contexts to see all active contexts");
        return true;
      }
      if (ctx.excluded) {
        store.include(arg);
        console.log(`  ✅ Included: ${arg} (now visible to agent)`);
      } else {
        store.exclude(arg);
        console.log(`  ❌ Excluded: ${arg} (hidden from agent)`);
      }
      return true;
    }

    if (cmd === "/save") {
      store.persist(PERSIST_PATH);
      console.log(`  💾 Contexts saved to ${PERSIST_PATH}`);
      return true;
    }

    if (cmd === "/restore") {
      const count = store.restore(PERSIST_PATH);
      if (count === 0) {
        console.log("  No contexts to restore (file missing or already loaded)");
      } else {
        console.log(`  📂 Restored ${count} contexts (marked as temporary)`);
        console.log("  Navigate to reclaim them, or they'll be cleared on next navigation");
      }
      return true;
    }

    return false;
  },
});

cli.start();
