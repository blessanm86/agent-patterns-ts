import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonRpcResponse, ProtocolEvent } from "./types.js";

// ─── CLI Client ──────────────────────────────────────────────────────────────
//
// Spawns the agent-protocol server in stdio mode as a child process, then
// communicates with it over JSONL. Demonstrates that the same server works
// from a terminal client, not just the browser.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, "index.ts");

// ── State ────────────────────────────────────────────────────────────────────

let currentThreadId: string | null = null;
let isProcessing = false;
let rpcId = 0;
const pendingRpc = new Map<
  string | number,
  { resolve: (result: unknown) => void; reject: (err: Error) => void }
>();

// ANSI colors
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const PURPLE = "\x1b[35m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ── Spawn Server ─────────────────────────────────────────────────────────────

const child = spawn("npx", ["tsx", SERVER_ENTRY, "--mode=server-stdio"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env },
  shell: true,
});

// Buffer for JSONL parsing (lines might span chunks)
let buffer = "";

child.stdout!.on("data", (data: Buffer) => {
  buffer += data.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? ""; // keep the incomplete last line

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const msg = JSON.parse(trimmed);
      if (msg.jsonrpc) {
        // JSON-RPC response
        handleRpcResponse(msg as JsonRpcResponse);
      } else if (msg.type) {
        // Protocol event
        handleEvent(msg as ProtocolEvent);
      }
    } catch {
      // Ignore unparseable lines (e.g. server startup messages)
    }
  }
});

child.on("exit", (code) => {
  console.log(`\n${DIM}Server exited with code ${code}${RESET}`);
  process.exit(0);
});

// ── RPC Helper ───────────────────────────────────────────────────────────────

function sendRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++rpcId;
    pendingRpc.set(id, { resolve, reject });
    const request = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    child.stdin!.write(request + "\n");
  });
}

function handleRpcResponse(response: JsonRpcResponse): void {
  const pending = pendingRpc.get(response.id);
  if (!pending) return;
  pendingRpc.delete(response.id);

  if (response.error) {
    pending.reject(new Error(response.error.message));
  } else {
    pending.resolve(response.result);
  }
}

// ── Event Handler ────────────────────────────────────────────────────────────

let streamingLine = false;

function handleEvent(event: ProtocolEvent): void {
  switch (event.type) {
    case "item.started": {
      const item = event.item;
      if (item.type === "agent_message") {
        if (streamingLine) {
          process.stdout.write("\n");
          streamingLine = false;
        }
        process.stdout.write(`\n  ${GREEN}Agent:${RESET} `);
        streamingLine = true;
      } else if (item.type === "tool_execution") {
        if (streamingLine) {
          process.stdout.write("\n");
          streamingLine = false;
        }
        console.log(
          `\n  ${PURPLE}[tool]${RESET} ${item.toolName}(${JSON.stringify(item.toolArgs)})`,
        );
      } else if (item.type === "approval_request") {
        if (streamingLine) {
          process.stdout.write("\n");
          streamingLine = false;
        }
        console.log(`\n  ${RED}${BOLD}APPROVAL REQUIRED${RESET}`);
        console.log(`  ${DIM}Tool:${RESET}   ${item.toolName}`);
        console.log(`  ${DIM}Action:${RESET} ${item.description}`);
        console.log(`  ${DIM}Risk:${RESET}   ${YELLOW}${item.riskLevel}${RESET}`);
        console.log(`  ${DIM}Args:${RESET}   ${JSON.stringify(item.toolArgs)}`);
        promptApproval(item.id);
      }
      break;
    }

    case "item.delta": {
      process.stdout.write(event.delta);
      streamingLine = true;
      break;
    }

    case "item.completed": {
      const item = event.item;
      if (item.type === "agent_message" && streamingLine) {
        process.stdout.write("\n");
        streamingLine = false;
      } else if (item.type === "tool_execution" && item.result) {
        try {
          const parsed = JSON.parse(item.result);
          console.log(`  ${DIM}Result: ${JSON.stringify(parsed).slice(0, 200)}${RESET}`);
        } catch {
          console.log(`  ${DIM}Result: ${item.result.slice(0, 200)}${RESET}`);
        }
        if (item.durationMs !== undefined) {
          console.log(`  ${DIM}(${item.durationMs}ms)${RESET}`);
        }
      }
      break;
    }

    case "turn.completed": {
      if (streamingLine) {
        process.stdout.write("\n");
        streamingLine = false;
      }
      isProcessing = false;
      showPrompt();
      break;
    }

    case "error": {
      if (streamingLine) {
        process.stdout.write("\n");
        streamingLine = false;
      }
      console.log(`\n  ${RED}Error: ${event.message}${RESET}`);
      isProcessing = false;
      showPrompt();
      break;
    }
  }
}

// ── Approval Prompt ──────────────────────────────────────────────────────────

function promptApproval(itemId: string): void {
  process.stdout.write(`\n  ${YELLOW}[y] Approve  [n] Deny:${RESET} `);
  rl.once("line", async (input) => {
    const choice = input.trim().toLowerCase();
    const decision = choice === "y" || choice === "yes" ? "approved" : "denied";

    if (decision === "approved") {
      console.log(`  ${GREEN}Approved${RESET}`);
    } else {
      console.log(`  ${RED}Denied${RESET}`);
    }

    try {
      await sendRpc("turn.approve", { itemId, decision });
    } catch (err) {
      console.log(`  ${RED}Error: ${err instanceof Error ? err.message : "Unknown error"}${RESET}`);
    }
  });
}

// ── CLI Interface ────────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

function showPrompt(): void {
  rl.setPrompt(`${BLUE}you:${RESET} `);
  rl.prompt();
}

function printHelp(): void {
  console.log(`\n  ${BOLD}Commands:${RESET}`);
  console.log(`  ${DIM}/new${RESET}           Create a new thread`);
  console.log(`  ${DIM}/threads${RESET}       List all threads`);
  console.log(`  ${DIM}/resume <id>${RESET}   Switch to an existing thread`);
  console.log(`  ${DIM}/help${RESET}          Show this help`);
  console.log(`  ${DIM}/quit${RESET}          Exit\n`);
}

async function handleCommand(line: string): Promise<void> {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case "/new": {
      const result = (await sendRpc("thread.create", { title: "CLI chat" })) as {
        threadId: string;
      };
      currentThreadId = result.threadId;
      console.log(`\n  ${GREEN}Created thread ${currentThreadId}${RESET}\n`);
      showPrompt();
      break;
    }

    case "/threads": {
      const result = (await sendRpc("thread.list")) as {
        threads: Array<{ id: string; title: string; turnCount: number }>;
      };
      if (result.threads.length === 0) {
        console.log(`\n  ${DIM}No threads yet. Use /new to create one.${RESET}\n`);
      } else {
        console.log(`\n  ${BOLD}Threads:${RESET}`);
        for (const t of result.threads) {
          const marker = t.id === currentThreadId ? ` ${GREEN}<- current${RESET}` : "";
          console.log(`  ${t.id}  ${t.title}  (${t.turnCount} turns)${marker}`);
        }
        console.log();
      }
      showPrompt();
      break;
    }

    case "/resume": {
      const threadId = parts[1];
      if (!threadId) {
        console.log(`\n  ${RED}Usage: /resume <thread-id>${RESET}\n`);
        showPrompt();
        break;
      }
      try {
        await sendRpc("thread.get", { threadId });
        currentThreadId = threadId;
        console.log(`\n  ${GREEN}Resumed thread ${currentThreadId}${RESET}\n`);
      } catch (err) {
        console.log(`\n  ${RED}Error: ${err instanceof Error ? err.message : "Unknown"}${RESET}\n`);
      }
      showPrompt();
      break;
    }

    case "/help":
      printHelp();
      showPrompt();
      break;

    case "/quit":
      child.kill();
      process.exit(0);
      break;

    default:
      console.log(`\n  ${RED}Unknown command: ${cmd}${RESET}`);
      printHelp();
      showPrompt();
  }
}

// ── Main Loop ────────────────────────────────────────────────────────────────

console.log(`\n  ${BOLD}Agent Protocol — CLI Client${RESET}`);
console.log(`  ${DIM}Type /help for commands, /new to start a thread${RESET}\n`);

showPrompt();

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    showPrompt();
    return;
  }

  if (trimmed.startsWith("/")) {
    await handleCommand(trimmed);
    return;
  }

  if (!currentThreadId) {
    console.log(`\n  ${YELLOW}No active thread. Use /new to create one.${RESET}\n`);
    showPrompt();
    return;
  }

  if (isProcessing) {
    console.log(`\n  ${DIM}Agent is still processing...${RESET}\n`);
    showPrompt();
    return;
  }

  isProcessing = true;
  try {
    await sendRpc("turn.submit", { threadId: currentThreadId, message: trimmed });
  } catch (err) {
    console.log(`\n  ${RED}Error: ${err instanceof Error ? err.message : "Unknown error"}${RESET}`);
    isProcessing = false;
    showPrompt();
  }
});

rl.on("close", () => {
  child.kill();
  process.exit(0);
});
