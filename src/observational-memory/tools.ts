import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_recipes",
      description:
        "Search for recipes by cuisine, dietary restriction, difficulty, or ingredient. Returns matching recipes with basic info.",
      parameters: {
        type: "object",
        properties: {
          cuisine: {
            type: "string",
            description: "Type of cuisine",
            enum: [
              "mediterranean",
              "asian",
              "mexican",
              "indian",
              "italian",
              "american",
              "middle-eastern",
              "french",
            ],
          },
          dietary: {
            type: "string",
            description: "Dietary restriction to filter by",
            enum: ["vegetarian", "vegan", "gluten-free", "dairy-free", "nut-free", "low-carb"],
          },
          difficulty: {
            type: "string",
            description: "Recipe difficulty level",
            enum: ["easy", "medium", "hard"],
          },
          ingredient: {
            type: "string",
            description: "A key ingredient to search for (e.g. 'chicken', 'tofu', 'pasta')",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recipe_details",
      description:
        "Get full recipe details including ingredients list, step-by-step instructions, prep/cook time, and nutrition info.",
      parameters: {
        type: "object",
        properties: {
          recipe_id: {
            type: "string",
            description: "The unique recipe identifier (e.g. 'rec-001')",
          },
        },
        required: ["recipe_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_substitutions",
      description:
        "Get ingredient substitutions for a recipe, useful for dietary restrictions or missing ingredients.",
      parameters: {
        type: "object",
        properties: {
          recipe_id: {
            type: "string",
            description: "The recipe to get substitutions for",
          },
          reason: {
            type: "string",
            description: "Why substitutions are needed",
            enum: ["allergy", "dietary", "missing-ingredient", "preference"],
          },
        },
        required: ["recipe_id"],
      },
    },
  },
];

// ─── Mock Data ───────────────────────────────────────────────────────────────

interface Recipe {
  id: string;
  name: string;
  cuisine: string;
  dietary: string[];
  difficulty: string;
  prepTime: string;
  cookTime: string;
  servings: number;
  ingredients: string[];
  steps: string[];
  nutrition: { calories: number; protein: string; carbs: string; fat: string };
  keyIngredients: string[];
}

const RECIPES: Recipe[] = [
  {
    id: "rec-001",
    name: "Mediterranean Chickpea Bowl",
    cuisine: "mediterranean",
    dietary: ["vegan", "gluten-free", "nut-free"],
    difficulty: "easy",
    prepTime: "15 min",
    cookTime: "20 min",
    servings: 4,
    ingredients: [
      "2 cans chickpeas",
      "1 cup quinoa",
      "2 cups cherry tomatoes",
      "1 cucumber",
      "1/2 cup kalamata olives",
      "1/4 cup olive oil",
      "2 tbsp lemon juice",
      "2 cloves garlic",
      "Fresh parsley",
      "Salt and pepper",
    ],
    steps: [
      "Cook quinoa according to package directions",
      "Drain and rinse chickpeas, toss with olive oil and spices",
      "Roast chickpeas at 400°F for 20 minutes",
      "Dice cucumber and halve tomatoes",
      "Assemble bowls: quinoa base, roasted chickpeas, vegetables, olives",
      "Drizzle with lemon-garlic dressing",
    ],
    nutrition: { calories: 420, protein: "18g", carbs: "52g", fat: "16g" },
    keyIngredients: ["chickpeas", "quinoa", "tomatoes", "cucumber", "olives"],
  },
  {
    id: "rec-002",
    name: "Thai Basil Tofu Stir-Fry",
    cuisine: "asian",
    dietary: ["vegan", "dairy-free"],
    difficulty: "easy",
    prepTime: "10 min",
    cookTime: "15 min",
    servings: 2,
    ingredients: [
      "1 block firm tofu",
      "2 cups Thai basil leaves",
      "3 cloves garlic",
      "2 Thai chilies",
      "2 tbsp soy sauce",
      "1 tbsp oyster sauce (vegan)",
      "1 tsp sugar",
      "2 tbsp vegetable oil",
      "1 bell pepper",
      "Jasmine rice for serving",
    ],
    steps: [
      "Press and cube tofu, pat dry",
      "Heat oil in wok over high heat",
      "Fry tofu until golden on all sides, remove",
      "Stir-fry garlic and chilies for 30 seconds",
      "Add bell pepper, cook 2 minutes",
      "Return tofu, add sauces and sugar",
      "Toss in Thai basil until wilted, serve over rice",
    ],
    nutrition: { calories: 350, protein: "22g", carbs: "28g", fat: "18g" },
    keyIngredients: ["tofu", "basil", "garlic", "chilies", "soy sauce"],
  },
  {
    id: "rec-003",
    name: "Classic Chicken Tikka Masala",
    cuisine: "indian",
    dietary: ["gluten-free"],
    difficulty: "medium",
    prepTime: "30 min",
    cookTime: "40 min",
    servings: 4,
    ingredients: [
      "1.5 lbs chicken thighs",
      "1 cup yogurt",
      "2 tbsp tikka masala spice blend",
      "1 can crushed tomatoes",
      "1 cup heavy cream",
      "1 large onion",
      "4 cloves garlic",
      "1 inch ginger",
      "2 tbsp butter",
      "Basmati rice and naan for serving",
    ],
    steps: [
      "Marinate chicken in yogurt and half the spices for 30 minutes",
      "Grill or broil chicken until charred, cut into pieces",
      "Sauté onion, garlic, and ginger in butter",
      "Add remaining spices, cook 1 minute",
      "Add crushed tomatoes, simmer 15 minutes",
      "Stir in cream, add chicken, simmer 10 minutes",
      "Serve over basmati rice with warm naan",
    ],
    nutrition: { calories: 580, protein: "42g", carbs: "24g", fat: "36g" },
    keyIngredients: ["chicken", "yogurt", "tomatoes", "cream", "spices"],
  },
  {
    id: "rec-004",
    name: "Mushroom Risotto",
    cuisine: "italian",
    dietary: ["vegetarian", "gluten-free"],
    difficulty: "medium",
    prepTime: "10 min",
    cookTime: "35 min",
    servings: 4,
    ingredients: [
      "1.5 cups arborio rice",
      "8 oz mixed mushrooms",
      "4 cups vegetable broth (warm)",
      "1/2 cup dry white wine",
      "1 shallot",
      "2 cloves garlic",
      "1/2 cup parmesan cheese",
      "2 tbsp butter",
      "2 tbsp olive oil",
      "Fresh thyme",
    ],
    steps: [
      "Sauté mushrooms in olive oil until golden, set aside",
      "Cook shallot and garlic in butter until soft",
      "Add rice, toast for 2 minutes",
      "Add wine, stir until absorbed",
      "Add broth one ladle at a time, stirring constantly",
      "After 20 minutes, fold in mushrooms and parmesan",
      "Season with thyme, salt, and pepper",
    ],
    nutrition: { calories: 460, protein: "14g", carbs: "62g", fat: "16g" },
    keyIngredients: ["rice", "mushrooms", "parmesan", "wine", "broth"],
  },
  {
    id: "rec-005",
    name: "Black Bean Tacos with Mango Salsa",
    cuisine: "mexican",
    dietary: ["vegan", "gluten-free", "nut-free"],
    difficulty: "easy",
    prepTime: "20 min",
    cookTime: "10 min",
    servings: 4,
    ingredients: [
      "2 cans black beans",
      "1 ripe mango",
      "1 red onion",
      "1 jalapeño",
      "2 limes",
      "1 avocado",
      "Fresh cilantro",
      "Corn tortillas",
      "1 tsp cumin",
      "1 tsp smoked paprika",
    ],
    steps: [
      "Season and warm black beans with cumin and paprika",
      "Dice mango, red onion, and jalapeño for salsa",
      "Mix salsa with lime juice and cilantro",
      "Warm corn tortillas",
      "Assemble: beans, mango salsa, sliced avocado",
      "Squeeze lime over top and serve",
    ],
    nutrition: { calories: 380, protein: "16g", carbs: "58g", fat: "12g" },
    keyIngredients: ["black beans", "mango", "avocado", "corn tortillas", "cilantro"],
  },
  {
    id: "rec-006",
    name: "Lemon Herb Grilled Salmon",
    cuisine: "mediterranean",
    dietary: ["gluten-free", "dairy-free", "low-carb"],
    difficulty: "easy",
    prepTime: "10 min",
    cookTime: "12 min",
    servings: 2,
    ingredients: [
      "2 salmon fillets",
      "2 lemons",
      "3 tbsp olive oil",
      "Fresh dill and parsley",
      "3 cloves garlic",
      "Salt and pepper",
      "Asparagus for serving",
    ],
    steps: [
      "Mix olive oil, lemon zest, minced garlic, and herbs",
      "Marinate salmon for 10 minutes",
      "Preheat grill to medium-high",
      "Grill salmon 5-6 minutes per side",
      "Grill asparagus alongside",
      "Serve with lemon wedges",
    ],
    nutrition: { calories: 380, protein: "36g", carbs: "4g", fat: "24g" },
    keyIngredients: ["salmon", "lemon", "dill", "garlic", "asparagus"],
  },
  {
    id: "rec-007",
    name: "Shakshuka",
    cuisine: "middle-eastern",
    dietary: ["vegetarian", "gluten-free", "dairy-free", "nut-free"],
    difficulty: "easy",
    prepTime: "10 min",
    cookTime: "25 min",
    servings: 4,
    ingredients: [
      "6 eggs",
      "1 can crushed tomatoes",
      "2 bell peppers",
      "1 onion",
      "4 cloves garlic",
      "2 tsp cumin",
      "2 tsp paprika",
      "1 tsp chili flakes",
      "Fresh cilantro",
      "Crusty bread for serving",
    ],
    steps: [
      "Sauté onion and peppers until soft",
      "Add garlic and spices, cook 1 minute",
      "Pour in crushed tomatoes, simmer 10 minutes",
      "Make wells in sauce, crack eggs into wells",
      "Cover and cook 8-10 minutes until eggs set",
      "Garnish with cilantro, serve with bread",
    ],
    nutrition: { calories: 280, protein: "18g", carbs: "22g", fat: "14g" },
    keyIngredients: ["eggs", "tomatoes", "bell peppers", "cumin", "paprika"],
  },
  {
    id: "rec-008",
    name: "Pad Thai",
    cuisine: "asian",
    dietary: ["gluten-free", "dairy-free"],
    difficulty: "medium",
    prepTime: "20 min",
    cookTime: "10 min",
    servings: 2,
    ingredients: [
      "8 oz rice noodles",
      "2 eggs",
      "1 cup bean sprouts",
      "3 green onions",
      "1/4 cup crushed peanuts",
      "2 tbsp fish sauce",
      "1 tbsp tamarind paste",
      "1 tbsp sugar",
      "1 lime",
      "Shrimp or tofu",
    ],
    steps: [
      "Soak rice noodles in warm water 20 minutes",
      "Mix fish sauce, tamarind, and sugar for sauce",
      "Scramble eggs in hot wok, set aside",
      "Stir-fry shrimp/tofu until cooked",
      "Add drained noodles and sauce, toss 2 minutes",
      "Add eggs, bean sprouts, green onions",
      "Top with peanuts and lime wedge",
    ],
    nutrition: { calories: 440, protein: "24g", carbs: "58g", fat: "14g" },
    keyIngredients: ["rice noodles", "eggs", "peanuts", "fish sauce", "tamarind"],
  },
];

interface Substitution {
  recipeId: string;
  original: string;
  substitute: string;
  reason: string;
}

const SUBSTITUTIONS: Substitution[] = [
  {
    recipeId: "rec-003",
    original: "heavy cream",
    substitute: "coconut cream",
    reason: "dairy-free",
  },
  { recipeId: "rec-003", original: "yogurt", substitute: "coconut yogurt", reason: "dairy-free" },
  {
    recipeId: "rec-003",
    original: "chicken thighs",
    substitute: "paneer or firm tofu",
    reason: "vegetarian",
  },
  {
    recipeId: "rec-003",
    original: "butter",
    substitute: "ghee or coconut oil",
    reason: "dairy-free",
  },
  {
    recipeId: "rec-004",
    original: "parmesan cheese",
    substitute: "nutritional yeast",
    reason: "vegan",
  },
  { recipeId: "rec-004", original: "butter", substitute: "olive oil", reason: "vegan" },
  {
    recipeId: "rec-004",
    original: "white wine",
    substitute: "vegetable broth + lemon juice",
    reason: "alcohol-free",
  },
  {
    recipeId: "rec-008",
    original: "fish sauce",
    substitute: "soy sauce + lime juice",
    reason: "vegetarian",
  },
  { recipeId: "rec-008", original: "eggs", substitute: "scrambled tofu", reason: "vegan" },
  {
    recipeId: "rec-008",
    original: "crushed peanuts",
    substitute: "sunflower seeds",
    reason: "nut-free",
  },
  { recipeId: "rec-002", original: "soy sauce", substitute: "coconut aminos", reason: "soy-free" },
  { recipeId: "rec-002", original: "tofu", substitute: "tempeh or seitan", reason: "preference" },
  { recipeId: "rec-007", original: "eggs", substitute: "silken tofu rounds", reason: "vegan" },
  { recipeId: "rec-006", original: "salmon", substitute: "swordfish or cod", reason: "preference" },
];

// ─── Tool Implementations ────────────────────────────────────────────────────

function searchRecipes(args: {
  cuisine?: string;
  dietary?: string;
  difficulty?: string;
  ingredient?: string;
}): string {
  let results = [...RECIPES];

  if (args.cuisine) {
    results = results.filter((r) => r.cuisine === args.cuisine);
  }
  if (args.dietary) {
    const dietary = args.dietary;
    results = results.filter((r) => r.dietary.includes(dietary));
  }
  if (args.difficulty) {
    results = results.filter((r) => r.difficulty === args.difficulty);
  }
  if (args.ingredient) {
    const ing = args.ingredient.toLowerCase();
    results = results.filter((r) => r.keyIngredients.some((k) => k.includes(ing)));
  }

  if (results.length === 0) {
    return JSON.stringify({ found: false, message: "No recipes match those criteria." });
  }

  return JSON.stringify({
    found: true,
    count: results.length,
    recipes: results.map((r) => ({
      id: r.id,
      name: r.name,
      cuisine: r.cuisine,
      dietary: r.dietary,
      difficulty: r.difficulty,
      prepTime: r.prepTime,
      cookTime: r.cookTime,
    })),
  });
}

function getRecipeDetails(args: { recipe_id: string }): string {
  const recipe = RECIPES.find((r) => r.id === args.recipe_id);
  if (!recipe) {
    return JSON.stringify({ error: `Recipe not found: ${args.recipe_id}` });
  }
  return JSON.stringify(recipe);
}

function getSubstitutions(args: { recipe_id: string; reason?: string }): string {
  const recipe = RECIPES.find((r) => r.id === args.recipe_id);
  if (!recipe) {
    return JSON.stringify({ error: `Recipe not found: ${args.recipe_id}` });
  }

  let subs = SUBSTITUTIONS.filter((s) => s.recipeId === args.recipe_id);
  if (args.reason) {
    subs = subs.filter((s) => s.reason === args.reason);
  }

  return JSON.stringify({
    recipe: recipe.name,
    substitutions: subs,
  });
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_recipes":
      return searchRecipes(args);
    case "get_recipe_details":
      return getRecipeDetails(args as Parameters<typeof getRecipeDetails>[0]);
    case "get_substitutions":
      return getSubstitutions(args as Parameters<typeof getSubstitutions>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
