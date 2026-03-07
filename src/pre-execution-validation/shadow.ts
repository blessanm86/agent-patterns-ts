// ─── Shadow Workspace Provider ──────────────────────────────────────────────
//
// The core abstraction: an isolated copy of the workspace where edits are
// applied and validated before promoting to the real workspace.
//
// Lifecycle: create → applyEdit → validate → promote | discard
//
// Uses an in-memory filesystem for portability (no temp dirs, easy to test).
// In production, this would clone files to a temp directory or hidden editor
// window (like Cursor's Shadow Workspace).

import { z } from "zod";

// ─── Recipe Schema ────────────────────────────────────────────────────────────
//
// Zod schema as the single source of truth for recipe validation.
// Deliberately constrained to surface common LLM generation errors:
//   - category enum: LLMs invent categories like "brunch" or "side"
//   - servings must be positive integer: LLMs sometimes use 0 or fractions
//   - prepTime 1-480: prevents unreasonable values
//   - ingredient quantities must be positive: catches negatives and zeros

const VALID_CATEGORIES = ["breakfast", "lunch", "dinner", "dessert", "snack"] as const;
const VALID_UNITS = ["g", "kg", "ml", "l", "cup", "tbsp", "tsp", "whole", "pinch"] as const;
const VALID_DIFFICULTY = ["easy", "medium", "hard"] as const;

const IngredientSchema = z.object({
  name: z.string().min(1, "Ingredient name is required"),
  quantity: z.number().positive("Quantity must be positive"),
  unit: z.enum(VALID_UNITS),
});

const NutritionSchema = z.object({
  caloriesPerServing: z.number().min(0).max(5000),
  proteinGrams: z.number().min(0).max(500),
  carbsGrams: z.number().min(0).max(500),
  fatGrams: z.number().min(0).max(500),
});

export const RecipeSchema = z.object({
  name: z.string().min(1, "Recipe name is required"),
  category: z.enum(VALID_CATEGORIES),
  difficulty: z.enum(VALID_DIFFICULTY),
  servings: z.number().int().min(1).max(100),
  prepTimeMinutes: z.number().int().min(1).max(480),
  ingredients: z.array(IngredientSchema).min(1).max(30),
  instructions: z.array(z.string().min(1)).min(1).max(20),
  nutrition: NutritionSchema,
});

export type Recipe = z.infer<typeof RecipeSchema>;

// ─── Validation Result ────────────────────────────────────────────────────────

export interface Diagnostic {
  layer: "syntax" | "schema" | "semantic";
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
}

// ─── In-Memory Workspace ──────────────────────────────────────────────────────

export interface Workspace {
  files: Map<string, string>; // filename → JSON content
}

export function createWorkspace(initialFiles?: Record<string, string>): Workspace {
  const files = new Map<string, string>();
  if (initialFiles) {
    for (const [name, content] of Object.entries(initialFiles)) {
      files.set(name, content);
    }
  }
  return { files };
}

// ─── Shadow Workspace ─────────────────────────────────────────────────────────

export interface ShadowWorkspace {
  id: string;
  files: Map<string, string>; // shadow copy of workspace files
}

let shadowCounter = 0;

/** Clone the real workspace into an isolated shadow copy. */
export function createShadow(real: Workspace): ShadowWorkspace {
  shadowCounter++;
  return {
    id: `shadow-${shadowCounter}`,
    files: new Map(real.files),
  };
}

/** Apply an edit to the shadow workspace (not the real one). */
export function applyEditToShadow(
  shadow: ShadowWorkspace,
  filename: string,
  content: string,
): void {
  shadow.files.set(filename, content);
}

/** Promote all shadow changes to the real workspace. */
export function promote(shadow: ShadowWorkspace, real: Workspace): void {
  for (const [filename, content] of shadow.files) {
    real.files.set(filename, content);
  }
}

// ─── 3-Layer Validation ───────────────────────────────────────────────────────

/** Validate a single file in the shadow workspace. */
export function validateFile(filename: string, content: string): ValidationResult {
  const diagnostics: Diagnostic[] = [];

  // Layer 1: JSON syntax validation
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    const error = e as SyntaxError;
    diagnostics.push({
      layer: "syntax",
      path: filename,
      message: `JSON parse error: ${error.message}`,
    });
    return { valid: false, diagnostics };
  }

  // Layer 2: Schema validation via Zod
  const result = RecipeSchema.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      diagnostics.push({
        layer: "schema",
        path: `${filename}:${issue.path.join(".") || "root"}`,
        message: issue.message,
      });
    }
    return { valid: false, diagnostics };
  }

  // Layer 3: Semantic validation (cross-field consistency)
  const recipe = result.data;

  // Calorie sanity check: total macros should roughly match calories
  // protein=4cal/g, carbs=4cal/g, fat=9cal/g
  const estimatedCalories =
    recipe.nutrition.proteinGrams * 4 +
    recipe.nutrition.carbsGrams * 4 +
    recipe.nutrition.fatGrams * 9;
  const declaredCalories = recipe.nutrition.caloriesPerServing;
  const calorieDrift =
    Math.abs(estimatedCalories - declaredCalories) / Math.max(declaredCalories, 1);
  if (calorieDrift > 0.4) {
    diagnostics.push({
      layer: "semantic",
      path: `${filename}:nutrition`,
      message: `Calorie mismatch: declared ${declaredCalories} cal but macros suggest ~${Math.round(estimatedCalories)} cal (${Math.round(calorieDrift * 100)}% drift). Adjust calories or macros.`,
    });
  }

  // Prep time vs ingredient count: >15 ingredients with <10 min prep is suspicious
  if (recipe.ingredients.length > 15 && recipe.prepTimeMinutes < 10) {
    diagnostics.push({
      layer: "semantic",
      path: `${filename}:prepTimeMinutes`,
      message: `${recipe.ingredients.length} ingredients with only ${recipe.prepTimeMinutes} min prep time seems too fast. Consider increasing prep time.`,
    });
  }

  // Duplicate ingredient names
  const ingredientNames = recipe.ingredients.map((i) => i.name.toLowerCase());
  const seen = new Set<string>();
  for (const name of ingredientNames) {
    if (seen.has(name)) {
      diagnostics.push({
        layer: "semantic",
        path: `${filename}:ingredients`,
        message: `Duplicate ingredient "${name}". Combine quantities into a single entry.`,
      });
      break;
    }
    seen.add(name);
  }

  // Instructions should mention at least one ingredient
  const allInstructions = recipe.instructions.join(" ").toLowerCase();
  const mentionedAny = recipe.ingredients.some((i) =>
    allInstructions.includes(i.name.toLowerCase().split(" ")[0]),
  );
  if (!mentionedAny) {
    diagnostics.push({
      layer: "semantic",
      path: `${filename}:instructions`,
      message: `Instructions don't mention any ingredients by name. Consider referencing ingredients in the steps.`,
    });
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  };
}

/** Validate all files in a shadow workspace. */
export function validateShadow(shadow: ShadowWorkspace): ValidationResult {
  const allDiagnostics: Diagnostic[] = [];

  for (const [filename, content] of shadow.files) {
    const result = validateFile(filename, content);
    allDiagnostics.push(...result.diagnostics);
  }

  return {
    valid: allDiagnostics.length === 0,
    diagnostics: allDiagnostics,
  };
}

// ─── Shadow-Validated Edit (the full lifecycle) ──────────────────────────────

export interface ShadowEditResult {
  success: boolean;
  promoted: boolean;
  diagnostics: Diagnostic[];
  shadowId: string;
}

/**
 * The complete shadow workspace lifecycle for a single edit:
 *   1. Clone workspace to shadow
 *   2. Apply edit to shadow
 *   3. Validate the shadow
 *   4. If valid → promote to real workspace
 *   5. If invalid → discard shadow, return diagnostics
 */
export function shadowEdit(
  workspace: Workspace,
  filename: string,
  content: string,
): ShadowEditResult {
  // 1. Clone
  const shadow = createShadow(workspace);

  // 2. Apply
  applyEditToShadow(shadow, filename, content);

  // 3. Validate (only the edited file, not entire workspace)
  const result = validateFile(filename, content);

  // 4/5. Promote or discard
  if (result.valid) {
    promote(shadow, workspace);
    return {
      success: true,
      promoted: true,
      diagnostics: [],
      shadowId: shadow.id,
    };
  }

  // Discard — shadow is garbage collected (no explicit cleanup needed for in-memory)
  return {
    success: false,
    promoted: false,
    diagnostics: result.diagnostics,
    shadowId: shadow.id,
  };
}
