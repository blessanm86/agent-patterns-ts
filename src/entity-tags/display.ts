import type { EntityStats, EntityType, ParsedEntity } from "./types.js";

// ─── Stats Panel Formatting ─────────────────────────────────────────────────
//
// Renders entity tag statistics as a terminal panel after each agent response.
// Shows entity counts by type, tag hit rate, and extracted entity list.

const ENTITY_LABELS: Record<EntityType, string> = {
  User: "\u{1F464} Users",
  Product: "\u{1F4E6} Products",
  Order: "\u{1F9FE} Orders",
  Category: "\u{1F3F7}\uFE0F  Categories",
};

function padRight(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - s.length));
}

export function formatEntityStats(stats: EntityStats): string[] {
  if (stats.entities.length === 0) {
    return ["", "  --- Entity Tags ---", "  No entity tags found in response."];
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(`  +${"=".repeat(50)}+`);
  lines.push(`  | ${padRight("ENTITY TAGS", 48)} |`);
  lines.push(`  +${"=".repeat(50)}+`);

  // Count by type
  lines.push("  |");
  lines.push("  | Counts:");
  for (const type of Object.keys(ENTITY_LABELS) as EntityType[]) {
    const count = stats.counts[type];
    if (count > 0) {
      lines.push(`  |   ${ENTITY_LABELS[type]}: ${count}`);
    }
  }

  // Tag hit rate
  lines.push("  |");
  if (stats.tagHitRate >= 0) {
    const pct = (stats.tagHitRate * 100).toFixed(0);
    const bar = "\u2588".repeat(Math.round(stats.tagHitRate * 20));
    const empty = "\u2591".repeat(20 - Math.round(stats.tagHitRate * 20));
    lines.push(`  | Tag hit rate: ${pct}% ${bar}${empty}`);
  }

  // Entity list
  lines.push("  |");
  lines.push("  | Entities:");
  const seen = new Set<string>();
  for (const entity of stats.entities) {
    const key = `${entity.type}:${entity.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const attrs = formatEntityAttrs(entity);
    lines.push(`  |   ${entity.type}: ${entity.name || "(unnamed)"}${attrs}`);
  }

  lines.push(`  +${"=".repeat(50)}+`);
  return lines;
}

function formatEntityAttrs(entity: ParsedEntity): string {
  const parts: string[] = [];
  if (entity.id) parts.push(`id=${entity.id}`);

  // Show extra attributes beyond id and name
  for (const [key, val] of Object.entries(entity.attributes)) {
    if (key !== "id" && key !== "name" && val) {
      parts.push(`${key}=${val}`);
    }
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}
