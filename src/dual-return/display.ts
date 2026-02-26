import type { ToolArtifact, ArtifactEntry, TokenStats } from "./types.js";

// ─── Artifact Display ───────────────────────────────────────────────────────
//
// ASCII table formatter for rendering artifacts in the terminal.
// Capped at 15 rows and 20-char columns to keep output readable.

const MAX_ROWS = 15;
const MAX_COL_WIDTH = 20;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

function padRight(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - s.length));
}

function renderTable(data: unknown[]): string[] {
  if (data.length === 0) return ["  (empty)"];

  // Extract columns from first row
  const columns = Object.keys(data[0] as Record<string, unknown>);
  const colWidths = columns.map((col) => {
    const headerWidth = Math.min(col.length, MAX_COL_WIDTH);
    const dataWidth = data.slice(0, MAX_ROWS).reduce<number>((max, row) => {
      const val = String((row as Record<string, unknown>)[col] ?? "");
      return Math.max(max, Math.min(val.length, MAX_COL_WIDTH));
    }, 0);
    return Math.max(headerWidth, dataWidth);
  });

  const lines: string[] = [];
  const separator = "  +-" + colWidths.map((w) => "-".repeat(w)).join("-+-") + "-+";

  // Header
  lines.push(separator);
  lines.push(
    "  | " +
      columns.map((col, i) => padRight(truncate(col, colWidths[i]), colWidths[i])).join(" | ") +
      " |",
  );
  lines.push(separator);

  // Rows
  const rows = data.slice(0, MAX_ROWS);
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    lines.push(
      "  | " +
        columns
          .map((col, i) => {
            const val = String(r[col] ?? "");
            return padRight(truncate(val, colWidths[i]), colWidths[i]);
          })
          .join(" | ") +
        " |",
    );
  }

  lines.push(separator);

  if (data.length > MAX_ROWS) {
    lines.push(`  ... and ${data.length - MAX_ROWS} more rows`);
  }

  return lines;
}

function renderJson(data: unknown): string[] {
  const json = JSON.stringify(data, null, 2);
  return json.split("\n").map((line) => `  ${line}`);
}

function renderList(data: unknown[]): string[] {
  if (data.length === 0) return ["  (empty)"];

  const lines: string[] = [];
  const items = data.slice(0, MAX_ROWS);

  for (const item of items) {
    const obj = item as Record<string, unknown>;
    // Use the first two fields as label + detail
    const keys = Object.keys(obj);
    const label = String(obj[keys[0]] ?? "");
    const detail = keys.length > 1 ? String(obj[keys[1]] ?? "") : "";
    lines.push(`  - ${label}: ${truncate(detail, 60)}`);

    // Show key fields indented
    for (const key of keys.slice(2, 5)) {
      lines.push(`      ${key}: ${truncate(String(obj[key] ?? ""), 50)}`);
    }
  }

  if (data.length > MAX_ROWS) {
    lines.push(`  ... and ${data.length - MAX_ROWS} more items`);
  }

  return lines;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function renderArtifact(artifact: ToolArtifact): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  +${"=".repeat(56)}+`);
  lines.push(`  | ARTIFACT: ${padRight(artifact.title, 43)} |`);
  lines.push(`  +${"=".repeat(56)}+`);

  switch (artifact.type) {
    case "table":
      lines.push(...renderTable(artifact.data as unknown[]));
      break;
    case "json":
      lines.push(...renderJson(artifact.data));
      break;
    case "list":
      lines.push(...renderList(artifact.data as unknown[]));
      break;
  }

  lines.push(`  +${"=".repeat(56)}+`);
  return lines;
}

export function formatTokenStats(stats: TokenStats): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push("  --- Token Stats ---");
  lines.push(`  Content tokens (in LLM context):  ${stats.contentTokens}`);
  lines.push(`  Artifact tokens (UI only):        ${stats.artifactTokens}`);
  lines.push(`  Tokens saved:                     ${stats.savedTokens}`);
  lines.push(`  Savings:                          ${stats.savingsPercent.toFixed(0)}%`);
  return lines;
}

export function formatArtifactEntries(entries: ArtifactEntry[]): string[] {
  if (entries.length === 0) return [];

  const lines: string[] = [];
  for (const entry of entries) {
    lines.push(...renderArtifact(entry.artifact));
  }
  return lines;
}
