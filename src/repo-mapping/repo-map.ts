// ─── Repo Map Orchestrator ───────────────────────────────────────────────────
//
// The main pipeline: Walk → Parse → Graph → Rank → Render
//
// Takes a root directory, parses all .ts files, builds a dependency graph,
// runs PageRank, and renders a compact map that fits within a token budget.

import * as fs from "fs";
import * as path from "path";
import { parseFile, resolveReferences } from "./parser.js";
import { rankFiles } from "./graph.js";
import type { FileTag, RepoMapConfig } from "./types.js";

// ─── Walk ───────────────────────────────────────────────────────────────────

function walkDirectory(dir: string, rootDir: string): string[] {
  const files: string[] = [];
  const ignoreDirs = new Set(["node_modules", ".git", "dist", ".next", "coverage"]);

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoreDirs.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        files.push(path.relative(rootDir, fullPath));
      }
    }
  }

  walk(dir);
  return files.sort();
}

// ─── Parse All Files ────────────────────────────────────────────────────────

function parseAllFiles(rootDir: string, filePaths: string[]): FileTag[] {
  const tags: FileTag[] = [];
  for (const relPath of filePaths) {
    const fullPath = path.join(rootDir, relPath);
    const content = fs.readFileSync(fullPath, "utf-8");
    tags.push(parseFile(relPath, content));
  }
  resolveReferences(tags);
  return tags;
}

// ─── Render Map ─────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function renderMapForFiles(tags: FileTag[], rankedPaths: string[], maxFiles: number): string {
  const tagIndex = new Map(tags.map((t) => [t.filePath, t]));
  const lines: string[] = [];

  const filesToShow = rankedPaths.slice(0, maxFiles);
  for (const filePath of filesToShow) {
    const tag = tagIndex.get(filePath);
    if (!tag) continue;

    // Only show exported definitions (the public API)
    const exportedDefs = tag.definitions.filter((d) => d.exported);
    if (exportedDefs.length === 0 && tag.definitions.length === 0) continue;

    lines.push(`${filePath}:`);
    const defsToShow = exportedDefs.length > 0 ? exportedDefs : tag.definitions.slice(0, 3);
    for (const def of defsToShow) {
      lines.push(`│  ${def.signature}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

// Binary search for max files that fit within token budget
function renderWithBudget(tags: FileTag[], rankedPaths: string[], tokenBudget: number): string {
  if (rankedPaths.length === 0) return "(empty repository)";

  // Try all files first
  const full = renderMapForFiles(tags, rankedPaths, rankedPaths.length);
  if (estimateTokens(full) <= tokenBudget) return full;

  // Binary search for the right number of files
  let lo = 1;
  let hi = rankedPaths.length;
  let bestMap = renderMapForFiles(tags, rankedPaths, 1);

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const rendered = renderMapForFiles(tags, rankedPaths, mid);
    if (estimateTokens(rendered) <= tokenBudget) {
      bestMap = rendered;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return bestMap;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface RepoMapResult {
  map: string;
  stats: {
    totalFiles: number;
    filesInMap: number;
    totalDefinitions: number;
    totalReferences: number;
    estimatedTokens: number;
  };
  tags: FileTag[];
  ranked: { filePath: string; score: number }[];
}

export function generateRepoMap(config: RepoMapConfig): RepoMapResult {
  const { rootDir, tokenBudget = 1024, personalizedFiles = [] } = config;

  // 1. Walk
  const filePaths = walkDirectory(rootDir, rootDir);

  // 2. Parse
  const tags = parseAllFiles(rootDir, filePaths);

  // 3. Rank
  const ranked = rankFiles(tags, personalizedFiles);
  const rankedPaths = ranked.map((r) => r.filePath);

  // 4. Render within budget
  const map = renderWithBudget(tags, rankedPaths, tokenBudget);

  // Stats
  const totalDefs = tags.reduce((sum, t) => sum + t.definitions.length, 0);
  const totalRefs = tags.reduce((sum, t) => sum + t.references.length, 0);
  const filesInMap = (map.match(/^\S.*\.ts:$/gm) || []).length;

  return {
    map,
    stats: {
      totalFiles: filePaths.length,
      filesInMap,
      totalDefinitions: totalDefs,
      totalReferences: totalRefs,
      estimatedTokens: estimateTokens(map),
    },
    tags,
    ranked,
  };
}
