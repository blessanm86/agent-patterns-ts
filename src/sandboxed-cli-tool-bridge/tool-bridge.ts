// ─── Tool Bridge (Host Side) ─────────────────────────────────────────────────
//
// The ToolBridge is the host-side coordinator. It:
//   1. Spawns the sandbox-runner as a child process via child_process.spawn()
//   2. Sends shell commands to the sandbox over stdin
//   3. Receives JSON-RPC requests from the sandbox over stdout
//   4. Routes them to the ToolRegistry (list/describe/invoke)
//   5. Enforces describe-before-invoke and token validation
//   6. Sends JSON-RPC responses back to the sandbox
//   7. Returns the formatted shell result to the agent

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ToolRegistry } from "./tools.js";
import {
  JSON_RPC_ERRORS,
  type BridgeSession,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type SandboxToHostMessage,
  type HostToSandboxMessage,
} from "./types.js";

export class ToolBridge {
  private sandbox: ChildProcess | null = null;
  private session: BridgeSession;
  private registry: ToolRegistry;
  private commandTimeout: number;

  // Pending shell commands awaiting results from the sandbox
  private pendingCommands = new Map<
    string,
    {
      resolve: (output: string) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  // Buffer for partial stdout lines
  private outputBuffer = "";

  constructor(registry: ToolRegistry, options?: { commandTimeout?: number }) {
    this.registry = registry;
    this.commandTimeout = options?.commandTimeout ?? 10_000;
    this.session = {
      token: randomUUID(),
      describedTools: new Set(),
      createdAt: Date.now(),
    };
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Spawn sandbox-runner.ts as a child process with raw stdin/stdout
      this.sandbox = spawn(
        "node",
        ["--import", "tsx/esm", new URL("./sandbox-runner.ts", import.meta.url).pathname],
        {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        },
      );

      // Handle stderr (for debugging)
      this.sandbox.stderr?.setEncoding("utf-8");
      this.sandbox.stderr?.on("data", (data: string) => {
        // Sandbox errors go to debug output
        if (process.env.DEBUG) {
          process.stderr.write(`[sandbox stderr] ${data}`);
        }
      });

      this.sandbox.on("error", (err) => {
        reject(new Error(`Failed to spawn sandbox: ${err.message}`));
      });

      this.sandbox.on("exit", (code) => {
        // Reject all pending commands
        for (const [id, pending] of this.pendingCommands) {
          clearTimeout(pending.timer);
          pending.resolve(`Sandbox exited unexpectedly (code ${code})`);
          this.pendingCommands.delete(id);
        }
        this.sandbox = null;
      });

      // Listen for stdout messages
      this.sandbox.stdout?.setEncoding("utf-8");
      this.sandbox.stdout?.on("data", (chunk: string) => {
        this.outputBuffer += chunk;
        const lines = this.outputBuffer.split("\n");
        this.outputBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line) as SandboxToHostMessage;
            this.handleSandboxMessage(message, resolve);
          } catch {
            // Ignore malformed JSON
          }
        }
      });

      // Timeout for startup
      setTimeout(() => {
        reject(new Error("Sandbox did not send ready signal within 5 seconds"));
      }, 5_000);
    });
  }

  shutdown(): void {
    if (this.sandbox) {
      this.sandbox.kill("SIGTERM");
      this.sandbox = null;
    }
    for (const [, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
    }
    this.pendingCommands.clear();
  }

  // ─── Execute Shell Command ─────────────────────────────────────────────

  async executeShell(command: string): Promise<string> {
    if (!this.sandbox) {
      throw new Error("Sandbox not started");
    }

    const id = randomUUID();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id);
        resolve("Error: Command timed out");
      }, this.commandTimeout);

      this.pendingCommands.set(id, { resolve, timer });

      this.sendToSandbox({
        type: "shell_command",
        id,
        command,
        token: this.session.token,
      });
    });
  }

  // ─── Session Info ──────────────────────────────────────────────────────

  getSessionInfo(): { token: string; describedTools: string[]; uptime: number } {
    return {
      token: `${this.session.token.slice(0, 8)}…`,
      describedTools: [...this.session.describedTools],
      uptime: Date.now() - this.session.createdAt,
    };
  }

  resetSession(): void {
    this.session = {
      token: randomUUID(),
      describedTools: new Set(),
      createdAt: Date.now(),
    };
  }

  // ─── Private: Message Routing ──────────────────────────────────────────

  private handleSandboxMessage(
    message: SandboxToHostMessage,
    onReady?: (value: void) => void,
  ): void {
    if (message.type === "ready") {
      onReady?.();
      return;
    }

    if (message.type === "shell_result") {
      const pending = this.pendingCommands.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCommands.delete(message.id);
        pending.resolve(message.output);
      }
      return;
    }

    if (message.type === "jsonrpc_request") {
      this.handleJsonRpcRequest(message.id, message.request);
    }
  }

  // ─── Private: JSON-RPC Router ──────────────────────────────────────────

  private handleJsonRpcRequest(shellCommandId: string, request: JsonRpcRequest): void {
    const response = this.routeJsonRpc(request);

    this.sendToSandbox({
      type: "jsonrpc_response",
      id: request.id,
      response,
    });
  }

  private routeJsonRpc(request: JsonRpcRequest): JsonRpcResponse {
    const { method, params, id } = request;
    const token = params.token as string | undefined;

    // Token validation for invoke
    if (method === "tools.invoke" && token !== this.session.token) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: JSON_RPC_ERRORS.AUTH_FAILED,
          message: "Invalid session token",
        },
      };
    }

    switch (method) {
      case "tools.list":
        return {
          jsonrpc: "2.0",
          id,
          result: this.registry.list(),
        };

      case "tools.describe": {
        const name = params.name as string;
        const tool = this.registry.describe(name);
        if (!tool) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
              message: `Unknown tool: ${name}`,
            },
          };
        }
        // Track that this tool has been described in this session
        this.session.describedTools.add(name);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            fullName: tool.fullName,
            description: tool.description,
            parameters: tool.parameters,
            required: tool.required,
          },
        };
      }

      case "tools.invoke": {
        const name = params.name as string;
        const args = (params.args ?? {}) as Record<string, string>;

        // Describe-before-invoke enforcement
        if (!this.session.describedTools.has(name)) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: JSON_RPC_ERRORS.DESCRIBE_REQUIRED,
              message: `You must call "tools describe ${name}" before invoking it. This ensures you know the correct parameters.`,
            },
          };
        }

        if (!this.registry.has(name)) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
              message: `Unknown tool: ${name}`,
            },
          };
        }

        try {
          const result = this.registry.invoke(name, args);
          return { jsonrpc: "2.0", id, result };
        } catch (err) {
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: JSON_RPC_ERRORS.INTERNAL_ERROR,
              message: (err as Error).message,
            },
          };
        }
      }

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
            message: `Unknown method: ${method}`,
          },
        };
    }
  }

  // ─── Private: Send to Sandbox ──────────────────────────────────────────

  private sendToSandbox(message: HostToSandboxMessage): void {
    if (this.sandbox?.stdin?.writable) {
      this.sandbox.stdin.write(JSON.stringify(message) + "\n");
    }
  }
}
