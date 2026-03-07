// ─── A2A Protocol — Server ────────────────────────────────────────────────────
//
// A minimal A2A-compliant HTTP server: "Ristorante Finder"
//
// Exposes two endpoints:
//   GET  /.well-known/agent-card.json  — capability manifest (discovery)
//   POST /                             — JSON-RPC 2.0 dispatcher
//
// Supported JSON-RPC methods:
//   message/send    — synchronous: runs agent, returns completed Task
//   message/stream  — streaming: SSE events as the task progresses
//   tasks/get       — retrieve a task by ID (polling fallback)
//   tasks/cancel    — cancel an in-progress task
//
// The server uses Ollama to process requests with two mock restaurant tools.
// All tool data is hardcoded — no real API calls needed.

import http from "http";
import { randomUUID } from "crypto";

import "dotenv/config";
import ollama from "ollama";

import { MODEL } from "../shared/config.js";
import type { ToolDefinition } from "../shared/types.js";

import type {
  AgentCard,
  Task,
  TaskStatus,
  Message,
  Artifact,
  TextPart,
  JsonRpcRequest,
  JsonRpcResponse,
  MessageSendParams,
  TaskGetParams,
  TaskCancelParams,
  A2AStreamEvent,
} from "./types.js";

// ─── Port ─────────────────────────────────────────────────────────────────────

export const A2A_PORT = 41337;

// ─── Agent Card ───────────────────────────────────────────────────────────────
//
// This is what the client sees when it fetches /.well-known/agent-card.json.
// It describes the agent's identity, capabilities, and the skills it offers.
// Think of it as a résumé: the client reads it once, then knows how to delegate.

const AGENT_CARD: AgentCard = {
  name: "Ristorante Finder",
  description:
    "A restaurant specialist that finds dining options by city and cuisine. Provides names, ratings, price ranges, specialties, and hours.",
  url: `http://localhost:${A2A_PORT}`,
  version: "1.0.0",
  protocolVersion: "0.3.0",
  capabilities: {
    streaming: true,
    pushNotifications: false,
  },
  skills: [
    {
      id: "restaurant-search",
      name: "Restaurant Search",
      description: "Search restaurants by city and cuisine type",
      inputModes: ["text"],
      outputModes: ["text"],
      examples: [
        "Find Italian restaurants in Rome",
        "Best sushi in Tokyo for a business dinner",
        "Vegetarian-friendly places in Barcelona",
      ],
    },
    {
      id: "restaurant-details",
      name: "Restaurant Details",
      description: "Get full details for a specific restaurant by name and city",
      inputModes: ["text"],
      outputModes: ["text"],
      examples: ["Tell me more about Tonnarello in Rome"],
    },
  ],
  defaultInputModes: ["text"],
  defaultOutputModes: ["text"],
  provider: {
    organization: "Agent Patterns Demo",
  },
};

// ─── Mock Restaurant Data ─────────────────────────────────────────────────────
//
// Hardcoded like all other tool implementations in this repo.
// Structure: city → cuisine → restaurant[]

interface RestaurantRecord {
  name: string;
  rating: number;
  priceRange: string;
  specialty: string;
  hours: string;
  address: string;
}

type RestaurantDb = Record<string, Record<string, RestaurantRecord[]>>;

const RESTAURANT_DB: RestaurantDb = {
  rome: {
    italian: [
      {
        name: "Osteria della Quercia",
        rating: 4.8,
        priceRange: "€€€",
        specialty: "Cacio e pepe, carbonara",
        hours: "12:00-23:00",
        address: "Via delle Coppelle 8",
      },
      {
        name: "Tonnarello",
        rating: 4.6,
        priceRange: "€€",
        specialty: "Supplì, gricia, amatriciana",
        hours: "12:30-00:00",
        address: "Via della Paglia 1, Trastevere",
      },
      {
        name: "Il Sorpasso",
        rating: 4.5,
        priceRange: "€€",
        specialty: "Roman street food, natural wines",
        hours: "07:30-01:00",
        address: "Via Properzio 31, Prati",
      },
    ],
    pizza: [
      {
        name: "Pizzarium Bonci",
        rating: 4.9,
        priceRange: "€",
        specialty: "Pizza al taglio with inventive toppings",
        hours: "11:00-22:00",
        address: "Via della Meloria 43",
      },
      {
        name: "Emma Pizzeria",
        rating: 4.7,
        priceRange: "€€",
        specialty: "Neapolitan pizza, burrata starters",
        hours: "12:30-23:30",
        address: "Via del Monte della Farina 28",
      },
    ],
  },
  paris: {
    french: [
      {
        name: "Frenchie",
        rating: 4.9,
        priceRange: "€€€€",
        specialty: "Modern bistro, seasonal tasting menu",
        hours: "19:30-22:30",
        address: "5-6 Rue du Nil",
      },
      {
        name: "Le Comptoir du Relais",
        rating: 4.7,
        priceRange: "€€€",
        specialty: "Classic Lyonnais, slow-braised meats",
        hours: "12:00-23:00",
        address: "9 Carrefour de l'Odéon",
      },
    ],
    japanese: [
      {
        name: "Abri Soba",
        rating: 4.8,
        priceRange: "€€",
        specialty: "Handmade buckwheat soba, tempura",
        hours: "12:00-14:00, 19:00-22:00",
        address: "10 Rue du Faubourg Poissonnière",
      },
    ],
  },
  tokyo: {
    ramen: [
      {
        name: "Ichiran Shibuya",
        rating: 4.7,
        priceRange: "¥",
        specialty: "Solitary tonkotsu booths — no social pressure",
        hours: "24h",
        address: "1-22-7 Jinnan, Shibuya",
      },
      {
        name: "Fuunji",
        rating: 4.9,
        priceRange: "¥¥",
        specialty: "Tsukemen (dipping ramen)",
        hours: "11:00-15:00, 17:30-21:00",
        address: "2-14-3 Yoyogi, Shibuya",
      },
    ],
    sushi: [
      {
        name: "Sushi Saito",
        rating: 5.0,
        priceRange: "¥¥¥¥¥",
        specialty: "Omakase — one of Japan's best, reservation required",
        hours: "Lunch only, by appointment",
        address: "1-9-15 Akasaka, Minato",
      },
      {
        name: "Hanamizuki Sushi",
        rating: 4.6,
        priceRange: "¥¥",
        specialty: "Counter sushi, seasonal nigiri",
        hours: "11:30-14:30, 17:30-22:00",
        address: "3-2-1 Ginza, Chuo",
      },
    ],
  },
};

// ─── Mock Tool Implementations ────────────────────────────────────────────────

function searchRestaurants(city: string, cuisine: string): string {
  const cityData = RESTAURANT_DB[city.toLowerCase()];
  if (!cityData) return `No restaurant data for "${city}". Try: rome, paris, tokyo.`;
  const results = cityData[cuisine.toLowerCase()];
  if (!results || results.length === 0)
    return `No ${cuisine} restaurants found in ${city}. Available cuisines: ${Object.keys(cityData).join(", ")}.`;
  return JSON.stringify(results, null, 2);
}

function getRestaurantDetails(name: string, city: string): string {
  const cityData = RESTAURANT_DB[city.toLowerCase()];
  if (!cityData) return `No restaurant data for "${city}".`;
  for (const restaurants of Object.values(cityData)) {
    const found = restaurants.find((r) => r.name.toLowerCase().includes(name.toLowerCase()));
    if (found) return JSON.stringify(found, null, 2);
  }
  return `Restaurant "${name}" not found in ${city}.`;
}

// ─── Ollama Tool Definitions ──────────────────────────────────────────────────

const TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_restaurants",
      description: "Search for restaurants in a city filtered by cuisine type",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "City name. Supported: rome, paris, tokyo",
          },
          cuisine: {
            type: "string",
            description:
              "Cuisine type. Rome: italian, pizza. Paris: french, japanese. Tokyo: ramen, sushi",
          },
        },
        required: ["city", "cuisine"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_restaurant_details",
      description: "Get detailed information about a specific restaurant by name and city",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Restaurant name (partial match supported)" },
          city: { type: "string", description: "City name" },
        },
        required: ["name", "city"],
      },
    },
  },
];

// ─── Task Store ───────────────────────────────────────────────────────────────

const taskStore = new Map<string, Task>();

function createTask(contextId: string): Task {
  const task: Task = {
    id: randomUUID(),
    contextId,
    status: { state: "submitted", timestamp: new Date().toISOString() },
    history: [],
    artifacts: [],
  };
  taskStore.set(task.id, task);
  return task;
}

function updateTaskStatus(taskId: string, state: TaskStatus["state"], message?: Message): Task {
  const task = taskStore.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  task.status = { state, timestamp: new Date().toISOString(), ...(message && { message }) };
  return task;
}

function addArtifact(taskId: string, artifact: Artifact): void {
  const task = taskStore.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  (task.artifacts ??= []).push(artifact);
}

// ─── Agent Logic ──────────────────────────────────────────────────────────────
//
// Standard ReAct loop: call Ollama → if tool calls, execute them → loop.
// The `onToolCall` callback fires before each tool execution so the streaming
// handler can send real-time progress events to the client.

const SYSTEM_PROMPT = `You are Ristorante Finder, a restaurant specialist agent.

When asked about restaurants, always use your tools — never guess names or details.
1. Call search_restaurants to get a list for the requested city and cuisine.
2. Optionally call get_restaurant_details for 1-2 top picks to get full info.
3. Format your final answer as friendly recommendations with names, specialties, prices, and hours.

Keep responses concise — 3-5 restaurants maximum, with the most important details.`;

interface OllamaMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, string> };
  }>;
}

const MAX_ITERATIONS = 8;

async function runAgentAndGetResult(
  userText: string,
  onToolCall?: (toolName: string, args: Record<string, string>) => void,
): Promise<string> {
  const messages: OllamaMessage[] = [{ role: "user", content: userText }];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system field not in official Ollama types but works at runtime
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
    });

    const msg = response.message as OllamaMessage;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content ?? "[no response]";
    }

    for (const call of msg.tool_calls) {
      const { name, arguments: args } = call.function;
      onToolCall?.(name, args);

      let result: string;
      if (name === "search_restaurants") {
        result = searchRestaurants(args.city, args.cuisine);
      } else if (name === "get_restaurant_details") {
        result = getRestaurantDetails(args.name, args.city);
      } else {
        result = `Unknown tool: ${name}`;
      }

      messages.push({ role: "tool", content: result });
    }
  }

  return "[Agent reached max iterations without completing]";
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

function handleAgentCard(res: http.ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(AGENT_CARD, null, 2));
}

async function handleMessageSend(
  params: MessageSendParams,
  rpcId: string | number,
  res: http.ServerResponse,
): Promise<void> {
  const contextId = params.message.contextId ?? randomUUID();
  const task = createTask(contextId);

  const userText = params.message.parts
    .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
    .map((p) => p.text)
    .join("\n");

  updateTaskStatus(task.id, "working");

  try {
    const result = await runAgentAndGetResult(userText);

    const artifact: Artifact = {
      artifactId: randomUUID(),
      name: "Restaurant Recommendations",
      parts: [{ kind: "text", text: result } satisfies TextPart],
    };
    addArtifact(task.id, artifact);

    const completedTask = updateTaskStatus(task.id, "completed");
    completedTask.artifacts = [artifact];

    const rpcResponse: JsonRpcResponse<Task> = {
      jsonrpc: "2.0",
      id: rpcId,
      result: completedTask,
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(rpcResponse));
  } catch (err) {
    updateTaskStatus(task.id, "failed");
    const rpcResponse: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: rpcId,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : "Internal error",
      },
    };
    if (!res.headersSent) {
      res.writeHead(200, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify(rpcResponse));
  }
}

async function handleMessageStream(
  params: MessageSendParams,
  rpcId: string | number,
  res: http.ServerResponse,
): Promise<void> {
  const contextId = params.message.contextId ?? randomUUID();
  const task = createTask(contextId);

  // Open the SSE connection immediately — don't wait for agent completion
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  function sendEvent(event: A2AStreamEvent): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  // Event 1: task submitted
  sendEvent({
    kind: "status-update",
    taskId: task.id,
    contextId,
    status: { state: "submitted", timestamp: task.status.timestamp },
    final: false,
  });

  const userText = params.message.parts
    .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
    .map((p) => p.text)
    .join("\n");

  // Event 2: task working
  updateTaskStatus(task.id, "working");
  sendEvent({
    kind: "status-update",
    taskId: task.id,
    contextId,
    status: { state: "working", timestamp: new Date().toISOString() },
    final: false,
  });

  // Run the agent — fire status updates for each tool call so the client
  // can show real-time progress ("calling search_restaurants...")
  try {
    const result = await runAgentAndGetResult(userText, (toolName, args) => {
      const toolMsg: Message = {
        messageId: randomUUID(),
        role: "agent",
        parts: [
          {
            kind: "text",
            text: `Calling ${toolName}(${Object.entries(args)
              .map(([k, v]) => `${k}="${v}"`)
              .join(", ")})`,
          } satisfies TextPart,
        ],
      };
      sendEvent({
        kind: "status-update",
        taskId: task.id,
        contextId,
        status: { state: "working", timestamp: new Date().toISOString(), message: toolMsg },
        final: false,
      });
    });

    // Event N-1: artifact with the result
    const artifact: Artifact = {
      artifactId: randomUUID(),
      name: "Restaurant Recommendations",
      parts: [{ kind: "text", text: result } satisfies TextPart],
      lastChunk: true,
    };
    addArtifact(task.id, artifact);

    sendEvent({
      kind: "artifact-update",
      taskId: task.id,
      contextId,
      artifact,
    });

    // Event N: completed (final=true signals the client to close the stream)
    const completedTask = updateTaskStatus(task.id, "completed");
    completedTask.artifacts = [artifact];

    sendEvent({
      kind: "status-update",
      taskId: task.id,
      contextId,
      status: { state: "completed", timestamp: new Date().toISOString() },
      final: true,
    });
  } catch (err) {
    // If the agent fails mid-stream, send a final failure event so the client
    // doesn't hang waiting for more events on an open SSE connection.
    updateTaskStatus(task.id, "failed");
    sendEvent({
      kind: "status-update",
      taskId: task.id,
      contextId,
      status: {
        state: "failed",
        timestamp: new Date().toISOString(),
        message: {
          messageId: randomUUID(),
          role: "agent",
          parts: [
            {
              kind: "text",
              text: err instanceof Error ? err.message : "Agent failed",
            } satisfies TextPart,
          ],
        },
      },
      final: true,
    });
  }

  res.end();
}

function handleTaskGet(
  params: TaskGetParams,
  rpcId: string | number,
  res: http.ServerResponse,
): void {
  const task = taskStore.get(params.id);

  // JSON-RPC 2.0: error responses always use HTTP 200 — the error is in the body, not the status
  if (!task) {
    const rpcResponse: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: rpcId,
      error: { code: -32602, message: `Task "${params.id}" not found` },
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(rpcResponse));
    return;
  }

  const rpcResponse: JsonRpcResponse<Task> = { jsonrpc: "2.0", id: rpcId, result: task };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(rpcResponse));
}

function handleTaskCancel(
  params: TaskCancelParams,
  rpcId: string | number,
  res: http.ServerResponse,
): void {
  const task = taskStore.get(params.id);

  // JSON-RPC 2.0: error responses always use HTTP 200
  if (!task) {
    const rpcResponse: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: rpcId,
      error: { code: -32602, message: `Task "${params.id}" not found` },
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(rpcResponse));
    return;
  }

  updateTaskStatus(task.id, "canceled");
  const rpcResponse: JsonRpcResponse<Task> = { jsonrpc: "2.0", id: rpcId, result: task };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(rpcResponse));
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

export function createA2AServer(): http.Server {
  return http.createServer((req, res) => {
    // CORS — allow local clients (browser devtools, curl, etc.)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Discovery endpoint ───────────────────────────────────────────────────
    if (req.method === "GET" && req.url === "/.well-known/agent-card.json") {
      handleAgentCard(res);
      return;
    }

    // ── JSON-RPC dispatcher ──────────────────────────────────────────────────
    if (req.method === "POST" && req.url === "/") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", async () => {
        let rpc: JsonRpcRequest;
        try {
          rpc = JSON.parse(body) as JsonRpcRequest;
        } catch {
          const errResponse: JsonRpcResponse = {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          };
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(errResponse));
          return;
        }

        switch (rpc.method) {
          case "message/send":
            await handleMessageSend(rpc.params as MessageSendParams, rpc.id, res);
            break;
          case "message/stream":
            await handleMessageStream(rpc.params as MessageSendParams, rpc.id, res);
            break;
          case "tasks/get":
            handleTaskGet(rpc.params as TaskGetParams, rpc.id, res);
            break;
          case "tasks/cancel":
            handleTaskCancel(rpc.params as TaskCancelParams, rpc.id, res);
            break;
          default: {
            const errResponse: JsonRpcResponse = {
              jsonrpc: "2.0",
              id: rpc.id,
              error: { code: -32601, message: `Method not found: ${rpc.method}` },
            };
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify(errResponse));
          }
        }
      });
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });
}

export function startA2AServer(): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = createA2AServer();
    server.on("error", reject);
    server.listen(A2A_PORT, () => resolve(server));
  });
}
