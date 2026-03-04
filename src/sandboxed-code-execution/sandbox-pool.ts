// ─── Sandbox Pool ─────────────────────────────────────────────────────────────
//
// Manages a pre-warmed pool of sandbox processes with:
//   - O(1) acquire from the pool (no cold-start on user request)
//   - Conversation affinity (same sandbox reused for same conversation)
//   - Token-scoped credential proxy (tokens issued on acquire, revoked on release)
//   - Dead worker eviction with exponential backoff on replenishment
//   - Health checks via heartbeat freshness
//
// The pool uses a SandboxProvider abstraction so the same code works with
// child processes (demo), Firecracker VMs, or Kubernetes pods (production).

import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { TokenProxy } from "./token-proxy.js";
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxInfo,
  SandboxStatus,
  PoolConfig,
  WorkerMessage,
  WorkerResultMessage,
  WorkerToolRequestMessage,
} from "./types.js";
import { DEFAULT_POOL_CONFIG } from "./types.js";

// ─── Node.js Child Process Provider ──────────────────────────────────────────
//
// Demo provider that uses child_process.fork(). In production you'd swap this
// for a Firecracker, gVisor, or Docker provider — same interface.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKER_PATH = join(__dirname, "sandbox-worker.ts");

export class NodeChildProcessProvider implements SandboxProvider {
  async spawn(): Promise<SandboxHandle> {
    const child: ChildProcess = fork(WORKER_PATH, [], {
      execArgv: ["--import", "tsx"],
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    return {
      get pid() {
        return child.pid;
      },
      send(message) {
        child.send(message);
      },
      onMessage(handler) {
        child.on("message", handler);
      },
      onExit(handler) {
        child.on("exit", handler);
      },
      kill() {
        child.kill("SIGKILL");
      },
    };
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    handle.kill();
  }
}

// ─── Internal Sandbox Entry ──────────────────────────────────────────────────

interface SandboxEntry {
  id: string;
  status: SandboxStatus;
  handle: SandboxHandle;
  conversationId: string | undefined;
  token: string | undefined;
  createdAt: number;
  lastUsedAt: number;
  lastHeartbeat: number;
  executionCount: number;
}

// ─── Pool Status ──────────────────────────────────────────────────────────────

export interface PoolStatus {
  total: number;
  idle: number;
  busy: number;
  dead: number;
  booting: number;
  affinityBindings: number;
  activeTokens: number;
}

// ─── Sandbox Pool ─────────────────────────────────────────────────────────────

export class SandboxPool {
  private sandboxes = new Map<string, SandboxEntry>();
  private affinityMap = new Map<string, string>(); // conversationId → sandboxId
  private config: PoolConfig;
  private provider: SandboxProvider;
  private tokenProxy: TokenProxy;
  private healthCheckTimer: ReturnType<typeof setInterval> | undefined;
  private backoffMs = 1_000;

  // Callback for handling tool requests from sandbox code
  private toolHandler:
    | ((name: string, args: Record<string, string>) => Promise<string>)
    | undefined;

  constructor(provider: SandboxProvider, tokenProxy: TokenProxy, config: Partial<PoolConfig> = {}) {
    this.provider = provider;
    this.tokenProxy = tokenProxy;
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
  }

  /** Register a handler for tool calls originating from sandbox code. */
  setToolHandler(handler: (name: string, args: Record<string, string>) => Promise<string>): void {
    this.toolHandler = handler;
  }

  /** Pre-warm the pool — spawn N sandboxes in parallel, wait for all ready. */
  async initialize(): Promise<void> {
    console.log(`\n  [Pool] Pre-warming ${this.config.poolSize} sandboxes...`);
    const start = Date.now();

    const promises = Array.from({ length: this.config.poolSize }, () => this.spawnSandbox());
    await Promise.all(promises);

    console.log(`  [Pool] All ${this.config.poolSize} sandboxes ready (${Date.now() - start}ms)`);
    this.startHealthCheck();
  }

  /** Acquire a sandbox for a conversation. Uses affinity if available. */
  acquire(conversationId: string): SandboxInfo {
    // Check affinity — reuse the same sandbox for the same conversation
    const affinityId = this.affinityMap.get(conversationId);
    if (affinityId) {
      const entry = this.sandboxes.get(affinityId);
      if (entry && entry.status === "idle") {
        entry.status = "busy";
        entry.lastUsedAt = Date.now();
        entry.token = this.tokenProxy.issueToken(entry.id);
        console.log(
          `  [Pool] Affinity hit — reusing sandbox ${entry.id.slice(0, 8)}… for conversation ${conversationId.slice(0, 8)}…`,
        );
        return this.toInfo(entry);
      }
    }

    // No affinity or affinity sandbox is gone — pick first idle
    for (const entry of this.sandboxes.values()) {
      if (entry.status === "idle") {
        entry.status = "busy";
        entry.lastUsedAt = Date.now();
        entry.conversationId = conversationId;
        entry.token = this.tokenProxy.issueToken(entry.id);
        this.affinityMap.set(conversationId, entry.id);
        console.log(
          `  [Pool] New binding — sandbox ${entry.id.slice(0, 8)}… ↔ conversation ${conversationId.slice(0, 8)}…`,
        );
        return this.toInfo(entry);
      }
    }

    throw new Error("No idle sandboxes available — pool exhausted");
  }

  /** Release a sandbox back to the pool. Revokes its token but keeps affinity. */
  release(sandboxId: string): void {
    const entry = this.sandboxes.get(sandboxId);
    if (!entry) return;

    if (entry.token) {
      this.tokenProxy.revokeToken(entry.token);
      entry.token = undefined;
    }
    entry.status = "idle";
    console.log(`  [Pool] Released sandbox ${sandboxId.slice(0, 8)}… back to pool`);
  }

  /** Execute code in a sandbox. Bridges tool requests from sandbox → orchestrator. */
  async execute(
    sandboxId: string,
    code: string,
  ): Promise<{ success: boolean; output: string; error?: string; durationMs: number }> {
    const entry = this.sandboxes.get(sandboxId);
    if (!entry) throw new Error(`Sandbox ${sandboxId} not found`);

    const execId = randomUUID();

    return new Promise((resolve) => {
      const onMessage = async (msg: WorkerMessage) => {
        if (msg.type === "result" && (msg as WorkerResultMessage).id === execId) {
          entry.executionCount++;
          const result = msg as WorkerResultMessage;
          resolve({
            success: result.success,
            output: result.output,
            error: result.error,
            durationMs: result.durationMs,
          });
          return;
        }

        // Bridge: sandbox code requested a tool call
        if (msg.type === "tool_request") {
          const req = msg as WorkerToolRequestMessage;

          // Validate token
          const validation = this.tokenProxy.validateToken(req.token);
          if (!validation.valid) {
            entry.handle.send({
              type: "tool_result",
              id: req.id,
              result: JSON.stringify({ error: "Token invalid or expired" }),
            });
            return;
          }

          // Execute tool via registered handler
          if (this.toolHandler) {
            const result = await this.toolHandler(req.name, req.args);
            entry.handle.send({
              type: "tool_result",
              id: req.id,
              result,
            });
          }
        }
      };

      entry.handle.onMessage(onMessage);

      // Send execute command to worker
      entry.handle.send({
        type: "execute",
        id: execId,
        code,
        timeout: this.config.executionTimeoutMs,
        token: entry.token ?? "",
      });
    });
  }

  /** Deliberately kill a sandbox — for demo purposes (simulates crash). */
  killSandbox(sandboxId: string): void {
    const entry = this.sandboxes.get(sandboxId);
    if (!entry) return;
    console.log(`  [Pool] Deliberately killing sandbox ${sandboxId.slice(0, 8)}…`);
    entry.handle.kill();
  }

  /** Get the sandbox ID currently bound to a conversation. */
  getAffinitySandbox(conversationId: string): string | undefined {
    return this.affinityMap.get(conversationId);
  }

  /** Pool status snapshot for introspection. */
  getStatus(): PoolStatus {
    let idle = 0;
    let busy = 0;
    let dead = 0;
    let booting = 0;
    for (const entry of this.sandboxes.values()) {
      if (entry.status === "idle") idle++;
      else if (entry.status === "busy") busy++;
      else if (entry.status === "dead") dead++;
      else if (entry.status === "booting") booting++;
    }

    return {
      total: this.sandboxes.size,
      idle,
      busy,
      dead,
      booting,
      affinityBindings: this.affinityMap.size,
      activeTokens: this.tokenProxy.getActiveCount(),
    };
  }

  /** Graceful shutdown — kill all sandboxes, clear state. */
  async shutdown(): Promise<void> {
    console.log("\n  [Pool] Shutting down...");
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);

    for (const entry of this.sandboxes.values()) {
      if (entry.status !== "dead") {
        try {
          await this.provider.destroy(entry.handle);
        } catch {
          // Already dead
        }
      }
    }
    this.sandboxes.clear();
    this.affinityMap.clear();
    console.log("  [Pool] Shutdown complete");
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async spawnSandbox(): Promise<SandboxEntry> {
    const id = randomUUID();
    const handle = await this.provider.spawn();

    const entry: SandboxEntry = {
      id,
      status: "booting",
      handle,
      conversationId: undefined,
      token: undefined,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      lastHeartbeat: Date.now(),
      executionCount: 0,
    };

    this.sandboxes.set(id, entry);

    // Wait for the "ready" signal from the worker
    await new Promise<void>((resolve) => {
      handle.onMessage((msg: WorkerMessage) => {
        if (msg.type === "ready") {
          entry.status = "idle";
          console.log(`  [Pool] Sandbox ${id.slice(0, 8)}… ready (pid ${handle.pid})`);
          resolve();
        }
        if (msg.type === "heartbeat") {
          entry.lastHeartbeat = Date.now();
        }
      });
    });

    // Handle unexpected exit
    handle.onExit((code) => {
      this.handleSandboxDeath(id, code);
    });

    return entry;
  }

  private handleSandboxDeath(id: string, exitCode: number | null): void {
    const entry = this.sandboxes.get(id);
    if (!entry || entry.status === "dead") return;

    console.log(`  [Pool] Sandbox ${id.slice(0, 8)}… died (exit code ${exitCode})`);
    entry.status = "dead";

    // Revoke all tokens for this sandbox
    this.tokenProxy.revokeAllForSandbox(id);

    // Clear affinity bindings pointing to this sandbox
    for (const [convId, sandboxId] of this.affinityMap.entries()) {
      if (sandboxId === id) {
        this.affinityMap.delete(convId);
        console.log(`  [Pool] Cleared affinity for conversation ${convId.slice(0, 8)}…`);
      }
    }

    // Remove from pool and replenish
    this.sandboxes.delete(id);
    this.replenish("death");
  }

  private async replenish(reason: string): Promise<void> {
    console.log(`  [Pool] Replenishing (reason: ${reason}), backoff: ${this.backoffMs}ms`);

    try {
      await new Promise((resolve) => setTimeout(resolve, this.backoffMs));
      await this.spawnSandbox();
      this.backoffMs = 1_000; // Reset backoff on success
    } catch (err) {
      const error = err as Error;
      console.log(`  [Pool] Replenishment failed: ${error.message}`);
      this.backoffMs = Math.min(this.backoffMs * 2, this.config.maxBackoffMs);
      // Retry with increased backoff
      this.replenish("retry");
    }
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      const now = Date.now();
      for (const entry of this.sandboxes.values()) {
        if (entry.status === "dead" || entry.status === "booting") continue;

        const staleMs = now - entry.lastHeartbeat;
        if (staleMs > this.config.heartbeatIntervalMs * 3) {
          console.log(
            `  [Pool] Sandbox ${entry.id.slice(0, 8)}… heartbeat stale (${staleMs}ms) — evicting`,
          );
          entry.handle.kill();
        }
      }
    }, this.config.heartbeatIntervalMs * 2);
  }

  private toInfo(entry: SandboxEntry): SandboxInfo {
    return {
      id: entry.id,
      status: entry.status,
      pid: entry.handle.pid,
      conversationId: entry.conversationId,
      token: entry.token,
      createdAt: entry.createdAt,
      lastUsedAt: entry.lastUsedAt,
      executionCount: entry.executionCount,
    };
  }
}
