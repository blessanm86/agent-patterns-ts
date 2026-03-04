// ─── Repo Mapping Types ──────────────────────────────────────────────────────
//
// Core data structures for the repository mapping pipeline:
// Walk → Parse → Graph → Rank → Render

export interface Definition {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "const";
  line: number;
  signature: string; // e.g., "export function authenticate(email: string, password: string): User"
  exported: boolean;
}

export interface Reference {
  name: string; // identifier being referenced
  line: number;
}

export interface FileTag {
  filePath: string; // relative path from root
  definitions: Definition[];
  references: Reference[];
}

export interface RepoMapConfig {
  rootDir: string;
  tokenBudget: number; // max tokens for the rendered map (default 1024)
  personalizedFiles: string[]; // "active" files to boost in PageRank
}
