// ─── Migration Pipeline ─────────────────────────────────────────────────────
//
// Orchestrates the recipe migration: loads old recipes, checks for an existing
// checkpoint, then processes each recipe through a 4-node graph:
//
//   fetch → transform (LLM) → validate → save
//
// After each recipe, the agent saves a checkpoint. On resume, already-processed
// recipes are skipped entirely (idempotency at the recipe level).

import { randomUUID } from "node:crypto";
import { CheckpointableGraph, END } from "./graph.js";
import { CheckpointStore } from "./checkpoint-store.js";
import { OLD_RECIPES } from "./recipes.js";
import {
  fetchOldRecipe,
  transformRecipe,
  validateRecipe,
  saveNewRecipe,
  clearSavedRecipes,
} from "./tools.js";
import { ProgressReporter } from "./progress.js";
import type { ChannelConfig } from "./graph.js";
import type { OldRecipe, NewRecipe, MigrationResult } from "./recipes.js";
import type { ValidationResult, SaveResult } from "./tools.js";
import type { MigrationReport } from "./progress.js";

// ─── Config ─────────────────────────────────────────────────────────────────

export interface MigrationConfig {
  checkpointDir?: string;
  recipeTimeoutMs?: number;
  runId?: string;
}

export interface MigrationOptions {
  signal?: AbortSignal;
}

// ─── Per-Recipe Graph State ─────────────────────────────────────────────────

const recipeStateSchema = {
  recipeId: {
    default: () => "",
  } as ChannelConfig<string>,

  oldRecipe: {
    default: () => null as OldRecipe | null,
  } as ChannelConfig<OldRecipe | null>,

  newRecipe: {
    default: () => null as NewRecipe | null,
  } as ChannelConfig<NewRecipe | null>,

  validation: {
    default: () => null as ValidationResult | null,
  } as ChannelConfig<ValidationResult | null>,

  saveResult: {
    default: () => null as SaveResult | null,
  } as ChannelConfig<SaveResult | null>,

  error: {
    default: () => null as string | null,
  } as ChannelConfig<string | null>,
};

// ─── Graph Nodes ────────────────────────────────────────────────────────────

type RecipeState = {
  recipeId: string;
  oldRecipe: OldRecipe | null;
  newRecipe: NewRecipe | null;
  validation: ValidationResult | null;
  saveResult: SaveResult | null;
  error: string | null;
};

async function fetchNode(state: RecipeState): Promise<Partial<RecipeState>> {
  const old = fetchOldRecipe(state.recipeId);
  if (!old) {
    return { error: `Recipe ${state.recipeId} not found` };
  }
  return { oldRecipe: old };
}

async function transformNode(state: RecipeState): Promise<Partial<RecipeState>> {
  if (!state.oldRecipe) {
    return { error: "No old recipe to transform" };
  }
  const newRecipe = await transformRecipe(state.oldRecipe);
  return { newRecipe };
}

async function validateNode(state: RecipeState): Promise<Partial<RecipeState>> {
  if (!state.newRecipe) {
    return { error: "No new recipe to validate" };
  }
  const validation = validateRecipe(state.newRecipe);
  return { validation };
}

async function saveNode(state: RecipeState): Promise<Partial<RecipeState>> {
  if (!state.newRecipe) {
    return { error: "No recipe to save" };
  }
  if (state.validation && !state.validation.valid) {
    return { error: `Validation failed: ${state.validation.errors.join(", ")}` };
  }
  const result = saveNewRecipe(state.newRecipe);
  return { saveResult: result };
}

// ─── Graph Routing ──────────────────────────────────────────────────────────

function routeAfterFetch(state: RecipeState): string {
  return state.error ? END : "transform";
}

function routeAfterTransform(state: RecipeState): string {
  return state.error ? END : "validate";
}

function routeAfterValidate(state: RecipeState): string {
  return state.error ? END : "save";
}

// ─── Build Per-Recipe Graph ─────────────────────────────────────────────────
//
//   fetch → transform → validate → save → END
//   (any node error short-circuits to END)

function buildRecipeGraph() {
  return new CheckpointableGraph(recipeStateSchema)
    .addNode("fetch", fetchNode)
    .addNode("transform", transformNode)
    .addNode("validate", validateNode)
    .addNode("save", saveNode)
    .setEntryPoint("fetch")
    .addConditionalEdge("fetch", routeAfterFetch, ["transform"])
    .addConditionalEdge("transform", routeAfterTransform, ["validate"])
    .addConditionalEdge("validate", routeAfterValidate, ["save"])
    .addEdge("save", END)
    .compile();
}

// ─── Main Migration Function ────────────────────────────────────────────────

export async function runMigration(
  config: MigrationConfig = {},
  options: MigrationOptions = {},
): Promise<MigrationReport> {
  const { checkpointDir = ".checkpoints", recipeTimeoutMs = 60_000, runId: providedRunId } = config;
  const { signal } = options;

  const store = new CheckpointStore(checkpointDir);
  const recipes = OLD_RECIPES;
  const progress = new ProgressReporter(recipes.length);
  const graph = buildRecipeGraph();

  // Check for existing checkpoint to resume from
  let checkpoint = providedRunId ? store.load(providedRunId) : null;
  const resuming = checkpoint !== null && checkpoint.status === "in_progress";

  const runId = checkpoint?.runId ?? providedRunId ?? randomUUID();

  if (!checkpoint) {
    checkpoint = {
      runId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalItems: recipes.length,
      completedItems: 0,
      completedIds: [],
      results: [],
      status: "in_progress",
    };
    store.save(checkpoint);
  }

  const startTime = Date.now();
  progress.start(runId, resuming ? checkpoint.completedItems : undefined);

  // Clear in-memory store (saved recipes) — the checkpoint tracks what's done,
  // but the in-memory map resets between process restarts
  clearSavedRecipes();

  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i];

    // Check cancellation
    if (signal?.aborted) {
      checkpoint.status = "cancelled";
      store.save(checkpoint);
      progress.onCancel(checkpoint.completedItems);
      break;
    }

    // Skip already-completed recipes (idempotency)
    if (checkpoint.completedIds.includes(recipe.id)) {
      continue;
    }

    progress.onItemStart(i, recipe.name);

    const itemStart = Date.now();
    let result: MigrationResult;

    try {
      // Run the per-recipe graph with a timeout
      const timeoutSignal = AbortSignal.timeout(recipeTimeoutMs);

      const graphResult = await graph.run({ recipeId: recipe.id } as Partial<RecipeState>, {
        signal: timeoutSignal,
        hooks: {
          onNodeStart: (nodeName) => {
            progress.onStepUpdate(recipe.name, nodeName);
          },
        },
      });

      const state = graphResult.state;
      const elapsed = Date.now() - itemStart;

      if (graphResult.aborted) {
        result = {
          recipeId: recipe.id,
          recipeName: recipe.name,
          status: "failed",
          error: "Timed out",
          durationMs: elapsed,
        };
      } else if (state.error) {
        result = {
          recipeId: recipe.id,
          recipeName: recipe.name,
          status: "failed",
          error: state.error,
          durationMs: elapsed,
        };
      } else {
        result = {
          recipeId: recipe.id,
          recipeName: recipe.name,
          status: "success",
          durationMs: elapsed,
        };
      }
    } catch (err) {
      result = {
        recipeId: recipe.id,
        recipeName: recipe.name,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - itemStart,
      };
    }

    // Update checkpoint after each recipe
    checkpoint.completedItems++;
    checkpoint.completedIds.push(recipe.id);
    checkpoint.results.push(result);
    store.save(checkpoint);

    progress.onItemComplete(i, recipe.name, result);
  }

  // Finalize
  const totalDurationMs = Date.now() - startTime;

  if (checkpoint.status !== "cancelled") {
    checkpoint.status = "completed";
    store.save(checkpoint);
  }

  const report: MigrationReport = {
    runId,
    totalRecipes: recipes.length,
    succeeded: checkpoint.results.filter((r) => r.status === "success").length,
    failed: checkpoint.results.filter((r) => r.status === "failed").length,
    skipped: checkpoint.results.filter((r) => r.status === "skipped").length,
    totalDurationMs,
    results: checkpoint.results,
    resumedFromCheckpoint: resuming,
  };

  progress.complete(report);
  return report;
}

// Re-export for use by index.ts
export { CheckpointStore } from "./checkpoint-store.js";
