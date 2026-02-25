import ollama from "ollama";
import { tripTools, executeTripTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";

// ─── Plan Types ───────────────────────────────────────────────────────────────

export interface PlanStep {
  tool: string;
  args: Record<string, string>;
  description: string;
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

// Lists available tools so the planner knows what to call.
// The key constraint: the model must commit to ALL tool calls upfront
// without seeing any results first. This is the defining characteristic
// of Plan+Execute vs ReAct.
const PLANNER_PROMPT = `You are a trip planning assistant. Your job is to create a research plan for a trip.

Given a trip request, output a JSON plan specifying which tools to call to gather all necessary information.

Available tools:
${tripTools.map((t) => `- ${t.function.name}: ${t.function.description}`).join("\n")}

Output a JSON object with this exact structure:
{
  "goal": "<one sentence describing the trip>",
  "steps": [
    {
      "tool": "<tool name>",
      "args": { "<param>": "<value>", ... },
      "description": "<why this step is needed>"
    }
  ]
}

Rules:
- Include search_flights as the first step (flights before accommodation)
- Include search_hotels, find_attractions, and find_restaurants for the destination
- Use YYYY-MM-DD format for all dates
- All args values must be strings
- Output only valid JSON, no other text`;

const SYNTHESIZER_PROMPT = `You are a trip planning assistant. You have gathered research about a trip using various tools.
Using the research results below, create a practical day-by-day itinerary.

Include:
- Which flight to take (with price and departure time)
- Which hotel to stay at (with price per night)
- Day-by-day activity schedule using the attractions found
- Restaurant recommendations for meals

Be specific — use the actual names, prices, and times from the research. Format as a readable itinerary.`;

// ─── Phase 1: Planner ─────────────────────────────────────────────────────────
//
// A single LLM call that returns a structured plan.
// The model sees the request and the available tools, then decides ALL tool
// calls upfront — without seeing any results.
//
// This is the key distinction from ReAct: in ReAct the model decides one tool
// at a time after seeing each result. Here it commits to a full plan first.

export async function createPlan(userMessage: string): Promise<Plan> {
  const response = await ollama.chat({
    model: MODEL,
    messages: [
      { role: "system", content: PLANNER_PROMPT },
      { role: "user", content: userMessage },
    ],
    format: "json",
  });

  const plan = JSON.parse(response.message.content) as Plan;
  return plan;
}

// ─── Full Pipeline: Plan → Execute → Synthesize ───────────────────────────────
//
// Three phases:
//   1. PLAN  — one LLM call returns a structured list of tool calls
//   2. EXECUTE — run each tool mechanically, no LLM involved
//   3. SYNTHESIZE — one LLM call turns all results into a final itinerary
//
// Contrast with ReAct: in ReAct the loop intermixes LLM calls and tool calls.
// Here the phases are completely separated. The plan is visible (and testable)
// before any tools run.

export async function runPlanExecuteAgent(
  userMessage: string,
  history: Message[],
): Promise<Message[]> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];

  // ── Phase 1: Plan ───────────────────────────────────────────────────────────

  console.log("\n  📋 Planning...");
  const plan = await createPlan(userMessage);

  // Print the plan so users can see it was decided upfront
  console.log(`\n  Goal: ${plan.goal}`);
  console.log(`  Steps (${plan.steps.length} tool calls, all decided before any tools run):`);
  plan.steps.forEach((step, i) => {
    console.log(`    ${i + 1}. ${step.tool}(${JSON.stringify(step.args)})`);
    console.log(`       → ${step.description}`);
  });

  // Add a readable summary of the plan to history as an assistant message
  const planSummary = `I'll research this trip in ${plan.steps.length} steps:\n${plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join("\n")}`;
  messages.push({ role: "assistant", content: planSummary });

  // ── Phase 2: Execute ────────────────────────────────────────────────────────
  //
  // Run each planned tool call. No LLM involved here — execution is mechanical.
  // The plan is fixed; we don't adapt based on results.

  console.log("\n  ⚡ Executing plan...");
  for (const step of plan.steps) {
    const result = executeTripTool(step.tool, step.args);
    logToolCall(step.tool, step.args, result);

    messages.push({ role: "tool", content: result });
  }

  // ── Phase 3: Synthesize ─────────────────────────────────────────────────────
  //
  // The synthesizer sees the original request + all tool results and produces
  // the final itinerary. This is a regular LLM call — no tools, no loop.

  console.log("\n  ✍️  Synthesizing itinerary...");
  const synthResponse = await ollama.chat({
    model: MODEL,
    system: SYNTHESIZER_PROMPT,
    messages,
  });

  messages.push(synthResponse.message);

  return messages;
}
