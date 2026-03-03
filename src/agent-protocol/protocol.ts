import { runAgentLoop } from "./agent.js";
import {
  createThread,
  getThread,
  saveThread,
  createTurn,
  addItemToTurn,
  getThreadSummaries,
} from "./thread-store.js";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  ProtocolEvent,
  ApprovalRequestItem,
  Item,
  Turn,
} from "./types.js";

// ─── AgentServer ─────────────────────────────────────────────────────────────
//
// The heart of the protocol layer. Dispatches JSON-RPC methods to handlers,
// manages Turn/Item lifecycle, and implements the approval pause/resume
// mechanism using Promises.
//
// The server is transport-agnostic — it accepts JSON-RPC requests and emits
// ProtocolEvents. The transport layer (HTTP+SSE or stdio/JSONL) handles
// serialization and delivery.

export type EventListener = (event: ProtocolEvent) => void;

export class AgentServer {
  // Per-thread event listeners — transports register here
  private listeners = new Map<string, Set<EventListener>>();
  // Global listeners (get ALL events regardless of thread)
  private globalListeners = new Set<EventListener>();
  // Pending approval Promises — keyed by approval item ID
  private pendingApprovals = new Map<
    string,
    { resolve: (decision: "approved" | "denied") => void; threadId: string; turnId: string }
  >();

  // ── Event Subscription ──────────────────────────────────────────────────

  subscribe(threadId: string, listener: EventListener): () => void {
    if (!this.listeners.has(threadId)) {
      this.listeners.set(threadId, new Set());
    }
    this.listeners.get(threadId)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(threadId)?.delete(listener);
    };
  }

  subscribeAll(listener: EventListener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  private emit(threadId: string, event: ProtocolEvent): void {
    // Thread-specific listeners
    const threadListeners = this.listeners.get(threadId);
    if (threadListeners) {
      for (const listener of threadListeners) {
        listener(event);
      }
    }
    // Global listeners
    for (const listener of this.globalListeners) {
      listener(event);
    }
  }

  // ── JSON-RPC Dispatch ───────────────────────────────────────────────────

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      switch (request.method) {
        case "thread.create":
          return this.handleThreadCreate(request);
        case "thread.list":
          return this.handleThreadList(request);
        case "thread.get":
          return this.handleThreadGet(request);
        case "turn.submit":
          return await this.handleTurnSubmit(request);
        case "turn.approve":
          return this.handleTurnApprove(request);
        default:
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32601, message: `Method not found: ${request.method}` },
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32603, message },
      };
    }
  }

  // ── thread.create ───────────────────────────────────────────────────────

  private handleThreadCreate(request: JsonRpcRequest): JsonRpcResponse {
    const title = (request.params?.title as string) ?? undefined;
    const thread = createThread(title);
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { threadId: thread.id, title: thread.title, createdAt: thread.createdAt },
    };
  }

  // ── thread.list ─────────────────────────────────────────────────────────

  private handleThreadList(request: JsonRpcRequest): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { threads: getThreadSummaries() },
    };
  }

  // ── thread.get ──────────────────────────────────────────────────────────

  private handleThreadGet(request: JsonRpcRequest): JsonRpcResponse {
    const threadId = request.params?.threadId as string;
    if (!threadId) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: "Missing threadId parameter" },
      };
    }

    const thread = getThread(threadId);
    if (!thread) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: `Thread ${threadId} not found` },
      };
    }

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { thread },
    };
  }

  // ── turn.submit ─────────────────────────────────────────────────────────
  //
  // This is the main entry point for user interaction. It:
  //   1. Creates a Turn
  //   2. Emits turn.started
  //   3. Runs the agent loop (which emits item events via the emit callback)
  //   4. Saves updated history to the thread
  //   5. Emits turn.completed
  //
  // The RPC response returns immediately with the turn ID. All actual work
  // happens asynchronously through events.

  private async handleTurnSubmit(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const threadId = request.params?.threadId as string;
    const message = request.params?.message as string;

    if (!threadId || !message) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: "Missing threadId or message parameter" },
      };
    }

    const thread = getThread(threadId);
    if (!thread) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: `Thread ${threadId} not found` },
      };
    }

    const turn = createTurn(threadId);
    thread.turns.push(turn);

    // Emit turn started
    this.emit(threadId, { type: "turn.started", threadId, turn });

    // Add user message item
    const userItem: Item = {
      id: `${turn.id}-item-user`,
      turnId: turn.id,
      threadId,
      type: "user_message",
      status: "completed",
      content: message,
      createdAt: Date.now(),
    };
    addItemToTurn(turn, userItem);
    this.emit(threadId, { type: "item.started", threadId, turnId: turn.id, item: userItem });
    this.emit(threadId, { type: "item.completed", threadId, turnId: turn.id, item: userItem });

    // Return immediately — agent processing happens async
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: request.id,
      result: { turnId: turn.id, threadId },
    };

    // Run agent loop asynchronously
    this.runTurn(thread, turn, message).catch((err) => {
      const errMsg = err instanceof Error ? err.message : "Agent error";
      this.emit(threadId, { type: "error", threadId, message: errMsg });
      turn.status = "completed";
      saveThread(thread);
    });

    return response;
  }

  private async runTurn(
    thread: import("./types.js").Thread,
    turn: Turn,
    userMessage: string,
  ): Promise<void> {
    const threadId = thread.id;

    // emit callback — forwards agent events and tracks items on the turn
    const emit = (event: ProtocolEvent) => {
      this.emit(threadId, event);

      // Track items on the turn object
      if (event.type === "item.started" || event.type === "item.completed") {
        addItemToTurn(turn, event.item);
      }
    };

    // requestApproval callback — pauses agent loop, waits for client response
    const requestApproval = (item: ApprovalRequestItem): Promise<"approved" | "denied"> => {
      return new Promise((resolve) => {
        this.pendingApprovals.set(item.id, { resolve, threadId, turnId: turn.id });
        turn.status = "awaiting_approval";
        this.emit(threadId, {
          type: "turn.awaiting_approval",
          threadId,
          turnId: turn.id,
          item,
        });
      });
    };

    // Run the agent
    const updatedHistory = await runAgentLoop(
      userMessage,
      thread.history,
      threadId,
      turn.id,
      emit,
      requestApproval,
    );

    // Update thread state
    thread.history = updatedHistory;
    turn.status = "completed";
    saveThread(thread);

    // Emit turn completed
    this.emit(threadId, { type: "turn.completed", threadId, turn });
  }

  // ── turn.approve ────────────────────────────────────────────────────────
  //
  // Resolves a pending approval Promise, unblocking the agent loop.

  private handleTurnApprove(request: JsonRpcRequest): JsonRpcResponse {
    const itemId = request.params?.itemId as string;
    const decision = request.params?.decision as "approved" | "denied";

    if (!itemId || !decision) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: "Missing itemId or decision parameter" },
      };
    }

    const pending = this.pendingApprovals.get(itemId);
    if (!pending) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: `No pending approval for item ${itemId}` },
      };
    }

    // Resolve the Promise — this unblocks the agent loop
    this.pendingApprovals.delete(itemId);
    pending.resolve(decision);

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { itemId, decision, threadId: pending.threadId, turnId: pending.turnId },
    };
  }
}
