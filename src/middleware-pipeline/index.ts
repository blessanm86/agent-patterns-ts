import { runAgentWithMiddleware } from "./agent.js";
import { tools, executeTool } from "./tools.js";
import { createCLI } from "../shared/cli.js";
import { MODEL } from "../shared/config.js";
import { HOTEL_SYSTEM_PROMPT } from "../shared/prompts.js";
import type { Middleware } from "./middleware.js";
import {
  createTokenBudgetMiddleware,
  createToolRetryMiddleware,
  createPIIRedactionMiddleware,
  createModelFallbackMiddleware,
  createLoggingMiddleware,
} from "./middlewares.js";

// ─── Middleware Stacks ───────────────────────────────────────────────────────
//
// Three pre-built configurations that show how middleware ordering matters.

const piiRedaction = createPIIRedactionMiddleware();
const logging = createLoggingMiddleware();
const toolRetry = createToolRetryMiddleware();
const tokenBudget = createTokenBudgetMiddleware(6000);
const modelFallback = createModelFallbackMiddleware(MODEL, "qwen2.5:7b");

// Safe: PII is redacted BEFORE logging sees the data
const SAFE_STACK: Middleware[] = [toolRetry, piiRedaction, logging, tokenBudget, modelFallback];

// Unsafe: logging sees raw PII because it runs BEFORE redaction
const UNSAFE_STACK: Middleware[] = [toolRetry, logging, piiRedaction, tokenBudget, modelFallback];

// Minimal: no middleware — vanilla ReAct loop through the same pipeline runner
const MINIMAL_STACK: Middleware[] = [];

let currentStack = SAFE_STACK;
let currentStackName = "/safe";

function printStack(name: string, stack: Middleware[]) {
  if (stack.length === 0) {
    console.log(`  📋 Middleware stack (${name}): (none — vanilla ReAct)`);
    return;
  }
  console.log(`  📋 Middleware stack (${name}):`);
  for (let i = 0; i < stack.length; i++) {
    console.log(`     ${i + 1}. ${stack[i].name}`);
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function printStats(metadata: Record<string, unknown>): string[] {
  const lines: string[] = [];

  const tokens = metadata.totalTokens as number | undefined;
  const iterations = metadata.iterations as number | undefined;
  const retries = metadata.toolRetries as number | undefined;
  const redactions = metadata.piiRedactions as number | undefined;
  const fallback = metadata.modelFallbackUsed as boolean | undefined;

  const parts: string[] = [];
  if (iterations != null) parts.push(`Steps: ${iterations}`);
  if (tokens != null) parts.push(`Tokens: ${tokens.toLocaleString()}`);
  if (retries != null && retries > 0) parts.push(`Retries: ${retries}`);
  if (redactions != null && redactions > 0) parts.push(`PII redacted: ${redactions}`);
  if (fallback) parts.push("Model fallback: yes");

  if (parts.length > 0) {
    lines.push(`\n  📊 ${parts.join("  |  ")}  |  Stack: ${currentStackName}`);
  }

  return lines;
}

createCLI({
  title: "Middleware Pipeline Demo — The Grand TypeScript Hotel",
  emoji: "🔗",
  goodbye: "Goodbye! 🔗",
  dividerWidth: 60,
  welcomeLines: [
    "🔗  Middleware = composable hooks that wrap the agent loop.",
    "    Order matters! Compare /safe vs /unsafe to see PII leak into logs.",
    "",
    "📋  Commands:",
    "    /safe    → PII redacted BEFORE logging (default)",
    "    /unsafe  → logging sees raw PII (redaction runs after)",
    "    /minimal → no middleware (vanilla ReAct loop)",
    "    /stack   → print current middleware stack",
    "",
    "💡  Try these:",
    '    "Look up John Smith\'s contact info" → triggers PII redaction',
    '    "Book a suite for Alice Johnson from 2026-03-01 to 2026-03-05" → full booking flow',
    "",
  ],
  async onMessage(input, history) {
    const result = await runAgentWithMiddleware(input, history, {
      model: MODEL,
      systemPrompt: HOTEL_SYSTEM_PROMPT,
      tools,
      executeTool,
      middlewares: currentStack,
    });
    return {
      messages: result.messages,
      stats: printStats(result.metadata),
    };
  },
  onCommand(cmd) {
    switch (cmd) {
      case "/safe":
        currentStack = SAFE_STACK;
        currentStackName = "/safe";
        printStack("/safe", SAFE_STACK);
        console.log("  ✅ PII is redacted BEFORE logging — logs are clean");
        return true;

      case "/unsafe":
        currentStack = UNSAFE_STACK;
        currentStackName = "/unsafe";
        printStack("/unsafe", UNSAFE_STACK);
        console.log("  ⚠️  Logging runs BEFORE PII redaction — raw PII appears in logs");
        return true;

      case "/minimal":
        currentStack = MINIMAL_STACK;
        currentStackName = "/minimal";
        printStack("/minimal", MINIMAL_STACK);
        console.log("  📦 No middleware — same pipeline runner, vanilla behavior");
        return true;

      case "/stack":
        printStack(currentStackName, currentStack);
        return true;

      default:
        return false;
    }
  },
}).start();
