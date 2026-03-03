# One Agent, Many Faces — Client-Agnostic Agent Protocol

[Agent Patterns — TypeScript](../../README.md)

> **Previous concept:** [Streaming Responses](../streaming/README.md) — HTTP server with SSE and browser UI. This concept takes the streaming agent and wraps it in a protocol layer that any client can consume — CLI, browser, IDE extension, desktop app — through the same API.

---

Most agent demos wire the agent loop directly into a readline prompt or a framework-specific handler. It works, but it creates a coupling problem: the agent _is_ the interface. Want the same agent in a web dashboard? Rebuild the integration. In an IDE extension? Rebuild again. Each new surface means re-solving streaming, tool rendering, session management, and approval flows.

The solution is an old idea applied to agents: **define a protocol**. Put a stable API between the agent and its clients. The agent backend becomes a server that any number of clients can connect to. This is exactly what OpenAI did with the Codex App Server — one Rust binary serves their CLI, VS Code extension, macOS desktop app, and web interface through a single JSON-RPC API. OpenCode did the same with a Go TUI client talking to a JS backend over HTTP+SSE.

This demo teaches the pattern from scratch.

## The Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENTS                             │
│  ┌──────────────┐                ┌────────────────────┐     │
│  │  CLI Client   │                │  Web Client (HTML)  │     │
│  │  (readline)   │                │  (browser + fetch)  │     │
│  │  stdio/JSONL  │                │  HTTP + SSE         │     │
│  └──────┬───────┘                └─────────┬──────────┘     │
├─────────┼──────────────────────────────────┼────────────────┤
│         │       TRANSPORT LAYER            │                │
│  ┌──────┴───────┐                ┌─────────┴──────────┐     │
│  │StdioTransport │                │ HttpSseTransport    │     │
│  └──────┬───────┘                └─────────┬──────────┘     │
├─────────┴──────────────────────────────────┴────────────────┤
│                    PROTOCOL LAYER                           │
│  AgentServer: JSON-RPC dispatch, Item/Turn/Thread lifecycle │
│  approval pause/resume, thread persistence                  │
├─────────────────────────────────────────────────────────────┤
│                     AGENT LAYER                             │
│  ReAct loop with streaming + approval callback              │
│  Restaurant reservation tools                               │
└─────────────────────────────────────────────────────────────┘
```

The key insight: the agent layer knows nothing about transports, JSON-RPC, or HTTP. It communicates entirely through two injected callbacks — `emit(event)` and `requestApproval(item)`. The protocol layer manages the lifecycle. The transport layer handles serialization.

## The Three Primitives

Every agent protocol needs three abstractions that map the chaotic stream of LLM tokens, tool calls, and human decisions into something clients can render and resume.

### Item — Atomic Unit of Output

An Item is the smallest visible thing in a conversation. Four types:

| Type               | What it is                 | Example                                    |
| ------------------ | -------------------------- | ------------------------------------------ |
| `user_message`     | What the human sent        | "Find me Italian restaurants"              |
| `agent_message`    | What the agent said        | "I found 2 Italian restaurants..."         |
| `tool_execution`   | A tool call + result       | `search_restaurants({cuisine: "italian"})` |
| `approval_request` | A pause for human decision | "Cancel reservation rsv-1000?"             |

Every item has a lifecycle: `started` → `streaming` (for text deltas) → `completed`. Clients can render items progressively — show a blinking cursor while streaming, swap to final text on completion.

```typescript
// types.ts — the Item type
interface BaseItem {
  id: string;
  turnId: string;
  threadId: string;
  type: ItemType;
  status: ItemStatus; // "started" | "streaming" | "completed"
  createdAt: number;
}
```

### Turn — One Unit of Agent Work

A Turn groups everything that happens from one user input to the next. The user says "book me a table" → the agent searches restaurants, picks one, makes a reservation, and responds. That's one turn containing multiple items.

Turns have three states:

- **`in_progress`** — agent is actively working
- **`awaiting_approval`** — agent hit a high-risk action and is paused
- **`completed`** — agent finished responding

The `awaiting_approval` state is what makes agent protocols different from simple chat APIs. The server can _pause_ an in-flight turn, push a request to the client, and wait for a human decision before continuing.

### Thread — Durable Session Container

A Thread holds the full conversation history and all turns. It survives across client connections. Close the browser tab, reopen it, select the thread from a dropdown — you're back where you left off with full history.

```typescript
interface Thread {
  id: string;
  title: string;
  history: Message[]; // Ollama-format messages (the LLM's memory)
  turns: Turn[]; // Protocol-level structure (what clients render)
  createdAt: number;
  updatedAt: number;
}
```

The dual representation — `history` for the LLM and `turns` for the UI — is intentional. The model sees `[{role: "user", content: "..."}, {role: "assistant", content: "..."}, ...]`. The client sees structured items with metadata, lifecycle states, and approval resolutions. The protocol layer maintains both.

## The JSON-RPC API

Five methods, all JSON-RPC 2.0:

| Method          | Direction       | Purpose                             |
| --------------- | --------------- | ----------------------------------- |
| `thread.create` | Client → Server | Start a new session                 |
| `thread.list`   | Client → Server | List all sessions                   |
| `thread.get`    | Client → Server | Get full state (for reconnection)   |
| `turn.submit`   | Client → Server | Send user message, start agent work |
| `turn.approve`  | Client → Server | Respond to an approval request      |

The server pushes protocol events back to the client over a separate channel (SSE for HTTP, interleaved JSONL for stdio). Six event types cover the full lifecycle:

```
item.started            → new item appeared
item.delta              → streaming text chunk
item.completed          → item finished
turn.started            → agent began working
turn.awaiting_approval  → agent paused for human decision
turn.completed          → agent finished the turn
```

## The Approval Flow

This is the most interesting part of the protocol. When the agent wants to cancel a reservation (a high-risk action), the protocol pauses the agent loop and waits for the client to respond:

```
                Client                    Server                     Agent
                  │                         │                          │
                  │  turn.submit            │                          │
                  │ ─────────────────────→  │  runAgentLoop()          │
                  │                         │ ─────────────────────→   │
                  │  item.started (message)  │                          │
                  │ ←─────────────────────  │  ← emit(item)           │
                  │  item.delta (tokens)    │                          │
                  │ ←─────────────────────  │  ← emit(delta)          │
                  │                         │                          │
                  │                         │  cancel_reservation()    │
                  │                         │  ← high risk detected    │
                  │                         │                          │
                  │  turn.awaiting_approval │  requestApproval()       │
                  │ ←─────────────────────  │  ← Promise blocks       │
                  │                         │     (agent suspended)    │
                  │                         │                          │
                  │  [user clicks Approve]  │                          │
                  │                         │                          │
                  │  turn.approve           │                          │
                  │ ─────────────────────→  │  resolve(Promise)        │
                  │                         │ ─────────────────────→   │
                  │                         │  ← agent resumes         │
                  │  item.completed (tool)  │                          │
                  │ ←─────────────────────  │  ← tool executes         │
                  │  turn.completed         │                          │
                  │ ←─────────────────────  │                          │
```

The implementation uses a Promise that blocks the agent's async loop:

```typescript
// protocol.ts — the approval mechanism
const requestApproval = (item: ApprovalRequestItem): Promise<"approved" | "denied"> => {
  return new Promise((resolve) => {
    // Store the resolve function, keyed by item ID
    this.pendingApprovals.set(item.id, { resolve, threadId, turnId });
    // Emit the pause event — client renders an approval dialog
    this.emit(threadId, { type: "turn.awaiting_approval", threadId, turnId, item });
  });
};

// When the client sends turn.approve, we resolve the stored Promise
const pending = this.pendingApprovals.get(itemId);
pending.resolve(decision); // Agent loop resumes
```

If the user denies the action, the denial is fed back as a tool result:

```typescript
if (decision === "denied") {
  messages.push({
    role: "tool",
    content: JSON.stringify({
      error: "Action denied by user",
      message: "The user chose not to proceed...",
    }),
  });
  continue; // Skip execution, let the model adapt
}
```

The model sees the denial as a normal tool result and adapts its response — "Okay, I won't cancel that reservation. Is there anything else you'd like to do?"

## Transport: One Protocol, Two Pipes

The protocol layer is transport-agnostic. Two transports demonstrate the pattern:

### HTTP + SSE (for browsers)

```
POST /rpc              → JSON-RPC request → JSON-RPC response
GET  /events/:threadId → SSE stream (protocol events)
GET  /                 → serves client.html
```

The browser client uses `fetch()` for RPC calls and `EventSource` for streaming events. Each thread gets its own SSE connection, so events from one conversation don't leak into another.

### Stdio / JSONL (for CLIs)

Both JSON-RPC responses and protocol events flow through the same stdout pipe as newline-delimited JSON. The client distinguishes them by checking for a `jsonrpc` key (responses) vs. a `type` key (events):

```jsonl
{"jsonrpc":"2.0","id":1,"result":{"threadId":"thread-a1b2c3"}}
{"type":"turn.started","threadId":"thread-a1b2c3","turn":{...}}
{"type":"item.delta","threadId":"thread-a1b2c3","delta":"I found"}
```

The CLI client spawns the server as a child process and communicates over stdin/stdout. This is the same architecture OpenAI's Codex CLI uses — the CLI binary spawns the App Server binary, and all communication happens over stdio with JSON-RPC.

## Running the Demo

**Web client** (browser experience):

```bash
pnpm dev:agent-protocol
# Opens at http://localhost:3009
```

1. Click **+ New Thread** to start a conversation
2. Ask about restaurants: "What Italian restaurants are available?"
3. Make a reservation: "Book a table at Trattoria Bella for 2 at 7pm"
4. Try cancelling: "Cancel reservation rsv-1000" — the approval dialog appears
5. Approve or deny — watch the agent adapt
6. Refresh the page — select the existing thread to resume

**CLI client** (terminal experience):

```bash
pnpm dev:agent-protocol:cli
```

1. Type `/new` to create a thread
2. Chat naturally, watch streaming tokens and tool cards
3. Trigger an approval: "Cancel my reservation rsv-1000"
4. Type `/threads` to see all sessions, `/resume <id>` to switch

Both clients talk to the same protocol. The agent code is identical — only the transport differs.

## In the Wild: Coding Agent Harnesses

The client-agnostic protocol pattern is the defining architectural choice of modern coding agent harnesses. Every major harness that ships to multiple surfaces uses some form of it.

**OpenAI Codex** provides the clearest reference implementation. Their App Server is a Rust binary that exposes a JSON-RPC 2.0 API over stdio. It defines exactly the three primitives this demo teaches: Items (text, tool calls, approval requests with lifecycle events), Turns (one unit of agent work from user input to completion), and Threads (durable sessions with full history). The CLI, VS Code extension, macOS desktop app, and web interface all consume the same API. When the agent wants to run a command or edit a file, it sends an `approval_request` item and pauses — the client renders it however fits its platform. The [Codex App Server docs](https://developers.openai.com/codex/app-server/) are the best public specification of this pattern.

**OpenCode** takes a different transport approach. Its Go-based TUI client communicates with a JavaScript/TypeScript backend over HTTP + SSE — `POST /rpc` for commands and `GET /events` for streaming. This is conceptually identical to our HTTP transport, and it proves the pattern works with a process boundary between client and server (not just stdio). The [OpenCode architecture deep dive](https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/) provides the implementation details.

**Claude Code** takes an inverted approach — it ships as a single process where the agent loop and terminal UI are tightly coupled, but exposes the same agent capabilities to VS Code and JetBrains through a WebSocket-based sub-agent protocol. The IDE launches Claude Code as a child process and communicates over a structured message protocol, achieving the same multi-surface pattern from the opposite direction.

The AG-UI Protocol (Agent-User Interaction Protocol) formalizes this pattern further with 16 typed event types and multiple transport bindings. It's worth studying as a reference for what a production-grade version of this pattern looks like.

## Key Takeaways

1. **The protocol layer is the product.** The agent loop is commodity code. The protocol — with its lifecycle events, approval semantics, and session management — is what enables multiple clients without code duplication.

2. **Three primitives are enough.** Item (atomic output), Turn (one work cycle), Thread (durable session). Every agent UI interaction maps to operations on these three types.

3. **Approval is a first-class protocol concept.** It's not a bolt-on. The ability to pause a turn, push a request to the client, and resume on response is what separates agent protocols from simple chat APIs.

4. **Transport is a thin adapter.** HTTP+SSE and stdio/JSONL both implement the same interface. Adding a new transport (WebSocket, gRPC) means writing a new adapter, not touching the protocol or agent.

5. **Dual representation serves two masters.** The LLM needs `Message[]` (role/content pairs). The UI needs structured items with metadata. The protocol layer maintains both so neither side compromises.

## Sources & Further Reading

- [OpenAI — Unlocking the Codex Harness](https://openai.com/index/unlocking-the-codex-harness/) — the App Server protocol with Item/Turn/Thread primitives
- [Codex App Server Docs](https://developers.openai.com/codex/app-server/) — detailed protocol specification
- [OpenCode Deep Dive](https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/) — Go TUI + JS backend over HTTP+SSE
- [AG-UI Protocol](https://docs.ag-ui.com/introduction) — agent-to-frontend streaming standard with 16 event types
- [Anthropic Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) — async generator streaming as an alternative pattern
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification) — the wire format used by both Codex and this demo
