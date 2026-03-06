import ollama from "ollama";
import { tools, executeTool } from "./tools.js";
import { MODEL } from "../shared/config.js";
import { logToolCall } from "../shared/logging.js";
import type { Message } from "../shared/types.js";

// ─── Strategy Types ─────────────────────────────────────────────────────────

export type Strategy = "single" | "uniform" | "adaptive";

export interface TrajectoryResult {
  messages: Message[];
  tokenCount: number;
  toolCalls: number;
  llmCalls: number;
}

export interface AgentResult {
  strategy: Strategy;
  finalMessages: Message[];
  trajectoryCount: number;
  totalTokens: number;
  totalLLMCalls: number;
  totalToolCalls: number;
  confidenceScore?: number;
  scaledUp?: boolean;
}

// ─── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a recipe research assistant. You help users find recipes, plan meals, and solve dietary challenges.

When answering questions:
1. Use the search_recipes tool to find relevant recipes
2. Use get_recipe_details for full information on specific recipes
3. Use find_substitutions when users have dietary restrictions that require ingredient swaps
4. Use calculate_meal_nutrition when planning multi-dish meals to check total calories

Be thorough: search for recipes, get details, check dietary compliance, and calculate nutrition as needed.
Provide specific, actionable answers with recipe names, ingredients, and calorie counts.`;

// ─── Single Trajectory Run ──────────────────────────────────────────────────
//
// Runs one complete ReAct loop and returns the trajectory with token counts.
// This is the building block for all three strategies.

async function runTrajectory(
  userMessage: string,
  history: Message[],
  trajectoryId: number,
  verbose: boolean,
): Promise<TrajectoryResult> {
  const messages: Message[] = [...history, { role: "user", content: userMessage }];
  let tokenCount = 0;
  let toolCalls = 0;
  let llmCalls = 0;
  let iteration = 0;

  while (true) {
    iteration++;
    llmCalls++;

    const response = await ollama.chat({
      model: MODEL,
      // @ts-expect-error — system not in ChatRequest types but works at runtime
      system: SYSTEM_PROMPT,
      messages,
      tools,
      options: {
        // Vary temperature across trajectories for diversity
        temperature: trajectoryId === 0 ? 0.3 : 0.5 + trajectoryId * 0.15,
      },
    });

    tokenCount += (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0);
    const assistantMessage = response.message as Message;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const { name, arguments: args } = toolCall.function;
      toolCalls++;
      const result = executeTool(name, args as Record<string, string>);
      if (verbose) {
        logToolCall(name, args as Record<string, string>, result, { maxResultLength: 120 });
      }
      messages.push({ role: "tool", content: result });
    }

    if (iteration >= 8) {
      if (verbose) console.log(`    [trajectory ${trajectoryId + 1}] Max iterations reached`);
      break;
    }
  }

  return { messages, tokenCount, toolCalls, llmCalls };
}

// ─── Confidence Estimation ──────────────────────────────────────────────────
//
// After a single trajectory, ask the model to rate its own confidence.
// This is a cheap single LLM call that drives the adaptive scaling decision.

interface ConfidenceCheck {
  score: number; // 1-5
  tokens: number;
}

async function estimateConfidence(trajectory: TrajectoryResult): Promise<ConfidenceCheck> {
  const lastAssistant = [...trajectory.messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content);

  if (!lastAssistant) return { score: 1, tokens: 0 };

  const response = await ollama.chat({
    model: MODEL,
    messages: [
      {
        role: "user",
        content: `Rate the completeness and quality of this recipe assistant response on a scale of 1-5.

RESPONSE TO EVALUATE:
${lastAssistant.content}

CRITERIA:
- 5: Thorough, specific recipes with names, ingredients, and calorie counts. Addresses all parts of the question.
- 4: Good answer with specific recipes but missing some details (e.g. no calorie counts, or didn't address a dietary constraint).
- 3: Partial answer — mentions some recipes but lacks specificity or misses part of the question.
- 2: Vague or generic answer without specific recipe recommendations.
- 1: Off-topic, wrong, or essentially empty response.

Reply with ONLY a single number (1-5), nothing else.`,
      },
    ],
  });

  const tokens = (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0);
  const scoreText = (response.message.content ?? "3").trim();
  const parsed = Number.parseInt(scoreText.charAt(0));
  const score = Number.isNaN(parsed) ? 3 : Math.max(1, Math.min(5, parsed));

  return { score, tokens };
}

// ─── Trajectory Selection (LLM Judge) ───────────────────────────────────────
//
// Given multiple trajectories, ask the model to pick the best one.
// This is the verification step that makes parallel scaling useful.

interface JudgeResult {
  selectedIndex: number;
  tokens: number;
}

async function judgeTrajectories(
  query: string,
  trajectories: TrajectoryResult[],
): Promise<JudgeResult> {
  const candidates = trajectories.map((t, i) => {
    const lastAssistant = [...t.messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.content);
    return `--- CANDIDATE ${i + 1} ---\n${lastAssistant?.content ?? "(no response)"}`;
  });

  const response = await ollama.chat({
    model: MODEL,
    messages: [
      {
        role: "user",
        content: `You are judging recipe assistant responses. Pick the best one.

USER QUESTION: ${query}

${candidates.join("\n\n")}

CRITERIA (in order of importance):
1. Mentions specific recipe names (not generic suggestions)
2. Includes calorie/nutrition information
3. Addresses all dietary constraints mentioned in the question
4. Provides actionable details (ingredients, prep time)
5. Covers all parts of the question (e.g., if asking for a 3-course meal, includes all 3 courses)

Reply with ONLY the candidate number (1, 2, or 3), nothing else.`,
      },
    ],
  });

  const tokens = (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0);
  const text = (response.message.content ?? "1").trim();
  const parsed = Number.parseInt(text.charAt(0));
  const selectedIndex =
    Number.isNaN(parsed) || parsed < 1 || parsed > trajectories.length ? 0 : parsed - 1;

  return { selectedIndex, tokens };
}

// ─── Strategy: Single Pass ──────────────────────────────────────────────────
//
// Run the agent once, return the result. Cheapest strategy.
// Good enough for simple, well-defined queries.

export async function runSinglePass(
  userMessage: string,
  history: Message[],
  verbose = true,
): Promise<AgentResult> {
  if (verbose) console.log("\n  Strategy: SINGLE PASS (1 trajectory)");

  const trajectory = await runTrajectory(userMessage, history, 0, verbose);

  return {
    strategy: "single",
    finalMessages: trajectory.messages,
    trajectoryCount: 1,
    totalTokens: trajectory.tokenCount,
    totalLLMCalls: trajectory.llmCalls,
    totalToolCalls: trajectory.toolCalls,
  };
}

// ─── Strategy: Uniform Scaling ──────────────────────────────────────────────
//
// Always run N trajectories with varied temperatures, then use an LLM judge
// to pick the best one. More expensive but more reliable.
// This is the "brute force" approach — spend N tokens for every query.

const UNIFORM_N = 3;

export async function runUniformScaling(
  userMessage: string,
  history: Message[],
  verbose = true,
): Promise<AgentResult> {
  if (verbose) console.log(`\n  Strategy: UNIFORM SCALING (${UNIFORM_N} trajectories)`);

  const trajectories: TrajectoryResult[] = [];

  for (let i = 0; i < UNIFORM_N; i++) {
    if (verbose) console.log(`\n  --- Trajectory ${i + 1}/${UNIFORM_N} ---`);
    const trajectory = await runTrajectory(userMessage, history, i, verbose);
    trajectories.push(trajectory);
    if (verbose) {
      console.log(
        `    [trajectory ${i + 1}] ${trajectory.tokenCount} tokens, ${trajectory.toolCalls} tool calls`,
      );
    }
  }

  // Judge picks the best trajectory
  if (verbose) console.log("\n  Judging trajectories...");
  const judge = await judgeTrajectories(userMessage, trajectories);
  if (verbose) console.log(`  Selected: trajectory ${judge.selectedIndex + 1}`);

  const totalTokens = trajectories.reduce((sum, t) => sum + t.tokenCount, 0) + judge.tokens;
  const totalLLMCalls = trajectories.reduce((sum, t) => sum + t.llmCalls, 0) + 1;
  const totalToolCalls = trajectories.reduce((sum, t) => sum + t.toolCalls, 0);

  return {
    strategy: "uniform",
    finalMessages: trajectories[judge.selectedIndex].messages,
    trajectoryCount: UNIFORM_N,
    totalTokens,
    totalLLMCalls,
    totalToolCalls,
  };
}

// ─── Strategy: Adaptive Scaling ─────────────────────────────────────────────
//
// Run once, estimate confidence. If confidence is high (>= threshold),
// return immediately — no extra compute wasted on easy queries.
// If confidence is low, spawn additional trajectories and judge.
//
// This is the CATTS-inspired approach: spend more compute only when
// the agent is uncertain, achieving accuracy gains at 2-3x fewer
// tokens than uniform scaling.

const ADAPTIVE_N = 3;
const CONFIDENCE_THRESHOLD = 4; // scale up if confidence < 4 (out of 5)

export async function runAdaptiveScaling(
  userMessage: string,
  history: Message[],
  verbose = true,
): Promise<AgentResult> {
  if (verbose) console.log("\n  Strategy: ADAPTIVE SCALING (confidence-aware)");

  // Phase 1: Single trajectory
  if (verbose) console.log("\n  --- Phase 1: Initial trajectory ---");
  const firstTrajectory = await runTrajectory(userMessage, history, 0, verbose);
  if (verbose) {
    console.log(
      `    [trajectory 1] ${firstTrajectory.tokenCount} tokens, ${firstTrajectory.toolCalls} tool calls`,
    );
  }

  // Phase 2: Confidence check (cheap single LLM call)
  if (verbose) console.log("\n  --- Phase 2: Confidence estimation ---");
  const confidence = await estimateConfidence(firstTrajectory);
  if (verbose)
    console.log(`    Confidence score: ${confidence.score}/5 (threshold: ${CONFIDENCE_THRESHOLD})`);

  // High confidence → return immediately (no extra compute)
  if (confidence.score >= CONFIDENCE_THRESHOLD) {
    if (verbose) console.log("    High confidence — skipping additional trajectories");

    return {
      strategy: "adaptive",
      finalMessages: firstTrajectory.messages,
      trajectoryCount: 1,
      totalTokens: firstTrajectory.tokenCount + confidence.tokens,
      totalLLMCalls: firstTrajectory.llmCalls + 1, // +1 for confidence check
      totalToolCalls: firstTrajectory.toolCalls,
      confidenceScore: confidence.score,
      scaledUp: false,
    };
  }

  // Low confidence → spawn additional trajectories
  if (verbose) {
    console.log(`    Low confidence — scaling up to ${ADAPTIVE_N} total trajectories`);
  }

  const trajectories: TrajectoryResult[] = [firstTrajectory];

  for (let i = 1; i < ADAPTIVE_N; i++) {
    if (verbose) console.log(`\n  --- Additional trajectory ${i + 1}/${ADAPTIVE_N} ---`);
    const trajectory = await runTrajectory(userMessage, history, i, verbose);
    trajectories.push(trajectory);
    if (verbose) {
      console.log(
        `    [trajectory ${i + 1}] ${trajectory.tokenCount} tokens, ${trajectory.toolCalls} tool calls`,
      );
    }
  }

  // Judge picks the best
  if (verbose) console.log("\n  Judging trajectories...");
  const judge = await judgeTrajectories(userMessage, trajectories);
  if (verbose) console.log(`  Selected: trajectory ${judge.selectedIndex + 1}`);

  const totalTokens =
    trajectories.reduce((sum, t) => sum + t.tokenCount, 0) + confidence.tokens + judge.tokens;
  const totalLLMCalls = trajectories.reduce((sum, t) => sum + t.llmCalls, 0) + 2; // +confidence +judge
  const totalToolCalls = trajectories.reduce((sum, t) => sum + t.toolCalls, 0);

  return {
    strategy: "adaptive",
    finalMessages: trajectories[judge.selectedIndex].messages,
    trajectoryCount: ADAPTIVE_N,
    totalTokens,
    totalLLMCalls,
    totalToolCalls,
    confidenceScore: confidence.score,
    scaledUp: true,
  };
}

// ─── Strategy Dispatcher ────────────────────────────────────────────────────

export async function runAgent(
  userMessage: string,
  history: Message[],
  strategy: Strategy,
): Promise<AgentResult> {
  switch (strategy) {
    case "single":
      return runSinglePass(userMessage, history);
    case "uniform":
      return runUniformScaling(userMessage, history);
    case "adaptive":
      return runAdaptiveScaling(userMessage, history);
  }
}
