# Dynamic Tool Selection (Semantic Tool Filtering)

[Agent Patterns — TypeScript](../../README.md) · Builds on [Tool Description Engineering](../tool-descriptions/README.md)

---

Your agent has 5 tools. It works beautifully. You add 10 more. Still fine. You integrate three MCP servers and suddenly the model is calling `search_hotels` when the user asked about pasta recipes. What happened?

**Tool count happened.** Every tool definition you send to the model consumes context tokens and competes for attention. At 9 tools, GPT-4o achieved 58% accuracy on a customer support benchmark. At 51 tools, that dropped to 26%. Llama 3.3-70B went from 21% to 0%. The model didn't get dumber — it drowned.

Dynamic tool selection solves this by filtering the tool catalog _before_ the model sees it. Instead of sending all 50 tools every turn, you select the 3-5 most relevant ones based on what the user actually asked. The model sees a focused toolset, picks the right tool, and you save 80%+ of your context budget.

This post walks through two selection strategies — embedding-based and LLM-based — with a 27-tool demo that spans e-commerce, recipes, and travel.

---

## The Problem: Context Bloat and Attention Dilution

Every tool definition costs tokens. A typical tool schema — name, description, parameters with types and descriptions — averages ~250 tokens. Scale that up:

| Tools | Token cost | % of 8K window   | % of 128K window |
| ----- | ---------- | ---------------- | ---------------- |
| 5     | ~1,250     | 16%              | 1%               |
| 20    | ~5,000     | 62%              | 4%               |
| 50    | ~12,500    | 156% (overflow!) | 10%              |
| 200   | ~50,000    | —                | 39%              |

But token cost is only half the story. The deeper problem is **attention dilution**. Transformers attend to every token in the context window. More tokens means thinner attention per token. When your 27-tool catalog includes `search_flights`, `search_hotels`, `search_recipes`, and `search_products`, the model has to discriminate between similar-sounding tools that share the word "search" — and it often picks wrong.

The vLLM Semantic Router project ran the most comprehensive benchmark:

| Tool count | Accuracy (no filtering) | Accuracy (with filtering) |
| ---------- | ----------------------- | ------------------------- |
| 49         | 94%                     | 94%                       |
| 207        | 64%                     | 94%                       |
| 417        | 20%                     | 94%                       |
| 741        | 13.6%                   | 43.1%                     |

At 207 tools, filtering recovers accuracy from 64% back to 94%. At 417 tools, it's the difference between 20% and 94% — a 4.7x improvement from filtering alone.

There's also a **position bias** (the "lost-in-the-middle" effect): tools placed in the middle of a long list are selected less often than those at the beginning or end. At 741 tools, accuracy for a tool at position 50% was 22%, versus 32% at position 10%. Filtering eliminates this entirely by reducing the list to 3-5 tools.

---

## How It Works: Two Selection Strategies

```
                          ┌──────────────┐
                          │  User Query  │
                          └──────┬───────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │             │
              ┌─────▼─────┐ ┌───▼────┐ ┌──────▼──────┐
              │ Embedding  │ │  LLM   │ │  All Tools  │
              │  Selector  │ │Selector│ │ (baseline)  │
              └─────┬──────┘ └───┬────┘ └──────┬──────┘
                    │            │             │
              top-5 by      top-5 by      all 27
              similarity    relevance     tools
                    │            │             │
                    └────────────┼─────────────┘
                                 │
                          ┌──────▼───────┐
                          │  LLM Agent   │
                          │ (ReAct loop) │
                          └──────────────┘
```

### Strategy 1: Embedding-Based Selection

The fastest approach. At startup, embed every tool's description. At query time, embed the user's query and pick the top-K tools by cosine similarity.

```typescript
// tool-selector.ts — build the index once at startup
async function buildEmbeddingIndex(tools: ToolDefinition[]) {
  const descriptions = tools.map(toolToDescription);
  const response = await ollama.embed({
    model: EMBEDDING_MODEL, // nomic-embed-text
    input: descriptions,
  });
  // Store embeddings alongside tool definitions
  embeddedTools = tools.map((tool, i) => ({
    tool,
    embedding: response.embeddings[i],
  }));
}
```

```typescript
// At query time — ~15ms per selection
async function selectByEmbedding(query: string) {
  const queryEmbedding = await ollama.embed({
    model: EMBEDDING_MODEL,
    input: query,
  });

  const scored = embeddedTools
    .map((et) => ({
      tool: et.tool,
      score: cosineSimilarity(queryEmbedding, et.embedding),
    }))
    .sort((a, b) => b.score - a.score);

  return scored.filter((s) => s.score >= SIMILARITY_THRESHOLD).slice(0, TOP_K); // default: 5
}
```

The description you embed matters. Don't just embed the tool name — include the full description and parameter names. The function `toolToDescription` concatenates:

```
search_flights: Searches for available flights between two airports
on a given date. Parameters: origin, destination, date, class
```

This gives the embedding model enough semantic signal to distinguish `search_flights` from `search_hotels` based on query content.

**Tradeoffs:**

- Fast: ~15ms per selection (embedding + similarity)
- No LLM call, no extra cost
- Works well when query vocabulary overlaps with tool descriptions
- Struggles when the user asks indirectly ("plan my dinner" doesn't obviously match `get_meal_plan`)

### Strategy 2: LLM-Based Selection

Uses a lightweight LLM call where the model sees a compact catalog (just tool names and first-sentence descriptions) and returns a JSON array of relevant tool names.

```typescript
async function selectByLLM(query: string, tools: ToolDefinition[]) {
  const catalog = tools
    .map((t) => `- ${t.function.name}: ${t.function.description.split(".")[0]}`)
    .join("\n");

  const response = await ollama.chat({
    model: MODEL,
    messages: [
      {
        role: "user",
        content:
          `Given this query: "${query}"\n\n` +
          `Select the 3-5 most relevant tools:\n${catalog}\n\n` +
          `Return a JSON array of tool names.`,
      },
    ],
    format: "json",
  });

  return JSON.parse(response.message.content);
}
```

**Tradeoffs:**

- More accurate: understands intent, not just keyword overlap
- Handles indirect queries ("plan my dinner" -> `search_recipes`, `get_meal_plan`, `get_nutrition_info`)
- Slower: requires an extra LLM call (100-500ms depending on model)
- Costs tokens for the selection call
- Can hallucinate tool names not in the catalog (always validate against the actual tool list)

### Which Strategy When?

| Factor                       | Embedding          | LLM                   |
| ---------------------------- | ------------------ | --------------------- |
| Latency                      | ~15ms              | 100-500ms             |
| Cost                         | Embedding API only | Extra LLM call        |
| Accuracy on direct queries   | High               | High                  |
| Accuracy on indirect queries | Medium             | High                  |
| Handles synonym/intent gap   | Poor               | Good                  |
| Scales to 1000+ tools        | Yes (with ANN)     | Yes (compact catalog) |
| Risk of hallucination        | None               | Can invent tool names |

**Production recommendation:** Start with embeddings. Add LLM-based selection as a fallback when the top embedding score is below a confidence threshold — a hybrid approach that gets the speed of embeddings with the accuracy of LLM selection.

---

## The Demo: 27 Tools Across 3 Domains

The demo has tools across e-commerce (9), recipes (9), and travel (9):

```
E-commerce: search_products, get_product_details, add_to_cart,
            remove_from_cart, get_cart, apply_coupon, checkout,
            track_order, get_return_policy

Recipes:    search_recipes, get_recipe_details, get_nutrition_info,
            convert_units, find_substitutes, get_cooking_tips,
            rate_recipe, get_meal_plan, get_dietary_filters

Travel:     search_flights, get_flight_details, search_hotels,
            get_hotel_details, book_hotel, search_activities,
            get_weather_forecast, convert_currency, get_visa_requirements
```

Run in three modes to compare:

```bash
# Embedding-based selection (default) — ~5 tools per query
pnpm dev:dynamic-tools

# All 27 tools every turn (baseline)
pnpm dev:dynamic-tools:all

# LLM-based selection — model picks relevant tools
pnpm dev:dynamic-tools:llm
```

Each turn prints selection stats:

```
  --- Tool Selection (embedding) ---
  Tools: 5/27 selected
  Selected: search_recipes, get_recipe_details, get_nutrition_info,
            find_substitutes, get_cooking_tips
  Token estimate: ~620 tokens
  Selection time: 14ms
  Token savings: ~6,130 tokens (91% reduction vs all-tools)
```

Try these queries and observe which tools each strategy selects:

| Query                                        | Expected domain | Key tools                          |
| -------------------------------------------- | --------------- | ---------------------------------- |
| "Find me wireless headphones under $150"     | E-commerce      | search_products                    |
| "How do I make spaghetti carbonara?"         | Recipes         | search_recipes, get_recipe_details |
| "Search flights from SFO to JFK on April 15" | Travel          | search_flights                     |
| "Convert 2 cups to milliliters"              | Recipes         | convert_units                      |
| "What's the weather in Tokyo next week?"     | Travel          | get_weather_forecast               |
| "I need a vegan substitute for butter"       | Recipes         | find_substitutes                   |

---

## Implementation Deep Dive

### Token Estimation

Each tool costs roughly 250 tokens. Our estimator computes it from description length and parameter count:

```typescript
function estimateTokens(tools: ToolDefinition[]): number {
  return tools.reduce((sum, t) => {
    const desc = t.function.description.length;
    const params = Object.keys(t.function.parameters.properties).length;
    return sum + Math.ceil(desc / 4) + params * 30 + 50;
  }, 0);
}
```

At 27 tools, the all-tools baseline costs ~6,750 tokens. With embedding selection picking 5 tools, that drops to ~1,250 tokens — an **81% reduction**.

### Handling LLM Hallucinations

The LLM selector can return tool names that don't exist. Always validate against the actual catalog:

```typescript
const toolMap = new Map(tools.map((t) => [t.function.name, t]));
const selectedTools = selectedNames
  .map((name) => toolMap.get(name)) // lookup in catalog
  .filter((t): t is ToolDefinition => t !== undefined) // drop hallucinated names
  .slice(0, TOP_K);
```

LangChain's `LLMToolSelectorMiddleware` has a documented bug where the selector picks tools not in the list. This validation step is non-negotiable.

### Building Rich Descriptions for Embeddings

The quality of embedding-based selection depends entirely on what you embed. Compare:

**Weak:** `"search_flights"` — 2 words, almost no semantic signal
**Strong:** `"search_flights: Searches for available flights between two airports on a given date. Parameters: origin, destination, date, class"` — rich context for the embedding model

The demo concatenates name, description, and parameter names. This is the same lesson from [Tool Description Engineering](../tool-descriptions/README.md) — descriptions written for humans are also descriptions that embed well.

---

## In the Wild: Coding Agent Harnesses

Dynamic tool selection is one of the most visible patterns in production coding agents, because these agents routinely deal with 30-100+ tools.

### Claude Code: Deferred Tools with ToolSearch

Claude Code implements the most sophisticated production tool selection system. Tools are marked with `defer_loading: true`, which means their full schemas are _not_ sent to the model initially. Instead, the model gets a single `ToolSearch` meta-tool that it calls when it needs to discover tools:

```
You have access to a set of tools you can use to answer the user's question.
[Only ToolSearch is visible initially]

You MUST use this tool to load deferred tools BEFORE calling them directly.
```

The search itself uses two variants — regex (model constructs a pattern) and BM25 (model writes a natural language query). The API returns 3-5 matching tool definitions, which are expanded inline for the model to use.

Anthropic reports **85% token reduction** (from ~55K to ~8.7K for 58 tools) and accuracy improvement from 79.5% to 88.1% with Claude Opus 4.5. This is essentially the embedding approach, but hosted server-side with the search integrated into the model's tool-calling flow rather than as a pre-processing step.

### Cursor: Hard Cap at 40 Tools

Cursor takes a simpler approach — it enforces a **hard limit of 40 MCP tools** total. If you configure more than 40 tools across all MCP servers, only the first 40 are sent to the model. This is a blunt but effective guard against the attention dilution problem: rather than building a dynamic selector, cap the total and let the model handle selection from a manageable set.

### LlamaIndex: ObjectIndex for Tool Retrieval

LlamaIndex's `ObjectIndex` treats tools exactly like documents in a RAG pipeline. Tool descriptions are embedded into a vector store, and at query time, the agent retrieves the top-K most relevant tools:

```python
obj_index = ObjectIndex.from_objects(all_tools, index_cls=VectorStoreIndex)
retriever = obj_index.as_retriever(similarity_top_k=3)
agent = OpenAIAgent.from_tools(tool_retriever=retriever)
```

This is the same embedding-based approach our demo uses, packaged as a first-class framework feature. The key insight: tool retrieval is just document retrieval where the "documents" are tool descriptions.

### Amazon Bedrock: Semantic Tool Search in AgentCore

Amazon Bedrock's AgentCore Gateway implements vector-based semantic tool search using S3 Vectors. Their Strands Agents SDK provides a `search_tools` function with FAISS and SentenceTransformers (`all-MiniLM-L6-v2`). In production testing with 29 travel tools, semantic filtering reduced tokens from 1,557 to 275 per query (82% reduction) and achieved "up to 86.4% accuracy" in preventing tool selection hallucinations.

---

## Key Takeaways

1. **The 40-tool cliff is real.** Beyond ~40 tools, accuracy degrades rapidly. Cursor's hard limit is well-calibrated to this threshold.

2. **Embedding selection recovers most lost accuracy.** At 207 tools, filtering brings accuracy back from 64% to 94%. The technique is simple, fast (~15ms), and requires no extra LLM calls.

3. **Token savings compound.** At 27 tools, you save ~81% of tool definition tokens. At 741 tools, the vLLM benchmark showed 99.1% reduction (127K to 1K tokens).

4. **LLM selection bridges the semantic gap.** When the user says "plan my dinner," embeddings might miss `get_meal_plan`. An LLM selector understands the intent.

5. **Always validate selected tool names.** LLM-based selectors can hallucinate tool names not in the catalog. Map names back to actual definitions and drop misses.

6. **Rich descriptions serve double duty.** Good tool descriptions help both the main model (better tool calling) and the embedding model (better retrieval). Invest in descriptions once, benefit twice.

7. **The hybrid approach wins.** Use embeddings for speed, fall back to LLM when confidence is low. This is how production systems (Anthropic, Amazon) approach it.

---

## Sources & Further Reading

### Foundational Papers

- [Gorilla: Large Language Model Connected with Massive APIs](https://arxiv.org/abs/2305.15334) — Patil et al., UC Berkeley, NeurIPS 2024 — retrieval-augmented tool selection from 1,645+ APIs, 20.43% better than GPT-4
- [ToolSandbox: A Stateful, Conversational, Interactive Evaluation Benchmark](https://arxiv.org/abs/2408.04682) — Lu et al., Apple, 2024 — multi-tool benchmark showing distraction tool effects
- [ToolGen: Unified Tool Retrieval and Calling via Generation](https://arxiv.org/abs/2410.03439) — Wang et al., ICLR 2025 — 47K+ tools via vocabulary embedding, zero hallucination
- [ToolScope: Enhancing LLM Agent Tool Use through Tool Merging and Context-Aware Filtering](https://arxiv.org/abs/2510.20036) — 2025 — 8.38-38.6% accuracy gains from tool merging + filtering
- [Dynamic System Instructions and Tool Exposure for Efficient Agentic LLMs](https://arxiv.org/abs/2602.17046) — 2025 — 95% token reduction, 32% better tool routing

### Platform Documentation

- [Anthropic Tool Search Tool](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/tool-search-tool) — server-side BM25/regex tool search with defer_loading
- [Anthropic Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use) — scaling challenges and dynamic tool loading
- [LlamaIndex ObjectIndex](https://docs.llamaindex.ai/en/stable/examples/objects/object_index/) — embedding-based tool retrieval for agents

### Practitioner Posts

- [AWS: Reduce Agent Errors and Token Costs with Semantic Tool Selection](https://dev.to/aws/reduce-agent-errors-and-token-costs-with-semantic-tool-selection-7mf) — FAISS + SentenceTransformers, 82% token reduction
- [Speakeasy: 100x Token Reduction with Dynamic Toolsets](https://www.speakeasy.com/blog/100x-token-reduction-dynamic-toolsets) — progressive discovery vs. semantic search for MCP
- [vLLM Semantic Router Benchmark](https://vllm-semantic-router.com/blog/semantic-tool-selection/) — most comprehensive quantitative evidence on tool count degradation
