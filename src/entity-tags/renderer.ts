import type { EntityType } from "./types.js";
import { parseEntityTags } from "./parser.js";

// ─── ANSI Badge Renderer ──────────────────────────────────────────────────────
//
// Replaces entity tags in LLM output with colored terminal badges.
// Each entity type gets a distinct color + emoji.
//
// Example: <User id="USR-1001" name="Alice Johnson" />
//       →  [👤 Alice Johnson #USR-1001]  (in cyan)

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  // Entity type colors
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
} as const;

const ENTITY_STYLE: Record<EntityType, { emoji: string; color: string }> = {
  User: { emoji: "\u{1F464}", color: ANSI.cyan },
  Product: { emoji: "\u{1F4E6}", color: ANSI.green },
  Order: { emoji: "\u{1F9FE}", color: ANSI.yellow },
  Category: { emoji: "\u{1F3F7}\uFE0F", color: ANSI.magenta },
};

/**
 * Render entity tags as ANSI-colored badges.
 * Replaces from end-to-start to preserve character indices.
 */
export function renderEntityTags(text: string): string {
  const entities = parseEntityTags(text);
  if (entities.length === 0) return text;

  // Replace from end to start so indices stay valid
  let result = text;
  for (let i = entities.length - 1; i >= 0; i--) {
    const entity = entities[i];
    const style = ENTITY_STYLE[entity.type];
    const displayName = entity.name || entity.type;
    const idSuffix = entity.id ? ` #${entity.id}` : "";
    const badge = `${style.color}${ANSI.bold}[${style.emoji} ${displayName}${idSuffix}]${ANSI.reset}`;
    result = result.slice(0, entity.start) + badge + result.slice(entity.end);
  }

  return result;
}
