import type { Message, ToolDefinition } from "../shared/types.js";
import type { ContextStrategy, OffloadedContent } from "./types.js";

// ─── Base System Prompt ──────────────────────────────────────────────────────
//
// ~1800 tokens of recipe assistant context. Intentionally large to create a
// meaningful stable prefix that benefits from KV-cache reuse.

const BASE_SYSTEM_PROMPT = `You are a professional recipe assistant and meal planning expert for FreshPlate, a premium recipe platform. Your role is to help users discover recipes, plan meals, generate shopping lists, and improve their cooking skills.

## Your Capabilities

### Recipe Discovery
- Search the recipe database by ingredient, cuisine, dietary restriction, or keyword.
- Provide detailed recipe information including ingredients, steps, and timing.
- Suggest recipes based on available ingredients, dietary needs, or preferences.
- Compare recipes by nutrition, difficulty, or prep time when users are deciding.

### Meal Planning
- Help users build a weekly meal plan with balanced nutrition and variety.
- Assign recipes to specific days and meals (breakfast, lunch, dinner, snack).
- Ensure meal variety — avoid scheduling the same cuisine more than twice per week.
- Consider prep time constraints (suggest quick recipes for busy weeknights).

### Shopping & Ingredients
- Generate consolidated shopping lists from the meal plan.
- Suggest ingredient substitutions for dietary needs or missing ingredients.
- Scale recipes up or down based on the number of servings needed.
- Flag common pantry staples the user likely already has.

### Cooking Guidance
- Provide professional cooking tips and technique explanations.
- Share common mistakes to avoid for specific recipes.
- Explain visual cues for doneness, temperature targets, and timing.
- Suggest wine pairings and side dish recommendations.

## Communication Style

### Tone
- Enthusiastic but not overwhelming — like a knowledgeable friend who loves cooking.
- Use specific, actionable language ("sear for 3 minutes" not "cook until done").
- Acknowledge skill level — don't over-explain basics to experienced cooks.
- Be honest about recipe difficulty and time requirements.

### Response Structure
- Start with a direct answer to the user's question.
- Provide details only when relevant or requested.
- When suggesting recipes, always mention prep time and key ingredients.
- After making changes (meal plan, favorites), confirm what was done.

### Important Rules
- Always use tools to look up recipes — never make up recipe details.
- Always verify a recipe exists before adding it to the meal plan.
- When asked about nutrition, use the recipe_get_nutrition tool — don't estimate.
- If a user mentions dietary restrictions, proactively check for substitutions.
- For scaling, always show the adjusted ingredient list, not just the multiplier.

## Tool Usage Patterns
For meal planning flows, follow this sequence:
1. recipe_search (find candidates)
2. recipe_get_details (verify before adding)
3. recipe_add_to_meal_plan (assign to day/meal)
4. recipe_generate_shopping_list (when plan is complete)

For recipe exploration:
1. recipe_search or recipe_get_details (find/view recipe)
2. recipe_get_nutrition (if health-conscious)
3. recipe_get_cook_tips (if user will cook soon)
4. recipe_save_favorite (if user likes it)`;

// ─── Strategy 1: Naive (Cache-Hostile) ───────────────────────────────────────
//
// Demonstrates three common anti-patterns that destroy KV-cache efficiency:
// 1. Timestamp in the system prompt (changes every request)
// 2. Randomized tool ordering (changes the prefix each time)
// 3. History mutation (rewrites previous messages)

export const naiveStrategy: ContextStrategy = {
  name: "Naive (Cache-Hostile)",
  description:
    "Includes timestamp in system prompt, shuffles tool order, " +
    "and mutates previous messages — destroys KV-cache on every turn.",

  buildSystemPrompt(_turn: number): string {
    // Anti-pattern: timestamp at the start of the system prompt
    return `Current time: ${new Date().toISOString()}\nSession ID: ${Math.random().toString(36).slice(2)}\n\n${BASE_SYSTEM_PROMPT}`;
  },

  buildTools(_turn: number, allTools: ToolDefinition[]): ToolDefinition[] {
    // Anti-pattern: shuffle tool order each request
    const shuffled = [...allTools];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  },

  processHistory(history: Message[], turn: number): Message[] {
    if (history.length === 0) return history;
    // Anti-pattern: mutate a previous message by adding a "last accessed" marker
    // This changes the prefix and invalidates the cache
    const mutated = history.map((msg, i) => {
      if (msg.role === "user" && i === 0) {
        return {
          ...msg,
          content: `[last accessed: turn ${turn}] ${msg.content}`,
        };
      }
      return msg;
    });
    return mutated;
  },
};

// ─── Strategy 2: Append-Only (Cache-Friendly) ───────────────────────────────
//
// Follows the three basic rules for cache efficiency:
// 1. Stable system prompt (no timestamps, no dynamic content)
// 2. Deterministic tool ordering (sorted, never shuffled)
// 3. Append-only history (never modify previous messages)

export const appendOnlyStrategy: ContextStrategy = {
  name: "Append-Only (Cache-Friendly)",
  description:
    "Static system prompt, stable tool ordering, append-only history — " +
    "maximizes KV-cache prefix reuse.",

  buildSystemPrompt(_turn: number): string {
    // Stable: no timestamps, no session IDs, no dynamic content
    return BASE_SYSTEM_PROMPT;
  },

  buildTools(_turn: number, allTools: ToolDefinition[]): ToolDefinition[] {
    // Stable: tools are always in the same order (as defined in the array)
    return allTools;
  },

  processHistory(history: Message[], _turn: number): Message[] {
    // Append-only: return history unchanged — never modify previous entries
    return history;
  },
};

// ─── Strategy 3: Cache-Optimized (Full Pipeline) ────────────────────────────
//
// Everything from append-only plus:
// 1. Tool masking — all tools stay in the prompt, unavailable ones noted in
//    the system prompt rather than removed (simulates logit masking)
// 2. Restorable compression — verbose tool results from older turns are
//    replaced with compact references (the original content is "offloaded"
//    to a simulated filesystem)
// 3. The prefix remains byte-identical even as old content is compressed

const COMPRESSION_THRESHOLD = 200; // chars — compress tool results longer than this
const COMPRESS_AFTER_TURNS = 3; // only compress results older than N turns

export const cacheOptimizedStrategy: ContextStrategy & {
  offloadedContent: OffloadedContent[];
} = {
  name: "Cache-Optimized (Full Pipeline)",
  description:
    "Append-only + tool masking + restorable compression — " +
    "aggressive KV-cache optimization as used by Manus and Claude Code.",

  offloadedContent: [],

  buildSystemPrompt(_turn: number): string {
    // Stable prefix: identical every request
    // Tool availability is controlled via instructions, not by removing tools.
    // In production, this would be logit masking; here we simulate with text.
    return `${BASE_SYSTEM_PROMPT}

## Tool Availability
All tools are always available in this session. Tool availability is managed
via constrained decoding (logit masking) rather than adding/removing tools
from the prompt, to preserve KV-cache prefix stability.`;
  },

  buildTools(_turn: number, allTools: ToolDefinition[]): ToolDefinition[] {
    // All tools always present — never add or remove
    return allTools;
  },

  processHistory(history: Message[], turn: number): Message[] {
    // Restorable compression: replace verbose tool results from older turns
    // with compact references. The original content is "offloaded to disk."
    //
    // Key constraint: we only compress tool messages from turns older than
    // COMPRESS_AFTER_TURNS ago, and we do this in-place on a COPY so the
    // original history array used by the benchmark is unchanged.
    //
    // In production (Manus), this would write to the filesystem and keep
    // the file path. Here we simulate with a compact summary.

    const compressed: Message[] = [];
    let turnCounter = 0;

    for (const msg of history) {
      if (msg.role === "user") {
        turnCounter++;
      }

      // Compress old tool results that are verbose
      if (
        msg.role === "tool" &&
        msg.content.length > COMPRESSION_THRESHOLD &&
        turnCounter <= turn - COMPRESS_AFTER_TURNS
      ) {
        // Create a compact reference
        const original = msg.content;
        let summary: string;
        try {
          const parsed = JSON.parse(original);
          // Keep just the top-level keys and a size indicator
          const keys = Object.keys(parsed);
          summary = JSON.stringify({
            _compressed: true,
            _ref: `offload://turn-${turnCounter}/tool-result.json`,
            _originalSize: original.length,
            _keys: keys,
          });
        } catch {
          summary = JSON.stringify({
            _compressed: true,
            _ref: `offload://turn-${turnCounter}/tool-result.txt`,
            _originalSize: original.length,
          });
        }

        cacheOptimizedStrategy.offloadedContent.push({
          turnIndex: turnCounter,
          originalLength: original.length,
          reference: summary,
        });

        compressed.push({ ...msg, content: summary });
      } else {
        compressed.push(msg);
      }
    }

    return compressed;
  },
};

export const strategies: ContextStrategy[] = [
  naiveStrategy,
  appendOnlyStrategy,
  cacheOptimizedStrategy,
];
