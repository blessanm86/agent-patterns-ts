import ollama from "ollama";
import { EMBEDDING_MODEL, MODEL } from "../shared/config.js";
import { cosineSimilarity } from "../rag/vector-store.js";
import type { ToolDefinition } from "../shared/types.js";
import type { EmbeddedTool, SelectionResult, SelectionStrategy } from "./types.js";

// ─── Tool Selector ───────────────────────────────────────────────────────────
//
// Two strategies for filtering a large tool catalog down to the most
// relevant tools for a given query:
//
//   1. Embedding-based: cosine similarity between query and tool descriptions
//   2. LLM-based: lightweight model call to pick relevant tool names
//
// Both strategies dramatically reduce context usage vs. sending all tools.

const TOP_K = 5;
const SIMILARITY_THRESHOLD = 0.3; // nomic-embed-text scores tend to be lower than OpenAI embeddings

// ─── Embedding Index ─────────────────────────────────────────────────────────

let embeddedTools: EmbeddedTool[] = [];

function toolToDescription(tool: ToolDefinition): string {
  const params = Object.entries(tool.function.parameters.properties)
    .map(([name, p]) => `${name}: ${p.description ?? p.type}`)
    .join(", ");
  return `${tool.function.name}: ${tool.function.description} Parameters: ${params}`;
}

export async function buildEmbeddingIndex(tools: ToolDefinition[]): Promise<void> {
  console.log("  Building tool embedding index...");
  const descriptions = tools.map(toolToDescription);

  const response = await ollama.embed({
    model: EMBEDDING_MODEL,
    input: descriptions,
  });

  embeddedTools = tools.map((tool, i) => ({
    tool,
    description: descriptions[i],
    embedding: response.embeddings[i],
  }));

  console.log(`  Indexed ${embeddedTools.length} tools with ${EMBEDDING_MODEL}`);
}

// ─── Embedding-Based Selection ───────────────────────────────────────────────

async function selectByEmbedding(query: string, tools: ToolDefinition[]): Promise<SelectionResult> {
  const start = performance.now();

  // Embed the query
  const queryResponse = await ollama.embed({
    model: EMBEDDING_MODEL,
    input: query,
  });
  const queryEmbedding = queryResponse.embeddings[0];

  // Score each tool by cosine similarity
  const scored = embeddedTools
    .map((et) => ({
      tool: et.tool,
      score: et.embedding ? cosineSimilarity(queryEmbedding, et.embedding) : 0,
    }))
    .sort((a, b) => b.score - a.score);

  // Take top-K above threshold
  const selected = scored.filter((s) => s.score >= SIMILARITY_THRESHOLD).slice(0, TOP_K);

  const elapsed = performance.now() - start;

  return {
    selectedTools: selected.map((s) => s.tool),
    totalTools: tools.length,
    strategy: "embedding",
    selectionTimeMs: Math.round(elapsed),
    tokenEstimate: estimateTokens(selected.map((s) => s.tool)),
  };
}

// ─── LLM-Based Selection ─────────────────────────────────────────────────────

async function selectByLLM(query: string, tools: ToolDefinition[]): Promise<SelectionResult> {
  const start = performance.now();

  // Build a compact tool catalog for the selector LLM
  const catalog = tools
    .map((t) => `- ${t.function.name}: ${t.function.description.split(".")[0]}`)
    .join("\n");

  const selectorPrompt =
    `You are a tool selector. Given a user query and a list of available tools, ` +
    `return ONLY the names of the 3-5 most relevant tools as a JSON array of strings.\n\n` +
    `Available tools:\n${catalog}\n\n` +
    `User query: "${query}"\n\n` +
    `Return a JSON array of tool names, e.g. ["tool_a", "tool_b"]. ` +
    `Only include tools that are directly relevant to answering this query. ` +
    `Return ONLY the JSON array, no other text.`;

  const response = await ollama.chat({
    model: MODEL,
    messages: [{ role: "user", content: selectorPrompt }],
    format: "json",
  });

  const elapsed = performance.now() - start;

  // Parse the selected tool names
  let selectedNames: string[] = [];
  try {
    const parsed = JSON.parse(response.message.content);
    // Handle both { tools: [...] } and [...] formats
    selectedNames = Array.isArray(parsed) ? parsed : (parsed.tools ?? parsed.tool_names ?? []);
  } catch {
    // Fallback: try to extract tool names from response text
    selectedNames = tools
      .map((t) => t.function.name)
      .filter((name) => response.message.content.includes(name));
  }

  // Map names back to tool definitions (filter out hallucinated names)
  const toolMap = new Map(tools.map((t) => [t.function.name, t]));
  const selectedTools = selectedNames
    .map((name) => toolMap.get(name))
    .filter((t): t is ToolDefinition => t !== undefined)
    .slice(0, TOP_K);

  return {
    selectedTools,
    totalTools: tools.length,
    strategy: "llm",
    selectionTimeMs: Math.round(elapsed),
    tokenEstimate: estimateTokens(selectedTools),
  };
}

// ─── All Tools (No Filtering) ────────────────────────────────────────────────

function selectAll(tools: ToolDefinition[]): SelectionResult {
  return {
    selectedTools: tools,
    totalTools: tools.length,
    strategy: "all",
    selectionTimeMs: 0,
    tokenEstimate: estimateTokens(tools),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function selectTools(
  query: string,
  tools: ToolDefinition[],
  strategy: SelectionStrategy,
): Promise<SelectionResult> {
  switch (strategy) {
    case "all":
      return selectAll(tools);
    case "embedding":
      return selectByEmbedding(query, tools);
    case "llm":
      return selectByLLM(query, tools);
  }
}

// ─── Token Estimation ────────────────────────────────────────────────────────
//
// Rough estimate: ~250 tokens per tool definition (name + description + params).
// This matches observed values from Anthropic's docs: 58 tools ~ 55K tokens.

function estimateTokens(tools: ToolDefinition[]): number {
  return tools.reduce((sum, t) => {
    const desc = t.function.description.length;
    const params = Object.keys(t.function.parameters.properties).length;
    // ~4 chars per token, plus parameter overhead
    return sum + Math.ceil(desc / 4) + params * 30 + 50;
  }, 0);
}

// ─── Stats Formatting ────────────────────────────────────────────────────────

export function formatSelectionStats(result: SelectionResult): string[] {
  const lines = [
    `\n  --- Tool Selection (${result.strategy}) ---`,
    `  Tools: ${result.selectedTools.length}/${result.totalTools} selected`,
    `  Selected: ${result.selectedTools.map((t) => t.function.name).join(", ")}`,
    `  Token estimate: ~${result.tokenEstimate} tokens`,
  ];

  if (result.strategy !== "all") {
    lines.push(`  Selection time: ${result.selectionTimeMs}ms`);
    // Show savings vs all-tools
    const allToolsTokens = result.totalTools * 250; // rough estimate
    const saved = allToolsTokens - result.tokenEstimate;
    const pct = Math.round((saved / allToolsTokens) * 100);
    lines.push(`  Token savings: ~${saved} tokens (${pct}% reduction vs all-tools)`);
  }

  return lines;
}
