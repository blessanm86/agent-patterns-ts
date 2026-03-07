import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions ─────────────────────────────────────────────────────────
//
// 10 recipe management tools with detailed descriptions. Intentionally verbose
// to create a meaningful stable prefix (~1200 tokens of tool definitions).
// The tool ordering and content is identical across all strategies — what
// differs is whether the strategy preserves or disrupts that stability.

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "recipe_search",
      description:
        "Searches the recipe database by keyword, cuisine, or dietary restriction. " +
        "Returns a list of matching recipes with IDs, titles, and brief descriptions. " +
        "Use this as the first step when a user asks about recipes. " +
        "Do NOT use this if you already have a recipe ID — use recipe_get_details instead.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search query: a keyword, ingredient, cuisine type, or dish name. " +
              "Use natural language, e.g. 'quick pasta dishes' or 'gluten-free desserts'.",
          },
          cuisine: {
            type: "string",
            description: "Optional cuisine filter.",
            enum: ["italian", "mexican", "japanese", "indian", "french", "thai", "american"],
          },
          max_results: {
            type: "string",
            description: "Maximum number of results to return (default: 5).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recipe_get_details",
      description:
        "Fetches full details for a specific recipe by its ID, including ingredients, " +
        "step-by-step instructions, prep time, cook time, servings, and nutritional info. " +
        "Always call this BEFORE recipe_add_to_meal_plan or recipe_scale to get accurate data. " +
        "Do NOT call recipe_search if you already have the recipe ID.",
      parameters: {
        type: "object",
        properties: {
          recipe_id: {
            type: "string",
            description: "The recipe ID, e.g. 'RCP-001'. Must start with 'RCP-'.",
          },
        },
        required: ["recipe_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recipe_scale",
      description:
        "Scales a recipe's ingredient quantities to a different number of servings. " +
        "Returns the adjusted ingredient list with new quantities. " +
        "Call recipe_get_details first to verify the recipe exists and get the base servings. " +
        "Scaling factor is calculated automatically from base servings and target servings.",
      parameters: {
        type: "object",
        properties: {
          recipe_id: {
            type: "string",
            description: "The recipe ID, e.g. 'RCP-001'.",
          },
          target_servings: {
            type: "string",
            description:
              "Desired number of servings as a whole number, e.g. '8'. " +
              "Must be between 1 and 50.",
          },
        },
        required: ["recipe_id", "target_servings"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recipe_get_substitutions",
      description:
        "Suggests ingredient substitutions for dietary restrictions or missing ingredients. " +
        "Returns a list of alternatives with notes on how they affect taste and texture. " +
        "Use this when a user mentions allergies, dietary needs, or unavailable ingredients. " +
        "Provide the specific ingredient to substitute, not the recipe ID.",
      parameters: {
        type: "object",
        properties: {
          ingredient: {
            type: "string",
            description:
              "The ingredient to find substitutes for, e.g. 'heavy cream' or 'all-purpose flour'.",
          },
          reason: {
            type: "string",
            description: "Why a substitution is needed.",
            enum: ["allergy", "dietary", "unavailable", "preference"],
          },
        },
        required: ["ingredient"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recipe_add_to_meal_plan",
      description:
        "Adds a recipe to the user's weekly meal plan for a specific day and meal slot. " +
        "The meal plan persists across the conversation. " +
        "Call recipe_get_details first to confirm the recipe exists. " +
        "Each day+meal slot can hold only one recipe — adding to an occupied slot replaces it.",
      parameters: {
        type: "object",
        properties: {
          recipe_id: {
            type: "string",
            description: "The recipe ID to add, e.g. 'RCP-001'.",
          },
          day: {
            type: "string",
            description: "Day of the week.",
            enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
          },
          meal: {
            type: "string",
            description: "Meal slot.",
            enum: ["breakfast", "lunch", "dinner", "snack"],
          },
        },
        required: ["recipe_id", "day", "meal"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recipe_get_meal_plan",
      description:
        "Retrieves the current weekly meal plan showing all assigned recipes by day and meal. " +
        "Returns empty slots as well, so you can suggest additions. " +
        "Use this to show the user their current plan or to check for gaps before suggesting recipes.",
      parameters: {
        type: "object",
        properties: {
          day: {
            type: "string",
            description: "Optional: filter to a specific day. Omit to see the full week.",
            enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recipe_generate_shopping_list",
      description:
        "Generates a consolidated shopping list from all recipes in the meal plan. " +
        "Combines duplicate ingredients and totals quantities across recipes. " +
        "Organizes items by grocery store section (produce, dairy, meat, pantry, etc.). " +
        "Call recipe_get_meal_plan first if you need to verify what recipes are planned.",
      parameters: {
        type: "object",
        properties: {
          exclude_pantry_staples: {
            type: "string",
            description: "Set to 'true' to exclude common pantry items (salt, pepper, oil, etc.).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recipe_get_nutrition",
      description:
        "Calculates detailed nutritional information for a recipe including calories, " +
        "macronutrients (protein, carbs, fat), fiber, sodium, and key vitamins. " +
        "Returns per-serving values. Call recipe_get_details first to confirm the recipe. " +
        "Use this when the user asks about health, diet tracking, or calorie counting.",
      parameters: {
        type: "object",
        properties: {
          recipe_id: {
            type: "string",
            description: "The recipe ID, e.g. 'RCP-001'.",
          },
        },
        required: ["recipe_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recipe_get_cook_tips",
      description:
        "Returns professional cooking tips and common mistakes for a specific recipe or technique. " +
        "Includes timing advice, temperature guidance, and visual cues for doneness. " +
        "Use this to provide extra value when the user is about to cook a recipe. " +
        "Can also be used for general technique questions without a specific recipe ID.",
      parameters: {
        type: "object",
        properties: {
          recipe_id: {
            type: "string",
            description: "Optional recipe ID for recipe-specific tips.",
          },
          technique: {
            type: "string",
            description:
              "Optional cooking technique, e.g. 'searing', 'tempering chocolate', 'making roux'.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recipe_save_favorite",
      description:
        "Saves a recipe to the user's favorites list for quick access later. " +
        "The favorites list persists across the conversation. " +
        "Optionally add a personal note (e.g. 'great for date night', 'kids loved it'). " +
        "Duplicate saves are ignored — a recipe can only appear once in favorites.",
      parameters: {
        type: "object",
        properties: {
          recipe_id: {
            type: "string",
            description: "The recipe ID to save, e.g. 'RCP-001'.",
          },
          note: {
            type: "string",
            description: "Optional personal note to attach to this favorite.",
          },
        },
        required: ["recipe_id"],
      },
    },
  },
];

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface Recipe {
  id: string;
  title: string;
  cuisine: string;
  prepTime: number;
  cookTime: number;
  servings: number;
  ingredients: { item: string; amount: string; unit: string }[];
  steps: string[];
  calories: number;
  tags: string[];
}

const RECIPES: Record<string, Recipe> = {
  "RCP-001": {
    id: "RCP-001",
    title: "Classic Margherita Pizza",
    cuisine: "italian",
    prepTime: 20,
    cookTime: 15,
    servings: 4,
    ingredients: [
      { item: "pizza dough", amount: "500", unit: "g" },
      { item: "San Marzano tomatoes", amount: "400", unit: "g" },
      { item: "fresh mozzarella", amount: "250", unit: "g" },
      { item: "fresh basil", amount: "10", unit: "leaves" },
      { item: "olive oil", amount: "2", unit: "tbsp" },
      { item: "salt", amount: "1", unit: "tsp" },
    ],
    steps: [
      "Preheat oven to 475°F (245°C) with a pizza stone inside.",
      "Crush tomatoes by hand with salt for the sauce.",
      "Stretch dough on a floured surface to 12-inch round.",
      "Spread sauce, add torn mozzarella pieces.",
      "Bake for 12-15 minutes until crust is golden and cheese bubbles.",
      "Top with fresh basil and a drizzle of olive oil.",
    ],
    calories: 285,
    tags: ["vegetarian", "classic", "quick"],
  },
  "RCP-002": {
    id: "RCP-002",
    title: "Thai Green Curry",
    cuisine: "thai",
    prepTime: 15,
    cookTime: 25,
    servings: 4,
    ingredients: [
      { item: "chicken thigh", amount: "500", unit: "g" },
      { item: "coconut milk", amount: "400", unit: "ml" },
      { item: "green curry paste", amount: "3", unit: "tbsp" },
      { item: "bamboo shoots", amount: "200", unit: "g" },
      { item: "Thai basil", amount: "1", unit: "cup" },
      { item: "fish sauce", amount: "2", unit: "tbsp" },
      { item: "palm sugar", amount: "1", unit: "tbsp" },
      { item: "jasmine rice", amount: "300", unit: "g" },
    ],
    steps: [
      "Cook curry paste in coconut cream until fragrant (2-3 min).",
      "Add sliced chicken, cook until sealed.",
      "Pour in remaining coconut milk, bring to simmer.",
      "Add bamboo shoots, fish sauce, and palm sugar.",
      "Simmer 15 minutes until chicken is cooked through.",
      "Stir in Thai basil, serve over jasmine rice.",
    ],
    calories: 420,
    tags: ["spicy", "gluten-free", "weeknight"],
  },
  "RCP-003": {
    id: "RCP-003",
    title: "Mexican Street Tacos",
    cuisine: "mexican",
    prepTime: 25,
    cookTime: 10,
    servings: 4,
    ingredients: [
      { item: "flank steak", amount: "500", unit: "g" },
      { item: "corn tortillas", amount: "12", unit: "small" },
      { item: "white onion", amount: "1", unit: "medium" },
      { item: "cilantro", amount: "1", unit: "bunch" },
      { item: "lime", amount: "3", unit: "whole" },
      { item: "salsa verde", amount: "200", unit: "ml" },
      { item: "avocado", amount: "2", unit: "whole" },
    ],
    steps: [
      "Marinate steak with lime juice, salt, and cumin for 20 min.",
      "Grill steak over high heat, 4 min per side for medium.",
      "Rest steak 5 minutes, then slice against the grain thinly.",
      "Warm tortillas on a dry griddle until pliable.",
      "Assemble: tortilla, steak, diced onion, cilantro, lime squeeze.",
      "Serve with salsa verde and sliced avocado.",
    ],
    calories: 380,
    tags: ["grilling", "quick", "crowd-pleaser"],
  },
  "RCP-004": {
    id: "RCP-004",
    title: "Japanese Miso Ramen",
    cuisine: "japanese",
    prepTime: 30,
    cookTime: 45,
    servings: 4,
    ingredients: [
      { item: "ramen noodles", amount: "400", unit: "g" },
      { item: "white miso paste", amount: "4", unit: "tbsp" },
      { item: "chicken broth", amount: "1.5", unit: "L" },
      { item: "chashu pork belly", amount: "300", unit: "g" },
      { item: "soft-boiled eggs", amount: "4", unit: "whole" },
      { item: "corn kernels", amount: "100", unit: "g" },
      { item: "nori sheets", amount: "4", unit: "sheets" },
      { item: "green onion", amount: "4", unit: "stalks" },
      { item: "sesame oil", amount: "1", unit: "tbsp" },
    ],
    steps: [
      "Braise pork belly: sear, then simmer in soy-mirin broth 2 hours.",
      "Soft-boil eggs (6.5 min), peel, marinate in soy-mirin 1 hour.",
      "Heat chicken broth, whisk in miso paste (don't boil after adding miso).",
      "Cook ramen noodles according to package (usually 2-3 min).",
      "Assemble bowls: noodles, pour broth, top with sliced pork, egg half.",
      "Garnish with corn, nori, sliced green onion, drizzle sesame oil.",
    ],
    calories: 520,
    tags: ["comfort-food", "umami", "weekend-project"],
  },
  "RCP-005": {
    id: "RCP-005",
    title: "French Onion Soup",
    cuisine: "french",
    prepTime: 15,
    cookTime: 60,
    servings: 6,
    ingredients: [
      { item: "yellow onions", amount: "6", unit: "large" },
      { item: "butter", amount: "4", unit: "tbsp" },
      { item: "beef broth", amount: "1.5", unit: "L" },
      { item: "dry white wine", amount: "200", unit: "ml" },
      { item: "Gruyere cheese", amount: "200", unit: "g" },
      { item: "baguette slices", amount: "6", unit: "thick" },
      { item: "thyme", amount: "4", unit: "sprigs" },
    ],
    steps: [
      "Slice onions thinly and evenly (this is the key step).",
      "Melt butter in a heavy pot, add onions with a pinch of salt.",
      "Cook onions on medium-low for 45 min, stirring every 5 min, until deep brown.",
      "Deglaze with white wine, scraping up fond. Reduce by half.",
      "Add beef broth and thyme, simmer 20 minutes.",
      "Ladle into oven-safe bowls, top with baguette and Gruyere.",
      "Broil until cheese is golden and bubbling (3-4 min).",
    ],
    calories: 310,
    tags: ["comfort-food", "winter", "classic"],
  },
  "RCP-006": {
    id: "RCP-006",
    title: "Indian Butter Chicken",
    cuisine: "indian",
    prepTime: 30,
    cookTime: 30,
    servings: 4,
    ingredients: [
      { item: "chicken thigh", amount: "600", unit: "g" },
      { item: "yogurt", amount: "200", unit: "g" },
      { item: "tomato puree", amount: "400", unit: "g" },
      { item: "heavy cream", amount: "150", unit: "ml" },
      { item: "butter", amount: "50", unit: "g" },
      { item: "garam masala", amount: "2", unit: "tsp" },
      { item: "kashmiri chili powder", amount: "1", unit: "tsp" },
      { item: "ginger-garlic paste", amount: "2", unit: "tbsp" },
      { item: "basmati rice", amount: "300", unit: "g" },
    ],
    steps: [
      "Marinate chicken in yogurt, garam masala, and chili for 2 hours.",
      "Grill or pan-sear chicken until charred. Set aside.",
      "Melt butter, sauté ginger-garlic paste until golden.",
      "Add tomato puree, simmer 15 minutes until oil separates.",
      "Add cream and grilled chicken, simmer 10 minutes.",
      "Season with salt and sugar to balance. Serve with basmati rice.",
    ],
    calories: 450,
    tags: ["rich", "crowd-pleaser", "restaurant-style"],
  },
};

const SUBSTITUTIONS: Record<string, { substitute: string; notes: string }[]> = {
  "heavy cream": [
    { substitute: "coconut cream", notes: "Great for dairy-free; adds slight coconut flavor" },
    { substitute: "cashew cream", notes: "Blend soaked cashews with water; neutral flavor" },
    { substitute: "Greek yogurt", notes: "Tangier; use in sauces, not whipping" },
  ],
  "all-purpose flour": [
    { substitute: "almond flour", notes: "Gluten-free; use 1:1 but results are denser" },
    { substitute: "oat flour", notes: "Blend oats fine; works for pancakes and cookies" },
    { substitute: "rice flour", notes: "Good for frying; lighter texture" },
  ],
  butter: [
    { substitute: "olive oil", notes: "Use 3/4 the amount; best for savory dishes" },
    { substitute: "coconut oil", notes: "1:1 ratio; adds slight coconut flavor" },
    { substitute: "applesauce", notes: "For baking only; use half the amount of butter" },
  ],
  eggs: [
    { substitute: "flax egg (1 tbsp ground flax + 3 tbsp water)", notes: "Let sit 5 min to gel" },
    { substitute: "mashed banana (1/4 cup per egg)", notes: "Best for sweet baked goods" },
    {
      substitute: "silken tofu (1/4 cup per egg)",
      notes: "Blend smooth; good for dense baked goods",
    },
  ],
  "fish sauce": [
    { substitute: "soy sauce + lime juice", notes: "Mix 1:1; close umami but less funky" },
    { substitute: "coconut aminos", notes: "Sweeter, less salty; good for soy-free diets" },
  ],
};

const COOK_TIPS: Record<string, string[]> = {
  "RCP-001": [
    "Don't overwork the dough — let gluten relax for easier stretching.",
    "Use room-temperature mozzarella for better melting.",
    "The oven must be screaming hot (475°F+). Preheat the stone for 30 min.",
  ],
  "RCP-002": [
    "Fry the curry paste in the coconut cream (thick part) first — this blooms the spices.",
    "Don't boil the curry after adding thin coconut milk or it can split.",
    "Thai basil wilts fast — add it right before serving.",
  ],
  "RCP-004": [
    "Never boil miso — it kills the beneficial probiotics and dulls the flavor.",
    "Soft-boil eggs: 6.5 min from boiling water, then ice bath immediately.",
    "Slice chashu cold, then warm in broth — it's easier to cut evenly.",
  ],
  searing: [
    "Pat meat completely dry with paper towels before searing.",
    "Use a heavy pan (cast iron is ideal) preheated for 3-5 minutes.",
    "Don't move the meat once it's in the pan — let the Maillard reaction do its work.",
    "The meat will release naturally when properly seared — if it sticks, it's not ready.",
  ],
};

// ─── Mutable state ───────────────────────────────────────────────────────────

const mealPlan: Record<string, Record<string, string | null>> = {
  monday: { breakfast: null, lunch: null, dinner: null, snack: null },
  tuesday: { breakfast: null, lunch: null, dinner: null, snack: null },
  wednesday: { breakfast: null, lunch: null, dinner: null, snack: null },
  thursday: { breakfast: null, lunch: null, dinner: null, snack: null },
  friday: { breakfast: null, lunch: null, dinner: null, snack: null },
  saturday: { breakfast: null, lunch: null, dinner: null, snack: null },
  sunday: { breakfast: null, lunch: null, dinner: null, snack: null },
};

const favorites: { recipeId: string; note: string }[] = [];

// ─── Tool Implementations ─────────────────────────────────────────────────────

function recipeSearch(args: Record<string, string>): string {
  const query = (args.query ?? "").toLowerCase();
  const cuisine = args.cuisine?.toLowerCase();
  const max = parseInt(args.max_results ?? "5", 10);

  let matches = Object.values(RECIPES).filter(
    (r) =>
      r.title.toLowerCase().includes(query) ||
      r.tags.some((t) => t.includes(query)) ||
      r.cuisine.includes(query) ||
      r.ingredients.some((i) => i.item.toLowerCase().includes(query)),
  );

  if (cuisine) {
    matches = matches.filter((r) => r.cuisine === cuisine);
  }

  const results = matches.slice(0, max).map((r) => ({
    id: r.id,
    title: r.title,
    cuisine: r.cuisine,
    prepTime: `${r.prepTime} min`,
    cookTime: `${r.cookTime} min`,
    calories: r.calories,
    tags: r.tags,
  }));

  return results.length > 0
    ? JSON.stringify({ recipes: results })
    : JSON.stringify({ message: `No recipes found for '${query}'. Try a broader search.` });
}

function recipeGetDetails(args: Record<string, string>): string {
  const recipe = RECIPES[args.recipe_id];
  if (!recipe) {
    return JSON.stringify({ error: `Recipe '${args.recipe_id}' not found.` });
  }
  return JSON.stringify(recipe);
}

function recipeScale(args: Record<string, string>): string {
  const recipe = RECIPES[args.recipe_id];
  if (!recipe) {
    return JSON.stringify({ error: `Recipe '${args.recipe_id}' not found.` });
  }
  const target = parseInt(args.target_servings, 10);
  if (isNaN(target) || target < 1 || target > 50) {
    return JSON.stringify({ error: "target_servings must be between 1 and 50." });
  }
  const factor = target / recipe.servings;
  const scaled = recipe.ingredients.map((i) => ({
    item: i.item,
    amount: String(Math.round(parseFloat(i.amount) * factor * 10) / 10),
    unit: i.unit,
  }));
  return JSON.stringify({
    recipe_id: recipe.id,
    title: recipe.title,
    originalServings: recipe.servings,
    targetServings: target,
    scaledIngredients: scaled,
  });
}

function recipeGetSubstitutions(args: Record<string, string>): string {
  const ingredient = (args.ingredient ?? "").toLowerCase();
  const subs = SUBSTITUTIONS[ingredient];
  if (!subs) {
    return JSON.stringify({
      ingredient,
      substitutions: [
        { substitute: "No specific substitutions available", notes: "Try a general web search." },
      ],
    });
  }
  return JSON.stringify({ ingredient, reason: args.reason ?? "unspecified", substitutions: subs });
}

function recipeAddToMealPlan(args: Record<string, string>): string {
  const recipe = RECIPES[args.recipe_id];
  if (!recipe) {
    return JSON.stringify({ error: `Recipe '${args.recipe_id}' not found.` });
  }
  const day = args.day?.toLowerCase();
  const meal = args.meal?.toLowerCase();
  if (!mealPlan[day]) {
    return JSON.stringify({ error: `Invalid day: '${day}'.` });
  }
  if (!(meal in mealPlan[day])) {
    return JSON.stringify({ error: `Invalid meal: '${meal}'.` });
  }
  const previous = mealPlan[day][meal];
  mealPlan[day][meal] = recipe.id;
  return JSON.stringify({
    success: true,
    day,
    meal,
    recipeId: recipe.id,
    recipeTitle: recipe.title,
    replaced: previous,
  });
}

function recipeGetMealPlan(args: Record<string, string>): string {
  const day = args.day?.toLowerCase();
  if (day) {
    if (!mealPlan[day]) {
      return JSON.stringify({ error: `Invalid day: '${day}'.` });
    }
    const slots = Object.entries(mealPlan[day]).map(([meal, recipeId]) => ({
      meal,
      recipeId,
      recipeTitle: recipeId ? (RECIPES[recipeId]?.title ?? "Unknown") : null,
    }));
    return JSON.stringify({ day, slots });
  }
  const plan = Object.entries(mealPlan).map(([d, meals]) => ({
    day: d,
    slots: Object.entries(meals).map(([meal, recipeId]) => ({
      meal,
      recipeId,
      recipeTitle: recipeId ? (RECIPES[recipeId]?.title ?? "Unknown") : null,
    })),
  }));
  return JSON.stringify({ mealPlan: plan });
}

function recipeGenerateShoppingList(args: Record<string, string>): string {
  const excludeStaples = args.exclude_pantry_staples === "true";
  const staples = new Set(["salt", "pepper", "olive oil", "vegetable oil", "water"]);
  const items: Record<string, { amount: number; unit: string }> = {};

  for (const day of Object.values(mealPlan)) {
    for (const recipeId of Object.values(day)) {
      if (!recipeId) continue;
      const recipe = RECIPES[recipeId];
      if (!recipe) continue;
      for (const ing of recipe.ingredients) {
        if (excludeStaples && staples.has(ing.item.toLowerCase())) continue;
        const key = `${ing.item}|${ing.unit}`;
        if (!items[key]) {
          items[key] = { amount: 0, unit: ing.unit };
        }
        items[key].amount += parseFloat(ing.amount);
      }
    }
  }

  const list = Object.entries(items).map(([key, val]) => ({
    item: key.split("|")[0],
    amount: String(val.amount),
    unit: val.unit,
  }));

  return list.length > 0
    ? JSON.stringify({ shoppingList: list, itemCount: list.length })
    : JSON.stringify({ message: "Meal plan is empty — add recipes first." });
}

function recipeGetNutrition(args: Record<string, string>): string {
  const recipe = RECIPES[args.recipe_id];
  if (!recipe) {
    return JSON.stringify({ error: `Recipe '${args.recipe_id}' not found.` });
  }
  return JSON.stringify({
    recipe_id: recipe.id,
    title: recipe.title,
    perServing: {
      calories: recipe.calories,
      protein: `${Math.round((recipe.calories * 0.15) / 4)}g`,
      carbs: `${Math.round((recipe.calories * 0.5) / 4)}g`,
      fat: `${Math.round((recipe.calories * 0.35) / 9)}g`,
      fiber: `${Math.round((recipe.calories * 0.03) / 2 + 2)}g`,
      sodium: `${Math.round(recipe.calories * 0.8 + 200)}mg`,
    },
    servings: recipe.servings,
  });
}

function recipeGetCookTips(args: Record<string, string>): string {
  const recipeId = args.recipe_id;
  const technique = args.technique?.toLowerCase();

  const tips: string[] = [];
  if (recipeId && COOK_TIPS[recipeId]) {
    tips.push(...COOK_TIPS[recipeId]);
  }
  if (technique && COOK_TIPS[technique]) {
    tips.push(...COOK_TIPS[technique]);
  }
  if (tips.length === 0) {
    tips.push(
      "Read the entire recipe before starting.",
      "Prep all ingredients before cooking (mise en place).",
      "Taste as you go and adjust seasoning.",
    );
  }
  return JSON.stringify({ tips });
}

function recipeSaveFavorite(args: Record<string, string>): string {
  const recipe = RECIPES[args.recipe_id];
  if (!recipe) {
    return JSON.stringify({ error: `Recipe '${args.recipe_id}' not found.` });
  }
  if (favorites.some((f) => f.recipeId === args.recipe_id)) {
    return JSON.stringify({ message: `${recipe.title} is already in favorites.` });
  }
  favorites.push({ recipeId: args.recipe_id, note: args.note ?? "" });
  return JSON.stringify({
    success: true,
    recipeId: args.recipe_id,
    title: recipe.title,
    totalFavorites: favorites.length,
  });
}

// ─── Tool Dispatcher ──────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "recipe_search":
      return recipeSearch(args);
    case "recipe_get_details":
      return recipeGetDetails(args);
    case "recipe_scale":
      return recipeScale(args);
    case "recipe_get_substitutions":
      return recipeGetSubstitutions(args);
    case "recipe_add_to_meal_plan":
      return recipeAddToMealPlan(args);
    case "recipe_get_meal_plan":
      return recipeGetMealPlan(args);
    case "recipe_generate_shopping_list":
      return recipeGenerateShoppingList(args);
    case "recipe_get_nutrition":
      return recipeGetNutrition(args);
    case "recipe_get_cook_tips":
      return recipeGetCookTips(args);
    case "recipe_save_favorite":
      return recipeSaveFavorite(args);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

/** Reset mutable state between benchmark runs. */
export function resetState(): void {
  for (const day of Object.values(mealPlan)) {
    for (const meal of Object.keys(day)) {
      day[meal] = null;
    }
  }
  favorites.length = 0;
}
