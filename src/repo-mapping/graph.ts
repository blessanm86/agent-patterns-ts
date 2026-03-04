// ─── Dependency Graph + PageRank ─────────────────────────────────────────────
//
// Builds a directed graph from cross-file references, then runs PageRank
// to identify the most structurally important files. Follows Aider's insight:
// files that are referenced by many other files are the "hubs" of a codebase.
//
// Edge weights use a simplified version of Aider's multiplier system:
//   - Exported + referenced: weight 1.0
//   - Long identifier (>=8 chars): weight x2 (more specific = more meaningful)
//   - Unexported: weight x0.1 (internal detail, less important)
//   - Personalized file: weight x10 (files the user is currently working on)

import type { FileTag } from "./types.js";

export interface GraphEdge {
  from: string; // file that references
  to: string; // file that defines
  weight: number;
}

// ─── Build Adjacency ────────────────────────────────────────────────────────

export function buildGraph(
  tags: FileTag[],
  personalizedFiles: string[] = [],
): Map<string, Map<string, number>> {
  const personalizedSet = new Set(personalizedFiles);

  // Index: definition name → file path + exported flag
  const defIndex = new Map<string, { filePath: string; exported: boolean }[]>();
  for (const tag of tags) {
    for (const def of tag.definitions) {
      if (!defIndex.has(def.name)) {
        defIndex.set(def.name, []);
      }
      defIndex.get(def.name)!.push({ filePath: tag.filePath, exported: def.exported });
    }
  }

  // Build weighted adjacency: from → (to → accumulated weight)
  const adjacency = new Map<string, Map<string, number>>();

  // Ensure every file appears as a node
  for (const tag of tags) {
    if (!adjacency.has(tag.filePath)) {
      adjacency.set(tag.filePath, new Map());
    }
  }

  for (const tag of tags) {
    for (const ref of tag.references) {
      const targets = defIndex.get(ref.name);
      if (!targets) continue;

      for (const target of targets) {
        if (target.filePath === tag.filePath) continue; // skip self-references

        // Calculate edge weight
        let weight = 1.0;
        if (ref.name.length >= 8) weight *= 2; // long identifier = more specific
        if (!target.exported) weight *= 0.1; // unexported = less important
        if (personalizedSet.has(tag.filePath)) weight *= 10; // current file = boost

        const neighbors = adjacency.get(tag.filePath)!;
        neighbors.set(target.filePath, (neighbors.get(target.filePath) ?? 0) + weight);
      }
    }
  }

  return adjacency;
}

// ─── PageRank ───────────────────────────────────────────────────────────────

export function pagerank(
  adjacency: Map<string, Map<string, number>>,
  personalization?: Map<string, number>,
  damping = 0.85,
  iterations = 30,
): Map<string, number> {
  const nodes = [...adjacency.keys()];
  const n = nodes.length;
  if (n === 0) return new Map();

  // Initialize scores
  const scores = new Map<string, number>();
  const uniform = 1 / n;
  for (const node of nodes) {
    scores.set(node, uniform);
  }

  // Build personalization vector (uniform if not provided)
  const personVec = new Map<string, number>();
  if (personalization && personalization.size > 0) {
    let total = 0;
    for (const [node, val] of personalization) {
      if (adjacency.has(node)) {
        personVec.set(node, val);
        total += val;
      }
    }
    // Normalize
    for (const [node, val] of personVec) {
      personVec.set(node, val / total);
    }
    // Fill remaining nodes with zero
    for (const node of nodes) {
      if (!personVec.has(node)) personVec.set(node, 0);
    }
  } else {
    for (const node of nodes) {
      personVec.set(node, uniform);
    }
  }

  // Iterative PageRank
  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Map<string, number>();
    for (const node of nodes) {
      newScores.set(node, 0);
    }

    for (const [from, neighbors] of adjacency) {
      // Total outgoing weight from this node
      let totalWeight = 0;
      for (const w of neighbors.values()) {
        totalWeight += w;
      }
      if (totalWeight === 0) continue;

      const fromScore = scores.get(from)!;
      for (const [to, weight] of neighbors) {
        const contribution = (fromScore * weight) / totalWeight;
        newScores.set(to, newScores.get(to)! + contribution);
      }
    }

    // Apply damping + personalization
    for (const node of nodes) {
      const dampedScore = damping * newScores.get(node)! + (1 - damping) * personVec.get(node)!;
      newScores.set(node, dampedScore);
    }

    // Update scores
    for (const [node, score] of newScores) {
      scores.set(node, score);
    }
  }

  return scores;
}

// ─── Ranked File List ───────────────────────────────────────────────────────

export function rankFiles(
  tags: FileTag[],
  personalizedFiles: string[] = [],
): { filePath: string; score: number }[] {
  const adjacency = buildGraph(tags, personalizedFiles);

  // Build personalization vector: boosted files get 10x weight
  const personalization = new Map<string, number>();
  for (const tag of tags) {
    personalization.set(tag.filePath, personalizedFiles.includes(tag.filePath) ? 10 : 1);
  }

  const scores = pagerank(adjacency, personalization);

  return [...scores.entries()]
    .map(([filePath, score]) => ({ filePath, score }))
    .sort((a, b) => b.score - a.score);
}
