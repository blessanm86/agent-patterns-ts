import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentServer } from "./protocol.js";
import type { JsonRpcRequest, ProtocolEvent } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── HTTP + SSE Transport ────────────────────────────────────────────────────
//
// Three endpoints:
//   POST /rpc              — JSON-RPC requests → JSON-RPC responses
//   GET  /events/:threadId — SSE stream for a specific thread
//   GET  /                 — serves client.html

// ─── Body Parser ─────────────────────────────────────────────────────────────

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

// ─── SSE Helpers ─────────────────────────────────────────────────────────────

function formatSSE(event: ProtocolEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// ─── Start Server ────────────────────────────────────────────────────────────

export function startHttpTransport(server: AgentServer, port: number): http.Server {
  const httpServer = http.createServer(async (req, res) => {
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
      // ── POST /rpc — JSON-RPC endpoint ──────────────────────────────
      if (url === "/rpc" && method === "POST") {
        const body = await parseBody(req);
        let request: JsonRpcRequest;
        try {
          request = JSON.parse(body);
        } catch {
          res.writeHead(400, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }

        const response = await server.handleRequest(request);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify(response));
        return;
      }

      // ── GET /events/:threadId — SSE stream ────────────────────────
      const eventsMatch = url.match(/^\/events\/(.+)$/);
      if (eventsMatch && method === "GET") {
        const threadId = eventsMatch[1];

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        // Send keepalive comment
        res.write(": connected\n\n");

        // Subscribe to events for this thread
        const unsubscribe = server.subscribe(threadId, (event: ProtocolEvent) => {
          try {
            res.write(formatSSE(event));
          } catch {
            unsubscribe();
          }
        });

        // Clean up on disconnect
        req.on("close", () => {
          unsubscribe();
        });
        return;
      }

      // ── GET / — serve client.html ─────────────────────────────────
      if (url === "/" && method === "GET") {
        const htmlPath = path.join(__dirname, "client.html");
        const html = fs.readFileSync(htmlPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }

      // ── 404 ───────────────────────────────────────────────────────
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (err) {
      console.error("Server error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });

  httpServer.listen(port, () => {
    console.log(`\n  Agent Protocol Server (HTTP + SSE)`);
    console.log(`  ────────────────────────────────────`);
    console.log(`  URL:     http://localhost:${port}`);
    console.log(`  RPC:     POST http://localhost:${port}/rpc`);
    console.log(`  Events:  GET  http://localhost:${port}/events/:threadId`);
    console.log(`\n  Open the URL in your browser to chat.\n`);
  });

  return httpServer;
}
