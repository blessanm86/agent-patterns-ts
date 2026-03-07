// ─── CodeAct Tools: Python Preamble + JSON Equivalents ─────────────────────────
//
// CodeAct exposes tools as Python functions injected into every code execution.
// The LLM calls them like any Python function — no JSON schema, no dispatcher.
//
// For comparison mode we also provide JSON tool definitions and a TypeScript
// dispatcher that implements the same logic, so both agents have identical
// capabilities and we can measure the difference in LLM calls and tokens.

import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { ToolDefinition } from "../shared/types.js";

const execFileAsync = promisify(execFile);

// ─── Python Preamble (injected before agent-generated code) ───────────────────
//
// This is the entire "tool system" for a CodeAct agent. Instead of JSON schemas
// and a dispatcher, we define Python functions. The agent imports nothing —
// these are already in scope when its code block runs.

export const TOOLS_PREAMBLE = `# --- Meal Planning Tools (available directly, no import needed) ---

_RECIPE_DB = {
    "pasta carbonara":        {"calories": 520, "protein": 24, "carbs": 58, "fat": 22, "tags": ["italian", "pasta", "quick", "high calorie"]},
    "greek salad":            {"calories": 230, "protein": 8,  "carbs": 10, "fat": 18, "tags": ["mediterranean", "salad", "vegetarian", "low carb"]},
    "chicken tikka masala":   {"calories": 485, "protein": 38, "carbs": 18, "fat": 28, "tags": ["indian", "chicken", "high protein"]},
    "vegetable stir fry":     {"calories": 195, "protein": 8,  "carbs": 22, "fat": 9,  "tags": ["asian", "vegetarian", "quick", "low calorie"]},
    "banana bread":           {"calories": 265, "protein": 4,  "carbs": 42, "fat": 10, "tags": ["baking", "snack", "sweet"]},
    "caesar salad":           {"calories": 320, "protein": 12, "carbs": 14, "fat": 24, "tags": ["salad", "american"]},
    "pad thai":               {"calories": 410, "protein": 22, "carbs": 48, "fat": 14, "tags": ["thai", "noodles"]},
    "chocolate chip cookies": {"calories": 180, "protein": 2,  "carbs": 24, "fat": 9,  "tags": ["baking", "dessert", "sweet"]},
}


def search_recipes(query):
    """Search for recipes matching a keyword. Returns list of recipe names.

    Args:
        query: keyword to search (e.g. "low carb", "italian", "vegetarian", "quick")
    """
    q = query.lower()
    return [name for name, data in _RECIPE_DB.items()
            if q in name or any(q in tag for tag in data["tags"])]


def get_nutritional_info(recipe_name):
    """Get nutritional information per serving for a recipe.

    Args:
        recipe_name: recipe name (case-insensitive, e.g. "greek salad")

    Returns:
        dict with keys: recipe, calories, protein_g, carbs_g, fat_g
    """
    key = recipe_name.lower().strip()
    if key not in _RECIPE_DB:
        return {"error": f"'{recipe_name}' not found. Available: {list(_RECIPE_DB.keys())}"}
    d = _RECIPE_DB[key]
    return {
        "recipe": key,
        "calories": d["calories"],
        "protein_g": d["protein"],
        "carbs_g": d["carbs"],
        "fat_g": d["fat"],
    }


def calculate_meal_plan(recipes, target_calories):
    """Build a daily meal plan targeting a calorie goal.

    Args:
        recipes: list of recipe names to include in the plan
        target_calories: daily calorie target (integer)

    Returns:
        dict with meals list, total_calories, target_calories, difference
    """
    valid = [r.lower() for r in recipes if r.lower() in _RECIPE_DB]
    if not valid:
        return {"error": "No valid recipes found. Check spelling against search_recipes()."}
    per_meal = target_calories / len(valid)
    meals = []
    total = 0
    for r in valid:
        cal = _RECIPE_DB[r]["calories"]
        servings = max(1, round(per_meal / cal))
        meal_cal = cal * servings
        meals.append({"recipe": r, "servings": servings, "calories": meal_cal})
        total += meal_cal
    return {
        "meals": meals,
        "total_calories": total,
        "target_calories": target_calories,
        "difference": total - target_calories,
    }

`;

// Short description for the CodeAct system prompt
export const TOOL_DOCS = `- search_recipes(query)                        find recipes by keyword ("low carb", "italian", "quick")
- get_nutritional_info(recipe_name)            calories, protein_g, carbs_g, fat_g per serving
- calculate_meal_plan(recipes, target_calories) build a daily plan from a list of recipes`;

// ─── Python Execution ─────────────────────────────────────────────────────────
//
// Writes preamble + agent code to a temp file, runs python3, captures output.
// No Docker — this is a local demo. Production would use E2B or Docker.

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export async function executePython(userCode: string): Promise<ExecutionResult> {
  const fullCode = `${TOOLS_PREAMBLE}\n# --- Agent Code ---\n${userCode}`;
  const tmpFile = join(tmpdir(), `codeact_${Date.now()}_${process.pid}.py`);

  try {
    await writeFile(tmpFile, fullCode, "utf8");
    const { stdout, stderr } = await execFileAsync("python3", [tmpFile], {
      timeout: 10_000,
      encoding: "utf8",
    });
    return { stdout, stderr, exitCode: 0, timedOut: false };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.code ?? 1,
      timedOut: e.killed ?? false,
    };
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

// ─── JSON Tool Definitions (for comparison mode) ──────────────────────────────
//
// The same three capabilities expressed as JSON schemas for a traditional
// tool-calling agent. The model calls these one at a time via tool_calls.

export const jsonTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_recipes",
      description:
        "Search for recipes matching a keyword. Returns a list of matching recipe names.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keyword to search (e.g. 'low carb', 'vegetarian', 'italian', 'quick')",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_nutritional_info",
      description: "Get nutritional information per serving for a named recipe.",
      parameters: {
        type: "object",
        properties: {
          recipe_name: {
            type: "string",
            description: "Exact recipe name (e.g. 'greek salad', 'pasta carbonara')",
          },
        },
        required: ["recipe_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_meal_plan",
      description: "Build a daily meal plan targeting a calorie goal from a list of recipes.",
      parameters: {
        type: "object",
        properties: {
          recipes: {
            type: "string",
            description:
              "Comma-separated list of recipe names (e.g. 'greek salad, vegetable stir fry')",
          },
          target_calories: {
            type: "string",
            description: "Daily calorie target as a number (e.g. '1500')",
          },
        },
        required: ["recipes", "target_calories"],
      },
    },
  },
];

// ─── JSON Tool Implementations (TypeScript mirror of the Python preamble) ─────

const RECIPE_DB: Record<
  string,
  { calories: number; protein: number; carbs: number; fat: number; tags: string[] }
> = {
  "pasta carbonara": {
    calories: 520,
    protein: 24,
    carbs: 58,
    fat: 22,
    tags: ["italian", "pasta", "quick", "high calorie"],
  },
  "greek salad": {
    calories: 230,
    protein: 8,
    carbs: 10,
    fat: 18,
    tags: ["mediterranean", "salad", "vegetarian", "low carb"],
  },
  "chicken tikka masala": {
    calories: 485,
    protein: 38,
    carbs: 18,
    fat: 28,
    tags: ["indian", "chicken", "high protein"],
  },
  "vegetable stir fry": {
    calories: 195,
    protein: 8,
    carbs: 22,
    fat: 9,
    tags: ["asian", "vegetarian", "quick", "low calorie"],
  },
  "banana bread": {
    calories: 265,
    protein: 4,
    carbs: 42,
    fat: 10,
    tags: ["baking", "snack", "sweet"],
  },
  "caesar salad": {
    calories: 320,
    protein: 12,
    carbs: 14,
    fat: 24,
    tags: ["salad", "american"],
  },
  "pad thai": { calories: 410, protein: 22, carbs: 48, fat: 14, tags: ["thai", "noodles"] },
  "chocolate chip cookies": {
    calories: 180,
    protein: 2,
    carbs: 24,
    fat: 9,
    tags: ["baking", "dessert", "sweet"],
  },
};

export function executeJsonTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_recipes": {
      const q = (args.query ?? "").toLowerCase();
      const matches = Object.entries(RECIPE_DB)
        .filter(([n, d]) => n.includes(q) || d.tags.some((t) => t.includes(q)))
        .map(([n]) => n);
      return JSON.stringify(matches);
    }

    case "get_nutritional_info": {
      const key = (args.recipe_name ?? "").toLowerCase().trim();
      const d = RECIPE_DB[key];
      if (!d) {
        return JSON.stringify({
          error: `'${args.recipe_name}' not found`,
          available: Object.keys(RECIPE_DB),
        });
      }
      return JSON.stringify({
        recipe: key,
        calories: d.calories,
        protein_g: d.protein,
        carbs_g: d.carbs,
        fat_g: d.fat,
      });
    }

    case "calculate_meal_plan": {
      const recipes = (args.recipes ?? "")
        .split(",")
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean);
      const target = parseInt(args.target_calories ?? "2000", 10);
      const valid = recipes.filter((r) => r in RECIPE_DB);
      if (!valid.length) {
        return JSON.stringify({ error: "No valid recipes found. Check recipe names." });
      }
      const perMeal = target / valid.length;
      const meals = valid.map((r) => {
        const cal = RECIPE_DB[r].calories;
        const servings = Math.max(1, Math.round(perMeal / cal));
        return { recipe: r, servings, calories: cal * servings };
      });
      const total = meals.reduce((sum, m) => sum + m.calories, 0);
      return JSON.stringify({
        meals,
        total_calories: total,
        target_calories: target,
        difference: total - target,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
