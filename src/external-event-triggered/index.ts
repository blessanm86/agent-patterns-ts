import "dotenv/config";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  verifySignature,
  isReplayAttack,
  isDuplicate,
  deriveSessionId,
  signPayload,
} from "./webhook.js";
import { PerSessionQueue } from "./queue.js";
import { runWebhookAgent } from "./agent.js";
import { MODEL } from "../shared/config.js";
import type { SSEEvent, WebhookEvent } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const PORT = 3008;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── State ───────────────────────────────────────────────────────────────────

const queue = new PerSessionQueue();
const sseClients: http.ServerResponse[] = [];
let eventsProcessed = 0;

// ─── SSE Broadcasting ────────────────────────────────────────────────────────

function formatSSE(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

function broadcast(event: SSEEvent): void {
  const frame = formatSSE(event.type, event);
  // Write to all connected clients, remove disconnected ones
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(frame);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

// ─── Raw Body Parser ─────────────────────────────────────────────────────────
//
// Returns a Buffer, NOT a string. This is critical for HMAC verification —
// parsing to string and back changes bytes, breaking the signature.

function parseRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ─── Route: GET / ────────────────────────────────────────────────────────────

function handleClientHTML(_req: http.IncomingMessage, res: http.ServerResponse): void {
  const htmlPath = path.join(__dirname, "client.html");
  const html = fs.readFileSync(htmlPath, "utf-8");
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}

// ─── Route: GET /events ──────────────────────────────────────────────────────
//
// SSE endpoint. Unlike streaming's POST-based SSE, this is a persistent GET
// connection that receives all events for all sessions. The browser connects
// once via EventSource and stays connected.

function handleSSE(_req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Send initial connection event
  res.write(
    formatSSE("connected", {
      activeSessions: queue.activeSessions,
      eventsProcessed,
    }),
  );

  sseClients.push(res);

  // Remove on disconnect
  _req.on("close", () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
}

// ─── Route: POST /webhook ────────────────────────────────────────────────────
//
// The core webhook receiver. Five steps:
//   1. Parse raw body (Buffer, not string)
//   2. Verify HMAC signature
//   3. Check replay window
//   4. Check idempotency (duplicate delivery_id)
//   5. ACK immediately (202) → enqueue async processing
//
// The ACK happens BEFORE agent processing starts. This is how you meet
// platform timeout requirements — GitHub wants a response within 10s.

async function handleWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const ackStart = Date.now();

  // 1. Parse raw body
  const rawBody = await parseRawBody(req);

  // 2. Verify signature
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  if (!verifySignature(rawBody, signature)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid signature" }));
    return;
  }

  // Parse the event
  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody.toString());
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  // 3. Replay protection
  if (isReplayAttack(event.timestamp)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Event too old (replay protection)" }));
    return;
  }

  const sessionId = deriveSessionId(event);

  // 4. Idempotency check
  if (isDuplicate(event.delivery_id)) {
    broadcast({ type: "duplicate", sessionId, deliveryId: event.delivery_id });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "duplicate", delivery_id: event.delivery_id }));
    return;
  }

  // 5. ACK immediately — processing happens async
  const ackTimeMs = Date.now() - ackStart;
  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "accepted", session_id: sessionId }));

  // Broadcast webhook received + ACK timing
  broadcast({
    type: "webhook_received",
    sessionId,
    eventType: event.type,
    deliveryId: event.delivery_id,
    timestamp: event.timestamp,
  });
  broadcast({ type: "ack", sessionId, ackTimeMs });

  // Enqueue async processing — serialized per session
  queue.enqueue(sessionId, async () => {
    eventsProcessed++;
    try {
      await runWebhookAgent(event, sessionId, broadcast);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      broadcast({ type: "error", sessionId, message });
    }
  });
}

// ─── Route: POST /simulate ───────────────────────────────────────────────────
//
// Convenience endpoint for the browser UI. Auto-generates delivery_id and
// timestamp, signs the payload, then routes through the same webhook pipeline.

async function handleSimulate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const rawBody = await parseRawBody(req);

  let partial: Partial<WebhookEvent>;
  try {
    partial = JSON.parse(rawBody.toString());
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  // Auto-fill delivery_id and timestamp if missing
  const event = {
    ...partial,
    delivery_id: (partial as WebhookEvent).delivery_id ?? crypto.randomUUID(),
    timestamp: (partial as WebhookEvent).timestamp ?? Date.now(),
  };

  // Re-serialize and sign
  const signedBody = Buffer.from(JSON.stringify(event));
  const signature = signPayload(signedBody);

  // Create a fake IncomingMessage-like request to reuse handleWebhook
  // Instead, we'll directly inline the webhook logic to avoid complexity
  const sessionId = deriveSessionId(event as WebhookEvent);

  // Check for duplicate
  if (isDuplicate(event.delivery_id)) {
    broadcast({ type: "duplicate", sessionId, deliveryId: event.delivery_id });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "duplicate", delivery_id: event.delivery_id }));
    return;
  }

  // ACK immediately
  res.writeHead(202, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "accepted",
      session_id: sessionId,
      delivery_id: event.delivery_id,
      signature,
    }),
  );

  // Broadcast webhook received + ACK
  broadcast({
    type: "webhook_received",
    sessionId,
    eventType: event.type as string,
    deliveryId: event.delivery_id,
    timestamp: event.timestamp,
  });
  broadcast({ type: "ack", sessionId, ackTimeMs: 0 });

  // Enqueue async processing
  queue.enqueue(sessionId, async () => {
    eventsProcessed++;
    try {
      await runWebhookAgent(event as WebhookEvent, sessionId, broadcast);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      broadcast({ type: "error", sessionId, message });
    }
  });
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Hub-Signature-256",
    });
    res.end();
    return;
  }

  try {
    if (url === "/" && method === "GET") {
      handleClientHTML(req, res);
    } else if (url === "/events" && method === "GET") {
      handleSSE(req, res);
    } else if (url === "/webhook" && method === "POST") {
      await handleWebhook(req, res);
    } else if (url === "/simulate" && method === "POST") {
      await handleSimulate(req, res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  } catch (err) {
    console.error("Server error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n  Webhook Agent Server`);
  console.log(`  ────────────────────────────`);
  console.log(`  Model:    ${MODEL}`);
  console.log(`  URL:      http://localhost:${PORT}`);
  console.log(`  Webhook:  POST http://localhost:${PORT}/webhook`);
  console.log(`  Events:   GET  http://localhost:${PORT}/events`);
  console.log(`\n  Open the URL in your browser to simulate webhook events.\n`);
});
