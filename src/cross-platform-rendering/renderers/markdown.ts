import type { EntityRendererMap, EntityType, PlatformRenderer } from "../types.js";

// ─── Markdown Renderer ──────────────────────────────────────────────────────
//
// Renders entities as markdown links with entity:// protocol URIs.
// Example: <User id="USR-1001" name="Alice Johnson" />
//       →  [👤 Alice Johnson](entity://user/USR-1001)

const ENTITY_EMOJI: Record<EntityType, string> = {
  User: "\u{1F464}",
  Product: "\u{1F4E6}",
  Order: "\u{1F9FE}",
  Category: "\u{1F3F7}\uFE0F",
};

const entityRenderers: EntityRendererMap = {
  User: (entity) => {
    const name = entity.name || "User";
    const uri = entity.id ? `entity://user/${entity.id}` : "entity://user";
    return `[${ENTITY_EMOJI.User} ${name}](${uri})`;
  },
  Product: (entity) => {
    const name = entity.name || "Product";
    const uri = entity.id ? `entity://product/${entity.id}` : "entity://product";
    return `[${ENTITY_EMOJI.Product} ${name}](${uri})`;
  },
  Order: (entity) => {
    const name = entity.name || entity.id || "Order";
    const uri = entity.id ? `entity://order/${entity.id}` : "entity://order";
    return `[${ENTITY_EMOJI.Order} ${name}](${uri})`;
  },
  Category: (entity) => {
    const name = entity.name || "Category";
    const uri = entity.id ? `entity://category/${entity.id}` : "entity://category";
    return `[${ENTITY_EMOJI.Category} ${name}](${uri})`;
  },
};

export const markdownRenderer: PlatformRenderer = {
  name: "Markdown",
  entityRenderers,
};
