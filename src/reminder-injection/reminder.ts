// ─── Reminder Injection ──────────────────────────────────────────────────────
//
// The core of this concept: a short block of critical formatting rules
// appended to every tool response. This exploits the recency bias in
// transformer attention — tool responses are the last tokens the model
// reads before generating its next output, so reminders placed here
// sit in the high-attention zone.
//
// Keep reminders short (~100-150 tokens). Every unnecessary token
// dilutes the signal and eats into the context budget.

const REMINDER_BLOCK = `
<system-reminder>
CRITICAL FORMATTING RULES — apply to ALL your responses:
1. ALWAYS cite sources: [Source: <name>] after every recipe or wine mention
2. ONLY use metric units (grams, ml, °C) — NEVER cups, oz, or °F
3. End every dish description with: ⚠️ Allergens: <comma-separated list>
4. Number all steps as "Step N:" — never use bare numbers or bullet points
5. Prefix every dish with its course label: [Appetizer], [Primo], [Secondo], or [Dessert]
</system-reminder>`;

export function wrapToolResponse(result: string): string {
  return result + REMINDER_BLOCK;
}

export const REMINDER_TOKEN_ESTIMATE = 85;
