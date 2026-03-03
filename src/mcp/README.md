# The USB-C of Agent Tools — Building with Model Context Protocol

[Agent Patterns — TypeScript](../../README.md)

---

Every tool in every demo so far has been **hardcoded**. The agent file imports a tool array, passes it to the LLM, and dispatches calls through a switch statement. It works — but it creates a tight coupling. If you want the same agent to use tools from a different source, you rewrite the imports. If a third-party wants to offer tools to your agent, they have to ship code in your format.

MCP (Model Context Protocol) breaks this coupling. It's a standardized protocol for connecting agents to external tools dynamically — the agent discovers what tools exist at **runtime**, not compile time. Think USB-C for AI tools: any MCP-compatible agent can use any MCP-compatible tool server, regardless of who built either side.

This isn't theoretical. MCP has been adopted by every major AI lab (Anthropic, OpenAI, Google, xAI, Alibaba, and more), powers tool integration in 13 of 14 major coding harnesses, and has 97 million monthly SDK downloads. It's the de facto standard.

## The Problem: Static Tool Registration Doesn't Scale

In every previous demo, tools are registered like this:

```typescript
// agent.ts — imports tools directly
import { tools, executeTool } from "./tools.js";

const response = await ollama.chat({ model, messages, tools });
// ...dispatch via executeTool(name, args)
```

This works for a single agent with a fixed tool set. But consider what happens when you have **N agents** that each need access to **M different tool providers**:

```
Without MCP:  N agents × M providers = N×M custom integrations

   Agent A ──── custom ──── Provider 1
   Agent A ──── custom ──── Provider 2
   Agent B ──── custom ──── Provider 1
   Agent B ──── custom ──── Provider 2
   ...

With MCP:     N agents + M providers = N+M implementations

   Agent A ─┐               ┌── Provider 1
   Agent B ─┤── MCP spec ──├── Provider 2
   Agent C ─┘               └── Provider 3
```

MCP turns an N×M problem into an N+M problem. The tool author writes one MCP server. The agent author writes one MCP client. They never need to coordinate.

## MCP Architecture

MCP uses a **client-server model** with JSON-RPC 2.0 as the wire protocol:

```
┌─────────────────────────────────────────────────┐
│  Host (your application)                        │
│                                                 │
│   ┌──────────┐    ┌──────────┐                  │
│   │  Client 1 │    │  Client 2 │    ...          │
│   └────┬─────┘    └────┬─────┘                  │
└────────│───────────────│────────────────────────┘
         │               │
    ┌────▼─────┐    ┌────▼─────┐
    │ Server A │    │ Server B │
    │ (recipes)│    │ (weather)│
    └──────────┘    └──────────┘
```

**Three roles:**

- **Host** — the AI application (our `index.ts`). Creates and manages clients
- **Client** — maintains a 1:1 connection with a server. Handles handshake, discovery, and routing
- **Server** — exposes capabilities: Tools, Resources, and Prompts

**Lifecycle:** `initialize` (capabilities negotiation) → `operate` (list/call tools) → `shutdown`

**Transports:**

- **stdio** — for local processes. Server runs as a subprocess, communicates via stdin/stdout. This is what we use in this demo
- **Streamable HTTP** — for remote servers. The standard for production deployments. Replaces the older HTTP+SSE transport

## Building the Server

Our MCP server exposes three recipe tools. Here's the annotated `server.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer(
  { name: "recipe-server", version: "1.0.0" },
  {
    // Server instructions — injected into the agent's system prompt
    instructions: "You have access to a recipe database with dishes from multiple cuisines...",
  },
);

// Register tools with Zod schemas (v1 API: server.tool())
// The schema object is a plain map of Zod types — the SDK wraps it in z.object() internally
server.tool(
  "search_recipes",
  "Search for recipes by keyword and optionally filter by cuisine.",
  {
    query: z.string().describe("Search term — matches names, ingredients, tags"),
    cuisine: z.string().optional().describe("Optional cuisine filter"),
  },
  async ({ query, cuisine }) => ({
    content: [{ type: "text", text: searchRecipes(query, cuisine) }],
  }),
);

// Start the server — stdio transport uses stdin/stdout for JSON-RPC
const transport = new StdioServerTransport();
await server.connect(transport);
```

**Critical gotcha:** Never use `console.log()` in a stdio server — stdout is the JSON-RPC transport channel. Any stray log corrupts the protocol. Use `console.error()` instead (writes to stderr).

## Building the Client: Schema Translation

The client connects to the server, discovers tools, and **translates MCP schemas** into our repo's `ToolDefinition` format. This translation is the core integration point:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// 1. Spawn server subprocess and connect via stdio
const client = new Client({ name: "recipe-client", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: "tsx",
  args: ["src/mcp/server.ts"],
});
await client.connect(transport); // MCP handshake

// 2. Discover tools — the server advertises what it can do
const { tools: mcpTools } = await client.listTools();

// 3. Translate MCP JSON Schema → our ToolDefinition format
const tools = mcpTools.map(mcpToolToDefinition);
```

The `mcpToolToDefinition` function is where two type systems meet:

```typescript
// MCP tools use JSON Schema:
// { name: "search_recipes", inputSchema: { type: "object", properties: {...} } }
//
// Our repo uses ToolDefinition:
// { type: "function", function: { name, description, parameters: {...} } }

function mcpToolToDefinition(mcpTool: McpTool): ToolDefinition {
  const inputSchema = mcpTool.inputSchema;
  const properties: Record<string, ToolParameter> = {};

  for (const [key, prop] of Object.entries(inputSchema.properties ?? {})) {
    properties[key] = {
      type: prop.type ?? "string",
      description: prop.description,
    };
  }

  return {
    type: "function",
    function: {
      name: mcpTool.name,
      description: mcpTool.description ?? "",
      parameters: {
        type: "object",
        properties,
        required: inputSchema.required ?? [],
      },
    },
  };
}
```

This translation is mechanical but essential. Every agent framework has its own tool format. MCP doesn't eliminate format differences — it standardizes the **discovery and invocation protocol** so that a thin translation layer is all you need.

## The Agent Doesn't Change

Here's the key insight: the ReAct loop is **identical** whether tools come from MCP or from a static import. The only difference is **where the tools and executor come from**:

```typescript
// Static mode — tools are imported at compile time
const config = {
  tools: staticTools, // hardcoded ToolDefinition[]
  executeTool: executeStaticTool, // switch statement dispatcher
};

// MCP mode — tools are discovered at runtime
const conn = await connectToMcpServer("tsx", ["src/mcp/server.ts"]);
const config = {
  tools: conn.tools, // discovered via MCP handshake
  executeTool: conn.executeTool, // routed through MCP protocol
};

// Same agent loop handles both — it doesn't know the difference
const result = await runAgent(userMessage, history, config);
```

The agent accepts tools via **dependency injection** rather than importing them. This is the architectural pattern that MCP enables: separate tool existence from tool usage.

## Running the Demo

```bash
# MCP mode (default) — discovers tools dynamically from MCP server
pnpm dev:mcp

# Static mode — same tools, hardcoded (no MCP)
pnpm dev:mcp:static
```

In MCP mode, you'll see the discovery step:

```
  Connecting to MCP server...
  Discovered 3 tools via MCP:
    - search_recipes(query, cuisine)
    - get_recipe(recipe_id)
    - convert_units(value, from_unit, to_unit)

🔌  MCP (Model Context Protocol) — mcp mode
    Powered by Ollama + qwen2.5:7b
    Type "exit" to quit

    Mode: 🔌 MCP (tools discovered dynamically from server)
```

Try these prompts:

- "Find me an Italian pasta recipe"
- "Show me the full recipe for the carbonara"
- "Convert 2 cups to ml"
- "What quick recipes do you have?"

## When MCP Adds Value vs. Overhead

MCP isn't always the right choice. Here's when it helps and when it's overhead:

| Scenario                            | MCP                        | Static                |
| ----------------------------------- | -------------------------- | --------------------- |
| Single agent, fixed tools           | Overhead                   | Simpler               |
| Multiple agents sharing tools       | Reduces integration cost   | N×M integrations      |
| Third-party tool ecosystem          | Essential                  | Not portable          |
| Rapid prototyping / tool discovery  | Great for exploration      | Requires code changes |
| Production with locked dependencies | Discover → vendor → deploy | Already vendored      |
| Security-sensitive environments     | Needs careful trust model  | Easier to audit       |

**The practitioner consensus:** MCP is excellent for **discovery and prototyping** — discovering what tools a server offers, trying them interactively, iterating quickly. For **production deployment**, many teams follow a "discover then vendor" pattern: use MCP to find and test tools, then lock the tool definitions into source control with static schemas for predictable behavior.

**The token cost is real.** Research shows MCP integration can add 2x to 30x prompt-to-completion token inflation. A single GitHub MCP server's tool definitions consume ~50,000 tokens. Agents exposed to too many tools actually perform **worse** — there's an inverse correlation between tool count and reliability. Windsurf enforces a hard 100-tool limit across all MCP servers for this reason.

## In the Wild: Coding Agent Harnesses

MCP is the backbone of tool integration across coding agents. Here's how the major harnesses implement it:

**Claude Code** has the richest MCP experience. It manages servers at three scope levels — **local** (project-private, `.claude/settings.json`), **project** (git-tracked, `.mcp.json`), and **user** (`~/.claude.json`). The CLI offers `claude mcp add`, `claude mcp list`, and `claude mcp remove` for server management. When tool count grows large enough to consume 10%+ of the context window, Claude Code activates **Tool Search** — an on-demand discovery mechanism that selectively loads only the tools relevant to the current query, rather than injecting all tool definitions into every turn. Claude Code is also **dual-mode**: it can act as an MCP server itself (`claude mcp serve`), exposing its file editing and command execution capabilities to other MCP clients.

**Cursor** takes a **marketplace-first** approach. Since v1.0, the MCP Registry offers one-click "Add to Cursor" installation for 150+ integrations. Configuration goes in `.cursor/mcp.json` (compatible with Claude Desktop's format). A Tools icon in the IDE shows all available servers and their tools — making discovery visual rather than CLI-driven.

**GitHub Copilot** is unique in its **inputs system**. Copilot's MCP config supports `promptString` input fields that prompt the user for secrets at runtime rather than hardcoding them in config files. This avoids the common anti-pattern of API keys in `.mcp.json`. Copilot also supports **toolsets** — named groups of related tools that can be enabled/disabled as collections.

**Cline and Roo Code** prioritize **visual management**. Cline has a dedicated MCP Servers icon with a full GUI for config, per-tool auto-approval via `alwaysAllow`, and an adjustable network timeout slider. Roo Code adds a unique `watchPaths` feature — file paths that trigger automatic MCP server restart when they change, useful for servers whose behavior depends on config files. Notably, **Aider** is the only major coding harness (1 of 14) that still lacks native MCP support.

**The configuration UX is the real differentiator** between harnesses. The protocol itself is standard — the user experience of adding, managing, and securing MCP servers is where harnesses compete. Claude Code's CLI-first approach suits automation; Cursor's marketplace suits discovery; Cline's visual panel suits beginners.

## SDK v1 vs v2

This demo uses **SDK v1** (`@modelcontextprotocol/sdk` v1.27.1) — the current production release. SDK v2 is in pre-alpha with several changes worth knowing about:

| Aspect           | v1 (current)                              | v2 (upcoming)                                                                                                  |
| ---------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Package**      | Single `@modelcontextprotocol/sdk`        | Split: `@modelcontextprotocol/server` + `/client` + `/node`                                                    |
| **Tool API**     | `server.tool()`                           | `server.registerTool()`                                                                                        |
| **Schema**       | Plain Zod object: `{ param: z.string() }` | Full Zod object: `z.object({ param: z.string() })`                                                             |
| **Zod version**  | v3                                        | v4 (peer dependency)                                                                                           |
| **New features** | —                                         | `title` field, `outputSchema`, `structuredContent`, tool annotations (`readOnly`, `destructive`, `idempotent`) |

v2 adds explicit **output schemas** — the server can declare what shape a tool's response will have, and return `structuredContent` alongside the text content. This enables machine-readable tool results without parsing JSON from text. The `server.tool()` API will be deprecated but will still work initially, giving time to migrate.

## Key Takeaways

1. **MCP separates tool existence from tool usage.** The server decides what tools exist. The client discovers them. The agent uses them. No one needs to know how the others are implemented.

2. **Schema translation is the integration point.** Every agent framework has its own tool format. MCP standardizes discovery and invocation — a thin translation layer bridges the type systems. Our `mcpToolToDefinition` function is 20 lines of mechanical mapping.

3. **The agent loop is unchanged.** Dependency injection is the pattern that makes MCP work: pass `tools` and `executeTool` as config instead of importing them. The same ReAct loop handles both MCP and static tools.

4. **Start with stdio.** For local development, stdio transport (server as subprocess) is the simplest path. Move to Streamable HTTP when you need remote access or production deployment.

5. **Watch the token budget.** MCP tool definitions consume context window space. Research shows agents perform worse with too many tools. Discover tools dynamically during development, then vendor the ones you need for production.

## Sources & Further Reading

- [Model Context Protocol — Specification](https://modelcontextprotocol.io/) — official spec and documentation
- [Introducing the Model Context Protocol](https://www.anthropic.com/news/model-context-protocol) — Anthropic, 2024 — announcement and motivation
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — official TypeScript client/server implementation
- [OpenAI adopts MCP](https://openai.com/index/adding-mcp-support/) — OpenAI, 2025 — cross-vendor adoption signal
- [Advancing Multi-Agent Systems Through Model Context Protocol](https://arxiv.org/abs/2504.21030) — 2025 — formal analysis of MCP for multi-agent coordination
- [An Empirical Study of MCP Tool Description Smells](https://arxiv.org/abs/2508.12566) — 2025 — tool description quality analysis
- [MCP — A Critical Analysis](https://raz.farm/p/mcp-a-critical-analysis) — practitioner critique of MCP design decisions
- [Block + Goose: MCP at Enterprise Scale](https://block.xyz/inside/open-source-for-agents-how-blocks-engineers-use-goose) — Block, 2025 — production MCP deployment case study

---

_Next up: [A2A Protocol (Agent-to-Agent)](../a2a-protocol/README.md) — MCP solved "how does my agent use tools?" A2A solves "how does my agent work with other agents?"_
