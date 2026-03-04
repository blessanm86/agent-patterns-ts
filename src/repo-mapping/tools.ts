// ─── Agent Tools for Codebase Navigation ────────────────────────────────────
//
// Three tools for the agent to explore the sample project:
//   - list_files: see what files exist
//   - read_file: read a specific file's contents
//   - search_code: keyword search across all files
//
// The agent uses the repo map to decide WHICH files to read, then uses these
// tools to get the details. Without the map, it has to explore blindly.

import * as fs from "fs";
import * as path from "path";
import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions (sent to the model) ───────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List all files in the project directory tree. Returns relative file paths. Use this to discover what files exist before reading them.",
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description:
              'Optional subdirectory to list (e.g., "models", "services"). Leave empty to list all files.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the full contents of a specific file. Provide the relative file path (e.g., 'services/auth.ts').",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative file path to read (e.g., 'models/user.ts')",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_code",
      description:
        "Search for a keyword or pattern across all files in the project. Returns matching lines with file paths and line numbers.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search term or keyword to look for in all files",
          },
        },
        required: ["query"],
      },
    },
  },
];

// ─── Tool Implementations ───────────────────────────────────────────────────

let projectRoot = "";

export function setProjectRoot(root: string): void {
  projectRoot = root;
}

function listFilesImpl(directory?: string): string {
  const targetDir = directory ? path.join(projectRoot, directory) : projectRoot;
  if (!fs.existsSync(targetDir)) {
    return JSON.stringify({ error: `Directory not found: ${directory}` });
  }

  const files: string[] = [];
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts")) {
        files.push(path.relative(projectRoot, fullPath));
      }
    }
  }

  walk(targetDir);
  return JSON.stringify({ files: files.sort() });
}

function readFileImpl(filePath: string): string {
  const fullPath = path.join(projectRoot, filePath);
  if (!fs.existsSync(fullPath)) {
    return JSON.stringify({ error: `File not found: ${filePath}` });
  }
  const content = fs.readFileSync(fullPath, "utf-8");
  return JSON.stringify({ path: filePath, content });
}

function searchCodeImpl(query: string): string {
  const results: { file: string; line: number; text: string }[] = [];
  const lowerQuery = query.toLowerCase();

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts")) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(lowerQuery)) {
            results.push({
              file: path.relative(projectRoot, fullPath),
              line: i + 1,
              text: lines[i].trim(),
            });
          }
        }
      }
    }
  }

  walk(projectRoot);
  return JSON.stringify({ query, matches: results.slice(0, 20) });
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "list_files":
      return listFilesImpl(args.directory);
    case "read_file":
      return readFileImpl(args.path);
    case "search_code":
      return searchCodeImpl(args.query);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
