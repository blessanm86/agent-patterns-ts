# Beyond console.log — Streaming Agent Output to a Real UI

[Agent Patterns — TypeScript](../../README.md)

> **Previous concept:** [Sub-Agent Delegation](../sub-agent-delegation/README.md) — spawning parallel child agents. This concept moves from terminal output to HTTP streaming, making agent output visible token-by-token in a browser.

---

Your user sends a message. Your agent calls `ollama.chat()`, waits for the full response, processes tool calls, waits again, and eventually returns a complete answer. Total time: 5-10 seconds. During that time, the user sees **nothing**. No loading indicator. No partial text. Just a blank screen.

They refresh the page. They click the button again. They assume it's broken.

Streaming fixes this. The first token appears in 200-500ms. The user watches text materialize word by word. Tool calls appear as cards mid-response. The same 10-second generation now _feels_ like 200ms because something is always happening.

## The SSE Protocol

Server-Sent Events is a unidirectional protocol — the server pushes data to the client over a standard HTTP connection. No WebSocket upgrade handshake. No special proxy configuration. Just HTTP with a specific content type:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

Each event is a block of `field: value` lines terminated by a double newline:

```
event: text
data: {"type":"text","content":"I'd be"}

event: text
data: {"type":"text","content":" happy"}

event: tool_call
data: {"type":"tool_call","name":"check_availability","arguments":{"check_in":"2026-03-01","check_out":"2026-03-05"}}

event: tool_result
data: {"type":"tool_result","name":"check_availability","result":"...","durationMs":2}

event: done
data: {"type":"done","metrics":{"ttftMs":245,"totalDurationMs":8200,"tokenCount":142,"tokensPerSecond":17}}
```

The key fields are `event` (the event type for dispatch) and `data` (the JSON payload). The double newline separates frames.

## Five Event Types

Our streaming agent uses a typed discriminated union — each event has a `type` field that determines how the client renders it:

| Event         | Payload                        | Client Rendering                                   |
| ------------- | ------------------------------ | -------------------------------------------------- |
| `text`        | `{ content: string }`          | Append to assistant bubble, show blinking cursor   |
| `tool_call`   | `{ name, arguments }`          | Tool card with wrench icon and formatted args      |
| `tool_result` | `{ name, result, durationMs }` | Result preview under tool card with duration badge |
| `done`        | `{ metrics: StreamMetrics }`   | Metrics bar: TTFT, total time, tok/s               |
| `error`       | `{ message: string }`          | Red error banner                                   |

```typescript
// src/streaming/types.ts — the full type definition

export type SSEEvent = TextEvent | ToolCallEvent | ToolResultEvent | DoneEvent | ErrorEvent;
```

The `done` event carries `StreamMetrics` — the key numbers that make the streaming vs. blocking difference measurable:

```typescript
export interface StreamMetrics {
  ttftMs: number; // Time to First Token — the blank-screen duration
  totalDurationMs: number;
  tokenCount: number;
  tokensPerSecond: number;
  toolCallCount: number;
  iterationCount: number;
}
```

## Adapting the ReAct Loop for Streaming

The original [ReAct](../react/README.md) agent makes a blocking `ollama.chat()` call and waits for the complete response:

```typescript
// Non-streaming (original ReAct agent)
const response = await ollama.chat({ model, messages, tools });
const assistantMessage = response.message;
```

The streaming version adds `stream: true` and iterates over chunks as they arrive:

```typescript
// Streaming — tokens appear immediately
const stream = await ollama.chat({
  model,
  messages,
  tools,
  stream: true,
});

let contentBuffer = "";
let toolCalls = [];

for await (const chunk of stream) {
  if (chunk.message.content) {
    emit({ type: "text", content: chunk.message.content });
    contentBuffer += chunk.message.content;
  }
  if (chunk.message.tool_calls?.length) {
    toolCalls = chunk.message.tool_calls;
  }
}
```

The `emit()` callback is the bridge between the agent and the HTTP response. In the server, it writes SSE-formatted data to the response stream:

```typescript
const emit = (event: SSEEvent): void => {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
};
```

The rest of the ReAct loop — tool execution, history management, iteration — stays identical. Streaming changes how output is delivered, not how the agent reasons.

## Why Not EventSource?

The browser's built-in `EventSource` API only supports GET requests. Our chat endpoint needs POST (to send the message body and conversation history). Instead, we use `fetch()` with `response.body.getReader()`:

```javascript
const res = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message, history, stream: true }),
});

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split("\n\n");
  buffer = frames.pop(); // keep incomplete frame

  for (const frame of frames) {
    // parse event: and data: fields, dispatch to handlers
  }
}
```

This gives us the same SSE semantics with POST support.

## Buffering and Flushing

The SSE format uses `\n\n` as frame delimiters. The server writes complete frames via `res.write()`. Node.js HTTP flushes each `write()` call immediately when the response headers include `Transfer-Encoding: chunked` (the default for streaming responses).

One subtlety on the client: a single `reader.read()` call may return partial frames, multiple complete frames, or a mix of both. The client maintains a buffer and splits on `\n\n`, keeping the last (potentially incomplete) segment for the next read.

## Error Handling in Streams

Errors during streaming are tricky — the HTTP headers (200 OK) have already been sent. We can't change the status code. Instead, we emit an `error` event:

```typescript
try {
  const updatedHistory = await agent(userMessage, history, emit);
  res.write(formatSSE("history", updatedHistory));
} catch (err) {
  emit({ type: "error", message: err.message });
}
res.end();
```

The client renders error events as red banners. This is the same pattern Anthropic and OpenAI use — once the SSE stream is open, errors are events, not HTTP status codes.

## The Measurable Difference

The demo includes a **Streaming / Blocked** toggle that hits the same endpoint with `stream: true` or `stream: false`. The difference is immediately visible:

|                            | Streaming                            | Blocked                  |
| -------------------------- | ------------------------------------ | ------------------------ |
| **TTFT**                   | 200-500ms                            | 3-10s (= total duration) |
| **User sees**              | Tokens appearing one by one          | Nothing, then everything |
| **Perceived speed**        | Fast — something is always happening | Slow — feels broken      |
| **Actual generation time** | Same                                 | Same                     |

The total wall-clock time is identical. The only difference is when the first byte reaches the user. That's the entire point of streaming — it's a perceived-latency optimization, not an actual-latency optimization.

The key metric is **TTFT (Time to First Token)**:

- **TTFT** = time from request to first visible token
- In streaming mode, TTFT is the time for the LLM to generate its first token (~200-500ms for local models)
- In blocked mode, TTFT equals total generation time because nothing appears until everything is ready

## Running the Demo

```bash
# Start Ollama (if not already running)
ollama serve

# Start the streaming server
pnpm dev:streaming

# Open in browser
open http://localhost:3007
```

1. Send "Do you have any double rooms for March 1-5?"
2. Watch tokens stream in, tool cards appear, metrics show TTFT ~200-500ms
3. Toggle to **Blocked** mode, send the same query
4. Notice: blank screen for several seconds, then everything appears at once
5. Compare the TTFT numbers in the metrics bar

## In the Wild: Coding Agent Harnesses

The demo above streams tokens to a browser for human consumption. Production coding agent harnesses take streaming much further -- using it not just for display, but as a structural protocol for diff application, durable session management, and speculative code generation.

**Cursor** uses streaming as the backbone of its "Instant Apply" system, which rewrites entire files at roughly [1000 tokens per second on a fine-tuned Llama-3-70B model](https://cursor.com/blog/instant-apply). The key innovation is _speculative edits_ -- a variant of speculative decoding where, instead of using a draft model to predict future tokens, a deterministic algorithm speculates based on the original file content. The inference engine validates the longest matching prefix against the model's temperature-0 output, then continues with normal generation. This yields a ~13x speedup over vanilla inference. The streaming dimension is critical here: as the model generates the rewritten file, Cursor streams the output directly into the editor, so the user sees edits materialize in real time. The model, the speculation engine, and the editor form a single streaming pipeline -- the file is being rewritten, validated, and displayed simultaneously. Cursor partnered with [Fireworks AI to deploy the custom speculation logic](https://fireworks.ai/blog/cursor) at the inference layer, meaning the streaming protocol extends from the GPU through to the editor tab.

**OpenAI Codex** treats streaming as a full wire protocol, not a UX convenience. Its [App Server architecture](https://developers.openai.com/codex/app-server/) organizes all interactions into a hierarchy of Threads, Turns, and Items. A Thread is a durable conversation container persisted as JSONL on disk. A Turn is a single request-response cycle within a thread. An Item is a granular unit -- a user message, agent message, shell command execution, or file change. After a client calls `turn/start`, the server streams a sequence of JSON-RPC notifications: `item/started`, `item/agentMessage/delta` (incremental text), `item/completed`, and eventually `turn/completed` with token usage. This is not SSE -- it is bidirectional JSON-RPC over stdio or WebSocket. The protocol supports `thread/resume` for reconnection and `thread/fork` for branching, meaning a client that disconnects mid-turn can reconnect and catch up from the persisted JSONL without rebuilding state. Streaming here serves durability and composability, not just perceived latency.

**Cline** applies streaming at the editor integration layer. When the LLM generates a diff, Cline does not wait for the complete response before showing changes. Its [`DiffViewProvider`](https://github.com/cline/cline) streams partial edits into VS Code's diff view as tokens arrive, using `DecorationController` instances to render a semi-transparent overlay on unprocessed lines and a highlighted background on the line currently being written. The effect is that users watch edits materialize line-by-line in the actual file, not in a chat window. Cline's [v3.12 release](https://cline.bot/blog/cline-v3-12-faster-diff-edits-model-favorites-and-more) significantly improved performance of this streaming diff application for large files. The approach comes with tradeoffs -- repeatedly applying and removing VS Code decorations at high frequency consumes noticeable CPU, reducing responsiveness on lower-spec machines. Cline also supports an [order-invariant multi-diff apply algorithm](https://cline.bot/blog/improving-diff-edits-by-10) with model-specific delimiters (Anthropic models use `--/+++` markers while Gemini models use `>>>/<<<` blocks), meaning the streaming diff pipeline must handle format differences on the fly.

The common thread across all three harnesses is that streaming is not just "show tokens as they arrive." Cursor streams through a speculation engine to rewrite files at GPU speed. Codex streams through a durable protocol so sessions survive disconnects. Cline streams through a decoration pipeline so edits appear in the editor, not the chat. Each one extends the SSE-style pattern from this demo into a domain-specific streaming architecture that would not work with blocking request-response.

## Key Takeaways

1. **Streaming is a UX optimization, not a speed optimization.** Total generation time doesn't change. What changes is when the user sees the first token.

2. **TTFT is the metric that matters.** It's the difference between "fast" and "broken" in user perception. Sub-second TTFT makes any generation time feel acceptable.

3. **Typed events > raw tokens.** Sending structured events (`text`, `tool_call`, `tool_result`, `done`) lets the client render each type appropriately. A tool call gets a card; a result gets a preview; metrics get a bar.

4. **SSE > WebSockets for LLM streaming.** LLM output is unidirectional (server → client). SSE is simpler, works with standard HTTP infrastructure, and requires no upgrade handshake. WebSockets add bidirectional complexity you don't need.

5. **fetch + getReader > EventSource for POST.** The browser's EventSource API is GET-only. Since chat endpoints need POST bodies, use `fetch()` with a `ReadableStream` reader for manual SSE parsing.

6. **Errors become events in streams.** Once SSE headers are sent (200 OK), you can't change the status code. Errors are emitted as typed events that the client renders as banners.

## Sources & Further Reading

- [Server-sent events — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) — authoritative SSE web standard reference
- [OpenAI Streaming API](https://platform.openai.com/docs/guides/streaming-responses) — streaming with typed event types (`response.output_text.delta`, etc.)
- [Anthropic Streaming Messages](https://docs.anthropic.com/en/api/messages-streaming) — SSE protocol for Claude (`message_start`, `content_block_delta`, `message_stop`)
- [Vercel AI SDK — Streaming](https://ai-sdk.dev/docs/foundations/streaming) — practical framework for building streaming AI UIs
