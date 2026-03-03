import type { EntityRendererMap, EntityType, ParsedEntity, PlatformRenderer } from "../types.js";

// ─── Slack Renderer ─────────────────────────────────────────────────────────
//
// Renders entities using Slack mrkdwn inline formatting, then wraps the full
// response in Block Kit JSON (section + context blocks).
//
// Inline: <User id="USR-1001" name="Alice Johnson" />
//      →  *:bust_in_silhouette: Alice Johnson* (USR-1001)
//
// Wrapped: { blocks: [section(text), context(entity summary)] }

const ENTITY_SLACK_EMOJI: Record<EntityType, string> = {
  User: ":bust_in_silhouette:",
  Product: ":package:",
  Order: ":receipt:",
  Category: ":label:",
};

const entityRenderers: EntityRendererMap = {
  User: (entity) => {
    const name = entity.name || "User";
    const id = entity.id ? ` (${entity.id})` : "";
    return `*${ENTITY_SLACK_EMOJI.User} ${name}*${id}`;
  },
  Product: (entity) => {
    const name = entity.name || "Product";
    const id = entity.id ? ` (${entity.id})` : "";
    return `*${ENTITY_SLACK_EMOJI.Product} ${name}*${id}`;
  },
  Order: (entity) => {
    const name = entity.name || entity.id || "Order";
    const id = entity.id ? ` (${entity.id})` : "";
    return `*${ENTITY_SLACK_EMOJI.Order} ${name}*${id}`;
  },
  Category: (entity) => {
    const name = entity.name || "Category";
    const id = entity.id ? ` (${entity.id})` : "";
    return `*${ENTITY_SLACK_EMOJI.Category} ${name}*${id}`;
  },
};

/**
 * Wrap the mrkdwn-rendered text in Slack Block Kit JSON.
 * Produces a section block with the text + a context block listing entities.
 */
function wrapResponse(text: string, entities: ParsedEntity[]): string {
  const blocks: Record<string, unknown>[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text },
    },
  ];

  if (entities.length > 0) {
    // Deduplicate entities by type:id
    const seen = new Set<string>();
    const unique: ParsedEntity[] = [];
    for (const e of entities) {
      const key = `${e.type}:${e.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(e);
      }
    }

    const elements = unique.map((e) => ({
      type: "mrkdwn",
      text: `${ENTITY_SLACK_EMOJI[e.type]} ${e.name}${e.id ? ` \`${e.id}\`` : ""}`,
    }));

    blocks.push({
      type: "context",
      elements,
    });
  }

  return JSON.stringify({ blocks }, null, 2);
}

export const slackRenderer: PlatformRenderer = {
  name: "Slack Block Kit",
  entityRenderers,
  wrapResponse,
};
