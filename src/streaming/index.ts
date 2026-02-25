import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ollama from "ollama";
import { runStreamingAgent, runNonStreamingAgent } from "./agent.js";
import { MODEL } from "../shared/config.js";
import type { Message, SSEEvent } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const PORT = 3007;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── SSE Formatting ──────────────────────────────────────────────────────────

function formatSSE(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ─── Request Body Parser ─────────────────────────────────────────────────────

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

function handleClientHTML(_req: http.IncomingMessage, res: http.ServerResponse): void {
  const htmlPath = path.join(__dirname, "client.html");
  const html = fs.readFileSync(htmlPath, "utf-8");
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}

async function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    await ollama.list();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", model: MODEL }));
  } catch {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", message: "Ollama not reachable" }));
  }
}

async function handleChat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Parse request
  const raw = await parseBody(req);
  let body: { message?: string; history?: Message[]; stream?: boolean };
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const userMessage = body.message;
  if (!userMessage) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'message' field" }));
    return;
  }

  const history: Message[] = body.history ?? [];
  const useStreaming = body.stream !== false; // default: true

  // ── SSE headers ─────────────────────────────────────────────────────────
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // ── Emit callback — writes SSE events to the response ──────────────────
  const emit = (event: SSEEvent): void => {
    res.write(formatSSE(event.type, event));
  };

  try {
    const agent = useStreaming ? runStreamingAgent : runNonStreamingAgent;
    const updatedHistory = await agent(userMessage, history, emit);

    // Send the full conversation history so the client can maintain state
    res.write(formatSSE("history", updatedHistory));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    emit({ type: "error", message });
  }

  res.end();
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
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    if (url === "/" && method === "GET") {
      handleClientHTML(req, res);
    } else if (url === "/api/health" && method === "GET") {
      await handleHealth(req, res);
    } else if (url === "/api/chat" && method === "POST") {
      await handleChat(req, res);
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
  console.log(`\n  🌊 Streaming Agent Server`);
  console.log(`  ─────────────────────────`);
  console.log(`  Model:  ${MODEL}`);
  console.log(`  URL:    http://localhost:${PORT}`);
  console.log(`\n  Open the URL in your browser to chat.\n`);
});
