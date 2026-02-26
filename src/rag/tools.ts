import { searchDocs } from "./search.js";
import type { ToolDefinition, Chunk, SearchMode } from "./types.js";

// ─── Tool Definitions (sent to the model) ───────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_docs",
      description:
        "Search the NexusDB documentation for information relevant to the user's question. " +
        "Returns the most relevant documentation chunks ranked by relevance. " +
        "ALWAYS call this tool before answering any factual question about NexusDB — " +
        "do not rely on your own knowledge, as NexusDB is a specialized product with specific details " +
        "(port numbers, CLI commands, config keys) that you must look up.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The search query. Use specific keywords from the user's question. " +
              "For example: 'default port', 'create index', 'backup restore', 'replication setup'.",
          },
        },
        required: ["query"],
      },
    },
  },
];

// ─── Runtime Configuration ──────────────────────────────────────────────────

let _chunks: Chunk[] = [];
let _mode: SearchMode = "hybrid";

export function configure(chunks: Chunk[], mode: SearchMode): void {
  _chunks = chunks;
  _mode = mode;
}

export function setSearchMode(mode: SearchMode): void {
  _mode = mode;
}

export function getSearchMode(): SearchMode {
  return _mode;
}

// ─── Tool Dispatcher ────────────────────────────────────────────────────────
//
// Async because search may call ollama.embed() for semantic/hybrid modes.

export async function executeTool(name: string, args: Record<string, string>): Promise<string> {
  if (name === "search_docs") {
    const query = args.query ?? "";
    const results = await searchDocs(query, _chunks, _mode, 5);

    if (results.length === 0) {
      return JSON.stringify({ results: [], message: "No relevant documentation found." });
    }

    const formatted = results.map((r, i) => ({
      rank: i + 1,
      source: r.chunk.source,
      heading: r.chunk.heading,
      content: r.chunk.content,
      score: Math.round(r.score * 1000) / 1000,
    }));

    return JSON.stringify({ results: formatted });
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}
