import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────
//
// Food assistant tools. The model sees these schemas and decides which to call.
// Images aren't a tool — they go directly into the message. The model reasons
// about what it sees in the image and then calls tools for structured data.

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "identify_dish",
      description:
        "Identify a dish by name, cuisine, and key ingredients from a text description. Use this after examining an image of food or when the user describes a dish they want identified.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "A text description of the dish (appearance, ingredients, style)",
          },
          cuisine_hint: {
            type: "string",
            description: "Optional cuisine hint (e.g. 'Italian', 'Japanese', 'Mexican')",
          },
        },
        required: ["description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract_menu_items",
      description:
        "Parse a restaurant menu description into structured items with names and prices. Use after reading a menu image or when the user describes menu contents.",
      parameters: {
        type: "object",
        properties: {
          menu_text: {
            type: "string",
            description: "The menu text to parse, with dish names and prices",
          },
          restaurant_type: {
            type: "string",
            description: "Type of restaurant (e.g. 'Italian', 'Cafe', 'Fast Food')",
          },
        },
        required: ["menu_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_nutritional_info",
      description:
        "Look up nutritional information for a named dish including calories, protein, carbs, and fat.",
      parameters: {
        type: "object",
        properties: {
          dish_name: {
            type: "string",
            description: "The name of the dish to look up",
          },
        },
        required: ["dish_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_recipes",
      description:
        "Search for recipes by dish name or ingredients. Returns matching recipes with ingredients and basic instructions.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Dish name or ingredients to search for",
          },
          max_results: {
            type: "string",
            description: "Maximum number of results to return (default: 3)",
          },
        },
        required: ["query"],
      },
    },
  },
];

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface DishInfo {
  name: string;
  cuisine: string;
  ingredients: string[];
  description: string;
}

const DISH_DATABASE: DishInfo[] = [
  {
    name: "Spaghetti Carbonara",
    cuisine: "Italian",
    ingredients: ["spaghetti", "guanciale", "eggs", "pecorino romano", "black pepper"],
    description: "Classic Roman pasta with creamy egg sauce, cured pork, and sharp cheese",
  },
  {
    name: "Pad Thai",
    cuisine: "Thai",
    ingredients: ["rice noodles", "shrimp", "tofu", "bean sprouts", "peanuts", "tamarind sauce"],
    description: "Stir-fried rice noodles with a sweet-sour tamarind sauce",
  },
  {
    name: "Margherita Pizza",
    cuisine: "Italian",
    ingredients: ["pizza dough", "san marzano tomatoes", "fresh mozzarella", "basil", "olive oil"],
    description: "Classic Neapolitan pizza with tomato, mozzarella, and fresh basil",
  },
  {
    name: "Chicken Tikka Masala",
    cuisine: "Indian",
    ingredients: ["chicken", "yogurt", "tomatoes", "cream", "garam masala", "ginger", "garlic"],
    description: "Marinated chicken in a rich, spiced tomato-cream sauce",
  },
  {
    name: "Caesar Salad",
    cuisine: "American",
    ingredients: ["romaine lettuce", "croutons", "parmesan", "caesar dressing", "anchovies"],
    description: "Crisp romaine with creamy anchovy dressing and parmesan",
  },
  {
    name: "Sushi Roll",
    cuisine: "Japanese",
    ingredients: ["sushi rice", "nori", "salmon", "avocado", "cucumber"],
    description: "Vinegared rice wrapped in seaweed with fresh fish and vegetables",
  },
  {
    name: "Tacos al Pastor",
    cuisine: "Mexican",
    ingredients: ["pork", "pineapple", "corn tortillas", "onion", "cilantro", "achiote"],
    description: "Spit-roasted pork with pineapple on soft corn tortillas",
  },
  {
    name: "Ramen",
    cuisine: "Japanese",
    ingredients: [
      "wheat noodles",
      "pork broth",
      "chashu pork",
      "soft-boiled egg",
      "nori",
      "green onions",
    ],
    description: "Rich pork bone broth with springy noodles and layered toppings",
  },
];

interface NutritionInfo {
  dish: string;
  servingSize: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

const NUTRITION_DATABASE: Record<string, NutritionInfo> = {
  "spaghetti carbonara": {
    dish: "Spaghetti Carbonara",
    servingSize: "1 plate (350g)",
    calories: 550,
    protein: 22,
    carbs: 65,
    fat: 24,
    fiber: 3,
  },
  "pad thai": {
    dish: "Pad Thai",
    servingSize: "1 plate (300g)",
    calories: 480,
    protein: 18,
    carbs: 58,
    fat: 20,
    fiber: 4,
  },
  "margherita pizza": {
    dish: "Margherita Pizza",
    servingSize: "1 pizza (300g)",
    calories: 720,
    protein: 28,
    carbs: 80,
    fat: 32,
    fiber: 4,
  },
  "chicken tikka masala": {
    dish: "Chicken Tikka Masala",
    servingSize: "1 serving (350g)",
    calories: 490,
    protein: 32,
    carbs: 28,
    fat: 28,
    fiber: 3,
  },
  "caesar salad": {
    dish: "Caesar Salad",
    servingSize: "1 bowl (250g)",
    calories: 320,
    protein: 12,
    carbs: 18,
    fat: 24,
    fiber: 4,
  },
  "sushi roll": {
    dish: "Sushi Roll",
    servingSize: "8 pieces (250g)",
    calories: 350,
    protein: 16,
    carbs: 52,
    fat: 8,
    fiber: 2,
  },
  "tacos al pastor": {
    dish: "Tacos al Pastor",
    servingSize: "3 tacos (300g)",
    calories: 450,
    protein: 28,
    carbs: 42,
    fat: 18,
    fiber: 5,
  },
  ramen: {
    dish: "Ramen",
    servingSize: "1 bowl (500g)",
    calories: 620,
    protein: 26,
    carbs: 72,
    fat: 24,
    fiber: 3,
  },
};

interface Recipe {
  name: string;
  cuisine: string;
  prepTime: string;
  ingredients: string[];
  steps: string[];
}

const RECIPE_DATABASE: Recipe[] = [
  {
    name: "Spaghetti Carbonara",
    cuisine: "Italian",
    prepTime: "25 minutes",
    ingredients: [
      "400g spaghetti",
      "200g guanciale (or pancetta)",
      "4 egg yolks + 2 whole eggs",
      "100g pecorino romano, finely grated",
      "freshly cracked black pepper",
    ],
    steps: [
      "Cook spaghetti in salted water until al dente",
      "Crisp guanciale in a pan over medium heat until golden",
      "Whisk eggs with pecorino and pepper in a bowl",
      "Toss hot drained pasta with guanciale and fat",
      "Remove from heat, add egg mixture, toss quickly to form a creamy sauce",
    ],
  },
  {
    name: "Pad Thai",
    cuisine: "Thai",
    prepTime: "30 minutes",
    ingredients: [
      "200g flat rice noodles",
      "200g shrimp, peeled",
      "2 eggs",
      "3 tbsp tamarind paste",
      "2 tbsp fish sauce",
      "1 tbsp sugar",
      "bean sprouts, peanuts, lime for garnish",
    ],
    steps: [
      "Soak rice noodles in warm water for 20 minutes, drain",
      "Mix tamarind paste, fish sauce, and sugar for the sauce",
      "Stir-fry shrimp until pink, push aside, scramble eggs",
      "Add noodles and sauce, toss until noodles absorb the sauce",
      "Garnish with bean sprouts, crushed peanuts, and lime wedge",
    ],
  },
  {
    name: "Chicken Tikka Masala",
    cuisine: "Indian",
    prepTime: "45 minutes",
    ingredients: [
      "500g chicken breast, cubed",
      "200ml yogurt",
      "400g canned tomatoes",
      "200ml heavy cream",
      "2 tbsp garam masala",
      "ginger, garlic, onion",
    ],
    steps: [
      "Marinate chicken in yogurt, garam masala, and salt for 30 min",
      "Grill or broil chicken until charred edges form",
      "Sauté onion, ginger, garlic, then add tomatoes and spices",
      "Simmer sauce for 15 minutes until thickened",
      "Add cream and grilled chicken, simmer 5 more minutes",
    ],
  },
  {
    name: "Caesar Salad",
    cuisine: "American",
    prepTime: "15 minutes",
    ingredients: [
      "2 heads romaine lettuce",
      "1 cup croutons",
      "1/2 cup parmesan, shaved",
      "2 anchovy fillets",
      "1 egg yolk, 1 clove garlic, lemon juice, olive oil, dijon mustard",
    ],
    steps: [
      "Mash anchovies and garlic into a paste",
      "Whisk in egg yolk, lemon juice, dijon mustard",
      "Slowly drizzle in olive oil while whisking to emulsify",
      "Tear romaine, toss with dressing until coated",
      "Top with croutons and shaved parmesan",
    ],
  },
  {
    name: "Tacos al Pastor",
    cuisine: "Mexican",
    prepTime: "40 minutes (plus marination)",
    ingredients: [
      "500g pork shoulder, thinly sliced",
      "3 tbsp achiote paste",
      "1/2 pineapple, sliced",
      "corn tortillas",
      "white onion, cilantro, lime",
    ],
    steps: [
      "Marinate pork in achiote paste, lime juice, and spices for 2+ hours",
      "Grill or pan-sear pork slices until charred and cooked through",
      "Grill pineapple slices until caramelized",
      "Warm tortillas on a dry skillet",
      "Assemble: pork, diced pineapple, onion, cilantro, squeeze of lime",
    ],
  },
  {
    name: "Ramen (Tonkotsu)",
    cuisine: "Japanese",
    prepTime: "12 hours (broth) + 30 minutes (assembly)",
    ingredients: [
      "pork bones for broth",
      "fresh ramen noodles",
      "chashu pork (braised pork belly)",
      "soft-boiled eggs (marinated in soy)",
      "nori, green onions, sesame seeds",
    ],
    steps: [
      "Boil pork bones for 12 hours, skimming and adding water as needed",
      "Braise pork belly in soy, mirin, sake until tender; slice for chashu",
      "Marinate soft-boiled eggs in soy-mirin mixture for 4+ hours",
      "Cook ramen noodles until just done, about 2 minutes",
      "Assemble: noodles in bowl, ladle broth, top with chashu, egg, nori, green onions",
    ],
  },
];

// ─── Tool Implementations ─────────────────────────────────────────────────────

function identifyDish(args: { description: string; cuisine_hint?: string }): string {
  const desc = args.description.toLowerCase();
  const hint = args.cuisine_hint?.toLowerCase();

  // Score each dish by keyword matches
  let bestMatch: DishInfo | null = null;
  let bestScore = 0;

  for (const dish of DISH_DATABASE) {
    let score = 0;

    // Check if any ingredient or keyword from the dish appears in the description
    for (const ingredient of dish.ingredients) {
      if (desc.includes(ingredient.toLowerCase())) score += 2;
    }
    if (desc.includes(dish.name.toLowerCase())) score += 5;
    if (desc.includes(dish.cuisine.toLowerCase())) score += 1;

    // Cuisine hint bonus
    if (hint && dish.cuisine.toLowerCase() === hint) score += 3;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = dish;
    }
  }

  // Fallback: if no match, pick a plausible default based on any keywords
  if (!bestMatch || bestScore === 0) {
    // Try partial word matching
    for (const dish of DISH_DATABASE) {
      const words = desc.split(/\s+/);
      for (const word of words) {
        if (word.length > 3 && dish.description.toLowerCase().includes(word)) {
          bestMatch = dish;
          bestScore = 1;
          break;
        }
      }
      if (bestMatch && bestScore > 0) break;
    }
  }

  if (!bestMatch) {
    return JSON.stringify({
      identified: false,
      message:
        "Could not identify the dish from the description. Try adding more details about ingredients or cooking style.",
    });
  }

  return JSON.stringify({
    identified: true,
    dish: bestMatch.name,
    cuisine: bestMatch.cuisine,
    keyIngredients: bestMatch.ingredients,
    description: bestMatch.description,
    confidence: bestScore >= 5 ? "high" : bestScore >= 2 ? "medium" : "low",
  });
}

function extractMenuItems(args: { menu_text: string; restaurant_type?: string }): string {
  // Simple price extraction: look for patterns like "Item Name ... $XX.XX" or "Item Name XX.XX"
  const lines = args.menu_text
    .split(/[,;\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const items: { name: string; price: string }[] = [];

  for (const line of lines) {
    const priceMatch = line.match(/\$?(\d+\.?\d{0,2})/);
    if (priceMatch) {
      const name = line
        .replace(/\$?\d+\.?\d{0,2}/, "")
        .replace(/[.\-–—]+$/, "")
        .trim();
      if (name) {
        items.push({ name, price: `$${priceMatch[1]}` });
      }
    }
  }

  if (items.length === 0) {
    return JSON.stringify({
      parsed: false,
      message:
        "Could not extract menu items. Try providing items with prices (e.g. 'Pasta $12.99, Salad $8.50').",
      restaurantType: args.restaurant_type ?? "unknown",
    });
  }

  return JSON.stringify({
    parsed: true,
    restaurantType: args.restaurant_type ?? "unknown",
    itemCount: items.length,
    items,
    total: `$${items.reduce((sum, i) => sum + parseFloat(i.price.replace("$", "")), 0).toFixed(2)}`,
  });
}

function getNutritionalInfo(args: { dish_name: string }): string {
  const key = args.dish_name.toLowerCase().trim();
  const info = NUTRITION_DATABASE[key];

  if (!info) {
    // Try partial match
    const partialKey = Object.keys(NUTRITION_DATABASE).find(
      (k) => k.includes(key) || key.includes(k),
    );
    if (partialKey) {
      return JSON.stringify(NUTRITION_DATABASE[partialKey]);
    }
    return JSON.stringify({
      found: false,
      message: `No nutritional data found for "${args.dish_name}". Try common dish names like "Spaghetti Carbonara" or "Pad Thai".`,
    });
  }

  return JSON.stringify(info);
}

function searchRecipes(args: { query: string; max_results?: string }): string {
  const query = args.query.toLowerCase();
  const maxResults = Math.min(parseInt(args.max_results ?? "3", 10), 5);

  // Score recipes by relevance
  const scored = RECIPE_DATABASE.map((recipe) => {
    let score = 0;
    if (recipe.name.toLowerCase().includes(query)) score += 5;
    if (recipe.cuisine.toLowerCase().includes(query)) score += 2;
    for (const ingredient of recipe.ingredients) {
      if (ingredient.toLowerCase().includes(query)) score += 1;
    }
    return { recipe, score };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  if (scored.length === 0) {
    return JSON.stringify({
      found: false,
      message: `No recipes found for "${args.query}". Try searching for a dish name or ingredient.`,
    });
  }

  return JSON.stringify({
    found: true,
    resultCount: scored.length,
    recipes: scored.map((r) => r.recipe),
  });
}

// ─── Tool Dispatcher ──────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "identify_dish":
      return identifyDish(args as Parameters<typeof identifyDish>[0]);
    case "extract_menu_items":
      return extractMenuItems(args as Parameters<typeof extractMenuItems>[0]);
    case "get_nutritional_info":
      return getNutritionalInfo(args as Parameters<typeof getNutritionalInfo>[0]);
    case "search_recipes":
      return searchRecipes(args as Parameters<typeof searchRecipes>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
