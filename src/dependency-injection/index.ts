import "dotenv/config";
import { createCLI } from "../shared/cli.js";
import { runAgent } from "./agent.js";
import {
  createRunContext,
  createMockDatabase,
  createConsoleLogger,
  type Deps,
  type UserInfo,
} from "./context.js";

// ─── User Profiles ──────────────────────────────────────────────────────────
//
// Three different users demonstrate DI in action:
// same agent code, different injected dependencies → different behavior.

const USERS: Record<string, UserInfo> = {
  alice: { id: "user-alice", name: "Alice Chen", tier: "standard" },
  bob: { id: "user-bob", name: "Bob Martinez", tier: "vip" },
};

// ─── Select User ────────────────────────────────────────────────────────────

const userArg = process.argv.find((a) => a.startsWith("--user="))?.split("=")[1] ?? "alice";
const selectedUser = USERS[userArg] ?? USERS.alice;

// ─── Create Dependencies ────────────────────────────────────────────────────
//
// The run boundary: dependencies are assembled here, once, and passed to
// createRunContext(). From here on, every tool call receives them automatically.

const deps: Deps = {
  db: createMockDatabase(),
  user: selectedUser,
  logger: createConsoleLogger(selectedUser.name),
};

const ctx = createRunContext(deps);

// ─── CLI ────────────────────────────────────────────────────────────────────

const cli = createCLI({
  title: `Dependency Injection -- Order Support (${selectedUser.name}, ${selectedUser.tier})`,
  emoji: "\uD83D\uDC89",
  goodbye: "Thanks for contacting TechGear support!",
  agentLabel: "Support",
  welcomeLines: [
    `    User: ${selectedUser.name} (${selectedUser.tier} tier)`,
    `    Run ID: ${ctx.runId}`,
    "",
    "  The same agent code runs for every user. Only the injected",
    "  dependencies change -- the LLM never sees the DB or logger.",
    "",
    "  Try these prompts:",
    '    "Show me my recent orders"',
    '    "Look up order ORD-1001"',
    '    "I want a refund on ORD-1001"',
    '    "How many loyalty points do I have?"',
    "",
    "  Switch users to see different behavior:",
    "    pnpm dev:dependency-injection --user=alice  (standard tier, 3 orders)",
    "    pnpm dev:dependency-injection --user=bob    (vip tier, 2 orders)",
    "",
  ],
  onMessage: async (input, history) => {
    const messages = await runAgent(input, history, ctx);

    return {
      messages,
      stats: [`  Tool calls this session: ${ctx.toolCallCount} | Run ID: ${ctx.runId}`],
    };
  },
});

cli.start();
