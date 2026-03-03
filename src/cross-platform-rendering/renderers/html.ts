import type { EntityRendererMap, PlatformRenderer } from "../types.js";

// ─── HTML Renderer ──────────────────────────────────────────────────────────
//
// Renders entities as <span> elements with data attributes for UI frameworks.
// Example: <User id="USR-1001" name="Alice Johnson" />
//       →  <span class="entity entity-user" data-type="user" data-id="USR-1001">Alice Johnson</span>

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const entityRenderers: EntityRendererMap = {
  User: (entity) => {
    const name = escapeHtml(entity.name || "User");
    const id = escapeHtml(entity.id);
    return `<span class="entity entity-user" data-type="user" data-id="${id}">${name}</span>`;
  },
  Product: (entity) => {
    const name = escapeHtml(entity.name || "Product");
    const id = escapeHtml(entity.id);
    const price = entity.attributes.price
      ? ` data-price="${escapeHtml(entity.attributes.price)}"`
      : "";
    return `<span class="entity entity-product" data-type="product" data-id="${id}"${price}>${name}</span>`;
  },
  Order: (entity) => {
    const name = escapeHtml(entity.name || entity.id || "Order");
    const id = escapeHtml(entity.id);
    const status = entity.attributes.status
      ? ` data-status="${escapeHtml(entity.attributes.status)}"`
      : "";
    return `<span class="entity entity-order" data-type="order" data-id="${id}"${status}>${name}</span>`;
  },
  Category: (entity) => {
    const name = escapeHtml(entity.name || "Category");
    const id = escapeHtml(entity.id);
    return `<span class="entity entity-category" data-type="category" data-id="${id}">${name}</span>`;
  },
};

export const htmlRenderer: PlatformRenderer = {
  name: "HTML",
  entityRenderers,
};
