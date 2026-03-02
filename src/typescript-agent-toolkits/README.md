# Vercel AI SDK vs Mastra: Choosing Your TypeScript Agent Stack

At some point every TypeScript developer building agents hits the same fork in the road: keep assembling primitives by hand, or adopt a toolkit that packages the patterns for you? This guide maps that choice.

The two serious TypeScript-native options are **Vercel AI SDK** and **Mastra**. They're not competitors — Mastra is built on top of the AI SDK. But they represent genuinely different levels of the stack, and the choice between them shapes your entire architecture. This guide shows you what each one actually does, where they complement each other, and how they map to patterns you may have already built from scratch.

---

## The Landscape

Before diving into either toolkit, one fact shapes everything else:

> **Mastra is built on top of Vercel AI SDK.** It uses the AI SDK for all LLM calls and adds a production-grade layer on top.

The mental model:

```
┌────────────────────────────────────────────────────────────┐
│                         Mastra                             │
│   Agent class · Workflows · Memory · RAG · Evals · Deploy  │
├────────────────────────────────────────────────────────────┤
│                     Vercel AI SDK                          │
│   generateText · streamText · tool() · provider routing    │
├────────────────────────────────────────────────────────────┤
│                    LLM Providers                           │
│   OpenAI · Anthropic · Google · Mistral · Ollama · 20+     │
└────────────────────────────────────────────────────────────┘
```

The implication: learning the AI SDK makes you better at Mastra too. Choosing Mastra doesn't mean abandoning the AI SDK — you're still writing AI SDK code inside Mastra steps and tools.

---

## Part 1: Vercel AI SDK — "Functions, Not Frameworks"

The AI SDK's philosophy is composable primitives. No classes required. Everything composes via function calls and TypeScript types.

**Adoption:** 20M+ monthly npm downloads, 22.2K GitHub stars, Apache 2.0 licensed. Thomson Reuters built [CoCounsel](https://legal.thomsonreuters.com/en/products/cocounsel) (serving 1,300+ accounting firms) with it — 3 developers, 2 months.

### The Core Primitives

**`generateText()`** — non-streaming, returns a complete response. The primary building block for agents:

```typescript
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const { text, toolCalls, toolResults, steps, usage } = await generateText({
  model: openai("gpt-4o"),
  system: "You are a helpful assistant.",
  messages: conversationHistory,
  tools: { searchWeb, getWeather },
  maxSteps: 10,
});
```

**`streamText()`** — identical API, returns a stream. Every `generateText` call can become `streamText` — the only difference is the return type.

**`tool()`** — type-safe tool definition. The tool has two distinct parts that mirror the pattern in this repo's demos: a schema (what gets sent to the model) and an `execute` function (what actually runs):

```typescript
import { tool } from "ai";
import { z } from "zod";

const getWeather = tool({
  description: "Get current weather for a city",
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => {
    const data = await fetchWeatherAPI(city);
    return { temp: data.temperature, condition: data.condition };
  },
});
```

The model receives the description and schema. It never sees `execute`. This separation is exactly the [Tool System](../react/README.md) pattern you've already built.

### Agent Loop Control

The AI SDK's agent loop runs inside `generateText` with `maxSteps`. The loop continues as long as the model returns tool calls; it stops when the model returns plain text, a `stopWhen` condition fires, or `maxSteps` is reached.

**`stopWhen`** — composable stopping conditions:

```typescript
import { generateText, stopWhen, stepCountIs, hasToolCall } from "ai";

await generateText({
  // ...
  stopWhen: stepCountIs(20), // built-in: stop after 20 steps
  stopWhen: hasToolCall("finalAnswer"), // built-in: stop when this tool is called

  // custom: stop when cumulative tokens exceed 50k
  stopWhen: ({ steps }) => steps.reduce((t, s) => t + s.usage.inputTokens, 0) > 50_000,
});
```

**`prepareStep`** — runs before each step, lets you modify the model, tools, or context mid-loop:

```typescript
await generateText({
  // ...
  prepareStep: async ({ model, stepNumber, steps, messages }) => {
    // Use a cheap model for middle steps, expensive for first and last
    if (stepNumber > 0 && stepNumber < maxSteps - 1) {
      return { model: openai("gpt-4o-mini") };
    }
    // Restrict available tools as the loop progresses
    if (stepNumber < 2) {
      return { activeTools: ["search", "browse"] };
    }
    return { activeTools: ["writeSummary"] };
  },
});
```

**The "done" tool trick** — a tool with no `execute` function acts as a termination signal. Combined with `toolChoice: 'required'`, the loop only terminates when the model chooses to call `done`:

```typescript
const done = tool({
  description: "Call this when the task is complete.",
  inputSchema: z.object({ summary: z.string() }),
  // no execute — tool with no execute halts the loop naturally
});

await generateText({ tools: { done, ...otherTools }, toolChoice: "required" });
```

### Subagents

A subagent is `generateText` (or `streamText`) inside a tool's `execute` function. The outer agent delegates a subtask; the inner agent runs its own full loop.

The key innovation is `toModelOutput` — it controls what the _parent_ model sees from the subagent's work. A subagent can consume 100k tokens internally and return only a 500-token summary to the parent:

```typescript
const researchTask = tool({
  description: "Research a topic in depth and return a concise summary.",
  inputSchema: z.object({ topic: z.string() }),
  execute: async ({ topic }, { abortSignal }) => {
    const result = await generateText({
      model: openai("gpt-4o"),
      prompt: `Research: ${topic}. End with: "SUMMARY: [your findings]"`,
      tools: { searchWeb, browseUrl },
      maxSteps: 15,
      abortSignal, // always propagate abort signals to subagents
    });
    return result.text;
  },
  // What the parent model sees — only the last text block, not all 100k tokens
  toModelOutput: ({ output }) => {
    const lastText = output?.parts?.findLast((p) => p.type === "text");
    return { type: "text", value: lastText?.text ?? "Research complete." };
  },
});
```

Rules to follow: always pass `abortSignal`; subagents have no approval gates (parent controls those); contexts are isolated by default.

This maps directly to [Sub-Agent Delegation](../sub-agent-delegation/README.md) — but with built-in context compression.

### Middleware (`wrapLanguageModel`)

The middleware system lets you intercept every LLM call without touching agent code. Three hooks:

- `transformParams` — modify the request before it reaches the model (inject RAG context, add system instructions, log inputs)
- `wrapGenerate` — wrap non-streaming calls
- `wrapStream` — wrap streaming calls

```typescript
import { wrapLanguageModel } from "ai";

// Inject retrieved docs into every call transparently
const ragMiddleware = {
  transformParams: async ({ params }) => {
    const query = params.messages.at(-1)?.content;
    const docs = await vectorSearch(query);
    const injected = `Relevant context:\n${docs}\n\n${query}`;
    return {
      ...params,
      messages: [...params.messages.slice(0, -1), { role: "user", content: injected }],
    };
  },
};

const model = wrapLanguageModel({
  model: anthropic("claude-sonnet-4-6"),
  middleware: ragMiddleware,
});
```

Built-in middleware: `extractReasoningMiddleware` (surfaces chain-of-thought tokens), `simulateStreamingMiddleware` (makes non-streaming models streamable), `devToolsMiddleware` (full call visibility at localhost:4983).

This is the same concept as [Agent Middleware Pipeline](../middleware-pipeline/README.md) — with first-class framework support.

### Provider Switching (5 Ways)

The AI SDK defines a [Language Model Specification](https://github.com/vercel/ai/tree/main/packages/provider) (now at v3) that all 24+ provider packages implement. This means you can swap providers without changing your agent logic:

```typescript
// 1. Direct import — change the import to change the model
model: openai("gpt-4o");
model: anthropic("claude-sonnet-4-6");

// 2. Provider registry — switch by changing a string
const registry = experimental_createProviderRegistry({ openai, anthropic });
model: registry.languageModel("openai:gpt-4o");

// 3. Custom provider with aliases — update the alias, not call sites
const myProvider = createProviderRegistry({
  smart: openai("gpt-4o"),
  cheap: openai("gpt-4o-mini"),
});
model: myProvider.languageModel("smart");

// 4. Global default — set once at startup
globalThis.AI_SDK_DEFAULT_PROVIDER = openai;
model: "gpt-4o";

// 5. Dynamic per-step (via prepareStep) — different model per step in the loop
prepareStep: async ({ stepNumber }) => ({
  model: stepNumber === 0 ? anthropic("claude-opus-4-6") : openai("gpt-4o-mini"),
});
```

### Human-in-the-Loop

`needsApproval` on a tool suspends the agent loop until the user approves or rejects:

```typescript
const executeSQL = tool({
  description: "Execute a SQL query against the database.",
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => await db.query(query),
  // Require approval for write operations
  needsApproval: async ({ query }) => /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i.test(query),
});
```

When approval is required: the loop pauses (`finishReason: 'tool-calls'` with no execution), the tool call is surfaced to the UI, and the loop resumes after a decision. This maps directly to [Human-in-the-Loop](../human-in-the-loop/README.md).

### AI SDK 6 and the `ToolLoopAgent` Class

AI SDK 6 (released late 2025) introduced a reusable `ToolLoopAgent` class — define your agent once, use it everywhere:

```typescript
import { ToolLoopAgent } from "ai";

const supportAgent = new ToolLoopAgent({
  model: openai("gpt-4o"),
  system: "You are a customer support specialist.",
  tools: { searchKnowledgeBase, createTicket, escalate },
  stopWhen: hasToolCall("escalate"),
});

// Reuse across chat UI, API handlers, background jobs — same config
const { text } = await supportAgent.generate(messages);
```

Other AI SDK 6 additions: DevTools debugger, stable MCP with OAuth support, structured output + tool calling in a single loop, provider-specific tools (Anthropic computer use, OpenAI code interpreter).

### The Memory Gap

One important limitation: **AI SDK agents are stateless by default.** Each `generateText` call starts fresh. Memory is your responsibility.

Three approaches the SDK supports:

1. **Provider-defined tools** — Anthropic's Memory Tool gives Claude a `/memories` directory to manage (provider lock-in trade-off)
2. **Memory providers** — third-party services like Letta, Mem0, Supermemory integrate via the SDK's `MemoryAdapter` interface
3. **Custom tools** — build your own `readMemory`/`writeMemory` tools (maximum control, maximum work)

AI SDK 6 introduced foundational `MemoryAdapter`/`MemoryEntry` primitives — but they're low-level building blocks, not a batteries-included memory system. If you need persistent cross-session memory with semantic recall built in, read Part 2.

---

## Part 2: Mastra — "The Next.js of AI Agents"

Mastra was built by the Gatsby team — **Sam Bhagwat**, **Abhi**, and **Shane** — the same people who built the Gatsby static site generator. YC W25, $13M seed from investors including Guillermo Rauch (Vercel) and Amjad Masad (Replit). As of early 2026: 21,600+ GitHub stars, ~190K weekly downloads, production at Replit, Marsh McLennan (75,000 employees), PayPal, Adobe, SoftBank.

The thesis: AI SDK gives you the right primitives, but converting a prototype to production requires assembling memory, workflows, observability, evals, and deployment plumbing by hand every time. Mastra packages all of that.

```typescript
// The Mastra instance is the central registry
import { Mastra } from "@mastra/core";

export const mastra = new Mastra({
  agents: { supportAgent },
  workflows: { onboardingWorkflow },
});

// Retrieve via the registry — not direct import — so the framework can inject config
const agent = mastra.getAgent("supportAgent");
const workflow = mastra.getWorkflow("onboardingWorkflow");
```

### The Agent Class

Mastra's `Agent` wraps AI SDK's `generateText`/`streamText` and adds memory, structured output, scorers, and sub-agent support in a single object:

```typescript
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai"; // standard AI SDK model instance

const supportAgent = new Agent({
  id: "support-agent",
  name: "SupportAgent",
  instructions: "You are a helpful customer support agent.",
  model: openai("gpt-4o"), // AI SDK model — no adapter required
  tools: { searchKnowledgeBase, createTicket },
  memory: new Memory({ storage: new LibSQLStore({ url: "file:./local.db" }) }),
});

// Generate
const result = await supportAgent.generate("I need help with my order", {
  memory: { thread: "conv-001", resource: "user-alice" },
  maxSteps: 5,
});

// Stream
const stream = await supportAgent.stream("Tell me about your refund policy");
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}

// Structured output
const structured = await supportAgent.generate("Extract the order details", {
  output: z.object({ orderId: z.string(), issue: z.string() }),
});
```

**Dynamic instructions** — the `instructions` field accepts an async function that receives `runtimeContext`, enabling per-request system prompt customization without a new agent instance.

### Tools (`createTool`)

Mastra has its own `createTool` function with explicit `inputSchema`/`outputSchema` separation. The output schema enables type checking in workflow step composition:

```typescript
import { createTool } from "@mastra/core/tools";

export const weatherTool = createTool({
  id: "get-weather",
  description: "Get current weather for a city",
  inputSchema: z.object({ city: z.string().describe("City name") }),
  outputSchema: z.object({ temp: z.number(), condition: z.string() }),
  execute: async ({ context }) => ({
    temp: 22,
    condition: "sunny",
  }),
});
```

Mastra agents can also connect to any **MCP server** and expose all its tools automatically. In the other direction, a Mastra agent can be exposed _as_ an MCP server — making it callable from Claude Code, Cursor, or any MCP client.

### Workflows — The Key Differentiator

This is where Mastra diverges most from pure AI SDK usage. Where AI SDK gives you a `while(true)` loop controlled by the model, Mastra's workflow engine gives you a **typed, deterministic pipeline** controlled by your code.

```
┌──────────────────────────────────────────────────────────────────┐
│                    Mastra Workflow Engine                         │
│                                                                  │
│  .then()     ──► sequential: step A finishes, then step B        │
│  .parallel() ──► concurrent: step A and B run together           │
│  .branch()   ──► conditional: first matching predicate wins      │
│  .dountil()  ──► loop until: repeat step until condition is true  │
│  .dowhile()  ──► loop while: repeat step while condition holds    │
│  .foreach()  ──► map: run step for each item in an array         │
│                                                                  │
│  Type constraint: each step's outputSchema = next step's input   │
└──────────────────────────────────────────────────────────────────┘
```

**Steps** are the building blocks — pure typed functions with Zod-validated inputs and outputs:

```typescript
import { createStep } from "@mastra/core/workflows";

const validateOrder = createStep({
  id: "validate-order",
  inputSchema: z.object({ orderId: z.string(), userId: z.string() }),
  outputSchema: z.object({ order: orderSchema, isValid: z.boolean() }),
  execute: async ({ inputData }) => {
    const order = await db.orders.findById(inputData.orderId);
    return { order, isValid: order?.userId === inputData.userId };
  },
});
```

**Building the workflow:**

```typescript
import { createWorkflow } from "@mastra/core/workflows";

export const orderRefundWorkflow = createWorkflow({
  id: "order-refund",
  inputSchema: z.object({ orderId: z.string(), userId: z.string() }),
  outputSchema: z.object({ status: z.string(), refundId: z.string().optional() }),
})
  .then(validateOrder)
  .branch([
    [async ({ inputData }) => !inputData.isValid, rejectStep],
    [async ({ inputData }) => inputData.order.amount > 500, requireApprovalStep],
    [async () => true, autoApproveStep], // default branch
  ])
  .then(sendConfirmationEmail)
  .commit();
```

**Running it:**

```typescript
const run = await orderRefundWorkflow.createRun();
const result = await run.start({
  inputData: { orderId: "ORD-123", userId: "user-alice" },
});

if (result.status === "success") console.log(result.result);
if (result.status === "failed") console.error(result.error.message);
if (result.status === "suspended") {
  // Human approval required — resume when ready
  await run.resume({ step: "require-approval", resumeData: { approved: true } });
}
```

**Suspend & Resume** — a step calls `suspend()` to pause execution with optional context. State is persisted. `run.resume()` picks up exactly where it left off:

```typescript
const requireApprovalStep = createStep({
  id: "require-approval",
  inputSchema: z.object({ order: orderSchema, isValid: z.boolean() }),
  outputSchema: z.object({ approved: z.boolean() }),
  resumeSchema: z.object({ approved: z.boolean() }),
  suspendSchema: z.object({ reason: z.string(), amount: z.number() }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (resumeData?.approved !== undefined) {
      return { approved: resumeData.approved };
    }
    return await suspend({
      reason: "Order exceeds auto-approve threshold",
      amount: inputData.order.amount,
    });
  },
});
```

This is [Human-in-the-Loop](../human-in-the-loop/README.md) + [State Graph](../state-graph/README.md) combined — with persistence built in.

**Parallel and loops:**

```typescript
// Run enrichment steps concurrently
.parallel([enrichWithCRM, enrichWithAnalytics, enrichWithBilling])
.then(mergeEnrichmentStep)

// Retry until score exceeds threshold
.dountil(generateAndEvaluateStep, async ({ inputData }) => inputData.score > 0.85)

// Process each product in the cart
.foreach(applyDiscountStep, { concurrency: 4 })
```

### Memory System

Mastra's memory system is batteries-included — four layers that activate as needs grow:

```
Layer 1: Message History    — recent turns in the current thread
Layer 2: Working Memory     — LLM-managed scratchpad (user profile, preferences)
Layer 3: Semantic Recall    — RAG over past conversations by meaning
Layer 4: Observational      — background agents that condense long histories
```

**Layer 1+2 — basic setup:**

```typescript
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";

const agent = new Agent({
  memory: new Memory({
    storage: new LibSQLStore({ url: "file:./local.db" }),
    options: {
      workingMemory: {
        enabled: true,
        scope: "resource", // persists across all threads for the same user
        template: `# User Profile
- **Name**:
- **Location**:
- **Preferences**:
- **Current Goal**:`,
      },
    },
  }),
});

// Call with thread + resource identifiers
await agent.generate("My name is Alice and I live in Berlin", {
  memory: { thread: "conv-001", resource: "user-alice" },
});
// Next session — agent remembers Alice's name and location
```

The working memory template is a markdown doc the agent fills in and updates as it learns about the user. It's injected into every system prompt automatically. You can also use a Zod schema instead of a template for structured working memory.

**Layer 3 — semantic recall:**

```typescript
import { LibSQLVector } from "@mastra/libsql";
import { ModelRouterEmbeddingModel } from "@mastra/core/llm";

const agent = new Agent({
  memory: new Memory({
    storage: new LibSQLStore({ url: "file:./local.db" }),
    vector: new LibSQLVector({ url: "file:./local.db" }), // embedding store
    embedder: new ModelRouterEmbeddingModel("openai/text-embedding-3-small"),
    options: {
      semanticRecall: {
        topK: 3, // retrieve 3 most similar past messages
        messageRange: 2, // include 2 context messages around each match
        scope: "resource", // search across all threads for this user
      },
    },
  }),
});
```

**Supported storage backends:** LibSQL (default, file-based), PostgreSQL, Upstash, MongoDB, DynamoDB, Cloudflare D1/Durable Objects, Convex, LanceDB, MS SQL Server.

**Supported vector backends:** 18+ including pgvector, Pinecone, Qdrant, Chroma, Elasticsearch, LanceDB, Cloudflare Vectorize, Upstash, MongoDB Atlas, DuckDB.

**Local embeddings (no API key):** `@mastra/fastembed` runs FastEmbed locally — useful for development and privacy-sensitive deployments.

### RAG Pipeline

Mastra provides a standardized RAG pipeline for document ingestion and retrieval:

```typescript
// Ingestion (run once)
const doc = MDocument.fromText(content);
const chunks = await doc.chunk({ strategy: "recursive", size: 512, overlap: 50 });
const embedder = new ModelRouterEmbeddingModel("openai/text-embedding-3-small");
const embeddings = await embedder.embedMany(chunks.map((c) => c.text));
await vectorStore.upsert("product-docs", embeddings, chunks);

// At query time (inside a tool execute)
const queryEmbed = await embedder.embed(userQuery);
const results = await vectorStore.query("product-docs", queryEmbed, { topK: 5 });
```

This complements [Agentic RAG](../agentic-rag/README.md) — Mastra handles the plumbing (chunking, embedding, storage), you focus on the retrieval strategy.

### Evals (Built-In, No Separate Product)

Mastra's scorers run asynchronously after agent responses without blocking users. Scores are stored in a `mastra_scorers` table for analysis:

```typescript
import { createAnswerRelevancyScorer, createToxicityScorer } from "@mastra/evals/scorers/prebuilt";

const agent = new Agent({
  scorers: {
    relevancy: {
      scorer: createAnswerRelevancyScorer({ model: "openai/gpt-4.1-nano" }),
      sampling: { type: "ratio", rate: 0.5 }, // score 50% of responses
    },
    safety: {
      scorer: createToxicityScorer({ model: "openai/gpt-4.1-nano" }),
      sampling: { type: "ratio", rate: 1.0 }, // score every response
    },
  },
});
```

15+ built-in scorers using LLM-as-judge: relevancy, faithfulness, toxicity, hallucination, coherence, completeness. Custom scorers supported. This is LangSmith's core value proposition — built into the framework and open-source.

### Deployment

```bash
# Local development — starts a Hono server + Studio (visual debugger)
mastra dev
# → localhost:4111 — REST API for all registered agents and workflows
# → localhost:4111/studio — web UI to inspect agents, run workflows, trace calls

# Build for production
mastra build
# → outputs a deployable Hono server with auto-generated REST endpoints
# → POST /agents/supportAgent/generate
# → POST /workflows/orderRefund/run
```

**Platform deployers:**

```typescript
// Vercel
import { VercelDeployer } from "@mastra/deployer-vercel";
// Netlify
import { NetlifyDeployer } from "@mastra/deployer-netlify";
// Cloudflare Workers
import { CloudflareDeployer } from "@mastra/deployer-cloudflare";
```

For AWS Lambda, EC2, Azure, Digital Ocean — standard Node.js 22+ deployment. For production workflow execution with step memoization, auto-retries, and monitoring, Mastra integrates with [Inngest](https://www.inngest.com/) as the durable execution engine.

**Mastra Cloud** — managed beta platform, announced 2025. For teams that want zero infrastructure management.

---

## How They Fit Together

The Mastra team is explicit about this: "We built Mastra as a framework on top of the AI SDK to help teams build their proof-of-concepts into production-ready apps."

The practical implication: you might start with just the AI SDK (fast, minimal, great for prototypes and chatbots), then add Mastra when you need production features. Or you might go straight to Mastra for a production system.

What each layer owns:

| Concern               | Vercel AI SDK                              | Mastra                                        |
| --------------------- | ------------------------------------------ | --------------------------------------------- |
| LLM calls             | ✅ `generateText` / `streamText`           | Delegates to AI SDK                           |
| Tool definitions      | ✅ `tool()` with Zod                       | ✅ `createTool()` with explicit output schema |
| Agent loop            | ✅ `maxSteps`, `stopWhen`, `prepareStep`   | ✅ `Agent.generate()` wraps AI SDK            |
| Provider routing      | ✅ 24+ providers, 5 switching methods      | Delegates to AI SDK                           |
| Middleware            | ✅ `wrapLanguageModel`                     | —                                             |
| Streaming to UI       | ✅ `useChat` / `useCompletion` React hooks | —                                             |
| Multi-step workflows  | ❌ Manual                                  | ✅ `.then()`, `.branch()`, `.parallel()`      |
| Suspend / resume      | ❌ Manual                                  | ✅ `suspend()` / `run.resume()`               |
| Persistent memory     | ❌ Bring your own                          | ✅ 4-layer, 10+ backends                      |
| Semantic recall       | ❌ Bring your own                          | ✅ Built-in RAG over past conversations       |
| RAG pipeline          | ❌ Manual                                  | ✅ `MDocument` + chunking + embedding + store |
| Evals / scoring       | ❌ External (Langfuse, Braintrust)         | ✅ 15+ built-in scorers                       |
| Local dev UI          | ✅ DevTools (call inspector)               | ✅ Studio (agent + workflow visual debugger)  |
| Production deployment | ❌ Manual                                  | ✅ Built-in deployers + `mastra build`        |

---

## Mapping Repo Patterns to Toolkits

If you've worked through this repo, here's where each concept lives in the toolkit world:

| Repo Pattern                                                 | Vercel AI SDK                                          | Mastra                                           |
| ------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| [ReAct Loop](../react/README.md)                             | `generateText` with `tools` + `maxSteps`               | `Agent.generate()` with `tools`                  |
| [Plan+Execute](../plan-execute/README.md)                    | Manual: two `generateText` calls                       | `Workflow` with LLM planner step + execute steps |
| [Multi-Turn Memory](../conversation-memory/README.md)        | Manual: pass `messages` array                          | `Memory` Layer 1 (message history)               |
| [Persistent Memory](../persistent-memory/README.md)          | Manual tools or memory providers                       | `Memory` Layer 2 (working memory)                |
| [Context Window Management](../context-management/README.md) | `prepareStep` returning trimmed `messages`             | Automatic via memory processors                  |
| [Sub-Agent Delegation](../sub-agent-delegation/README.md)    | `generateText` inside `tool.execute` + `toModelOutput` | `Agent` with `agents` field (sub-agents)         |
| [Streaming](../streaming/README.md)                          | `streamText` + `useChat` React hooks                   | `Agent.stream()` + Mastra's SSE endpoints        |
| [RAG](../rag/README.md)                                      | Manual: embed + store + query                          | `MDocument` + vector store adapters              |
| [HITL](../human-in-the-loop/README.md)                       | `tool.needsApproval`                                   | Workflow `suspend()` / `run.resume()`            |
| [State Graph](../state-graph/README.md)                      | Manual state machine                                   | `Workflow` with `.branch()` + state              |
| [Guardrails](../guardrails/README.md)                        | `stopWhen: stepCountIs(n)`, timeout                    | Workflow tripwires + `maxSteps` on agents        |
| [Agent Middleware](../middleware-pipeline/README.md)         | `wrapLanguageModel` middleware                         | —                                                |
| [Evaluation Patterns](../evaluation-patterns/README.md)      | External tools (Langfuse, Braintrust)                  | Built-in `scorers` with 15+ options              |
| [Error Recovery](../error-recovery/README.md)                | `maxRetries` on tools                                  | Inngest integration for step retries             |

---

## The d0 Lesson: Give the Model Less Structure, Not More

The most instructive AI SDK production case study is Vercel's own **d0** SQL analytics agent. The original design had 15+ specialized tools: schema lookup, query validation, entity join finders, syntax validators, error recovery tools.

They replaced all of it with two tools: a bash sandbox (grep, cat, ls, find) and SQL execution.

**Results across 5 test queries:**

| Metric         | Before (15+ tools) | After (2 tools)         |
| -------------- | ------------------ | ----------------------- |
| Execution time | 274.8s             | 77.4s (**3.5× faster**) |
| Success rate   | 80%                | **100%**                |
| Token usage    | ~102k              | ~61k (**37% fewer**)    |
| Steps          | ~12                | ~7 (**42% fewer**)      |

The root cause: they were "doing the model's thinking for it." Specialized tools constrained what the model could see. With raw filesystem access, the model grepped exactly what it needed. Well-structured data files mattered more than sophisticated tooling infrastructure.

**The key quote:** _"The model makes better choices when we stop making choices for it."_

This lesson applies before you reach for either toolkit. Over-tooling is an anti-pattern regardless of whether you're using raw `generateText` or Mastra workflows.

---

## In the Wild: Who Uses These in Production

### The Harness Exception

The [Orchestration Frameworks](../orchestration-frameworks/README.md) guide noted that production coding agent harnesses (Claude Code, Cursor, Aider, OpenCode) all build their own loops from scratch. The same is true here: **no major coding agent harness is built on Vercel AI SDK or Mastra**. Harnesses need maximal control over every layer, so they start from primitives.

But harnesses are a specific category — teams building standalone agents for complex, unbounded tasks. Most teams ship agents as features inside products: a support chatbot, a document Q&A, an order processing workflow. That's where toolkits shine.

### Vercel AI SDK in Production

**Thomson Reuters CoCounsel** (legal AI assistant) was built by 3 developers in 2 months using the AI SDK. It now serves 1,300+ accounting firms. The AI SDK's provider-agnosticism let the team swap models as providers improved without rewriting agent logic.

**Vercel's own d0 agent** (internal SQL analytics) runs on AI SDK. The d0 redesign is a direct case study in the SDK's model — minimal tools, trust the model, let it navigate.

The AI SDK's 20M+ monthly downloads reflect a pattern: it's the default choice for TypeScript teams reaching for an LLM abstraction. It's small, composable, and works everywhere (Next.js, Remix, Astro, plain Node, Deno, Bun, edge runtimes).

### Mastra in Production

**Replit Agent 3** (their primary AI coding agent) is built on Mastra. This is the highest-signal harness adoption — a production coding agent choosing a framework over a from-scratch implementation, suggesting the workflow + memory primitives are mature enough for demanding use cases.

**Marsh McLennan** deployed an agentic search tool built with Mastra to 75,000 employees — a workflow-heavy use case where Mastra's deterministic pipeline model suits enterprise compliance requirements better than a pure ReAct loop.

**Inngest integration:** Inngest (durable workflow execution) chose Mastra as a primary framework integration, building `@mastra/inngest`. The combination — Mastra for agent orchestration + Inngest for workflow durability — is a production-grade stack for long-running agents.

---

## Decision Guide

**Use Vercel AI SDK alone when:**

- Building a React/Next.js chatbot or copilot feature — the `useChat` / `useCompletion` hooks are unmatched
- You need edge runtime compatibility (Cloudflare Workers, Vercel Edge) — Mastra requires Node.js 22.13+
- Your agent is stateless or you're managing memory yourself
- You want the smallest possible footprint — AI SDK's tree-shakeable modules vs. Mastra's opinionated structure
- You're building something experimental and want zero framework assumptions
- You're targeting a non-standard runtime where Mastra's deployers don't apply

**Add Mastra on top when:**

- You need persistent cross-session memory with semantic recall and don't want to wire it up yourself
- Your workflow has deterministic structure that shouldn't be left to LLM routing — approvals, branching, parallel enrichment
- You need suspend/resume for human-in-the-loop workflows with state persistence
- You want built-in evals without adding a separate service (Langfuse, Braintrust)
- You need a production REST API from your agents and workflows without writing it yourself
- You're switching from LangChain.js and want TypeScript-native tooling that doesn't feel like a Python port

**Neither — consider the alternatives when:**

- **Maximum type safety over convenience:** TanStack AI offers an even more composable, framework-agnostic approach
- **Complex multi-agent DAGs:** LangGraph (TypeScript) handles arbitrary fan-out/fan-in graphs that Mastra's linear `.branch()` can't express
- **Python interop:** If your team already has LangChain Python in production, the JS port preserves mental models even with type friction

**The honest trade-off:** AI SDK requires you to wire up memory, workflows, evals, and deployment manually — but it never constrains you. Mastra eliminates that wiring at the cost of opinionation and a faster-moving API (v1 beta stabilized many of the breaking changes from 2025, but pre-1.0 required careful release tracking).

---

## Key Takeaways

1. **Mastra and AI SDK are a stack, not a choice.** Mastra builds on the AI SDK. The question is which layer to stop at.

2. **AI SDK is the right default for React/Next.js.** The `useChat` hooks and edge runtime support make it the default choice when building AI features into web apps.

3. **Mastra's Workflow engine is the differentiator.** The `.then()/.branch()/.parallel()/.dountil()` fluent builder with typed step composition is genuinely new ground — LangGraph is more powerful for arbitrary topologies, but Mastra's is more ergonomic for the 80% case.

4. **The d0 lesson generalizes.** Over-tooling is the most common agent mistake. Start with fewer tools and broader capabilities before adding specialization. This holds whether you're using raw `generateText` or Mastra workflows.

5. **Memory is a first-class concern.** AI SDK's stateless default is correct for web requests but becomes a liability for agents that need context across sessions. Mastra's 4-layer memory system (message history + working memory + semantic recall + observational) is the most complete TypeScript-native solution available.

6. **Harnesses build from scratch; product teams use toolkits.** If you're building a coding agent with maximal control, you'll likely outgrow both frameworks. If you're shipping agent features inside a product, these toolkits prevent weeks of plumbing work.

---

## Sources & Further Reading

- [AI SDK Introduction](https://ai-sdk.dev/docs/introduction)
- [AI SDK 6 Blog Post](https://vercel.com/blog/ai-sdk-6)
- [AI SDK Agent Loop Control](https://ai-sdk.dev/docs/agents/loop-control)
- [AI SDK Subagents](https://ai-sdk.dev/docs/agents/subagents)
- [AI SDK Memory for Agents](https://ai-sdk.dev/docs/agents/memory)
- [We Removed 80% of Our Agent's Tools — Vercel d0 Case Study](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools)
- [Mastra Docs](https://mastra.ai/docs)
- [Using AI SDK with Mastra](https://mastra.ai/blog/using-ai-sdk-with-mastra)
- [Mastra $13M Seed Round](https://mastra.ai/blog/seed-round)
- [Mastra v1 Beta](https://mastra.ai/blog/mastrav1)
- [I Reimplemented Mastra Workflows and I Regret It — Convex](https://stack.convex.dev/reimplementing-mastra-regrets)
- [GitHub: vercel/ai](https://github.com/vercel/ai)
- [GitHub: mastra-ai/mastra](https://github.com/mastra-ai/mastra)
- [An Empirical Study of Agent Developer Practices in AI Agent Frameworks](https://arxiv.org/abs/2512.01939)

---

[Agent Patterns — TypeScript](../../README.md) · Previous: [Orchestration Frameworks](../orchestration-frameworks/README.md)
