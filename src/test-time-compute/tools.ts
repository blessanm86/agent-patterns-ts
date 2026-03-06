import type { ToolDefinition } from "../shared/types.js";

// ─── Mock Recipe Database ───────────────────────────────────────────────────

interface Recipe {
  id: string;
  name: string;
  cuisine: string;
  dietary: string[];
  ingredients: string[];
  caloriesPerServing: number;
  prepTimeMinutes: number;
  difficulty: string;
  description: string;
}

const RECIPES: Recipe[] = [
  {
    id: "r1",
    name: "Classic Caesar Salad",
    cuisine: "American",
    dietary: ["gluten-free"],
    ingredients: ["romaine lettuce", "parmesan", "croutons", "caesar dressing", "lemon", "garlic"],
    caloriesPerServing: 320,
    prepTimeMinutes: 15,
    difficulty: "easy",
    description: "Crisp romaine with creamy Caesar dressing, shaved parmesan, and garlic croutons.",
  },
  {
    id: "r2",
    name: "Vegan Chocolate Cake",
    cuisine: "American",
    dietary: ["vegan", "dairy-free"],
    ingredients: [
      "flour",
      "cocoa powder",
      "sugar",
      "coconut oil",
      "almond milk",
      "apple cider vinegar",
      "vanilla",
      "baking soda",
    ],
    caloriesPerServing: 380,
    prepTimeMinutes: 45,
    difficulty: "medium",
    description: "Rich, moist chocolate cake made entirely without eggs or dairy.",
  },
  {
    id: "r3",
    name: "Thai Green Curry",
    cuisine: "Thai",
    dietary: ["gluten-free", "dairy-free"],
    ingredients: [
      "coconut milk",
      "green curry paste",
      "chicken",
      "bamboo shoots",
      "thai basil",
      "fish sauce",
      "palm sugar",
      "kaffir lime leaves",
    ],
    caloriesPerServing: 450,
    prepTimeMinutes: 35,
    difficulty: "medium",
    description:
      "Fragrant curry with tender chicken, vegetables, and aromatic herbs in coconut milk.",
  },
  {
    id: "r4",
    name: "Mushroom Risotto",
    cuisine: "Italian",
    dietary: ["vegetarian", "gluten-free"],
    ingredients: [
      "arborio rice",
      "mixed mushrooms",
      "onion",
      "white wine",
      "parmesan",
      "butter",
      "vegetable broth",
      "thyme",
    ],
    caloriesPerServing: 420,
    prepTimeMinutes: 40,
    difficulty: "medium",
    description: "Creamy Italian risotto with a medley of wild and cultivated mushrooms.",
  },
  {
    id: "r5",
    name: "Grilled Salmon with Quinoa",
    cuisine: "Mediterranean",
    dietary: ["gluten-free", "dairy-free", "nut-free"],
    ingredients: [
      "salmon fillet",
      "quinoa",
      "lemon",
      "olive oil",
      "cherry tomatoes",
      "cucumber",
      "red onion",
      "dill",
    ],
    caloriesPerServing: 480,
    prepTimeMinutes: 30,
    difficulty: "easy",
    description: "Heart-healthy grilled salmon served over fluffy quinoa with a fresh salad.",
  },
  {
    id: "r6",
    name: "Spicy Black Bean Tacos",
    cuisine: "Mexican",
    dietary: ["vegan", "dairy-free", "nut-free"],
    ingredients: [
      "black beans",
      "corn tortillas",
      "avocado",
      "lime",
      "cilantro",
      "jalapeño",
      "cumin",
      "smoked paprika",
    ],
    caloriesPerServing: 290,
    prepTimeMinutes: 20,
    difficulty: "easy",
    description: "Satisfying plant-based tacos with smoky spiced black beans and fresh toppings.",
  },
  {
    id: "r7",
    name: "Beef Wellington",
    cuisine: "British",
    dietary: [],
    ingredients: [
      "beef tenderloin",
      "puff pastry",
      "mushroom duxelles",
      "prosciutto",
      "egg wash",
      "dijon mustard",
      "shallots",
      "thyme",
    ],
    caloriesPerServing: 650,
    prepTimeMinutes: 120,
    difficulty: "hard",
    description:
      "Show-stopping beef tenderloin wrapped in mushroom duxelles, prosciutto, and golden pastry.",
  },
  {
    id: "r8",
    name: "Miso Glazed Eggplant",
    cuisine: "Japanese",
    dietary: ["vegan", "dairy-free", "nut-free"],
    ingredients: [
      "eggplant",
      "white miso paste",
      "mirin",
      "sake",
      "sugar",
      "sesame seeds",
      "scallions",
      "rice",
    ],
    caloriesPerServing: 260,
    prepTimeMinutes: 25,
    difficulty: "easy",
    description: "Caramelized eggplant with sweet and savory miso glaze, served over steamed rice.",
  },
  {
    id: "r9",
    name: "Chicken Tikka Masala",
    cuisine: "Indian",
    dietary: ["gluten-free", "nut-free"],
    ingredients: [
      "chicken thighs",
      "yogurt",
      "tomato sauce",
      "cream",
      "garam masala",
      "turmeric",
      "cumin",
      "ginger",
      "garlic",
      "basmati rice",
    ],
    caloriesPerServing: 520,
    prepTimeMinutes: 50,
    difficulty: "medium",
    description: "Tender marinated chicken in a rich, spiced tomato-cream sauce with basmati rice.",
  },
  {
    id: "r10",
    name: "Lemon Herb Roasted Vegetables",
    cuisine: "Mediterranean",
    dietary: ["vegan", "gluten-free", "dairy-free", "nut-free"],
    ingredients: [
      "zucchini",
      "bell peppers",
      "red onion",
      "cherry tomatoes",
      "olive oil",
      "lemon",
      "oregano",
      "rosemary",
    ],
    caloriesPerServing: 180,
    prepTimeMinutes: 35,
    difficulty: "easy",
    description: "Colorful roasted vegetables with bright lemon and aromatic Mediterranean herbs.",
  },
  {
    id: "r11",
    name: "Soufflé au Fromage",
    cuisine: "French",
    dietary: ["vegetarian"],
    ingredients: [
      "eggs",
      "gruyère",
      "butter",
      "flour",
      "milk",
      "nutmeg",
      "cream of tartar",
      "salt",
    ],
    caloriesPerServing: 310,
    prepTimeMinutes: 55,
    difficulty: "hard",
    description: "Delicate French cheese soufflé with a golden crust and pillowy interior.",
  },
  {
    id: "r12",
    name: "Pad Thai",
    cuisine: "Thai",
    dietary: ["gluten-free", "dairy-free"],
    ingredients: [
      "rice noodles",
      "shrimp",
      "tofu",
      "bean sprouts",
      "peanuts",
      "lime",
      "tamarind paste",
      "fish sauce",
      "eggs",
    ],
    caloriesPerServing: 400,
    prepTimeMinutes: 30,
    difficulty: "medium",
    description:
      "Classic Thai stir-fried noodles with a perfect balance of sweet, sour, and salty.",
  },
];

// ─── Substitution Database ──────────────────────────────────────────────────

interface Substitution {
  original: string;
  substitute: string;
  ratio: string;
  notes: string;
  dietaryBenefit: string[];
}

const SUBSTITUTIONS: Substitution[] = [
  {
    original: "eggs",
    substitute: "flax eggs (1 tbsp ground flax + 3 tbsp water per egg)",
    ratio: "1:1",
    notes: "Best for binding in baked goods. Let sit 5 min to gel.",
    dietaryBenefit: ["vegan"],
  },
  {
    original: "eggs",
    substitute: "applesauce (1/4 cup per egg)",
    ratio: "1:1",
    notes: "Adds moisture and slight sweetness. Good for cakes and muffins.",
    dietaryBenefit: ["vegan"],
  },
  {
    original: "butter",
    substitute: "coconut oil",
    ratio: "1:1",
    notes: "Works in baking and cooking. Adds slight coconut flavor.",
    dietaryBenefit: ["vegan", "dairy-free"],
  },
  {
    original: "cream",
    substitute: "coconut cream",
    ratio: "1:1",
    notes: "Rich and creamy. Shake can well before using.",
    dietaryBenefit: ["vegan", "dairy-free"],
  },
  {
    original: "parmesan",
    substitute: "nutritional yeast",
    ratio: "3:4",
    notes: "Provides umami and cheesy flavor. Use 3/4 the amount.",
    dietaryBenefit: ["vegan", "dairy-free"],
  },
  {
    original: "fish sauce",
    substitute: "soy sauce + lime juice",
    ratio: "1:1",
    notes: "Mix equal parts soy sauce and lime juice for similar umami profile.",
    dietaryBenefit: ["vegetarian", "vegan"],
  },
  {
    original: "flour",
    substitute: "almond flour",
    ratio: "1:1",
    notes: "Denser result. May need extra binding agent. Not suitable for nut allergies.",
    dietaryBenefit: ["gluten-free"],
  },
  {
    original: "flour",
    substitute: "rice flour blend",
    ratio: "1:1",
    notes: "Mix rice flour with tapioca starch (3:1). Closest to wheat flour texture.",
    dietaryBenefit: ["gluten-free", "nut-free"],
  },
  {
    original: "peanuts",
    substitute: "sunflower seeds",
    ratio: "1:1",
    notes: "Similar crunch and protein. Toasted for better flavor.",
    dietaryBenefit: ["nut-free"],
  },
  {
    original: "milk",
    substitute: "oat milk",
    ratio: "1:1",
    notes: "Creamy consistency, neutral flavor. Good for cooking and baking.",
    dietaryBenefit: ["vegan", "dairy-free", "nut-free"],
  },
];

// ─── Tool Definitions ───────────────────────────────────────────────────────

const searchRecipesTool: ToolDefinition = {
  type: "function",
  function: {
    name: "search_recipes",
    description:
      "Search for recipes by keyword, cuisine type, or dietary restriction. Returns matching recipes with basic info.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search keyword (ingredient, dish name, or cuisine type like 'Italian', 'vegan', 'chicken')",
        },
        dietary_filter: {
          type: "string",
          description:
            "Optional dietary filter: 'vegan', 'vegetarian', 'gluten-free', 'dairy-free', 'nut-free'",
        },
        max_calories: {
          type: "string",
          description: "Optional maximum calories per serving (as a number string)",
        },
      },
      required: ["query"],
    },
  },
};

const getRecipeDetailsTool: ToolDefinition = {
  type: "function",
  function: {
    name: "get_recipe_details",
    description:
      "Get full details for a specific recipe by its ID (e.g. 'r1', 'r2'). Returns ingredients, nutrition, prep time, and instructions.",
    parameters: {
      type: "object",
      properties: {
        recipe_id: {
          type: "string",
          description: "The recipe ID (e.g. 'r1', 'r5', 'r12')",
        },
      },
      required: ["recipe_id"],
    },
  },
};

const findSubstitutionsTool: ToolDefinition = {
  type: "function",
  function: {
    name: "find_substitutions",
    description:
      "Find ingredient substitutions for dietary needs. Given an ingredient, returns alternatives suitable for specific diets (vegan, gluten-free, etc.).",
    parameters: {
      type: "object",
      properties: {
        ingredient: {
          type: "string",
          description: "The ingredient to find substitutions for (e.g. 'eggs', 'butter', 'flour')",
        },
        dietary_need: {
          type: "string",
          description: "The dietary requirement: 'vegan', 'gluten-free', 'dairy-free', 'nut-free'",
        },
      },
      required: ["ingredient"],
    },
  },
};

const calculateMealNutritionTool: ToolDefinition = {
  type: "function",
  function: {
    name: "calculate_meal_nutrition",
    description:
      "Calculate total nutrition for a combination of recipes (a meal plan). Pass comma-separated recipe IDs to get combined calorie count and dietary analysis.",
    parameters: {
      type: "object",
      properties: {
        recipe_ids: {
          type: "string",
          description: "Comma-separated recipe IDs (e.g. 'r1,r4,r2')",
        },
      },
      required: ["recipe_ids"],
    },
  },
};

// ─── Tool Implementations ───────────────────────────────────────────────────

function searchRecipes(args: Record<string, string>): string {
  const query = args.query?.toLowerCase() ?? "";
  const dietaryFilter = args.dietary_filter?.toLowerCase();
  const maxCalories = args.max_calories ? Number.parseInt(args.max_calories) : undefined;

  let results = RECIPES.filter((r) => {
    const matchesQuery =
      r.name.toLowerCase().includes(query) ||
      r.cuisine.toLowerCase().includes(query) ||
      r.ingredients.some((i) => i.toLowerCase().includes(query)) ||
      r.dietary.some((d) => d.toLowerCase().includes(query)) ||
      r.description.toLowerCase().includes(query);
    return matchesQuery;
  });

  if (dietaryFilter) {
    results = results.filter((r) => r.dietary.some((d) => d.includes(dietaryFilter)));
  }

  if (maxCalories) {
    results = results.filter((r) => r.caloriesPerServing <= maxCalories);
  }

  return JSON.stringify({
    results: results.map((r) => ({
      id: r.id,
      name: r.name,
      cuisine: r.cuisine,
      dietary: r.dietary,
      caloriesPerServing: r.caloriesPerServing,
      difficulty: r.difficulty,
      prepTimeMinutes: r.prepTimeMinutes,
    })),
    totalFound: results.length,
  });
}

function getRecipeDetails(args: Record<string, string>): string {
  const recipe = RECIPES.find((r) => r.id === args.recipe_id);
  if (!recipe) {
    return JSON.stringify({ error: `Recipe not found: ${args.recipe_id}` });
  }
  return JSON.stringify(recipe);
}

function findSubstitutions(args: Record<string, string>): string {
  const ingredient = args.ingredient?.toLowerCase() ?? "";
  const dietaryNeed = args.dietary_need?.toLowerCase();

  let results = SUBSTITUTIONS.filter((s) => s.original.toLowerCase().includes(ingredient));

  if (dietaryNeed) {
    results = results.filter((s) => s.dietaryBenefit.some((d) => d.includes(dietaryNeed)));
  }

  if (results.length === 0) {
    return JSON.stringify({
      message: `No substitutions found for "${args.ingredient}"${dietaryNeed ? ` with ${dietaryNeed} requirement` : ""}.`,
      suggestions: [
        "Try a broader ingredient name",
        "Available ingredients with substitutions: eggs, butter, cream, parmesan, fish sauce, flour, peanuts, milk",
      ],
    });
  }

  return JSON.stringify({ substitutions: results, totalFound: results.length });
}

function calculateMealNutrition(args: Record<string, string>): string {
  const ids = args.recipe_ids.split(",").map((id) => id.trim());
  const recipes = ids.map((id) => RECIPES.find((r) => r.id === id)).filter(Boolean) as Recipe[];

  if (recipes.length === 0) {
    return JSON.stringify({ error: "No valid recipe IDs provided." });
  }

  const notFound = ids.filter((id) => !RECIPES.find((r) => r.id === id));
  const totalCalories = recipes.reduce((sum, r) => sum + r.caloriesPerServing, 0);
  const totalPrepTime = recipes.reduce((sum, r) => sum + r.prepTimeMinutes, 0);

  // Find common dietary tags (intersection)
  const allDietary = recipes.map((r) => new Set(r.dietary));
  const commonDietary =
    allDietary.length > 0
      ? [...allDietary[0]].filter((tag) => allDietary.every((s) => s.has(tag)))
      : [];

  // Find all unique ingredients
  const allIngredients = [...new Set(recipes.flatMap((r) => r.ingredients))];

  return JSON.stringify({
    meal: recipes.map((r) => ({ id: r.id, name: r.name, calories: r.caloriesPerServing })),
    totalCalories,
    totalPrepTime,
    commonDietaryTags: commonDietary,
    allIngredients,
    notFound: notFound.length > 0 ? notFound : undefined,
  });
}

// ─── Exports ────────────────────────────────────────────────────────────────

export const tools: ToolDefinition[] = [
  searchRecipesTool,
  getRecipeDetailsTool,
  findSubstitutionsTool,
  calculateMealNutritionTool,
];

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_recipes":
      return searchRecipes(args);
    case "get_recipe_details":
      return getRecipeDetails(args);
    case "find_substitutions":
      return findSubstitutions(args);
    case "calculate_meal_nutrition":
      return calculateMealNutrition(args);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
