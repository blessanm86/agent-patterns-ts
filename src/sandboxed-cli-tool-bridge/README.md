# Sandboxed CLI Tool Bridge

Your sandboxed agent needs a database lookup, but it can't import your SDK. It needs weather data, but it has no network access. It needs to search files, but it's running in a restricted subprocess with no filesystem visibility.

This is the tool bridge problem — and the solution is the same one MCP uses: expose tools as a CLI binary that speaks JSON-RPC over stdin/stdout.

In the [Sandboxed Code Execution](../sandboxed-code-execution/README.md) demo, the tool bridge was invisible to the LLM. The sandbox code called `callTool()` — a JavaScript function injected into the VM context — and the bridge handled everything via Node.js IPC (`process.send`). The LLM never knew how tools were delivered.

This concept flips that on its head. Here, the CLI bridge **is the tool**. The model calls `execute_shell("tools list")`, `execute_shell("tools describe weather.lookup")`, `execute_shell("tools invoke weather.lookup --args='...'")`. The discovery-describe-invoke workflow is explicit, visible, and teachable.

[Agent Patterns — TypeScript](../../README.md)

---

## The Architecture

```
Host Process                              Sandbox Subprocess
┌─────────────────────┐                   ┌─────────────────────────┐
│ Agent (ReAct loop)   │                   │ sandbox-runner.ts        │
│   ↓ execute_shell    │   spawn()         │   receives shell cmds    │
│ ToolBridge ──────────│──────────────────►│   routes "tools" cmds    │
│   ↓ JSON-RPC router  │   stdin/stdout    │   to cli-binary.ts       │
│ ToolRegistry         │◄────────────────►│   sends JSON-RPC requests│
│   weather.lookup     │  (newline-delim   │   formats responses      │
│   math.evaluate      │   JSON-RPC)       │                          │
│   files.search       │                   └─────────────────────────┘
│   restaurant.find    │
└─────────────────────┘
```

The host process spawns the sandbox via `child_process.spawn()` (not `fork()` — raw stdin/stdout, no hidden Node IPC channel). This is the same transport MCP's stdio mode uses: newline-delimited JSON, one message per line, no framing, no HTTP.

## Why a CLI?

When you need to expose tools across a process boundary, you have several transport options: HTTP, gRPC, Unix sockets, shared memory, Node IPC. A CLI over stdin/stdout wins for this use case for five reasons:

1. **Universal** — every language can read stdin and write stdout. No SDK needed.
2. **Language-agnostic** — the sandbox could be Python, Go, Rust, or a shell script. The protocol doesn't care.
3. **Discoverable** — `tools list` and `tools describe` are self-documenting. No separate API docs needed.
4. **Composable** — you can pipe, script, and test tools from a terminal. `echo '...' | tools invoke` works.
5. **Matches MCP** — the Model Context Protocol uses exactly this transport for local tool servers. Learning it here means you already understand MCP's stdio mode.

## JSON-RPC Wire Format

Every message between host and sandbox is a single JSON object terminated by `\n`. The protocol is JSON-RPC 2.0 — the same protocol MCP uses under the hood.

**Request (sandbox → host):**

```json
{ "jsonrpc": "2.0", "id": "req-1", "method": "tools.list", "params": { "token": "abc123" } }
```

**Success response (host → sandbox):**

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "result": [{ "fullName": "weather.lookup", "description": "Look up current weather" }]
}
```

**Error response (host → sandbox):**

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "error": {
    "code": -32001,
    "message": "You must call \"tools describe weather.lookup\" before invoking it."
  }
}
```

The envelope messages (`shell_command`, `shell_result`, `jsonrpc_request`, `jsonrpc_response`) wrap these JSON-RPC payloads for routing between the shell command handler and the JSON-RPC layer. This two-level structure keeps the shell interface simple while the protocol stays clean.

## The Three-Step Tool Workflow

The model must follow a strict discovery protocol:

### 1. List — see what's available

```
execute_shell("tools list")
```

Returns a human-readable list of all tools with their namespaced names and descriptions. This is the entry point — the model starts here every time.

### 2. Describe — learn the parameters

```
execute_shell("tools describe weather.lookup")
```

Returns the tool's parameter schema: names, types, which are required, and example usage. The host tracks which tools have been described in the current session.

### 3. Invoke — call the tool

```
execute_shell("tools invoke weather.lookup --args='{\"city\":\"Paris\"}'")
```

Sends a JSON-RPC `tools.invoke` request. The host validates the session token and checks that the tool was described first. If not, it returns a helpful error:

```
Error: You must call "tools describe weather.lookup" before invoking it.
This ensures you know the correct parameters.
```

This is the **describe-before-invoke enforcement** — a protocol guard that prevents the model from guessing parameter names and getting them wrong. It's a teaching mechanism: the error message tells the model exactly what to do next.

## Describe-Before-Invoke: Why It Matters

Without this guard, models frequently hallucinate parameter names. They'll call `weather.lookup` with `{location: "Paris"}` instead of `{city: "Paris"}`, or `math.evaluate` with `{query: "2+2"}` instead of `{expression: "2+2"}`. The describe step forces the model to read the actual schema before attempting a call.

This pattern appears in MCP as well — clients call `tools/list` to get tool schemas before calling `tools/call`. The difference is that MCP doesn't enforce it at the protocol level (it's a convention), while our bridge makes it a hard requirement. Both approaches work; the enforcement is more valuable when models are weaker or tool schemas are complex.

The implementation is simple: a `Set<string>` in the session tracks described tools, and the JSON-RPC router checks it on every invoke:

```typescript
// In the JSON-RPC router
case "tools.invoke": {
  if (!this.session.describedTools.has(name)) {
    return {
      jsonrpc: "2.0", id,
      error: {
        code: JSON_RPC_ERRORS.DESCRIBE_REQUIRED,
        message: `You must call "tools describe ${name}" before invoking it.`,
      },
    };
  }
  // ... proceed with invocation
}
```

## Namespaced Tools

Tools are namespaced with a `namespace.name` convention: `weather.lookup`, `math.evaluate`, `files.search`, `restaurant.find`. This prevents name collisions when multiple tool providers exist — the same pattern MCP uses with `mcp__<server>__<tool>`.

The `ToolRegistry` class stores tools by their full name and supports registration from any number of providers:

```typescript
const registry = new ToolRegistry();
registerAllTools(registry); // weather.*, math.*, files.*, restaurant.*

// In production, you might register from multiple sources:
// registerWeatherTools(registry);
// registerDatabaseTools(registry);
```

## Implementation Walkthrough

### The Sandbox Runner (`sandbox-runner.ts`)

The subprocess runs as a spawned child process. It reads newline-delimited JSON from stdin and writes to stdout. When it receives a `shell_command` message:

1. If the command starts with `tools`, it routes to the CLI binary
2. The CLI binary constructs a JSON-RPC request and calls `sendRequest()`
3. `sendRequest()` writes the request to stdout and returns a Promise
4. The host reads the request, routes it to the ToolRegistry, and writes the response back
5. The runner reads the response, resolves the Promise, and the CLI binary formats the output
6. The formatted output is sent back as a `shell_result`

This request-response dance is the core of the stdio transport pattern.

### The Tool Bridge (`tool-bridge.ts`)

The host-side bridge is the coordinator. It spawns the sandbox, manages the bidirectional message stream, and enforces the protocol:

- **Token validation**: every invoke request includes a session token. Invalid tokens are rejected with `AUTH_FAILED`.
- **Describe tracking**: a `Set<string>` tracks which tools the model has described. Invoke without describe returns `DESCRIBE_REQUIRED`.
- **Timeout handling**: commands that take too long are rejected. The sandbox continues running, but the pending command is resolved with an error.

### The Agent (`agent.ts`)

The ReAct loop has a single tool: `execute_shell`. The system prompt instructs the model to use the `tools` CLI workflow. The model typically follows this pattern:

1. `tools list` → see available tools
2. `tools describe <name>` → learn parameters
3. `tools invoke <name> --args='...'` → get results
4. Summarize results to the user

Each shell command is a separate tool call in the ReAct loop, so you can see the full discovery flow in the console output.

## In the Wild: Coding Agent Harnesses

The pattern of exposing tools as a CLI binary over stdin/stdout is the foundation of how MCP servers work in practice — and every major coding agent harness uses it.

**MCP's stdio transport** is the canonical implementation of this pattern. An MCP server is a subprocess spawned with `child_process.spawn()`, communicating via newline-delimited JSON-RPC 2.0 on stdin/stdout. The client calls `tools/list` to discover tools, gets schemas back, and then calls `tools/call` with the correct parameters. Our demo builds this same protocol from scratch, showing what's happening inside that MCP client-server handshake.

**Claude Code** uses MCP stdio servers extensively — users can configure external MCP servers that Claude Code spawns and communicates with over stdin/stdout. Its permission system (deny → ask → allow) gates every tool invocation, and it uses OS-level sandboxing (macOS seatbelt profiles, Linux bwrap) to restrict what spawned processes can do. The `Tool Search Tool` pattern in Claude Code lets the model discover available tools dynamically, similar to our `tools list` step.

**OpenAI Codex CLI** adopted MCP's stdio transport for its tool integration. It runs MCP servers as subprocesses and uses an explicit approval flow — the model proposes a tool call, the user approves or denies via a JSON-RPC "elicitation" mechanism, and only then does the call execute. Its cloud sandbox mode uses a two-phase approach: setup runs with network access, then the agent runs offline — a stricter form of the sandbox isolation we demonstrate here.

**Inspect AI** (UK AI Safety Institute) uses a proxy bridge pattern for sandboxed tool access: it deploys an HTTP proxy on `localhost:13131` inside Docker containers, and tool calls from sandboxed code are forwarded through this proxy to the host's tool registry. This is the HTTP equivalent of our stdin/stdout bridge — same pattern, different transport.

**OpenCode** implements MCP tool discovery with practical production touches: a 30-second timeout on server startup, panic recovery for partial discovery failures, and `mcp__<server>__<tool>` namespacing for collision prevention. If one MCP server fails to start, the agent continues with tools from servers that did start.

## Key Takeaways

1. **Stdin/stdout is a universal IPC transport.** No SDK, no HTTP server, no port management — just newline-delimited JSON. This is what MCP's stdio mode uses, and it works for any language pair.

2. **Describe-before-invoke prevents hallucinated parameters.** Making tool discovery a required protocol step, not an optional convention, catches parameter mismatches before they waste a tool call.

3. **The CLI bridge pattern makes tools explicitly discoverable.** Unlike injected functions (the previous demo's `callTool()`), a CLI with `list/describe/invoke` subcommands is self-documenting and testable from a terminal.

4. **Namespaces prevent collisions at scale.** When multiple tool providers coexist, `weather.lookup` and `database.lookup` can't clash. MCP uses the same pattern with `mcp__server__tool`.

5. **The model's tool-use workflow mirrors MCP exactly.** List → describe → invoke is how every MCP client discovers and uses tools. Understanding this three-step protocol is understanding MCP's core interaction model.

## Sources & Further Reading

- [MCP Specification — Transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) — Official MCP stdio transport spec
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification) — The wire protocol underneath MCP
- [Claude Code — MCP Server Configuration](https://docs.anthropic.com/en/docs/claude-code/mcp) — How Claude Code uses MCP stdio servers
- [OpenAI Codex CLI — MCP Integration](https://github.com/openai/codex) — Codex CLI's MCP tool support
- [Inspect AI — Tool Sandbox](https://inspect.ai-safety-institute.org.uk/tools.html) — UK AISI's sandbox bridge pattern
- [Anthropic — Tool Use Best Practices](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/best-practices-and-limitations) — Parameter naming and description guidance
- [Sandboxed Code Execution](../sandboxed-code-execution/README.md) — The prerequisite demo showing IPC-based tool bridges
