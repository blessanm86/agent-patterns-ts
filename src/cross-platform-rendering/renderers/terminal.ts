import type { EntityRendererMap, EntityType, PlatformRenderer } from "../types.js";

// ─── Terminal Renderer ──────────────────────────────────────────────────────
//
// ANSI colored badges for terminal display.
// Example: <User id="USR-1001" name="Alice Johnson" />
//       →  [👤 Alice Johnson #USR-1001]  (in cyan)

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
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

const entityRenderers: EntityRendererMap = {
  User: (entity) => {
    const s = ENTITY_STYLE.User;
    const idSuffix = entity.id ? ` #${entity.id}` : "";
    return `${s.color}${ANSI.bold}[${s.emoji} ${entity.name || "User"}${idSuffix}]${ANSI.reset}`;
  },
  Product: (entity) => {
    const s = ENTITY_STYLE.Product;
    const idSuffix = entity.id ? ` #${entity.id}` : "";
    return `${s.color}${ANSI.bold}[${s.emoji} ${entity.name || "Product"}${idSuffix}]${ANSI.reset}`;
  },
  Order: (entity) => {
    const s = ENTITY_STYLE.Order;
    const idSuffix = entity.id ? ` #${entity.id}` : "";
    return `${s.color}${ANSI.bold}[${s.emoji} ${entity.name || entity.id || "Order"}${idSuffix}]${ANSI.reset}`;
  },
  Category: (entity) => {
    const s = ENTITY_STYLE.Category;
    const idSuffix = entity.id ? ` #${entity.id}` : "";
    return `${s.color}${ANSI.bold}[${s.emoji} ${entity.name || "Category"}${idSuffix}]${ANSI.reset}`;
  },
};

export const terminalRenderer: PlatformRenderer = {
  name: "Terminal",
  entityRenderers,
};
