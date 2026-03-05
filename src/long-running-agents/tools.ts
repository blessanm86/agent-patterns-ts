// ─── Migration Tools ────────────────────────────────────────────────────────
//
// 4 tools for the recipe migration pipeline:
//   1. fetchOldRecipe  — lookup from the hardcoded OLD_RECIPES array
//   2. transformRecipe — LLM call to extract structured data from free text
//   3. validateRecipe  — check required fields, types, ranges
//   4. saveNewRecipe   — idempotent write to the in-memory results store
//
// Only transformRecipe uses the LLM. The others are deterministic.

import ollama from "ollama";
import { MODEL } from "../shared/config.js";
import {
  OLD_RECIPES,
  type OldRecipe,
  type NewRecipe,
  type Ingredient,
  type RecipeCategory,
} from "./recipes.js";

// ─── In-Memory Results Store ────────────────────────────────────────────────

const savedRecipes = new Map<string, NewRecipe>();

export function getSavedRecipes(): Map<string, NewRecipe> {
  return savedRecipes;
}

export function clearSavedRecipes(): void {
  savedRecipes.clear();
}

// ─── 1. Fetch ───────────────────────────────────────────────────────────────

export function fetchOldRecipe(id: string): OldRecipe | null {
  return OLD_RECIPES.find((r) => r.id === id) ?? null;
}

// ─── 2. Transform (LLM) ────────────────────────────────────────────────────

const TRANSFORM_SYSTEM_PROMPT = `You are a recipe data migration assistant. Given a messy old-format recipe, extract structured data.

Return a JSON object with these exact fields:
{
  "name": "string — the recipe name",
  "category": "appetizer" | "main" | "side" | "dessert" | "beverage",
  "servings": number,
  "prepTimeMinutes": number,
  "cookTimeMinutes": number,
  "totalTimeMinutes": number,
  "ingredients": [{ "name": "string", "amount": number, "unit": "g" | "ml" | "tsp" | "tbsp" | "cup" | "piece" }],
  "steps": ["step 1", "step 2", ...]
}

Rules:
- Normalize the category to one of: appetizer, main, side, dessert, beverage
- Parse servings from strings like "serves 4", "6-8", "4 people" → use the lower number
- Split total time into prep and cook when possible; if unclear, set prepTimeMinutes to 0
- For chilling/marinating time, include it in totalTimeMinutes but not in cookTimeMinutes
- Extract ALL ingredients with normalized units
- Break the description into clear numbered steps
- Return ONLY the JSON object, no markdown fences or extra text`;

export async function transformRecipe(old: OldRecipe): Promise<NewRecipe> {
  const userPrompt = `Recipe: ${old.name}
Category: ${old.category}
Servings: ${old.servings}
Time: ${old.time}
Description: ${old.description}`;

  const response = await ollama.chat({
    model: MODEL,
    messages: [
      { role: "system", content: TRANSFORM_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    format: "json",
  });

  const parsed = JSON.parse(response.message.content);

  return {
    id: old.id,
    name: parsed.name ?? old.name,
    category: normalizeCategory(parsed.category),
    servings:
      typeof parsed.servings === "number"
        ? parsed.servings
        : parseInt(String(parsed.servings), 10) || 4,
    prepTimeMinutes: parsed.prepTimeMinutes ?? 0,
    cookTimeMinutes: parsed.cookTimeMinutes ?? 0,
    totalTimeMinutes:
      parsed.totalTimeMinutes ?? (parsed.prepTimeMinutes ?? 0) + (parsed.cookTimeMinutes ?? 0),
    ingredients: normalizeIngredients(parsed.ingredients ?? []),
    steps: Array.isArray(parsed.steps) ? parsed.steps.map(String) : [],
  };
}

function normalizeCategory(raw: string): RecipeCategory {
  const lower = (raw ?? "").toLowerCase().trim();
  const mapping: Record<string, RecipeCategory> = {
    appetizer: "appetizer",
    starter: "appetizer",
    main: "main",
    "main course": "main",
    entree: "main",
    side: "side",
    "side dish": "side",
    dessert: "dessert",
    sweet: "dessert",
    beverage: "beverage",
    drink: "beverage",
  };
  return mapping[lower] ?? "main";
}

function normalizeIngredients(raw: unknown[]): Ingredient[] {
  return raw.map((item) => {
    const i = item as Record<string, unknown>;
    return {
      name: String(i.name ?? "unknown"),
      amount: typeof i.amount === "number" ? i.amount : parseFloat(String(i.amount)) || 1,
      unit: normalizeUnit(String(i.unit ?? "piece")),
    };
  });
}

function normalizeUnit(raw: string): string {
  const lower = raw.toLowerCase().trim();
  const mapping: Record<string, string> = {
    g: "g",
    gram: "g",
    grams: "g",
    ml: "ml",
    milliliter: "ml",
    milliliters: "ml",
    tsp: "tsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
    tbsp: "tbsp",
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    cup: "cup",
    cups: "cup",
    piece: "piece",
    pieces: "piece",
    clove: "piece",
    cloves: "piece",
    slice: "piece",
    slices: "piece",
    head: "piece",
    heads: "piece",
    bunch: "piece",
    pinch: "tsp",
  };
  return mapping[lower] ?? lower;
}

// ─── 3. Validate ────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_CATEGORIES: RecipeCategory[] = ["appetizer", "main", "side", "dessert", "beverage"];

export function validateRecipe(recipe: NewRecipe): ValidationResult {
  const errors: string[] = [];

  if (!recipe.id) errors.push("Missing id");
  if (!recipe.name || recipe.name.trim() === "") errors.push("Missing name");
  if (!VALID_CATEGORIES.includes(recipe.category)) {
    errors.push(`Invalid category: "${recipe.category}"`);
  }
  if (typeof recipe.servings !== "number" || recipe.servings < 1 || recipe.servings > 100) {
    errors.push(`Invalid servings: ${recipe.servings}`);
  }
  if (typeof recipe.totalTimeMinutes !== "number" || recipe.totalTimeMinutes < 1) {
    errors.push(`Invalid totalTimeMinutes: ${recipe.totalTimeMinutes}`);
  }
  if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
    errors.push("No ingredients");
  }
  if (!Array.isArray(recipe.steps) || recipe.steps.length === 0) {
    errors.push("No steps");
  }

  // Validate individual ingredients
  for (const ing of recipe.ingredients ?? []) {
    if (!ing.name || ing.name === "unknown") {
      errors.push(`Ingredient missing name`);
    }
    if (typeof ing.amount !== "number" || ing.amount <= 0) {
      errors.push(`Invalid amount for ${ing.name}: ${ing.amount}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── 4. Save (idempotent) ───────────────────────────────────────────────────

export interface SaveResult {
  saved: boolean;
  reason: string;
}

export function saveNewRecipe(recipe: NewRecipe): SaveResult {
  if (savedRecipes.has(recipe.id)) {
    return { saved: false, reason: "Already saved (idempotent skip)" };
  }

  savedRecipes.set(recipe.id, recipe);
  return { saved: true, reason: "Saved successfully" };
}
