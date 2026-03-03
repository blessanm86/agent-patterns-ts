import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";
import { tools, executeTool, extractIdsFromToolResult } from "./tools.js";
import { parseEntityTags, collectEntityIds } from "./parser.js";
import type { EntityType, EntityStats } from "./types.js";

// ─── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a helpful e-commerce support agent for NovaMart. You help customers with account inquiries, product searches, order tracking, and browsing categories.

Always use tools to look up real data — never guess at customer details, product prices, or order statuses.

## Entity Tag Format

When you reference entities in your response, wrap them in XML-like tags so the UI can render them as interactive elements. Use the exact IDs and names from tool results.

Supported entity types and their attributes:

<User id="USR-1001" name="Alice Johnson" />
<Product id="PROD-2001" name="Wireless Headphones" price="79.99" />
<Order id="ORD-5001" status="shipped" total="105.97" />
<Category id="CAT-301" name="Electronics" />

Example response with tags:

I found the account for <User id="USR-1001" name="Alice Johnson" />. She has a recent order <Order id="ORD-5001" status="shipped" total="105.97" /> which includes <Product id="PROD-2001" name="Wireless Headphones" price="79.99" /> and <Product id="PROD-2003" name="USB-C Charging Cable" price="12.99" />.

Rules:
- Use self-closing tag syntax: <Type attr="val" />
- Always include the id and name attributes
- Use the exact IDs from tool results (e.g. USR-1001, PROD-2001)
- Include relevant extra attributes (price, status, total) when available
- Place tags naturally within your prose — the response should still read well
- Do not wrap the same entity more than once per sentence`;

// ─── Agent Loop ─────────────────────────────────────────────────────────────
//
// Standard ReAct loop. Returns both raw content (for multi-platform rendering)
// and entity stats (for the stats panel).

const MAX_ITERATIONS = 10;

export interface AgentResult {
  /** History with raw XML tags — pass this back for LLM continuity */
  rawHistory: Message[];
  /** The raw assistant content with XML entity tags (unparsed) */
  rawContent: string;
  /** Entity statistics for the stats panel */
  entityStats: EntityStats | null;
}

export async function runAgent(userMessage: string, history: Message[]): Promise<AgentResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  const toolResultIds = new Set<string>();

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });

    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      const result = executeTool(name, args as Record<string, string>);

      logToolCall(name, args as Record<string, string>, result, { maxResultLength: 150 });

      // Track entity IDs from tool results for hit rate calculation
      for (const id of extractIdsFromToolResult(result)) {
        toolResultIds.add(id);
      }

      messages.push({ role: "tool", content: result });
    }
  }

  // Extract raw content from last assistant message
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const rawContent = lastAssistant?.content ?? "";

  if (!rawContent) {
    return { rawHistory: messages, rawContent, entityStats: null };
  }

  // Parse entities and compute stats
  const entities = parseEntityTags(rawContent);
  const taggedIds = collectEntityIds(entities);

  // Calculate tag hit rate
  let tagHitRate = -1;
  if (toolResultIds.size > 0) {
    let hits = 0;
    for (const id of toolResultIds) {
      if (taggedIds.has(id)) hits++;
    }
    tagHitRate = hits / toolResultIds.size;
  }

  const counts: Record<EntityType, number> = { User: 0, Product: 0, Order: 0, Category: 0 };
  for (const e of entities) {
    counts[e.type]++;
  }

  const entityStats: EntityStats = { counts, entities, tagHitRate };

  return { rawHistory: messages, rawContent, entityStats };
}
