// ─── Reflector Agent ─────────────────────────────────────────────────────────
//
// The Reflector is a background agent that garbage-collects the observation
// block. It fires when observations exceed a token threshold and:
//   1. Merges redundant or overlapping observations
//   2. Drops stale or superseded observations
//   3. Condenses related items into higher-level summaries
//
// Input:  the current observation block (text)
// Output: a pruned, reorganized observation block

import ollama from "ollama";
import { MODEL } from "../shared/config.js";

const REFLECTOR_SYSTEM_PROMPT = `You are a memory reflector. Your job is to review an observation log and produce a more compact version by:

1. MERGING redundant observations (e.g., two entries about "likes spicy food" become one)
2. REMOVING observations that have been superseded (e.g., if a later entry says "switched to vegan", remove earlier "is vegetarian")
3. CONDENSING related observations into higher-level summaries
4. PROMOTING patterns to 🔴 if they appear multiple times (e.g., repeated requests for vegan recipes → 🔴 preference)
5. DROPPING 🟢 observations that are no longer relevant (old topic mentions with no lasting value)

Keep the same format:
Date: YYYY-MM-DD
- 🔴/🟡/🟢 observation text

Rules:
- Preserve ALL 🔴 observations unless explicitly superseded
- Keep the most recent date when merging observations from different dates
- Aim for 40-60% reduction in the number of observation lines
- Do NOT invent new information — only reorganize and condense what exists
- Output ONLY the condensed observation block — no preamble, no explanation`;

export interface ReflectorResult {
  observations: string;
}

export async function runReflector(currentObservations: string): Promise<ReflectorResult> {
  const prompt = `Current observation log to reflect on and condense:

${currentObservations}

Produce the condensed observation log:`;

  const response = await ollama.chat({
    model: MODEL,
    // @ts-expect-error — system not in ChatRequest types but works at runtime
    system: REFLECTOR_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  return {
    observations: response.message.content.trim(),
  };
}
