import { searchDocs } from "./search.js";
import type { ToolDefinition, Chunk, SearchMode, KBDocument } from "./types.js";

// ─── Tool Definitions (sent to the model) ───────────────────────────────────

export const basicTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_docs",
      description:
        "Search the NexusDB documentation for information relevant to the user's question. " +
        "Returns the most relevant documentation chunks ranked by relevance. " +
        "ALWAYS call this tool before answering any factual question about NexusDB — " +
        "do not rely on your own knowledge.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query. Use specific keywords from the user's question.",
          },
        },
        required: ["query"],
      },
    },
  },
];

export const agenticTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_docs",
      description:
        "Search the NexusDB documentation. Returns the top 5 most relevant chunks. " +
        "Use specific, targeted keywords — not full sentences. " +
        "Each search costs 1 from your search budget. " +
        "If your first search doesn't fully answer the question, try a DIFFERENT query " +
        "targeting the missing information.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "A specific, targeted search query. Use keywords like 'replication setup', " +
              "'backup schedule config', 'memory limit tuning'. Try different angles if " +
              "first results are insufficient.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_sources",
      description:
        "List all available documentation sources (titles and IDs). " +
        "Use this to understand what documentation exists before searching. " +
        "This does NOT count against your search budget.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

// ─── Runtime Configuration ──────────────────────────────────────────────────

let _chunks: Chunk[] = [];
let _mode: SearchMode = "hybrid";
let _documents: KBDocument[] = [];

export function configure(chunks: Chunk[], mode: SearchMode, documents: KBDocument[]): void {
  _chunks = chunks;
  _mode = mode;
  _documents = documents;
}

export function setSearchMode(mode: SearchMode): void {
  _mode = mode;
}

export function getSearchMode(): SearchMode {
  return _mode;
}

// ─── Tool Dispatcher ────────────────────────────────────────────────────────

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

  if (name === "list_sources") {
    const sources = _documents.map((d) => ({
      id: d.id,
      title: d.title,
    }));
    return JSON.stringify({ sources });
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}
