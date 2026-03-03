import type { PlatformType, PlatformRenderer, ParsedEntity } from "../types.js";
import { parseEntityTags } from "../parser.js";
import { terminalRenderer } from "./terminal.js";
import { markdownRenderer } from "./markdown.js";
import { htmlRenderer } from "./html.js";
import { slackRenderer } from "./slack.js";

// ─── Renderer Registry ──────────────────────────────────────────────────────
//
// Record<PlatformType, PlatformRenderer> forces exhaustive coverage.
// Adding "discord" to PlatformType → this object literal fails to compile
// until a Discord renderer is added.

const RENDERERS: Record<PlatformType, PlatformRenderer> = {
  terminal: terminalRenderer,
  markdown: markdownRenderer,
  html: htmlRenderer,
  slack: slackRenderer,
};

export const ALL_PLATFORMS: PlatformType[] = ["terminal", "markdown", "html", "slack"];

/**
 * Get the renderer for a given platform.
 */
export function getRenderer(platform: PlatformType): PlatformRenderer {
  return RENDERERS[platform];
}

/**
 * Render raw LLM output (containing entity tags) for a specific platform.
 *
 * 1. Parse entity tags from the raw text
 * 2. Replace each tag end-to-start using the platform's dispatch table
 * 3. Optionally wrap the result (e.g. Slack Block Kit JSON)
 *
 * Returns the rendered string and the parsed entities (for stats).
 */
export function renderForPlatform(
  rawText: string,
  platform: PlatformType,
): { rendered: string; entities: ParsedEntity[] } {
  const entities = parseEntityTags(rawText);
  const renderer = RENDERERS[platform];

  if (entities.length === 0) {
    return { rendered: rawText, entities };
  }

  // Replace from end to start so character indices stay valid
  let result = rawText;
  for (let i = entities.length - 1; i >= 0; i--) {
    const entity = entities[i];
    const renderFn = renderer.entityRenderers[entity.type];
    const replacement = renderFn(entity);
    result = result.slice(0, entity.start) + replacement + result.slice(entity.end);
  }

  // Optional platform-level wrapping (e.g. Slack Block Kit)
  if (renderer.wrapResponse) {
    result = renderer.wrapResponse(result, entities);
  }

  return { rendered: result, entities };
}
