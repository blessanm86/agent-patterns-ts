import type { EntityType, ParsedEntity } from "./types.js";

// ─── Entity Tag Parser ────────────────────────────────────────────────────────
//
// Parses XML-like entity tags from LLM output. Only matches the 4 known
// entity types — not arbitrary XML.
//
// Supports two forms:
//   Self-closing:  <User id="USR-1001" name="Alice Johnson" />
//   Wrapping:      <User id="USR-1001">Alice Johnson</User>

const ENTITY_TYPES: EntityType[] = ["User", "Product", "Order", "Category"];
const TYPE_PATTERN = ENTITY_TYPES.join("|");

// Self-closing: <Type attr="val" attr="val" />
const SELF_CLOSING_RE = new RegExp(`<(${TYPE_PATTERN})\\s+([^>]*?)\\s*/>`, "g");

// Wrapping: <Type attr="val">content</Type>
const WRAPPING_RE = new RegExp(`<(${TYPE_PATTERN})\\s+([^>]*?)>([^<]*?)</(${TYPE_PATTERN})>`, "g");

// Attribute extractor: key="value"
const ATTR_RE = /(\w+)="([^"]*)"/g;

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let match: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(attrString)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

/**
 * Parse all entity tags from LLM output text.
 * Returns entities sorted by their position in the string.
 */
export function parseEntityTags(text: string): ParsedEntity[] {
  const entities: ParsedEntity[] = [];

  // Self-closing tags
  SELF_CLOSING_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SELF_CLOSING_RE.exec(text)) !== null) {
    const attrs = parseAttributes(match[2]);
    entities.push({
      type: match[1] as EntityType,
      id: attrs.id ?? "",
      name: attrs.name ?? "",
      attributes: attrs,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Wrapping tags
  WRAPPING_RE.lastIndex = 0;
  while ((match = WRAPPING_RE.exec(text)) !== null) {
    const attrs = parseAttributes(match[2]);
    entities.push({
      type: match[1] as EntityType,
      id: attrs.id ?? "",
      name: attrs.name ?? match[3].trim(),
      attributes: attrs,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Sort by position so replacements work correctly
  entities.sort((a, b) => a.start - b.start);
  return entities;
}

/**
 * Strip all entity tags from text, leaving just readable names.
 * Useful for graceful degradation or plain-text display.
 */
export function stripEntityTags(text: string): string {
  // Replace self-closing tags with the name attribute
  let result = text.replace(SELF_CLOSING_RE, (_match, _type, attrStr) => {
    const attrs = parseAttributes(attrStr);
    return attrs.name ?? "";
  });

  // Replace wrapping tags with the inner content
  result = result.replace(WRAPPING_RE, (_match, _type, _attrStr, content) => {
    return content.trim();
  });

  return result;
}

/**
 * Collect all unique entity IDs from parsed entities.
 */
export function collectEntityIds(entities: ParsedEntity[]): Set<string> {
  return new Set(entities.filter((e) => e.id).map((e) => e.id));
}
