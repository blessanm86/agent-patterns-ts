// ─── A2A Protocol — Client ────────────────────────────────────────────────────
//
// A minimal A2A client with three capabilities:
//
//   fetchAgentCard()    — GET /.well-known/agent-card.json (discovery)
//   sendMessage()       — message/send (synchronous request/response)
//   streamMessage()     — message/stream (SSE — async generator)
//   getTask()           — tasks/get (polling fallback)
//
// All communication is plain HTTP + JSON-RPC. No SDK required.

import { randomUUID } from "crypto";

import type {
  AgentCard,
  Task,
  Message,
  MessageSendParams,
  JsonRpcRequest,
  JsonRpcResponse,
  A2AStreamEvent,
} from "./types.js";

// ─── Agent Card Discovery ─────────────────────────────────────────────────────
//
// The first thing an A2A client does is fetch the agent's capability manifest
// from the well-known URL. This tells the client what the agent can do, what
// credentials it needs, and where to send messages.

export async function fetchAgentCard(baseUrl: string): Promise<AgentCard> {
  const url = `${baseUrl}/.well-known/agent-card.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch agent card from ${url}: HTTP ${response.status}`);
  }
  return response.json() as Promise<AgentCard>;
}

// ─── Build a User Message ─────────────────────────────────────────────────────

function makeMessage(text: string, contextId?: string): Message {
  return {
    messageId: randomUUID(),
    role: "user",
    parts: [{ kind: "text", text }],
    ...(contextId && { contextId }),
  };
}

// ─── Synchronous Send: message/send ──────────────────────────────────────────
//
// Sends a message and waits for the full response before returning.
// The server processes the task end-to-end and returns a completed Task.
//
// Use this for short tasks where blocking is acceptable.
// For long-running tasks, use streamMessage() instead.

export async function sendMessage(
  baseUrl: string,
  text: string,
  contextId?: string,
): Promise<Task> {
  const message = makeMessage(text, contextId);
  const params: MessageSendParams = { message };

  const rpcRequest: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: randomUUID(),
    method: "message/send",
    params,
  };

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rpcRequest),
  });

  if (!response.ok) {
    throw new Error(`message/send failed: HTTP ${response.status}`);
  }

  const rpcResponse = (await response.json()) as JsonRpcResponse<Task>;

  if (rpcResponse.error) {
    throw new Error(`RPC error ${rpcResponse.error.code}: ${rpcResponse.error.message}`);
  }

  return rpcResponse.result!;
}

// ─── Streaming: message/stream ────────────────────────────────────────────────
//
// Sends a message and yields A2AStreamEvents as they arrive over SSE.
// The generator ends when the server sends a status-update with final=true.
//
// The server sends events in this order:
//   1. status-update (submitted)
//   2. status-update (working)         — one per state transition
//   3. status-update (working+message) — one per tool call (optional)
//   4. artifact-update                 — the result
//   5. status-update (completed, final=true)
//
// SSE wire format (each event is one line + blank line):
//   data: {"kind":"status-update","taskId":"...","status":{"state":"submitted"},...}\n\n

export async function* streamMessage(
  baseUrl: string,
  text: string,
  contextId?: string,
): AsyncGenerator<A2AStreamEvent> {
  const message = makeMessage(text, contextId);
  const params: MessageSendParams = { message };

  const rpcRequest: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: randomUUID(),
    method: "message/stream",
    params,
  };

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(rpcRequest),
  });

  if (!response.ok || !response.body) {
    throw new Error(`message/stream failed: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE uses \n\n to separate events. Split on newlines, keep incomplete lines.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // Last line may be incomplete — keep it buffered

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const json = line.slice(6).trim();
        if (json && json !== "[DONE]") {
          try {
            const event = JSON.parse(json) as A2AStreamEvent;
            yield event;
            // Short-circuit as soon as we see final=true — no need to wait
            // for the server to close the connection.
            if (event.kind === "status-update" && event.final) {
              await reader.cancel();
              return;
            }
          } catch {
            // Ignore malformed event lines
          }
        }
      }
    }
  }

  // Flush any remaining buffer content after the stream closes
  if (buffer.startsWith("data: ")) {
    const json = buffer.slice(6).trim();
    if (json && json !== "[DONE]") {
      try {
        yield JSON.parse(json) as A2AStreamEvent;
      } catch {
        // Ignore
      }
    }
  }
}

// ─── Poll a Task: tasks/get ───────────────────────────────────────────────────
//
// Retrieve the current state of a task by ID.
// Used as a polling fallback when streaming is not available,
// or to verify task state after a stream closes.

export async function getTask(baseUrl: string, taskId: string): Promise<Task> {
  const rpcRequest: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: randomUUID(),
    method: "tasks/get",
    params: { id: taskId },
  };

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rpcRequest),
  });

  if (!response.ok) {
    throw new Error(`tasks/get failed: HTTP ${response.status}`);
  }

  const rpcResponse = (await response.json()) as JsonRpcResponse<Task>;

  if (rpcResponse.error) {
    throw new Error(`tasks/get error: ${rpcResponse.error.message}`);
  }

  return rpcResponse.result!;
}
