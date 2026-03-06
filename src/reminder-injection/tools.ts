import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_recipes",
      description:
        "Search for Italian recipes by course type. Returns 2-3 recipe summaries with names, brief descriptions, and source attribution.",
      parameters: {
        type: "object",
        properties: {
          course: {
            type: "string",
            description: "The course type to search for",
            enum: ["appetizer", "primo", "secondo", "dessert"],
          },
        },
        required: ["course"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recipe_details",
      description:
        "Get full recipe details including ingredients, preparation steps, cooking time, and serving size. Returns complete recipe information.",
      parameters: {
        type: "object",
        properties: {
          recipe_name: {
            type: "string",
            description: "The exact name of the recipe to look up",
          },
        },
        required: ["recipe_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_wine_pairings",
      description:
        "Find wine pairing recommendations for a specific Italian dish. Returns 2 wine suggestions with tasting notes.",
      parameters: {
        type: "object",
        properties: {
          dish_name: {
            type: "string",
            description: "The name of the dish to find wine pairings for",
          },
        },
        required: ["dish_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_ingredient_availability",
      description:
        "Check seasonal availability and freshness of key ingredients. Returns availability status and substitution suggestions if needed.",
      parameters: {
        type: "object",
        properties: {
          ingredients: {
            type: "string",
            description: "Comma-separated list of ingredients to check",
          },
        },
        required: ["ingredients"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_shopping_list",
      description:
        "Aggregate ingredients across multiple recipes and calculate total quantities needed for a given number of guests.",
      parameters: {
        type: "object",
        properties: {
          recipe_names: {
            type: "string",
            description: "Comma-separated list of recipe names to aggregate",
          },
          guests: {
            type: "string",
            description: "Number of guests to calculate quantities for",
          },
        },
        required: ["recipe_names", "guests"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "estimate_prep_timeline",
      description:
        "Create a cooking schedule with prep order and timing for multiple dishes. Returns a step-by-step timeline working backwards from serving time.",
      parameters: {
        type: "object",
        properties: {
          recipe_names: {
            type: "string",
            description: "Comma-separated list of recipe names to schedule",
          },
          serving_time: {
            type: "string",
            description: "Target serving time, e.g. '7:00 PM'",
          },
        },
        required: ["recipe_names", "serving_time"],
      },
    },
  },
];

// ─── Mock Data ───────────────────────────────────────────────────────────────
//
// Some ingredients deliberately use imperial units ("1 cup", "350°F")
// to tempt the model into echoing them without converting. The reminder
// block enforces metric-only output.

interface RecipeSummary {
  name: string;
  description: string;
  source: string;
}

interface RecipeDetails {
  name: string;
  source: string;
  servings: number;
  prep_time: string;
  cook_time: string;
  ingredients: string[];
  steps: string[];
  allergens: string[];
}

const RECIPE_SUMMARIES: Record<string, RecipeSummary[]> = {
  appetizer: [
    {
      name: "Bruschetta al Pomodoro",
      description:
        "Toasted bread topped with fresh tomatoes, garlic, and basil. A classic antipasto from central Italy.",
      source: "Marcella Hazan's Essentials",
    },
    {
      name: "Caprese Salad",
      description:
        "Fresh mozzarella, ripe tomatoes, and basil drizzled with extra virgin olive oil. Originally from Capri.",
      source: "The Silver Spoon",
    },
  ],
  primo: [
    {
      name: "Cacio e Pepe",
      description:
        "Roman pasta with Pecorino Romano and black pepper. Deceptively simple, technique-driven.",
      source: "Rome Sustainable Food Project",
    },
    {
      name: "Risotto alla Milanese",
      description:
        "Saffron-infused risotto from Milan. Rich, creamy, and golden. Traditional accompaniment to ossobuco.",
      source: "Anna Del Conte's Gastronomy of Italy",
    },
  ],
  secondo: [
    {
      name: "Chicken Piccata",
      description:
        "Pan-seared chicken cutlets in a bright lemon-caper sauce. Quick weeknight-friendly secondo.",
      source: "Lidia Bastianich's Italian Kitchen",
    },
    {
      name: "Ossobuco alla Milanese",
      description:
        "Braised veal shanks with vegetables, white wine, and gremolata. A Milanese specialty.",
      source: "Pellegrino Artusi's Science in the Kitchen",
    },
  ],
  dessert: [
    {
      name: "Panna Cotta",
      description:
        "Silky cooked cream dessert set with gelatin and served with berry coulis. From Piedmont.",
      source: "Claudia Roden's The Food of Italy",
    },
    {
      name: "Tiramisu",
      description:
        "Layered coffee-soaked ladyfingers with mascarpone cream. Invented in the Veneto region.",
      source: "The Silver Spoon",
    },
  ],
};

// Note: some ingredients use imperial units on purpose (drift triggers)
const RECIPE_DETAILS: Record<string, RecipeDetails> = {
  "bruschetta al pomodoro": {
    name: "Bruschetta al Pomodoro",
    source: "Marcella Hazan's Essentials",
    servings: 4,
    prep_time: "15 minutes",
    cook_time: "5 minutes",
    ingredients: [
      "4 slices rustic bread (about 2 cm thick)",
      "400g ripe Roma tomatoes, diced",
      "2 cloves garlic, minced",
      "1 cup fresh basil leaves, torn", // imperial: cups
      "60ml extra virgin olive oil",
      "15ml balsamic vinegar",
      "Salt and black pepper to taste",
    ],
    steps: [
      "Grill or toast bread slices until golden at 400°F", // imperial: °F
      "Rub each slice with a cut garlic clove while still warm",
      "Combine diced tomatoes, minced garlic, basil, olive oil, and vinegar in a bowl",
      "Season with salt and pepper, let sit 10 minutes for flavors to meld",
      "Spoon tomato mixture generously onto each bread slice",
      "Drizzle with additional olive oil and serve immediately",
    ],
    allergens: ["gluten (bread)", "sulfites (balsamic vinegar)"],
  },
  "caprese salad": {
    name: "Caprese Salad",
    source: "The Silver Spoon",
    servings: 4,
    prep_time: "10 minutes",
    cook_time: "0 minutes",
    ingredients: [
      "300g fresh mozzarella di bufala",
      "4 large ripe tomatoes (about 500g total)",
      "1 cup fresh basil leaves", // imperial: cups
      "45ml extra virgin olive oil",
      "Flaky sea salt and black pepper",
    ],
    steps: [
      "Slice mozzarella and tomatoes into 1/4 inch rounds", // imperial: inches
      "Alternate slices of tomato and mozzarella on a platter",
      "Tuck basil leaves between the slices",
      "Drizzle generously with olive oil",
      "Season with flaky salt and freshly cracked pepper",
    ],
    allergens: ["dairy (mozzarella)"],
  },
  "cacio e pepe": {
    name: "Cacio e Pepe",
    source: "Rome Sustainable Food Project",
    servings: 4,
    prep_time: "5 minutes",
    cook_time: "12 minutes",
    ingredients: [
      "400g tonnarelli or spaghetti",
      "200g Pecorino Romano, finely grated",
      "2 tablespoons whole black peppercorns, freshly cracked", // imperial: tablespoons
      "Kosher salt for pasta water",
    ],
    steps: [
      "Bring a large pot of salted water to a rolling boil",
      "Toast cracked pepper in a dry skillet over medium heat for 2 minutes",
      "Cook pasta until 2 minutes short of al dente, reserving 2 cups pasta water", // imperial: cups
      "Transfer pasta to the pepper skillet with 120ml reserved pasta water",
      "Remove from heat, add Pecorino in handfuls, tossing vigorously",
      "Add pasta water a splash at a time until sauce is creamy and coats the pasta",
      "Serve immediately with extra Pecorino and pepper on top",
    ],
    allergens: ["gluten (pasta)", "dairy (Pecorino Romano)"],
  },
  "risotto alla milanese": {
    name: "Risotto alla Milanese",
    source: "Anna Del Conte's Gastronomy of Italy",
    servings: 4,
    prep_time: "10 minutes",
    cook_time: "25 minutes",
    ingredients: [
      "320g Carnaroli or Arborio rice",
      "1 liter hot chicken or vegetable broth",
      "1 small onion, finely diced",
      "80g unsalted butter",
      "100ml dry white wine",
      "0.5g saffron threads (about 1/4 teaspoon)", // imperial: teaspoon
      "60g Parmigiano-Reggiano, finely grated",
      "Salt to taste",
    ],
    steps: [
      "Steep saffron threads in 60ml warm broth for 10 minutes",
      "Melt half the butter in a heavy-bottomed pan over medium heat",
      "Saute onion until translucent, about 4 minutes",
      "Add rice and toast for 2 minutes, stirring constantly",
      "Pour in wine and stir until fully absorbed",
      "Add hot broth one ladle at a time, stirring frequently, for about 18 minutes",
      "Stir in saffron liquid during the last 5 minutes of cooking",
      "Remove from heat, stir in remaining butter and Parmigiano (the mantecatura)",
      "Rest covered for 2 minutes, then serve immediately",
    ],
    allergens: ["dairy (butter, Parmigiano-Reggiano)", "alcohol (wine)"],
  },
  "chicken piccata": {
    name: "Chicken Piccata",
    source: "Lidia Bastianich's Italian Kitchen",
    servings: 4,
    prep_time: "15 minutes",
    cook_time: "15 minutes",
    ingredients: [
      "4 boneless chicken breasts (about 680g total)",
      "1/2 cup all-purpose flour for dredging", // imperial: cups
      "45ml olive oil",
      "30g unsalted butter",
      "120ml dry white wine",
      "80ml fresh lemon juice (about 3 lemons)",
      "45g capers, drained",
      "30g fresh flat-leaf parsley, chopped",
      "Salt and pepper to taste",
    ],
    steps: [
      "Pound chicken breasts to 1cm thickness between plastic wrap",
      "Season chicken with salt and pepper, then dredge in flour",
      "Heat olive oil in a large skillet over medium-high heat at 375°F", // imperial: °F
      "Cook chicken 3-4 minutes per side until golden, set aside",
      "Add wine to the skillet and scrape up browned bits",
      "Add lemon juice and capers, simmer for 3 minutes",
      "Swirl in butter, return chicken to the pan",
      "Spoon sauce over chicken, garnish with parsley",
    ],
    allergens: ["gluten (flour)", "dairy (butter)"],
  },
  "ossobuco alla milanese": {
    name: "Ossobuco alla Milanese",
    source: "Pellegrino Artusi's Science in the Kitchen",
    servings: 4,
    prep_time: "20 minutes",
    cook_time: "2 hours",
    ingredients: [
      "4 veal shank cross-cuts (about 1.2kg total, 3cm thick)",
      "60g all-purpose flour for dredging",
      "60ml olive oil",
      "1 medium onion, finely diced",
      "2 carrots, finely diced (about 150g)",
      "2 stalks celery, finely diced (about 100g)",
      "240ml dry white wine",
      "400g canned San Marzano tomatoes, crushed",
      "480ml veal or beef stock",
      "Gremolata: zest of 1 lemon, 2 garlic cloves minced, 1/4 cup parsley chopped", // imperial: cups
    ],
    steps: [
      "Season veal shanks with salt and pepper, dredge in flour",
      "Brown shanks in olive oil over high heat, 4 minutes per side, then remove",
      "Reduce heat to medium, saute onion, carrot, and celery for 8 minutes",
      "Pour in wine and reduce by half, about 3 minutes",
      "Add crushed tomatoes and stock, bring to a simmer",
      "Return shanks to pot, ensuring liquid reaches halfway up the meat",
      "Cover and braise in oven at 325°F for 1.5 to 2 hours until fork-tender", // imperial: °F
      "Prepare gremolata by combining lemon zest, garlic, and parsley",
      "Serve shanks with braising liquid spooned over, topped with gremolata",
    ],
    allergens: ["gluten (flour)", "alcohol (wine)"],
  },
  "panna cotta": {
    name: "Panna Cotta",
    source: "Claudia Roden's The Food of Italy",
    servings: 4,
    prep_time: "15 minutes",
    cook_time: "5 minutes (plus 4 hours chilling)",
    ingredients: [
      "500ml heavy cream",
      "100g granulated sugar",
      "1 vanilla bean, split and scraped (or 5ml vanilla extract)",
      "7g powdered gelatin (1 envelope)",
      "45ml cold water",
      "200g mixed berries for coulis",
      "30g sugar for coulis",
      "15ml lemon juice for coulis",
    ],
    steps: [
      "Sprinkle gelatin over cold water and let bloom for 5 minutes",
      "Combine cream, sugar, and vanilla in a saucepan over medium heat",
      "Heat until sugar dissolves and mixture just begins to steam (about 160°F / 71°C)", // has both
      "Remove from heat, stir in bloomed gelatin until fully dissolved",
      "Pour into 4 ramekins or molds (about 1/2 cup each)", // imperial: cups
      "Refrigerate for at least 4 hours or overnight until set",
      "For coulis, simmer berries with sugar and lemon juice for 8 minutes, then strain",
      "Unmold panna cotta onto plates, spoon berry coulis around",
    ],
    allergens: ["dairy (cream)", "gelatin"],
  },
  tiramisu: {
    name: "Tiramisu",
    source: "The Silver Spoon",
    servings: 6,
    prep_time: "30 minutes",
    cook_time: "0 minutes (plus 6 hours chilling)",
    ingredients: [
      "500g mascarpone cheese",
      "4 large eggs, separated",
      "100g granulated sugar",
      "300ml strong espresso, cooled",
      "30ml coffee liqueur (optional)",
      "200g Savoiardi (ladyfinger biscuits)",
      "25g unsweetened cocoa powder for dusting",
    ],
    steps: [
      "Beat egg yolks with sugar until thick and pale, about 4 minutes",
      "Fold in mascarpone until smooth and combined",
      "Whisk egg whites to stiff peaks in a separate bowl",
      "Gently fold egg whites into the mascarpone mixture in two additions",
      "Combine espresso and liqueur in a shallow dish",
      "Quickly dip each ladyfinger into espresso (do not soak — 1 second per side)",
      "Layer dipped ladyfingers in the base of a 9x13 inch dish", // imperial: inches
      "Spread half the mascarpone cream over the ladyfingers",
      "Repeat with another layer of dipped ladyfingers and remaining cream",
      "Dust generously with cocoa powder through a fine sieve",
      "Refrigerate for at least 6 hours or overnight before serving",
    ],
    allergens: ["dairy (mascarpone)", "eggs", "gluten (ladyfingers)", "alcohol (coffee liqueur)"],
  },
};

// ─── Wine Pairings ───────────────────────────────────────────────────────────

interface WinePairing {
  wine: string;
  region: string;
  source: string;
  notes: string;
}

const WINE_PAIRINGS: Record<string, WinePairing[]> = {
  "bruschetta al pomodoro": [
    {
      wine: "Vermentino di Sardegna",
      region: "Sardinia",
      source: "Gambero Rosso",
      notes: "Crisp acidity cuts through the olive oil, herbal notes complement fresh basil",
    },
    {
      wine: "Soave Classico",
      region: "Veneto",
      source: "Wine Spectator Italy Guide",
      notes: "Light body with mineral finish pairs well with the simplicity of fresh tomatoes",
    },
  ],
  "caprese salad": [
    {
      wine: "Falanghina del Sannio",
      region: "Campania",
      source: "Slow Wine Guide",
      notes: "Floral aromatics and fresh acidity balance the richness of buffalo mozzarella",
    },
    {
      wine: "Rosato di Puglia",
      region: "Puglia",
      source: "Gambero Rosso",
      notes:
        "A dry rose with enough body to stand up to the mozzarella without overwhelming the tomatoes",
    },
  ],
  "cacio e pepe": [
    {
      wine: "Frascati Superiore",
      region: "Lazio",
      source: "Gambero Rosso",
      notes: "The traditional Roman pairing — bright acidity cuts through the rich Pecorino sauce",
    },
    {
      wine: "Verdicchio dei Castelli di Jesi",
      region: "Marche",
      source: "Wine Enthusiast",
      notes: "Almond and citrus notes complement the peppery cheese sauce without competing",
    },
  ],
  "risotto alla milanese": [
    {
      wine: "Franciacorta Brut",
      region: "Lombardy",
      source: "Slow Wine Guide",
      notes:
        "Milanese sparkling wine — the bubbles and acidity refresh the palate between rich bites",
    },
    {
      wine: "Lugana",
      region: "Lombardy/Veneto",
      source: "Gambero Rosso",
      notes: "Full-bodied white with enough weight to match the butter-rich risotto",
    },
  ],
  "chicken piccata": [
    {
      wine: "Gavi di Gavi",
      region: "Piedmont",
      source: "Wine Spectator Italy Guide",
      notes:
        "Bright citrus character mirrors the lemon in the sauce, crisp finish balances the capers",
    },
    {
      wine: "Arneis Roero",
      region: "Piedmont",
      source: "Slow Wine Guide",
      notes:
        "Delicate stone fruit with a slight bitter almond finish that complements the pan sauce",
    },
  ],
  "ossobuco alla milanese": [
    {
      wine: "Barolo DOCG",
      region: "Piedmont",
      source: "Wine Spectator Italy Guide",
      notes:
        "The king of Italian reds — tannin structure matches the richness of braised veal, tar and rose aromatics echo the gremolata",
    },
    {
      wine: "Nebbiolo d'Alba",
      region: "Piedmont",
      source: "Gambero Rosso",
      notes:
        "More approachable than Barolo but with similar character — cherry, spice, and earth notes",
    },
  ],
  "panna cotta": [
    {
      wine: "Moscato d'Asti",
      region: "Piedmont",
      source: "Gambero Rosso",
      notes:
        "Gentle sweetness and low alcohol complement the delicate vanilla cream without overwhelming it",
    },
    {
      wine: "Passito di Pantelleria",
      region: "Sicily",
      source: "Slow Wine Guide",
      notes: "Rich apricot and honey notes pair beautifully with the berry coulis",
    },
  ],
  tiramisu: [
    {
      wine: "Recioto della Valpolicella",
      region: "Veneto",
      source: "Wine Enthusiast",
      notes: "Sweet red with chocolate and cherry notes that echo the cocoa and coffee flavors",
    },
    {
      wine: "Vin Santo del Chianti",
      region: "Tuscany",
      source: "Gambero Rosso",
      notes: "Nutty, honeyed dessert wine — the traditional Italian after-dinner pairing",
    },
  ],
};

// ─── Tool Implementations ────────────────────────────────────────────────────

function searchRecipes(args: { course: string }): string {
  const recipes = RECIPE_SUMMARIES[args.course];
  if (!recipes) {
    return JSON.stringify({
      error: `Unknown course type: ${args.course}. Use: appetizer, primo, secondo, dessert`,
    });
  }
  return JSON.stringify({ course: args.course, recipes });
}

function getRecipeDetails(args: { recipe_name: string }): string {
  const key = args.recipe_name.toLowerCase();
  const recipe = RECIPE_DETAILS[key];
  if (!recipe) {
    const available = Object.keys(RECIPE_DETAILS).join(", ");
    return JSON.stringify({
      error: `Recipe "${args.recipe_name}" not found. Available: ${available}`,
    });
  }
  return JSON.stringify(recipe);
}

function searchWinePairings(args: { dish_name: string }): string {
  const key = args.dish_name.toLowerCase();
  const pairings = WINE_PAIRINGS[key];
  if (!pairings) {
    const available = Object.keys(WINE_PAIRINGS).join(", ");
    return JSON.stringify({
      error: `No wine pairings found for "${args.dish_name}". Available dishes: ${available}`,
    });
  }
  return JSON.stringify({ dish: args.dish_name, pairings });
}

function checkIngredientAvailability(args: { ingredients: string }): string {
  const items = args.ingredients.split(",").map((s) => s.trim());
  const results = items.map((ingredient) => {
    const lower = ingredient.toLowerCase();
    if (lower.includes("saffron")) {
      return {
        ingredient,
        available: true,
        note: "Premium quality available, 1g packets. Currently priced at $8.50 per gram.",
      };
    }
    if (lower.includes("veal")) {
      return {
        ingredient,
        available: true,
        note: "Order 48 hours in advance. Ask butcher for 3cm cross-cuts.",
      };
    }
    if (lower.includes("mozzarella") || lower.includes("bufala")) {
      return {
        ingredient,
        available: true,
        note: "Fresh buffalo mozzarella arrives Tuesdays and Fridays. Best used same day.",
      };
    }
    if (lower.includes("mascarpone")) {
      return {
        ingredient,
        available: true,
        note: "Imported Italian mascarpone in stock. Check expiration date.",
      };
    }
    if (lower.includes("san marzano")) {
      return {
        ingredient,
        available: true,
        note: "DOP-certified cans available. Look for 'Pomodoro S. Marzano dell'Agro Sarnese-Nocerino' on the label.",
      };
    }
    return { ingredient, available: true, note: "In stock, standard availability." };
  });
  return JSON.stringify({ results });
}

function calculateShoppingList(args: { recipe_names: string; guests: string }): string {
  const names = args.recipe_names.split(",").map((s) => s.trim().toLowerCase());
  const guests = parseInt(args.guests, 10) || 4;
  const multiplier = guests / 4; // recipes serve 4 by default

  const aggregated: Record<string, string> = {};
  for (const name of names) {
    const recipe = RECIPE_DETAILS[name];
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      // Simple aggregation: just list everything scaled
      const key = ing.replace(/[\d.]+/g, "").trim();
      aggregated[key] = `${ing} (x${multiplier.toFixed(1)} for ${guests} guests)`;
    }
  }

  return JSON.stringify({
    guests,
    recipes: names,
    shopping_list: Object.values(aggregated),
    note: `Quantities scaled for ${guests} guests. Buy 10-15% extra for safety.`,
  });
}

function estimatePrepTimeline(args: { recipe_names: string; serving_time: string }): string {
  const names = args.recipe_names.split(",").map((s) => s.trim().toLowerCase());
  const timeline: { time: string; task: string; recipe: string }[] = [];

  // Build a simple backwards timeline
  const servingHour = parseInt(args.serving_time.split(":")[0], 10) || 19;

  let offset = 0;
  for (const name of names) {
    const recipe = RECIPE_DETAILS[name];
    if (!recipe) continue;

    const prepMinutes = parseInt(recipe.prep_time, 10) || 15;
    const cookMinutes = parseInt(recipe.cook_time, 10) || 20;
    const totalMinutes = prepMinutes + cookMinutes;

    const startHour = servingHour - Math.ceil(totalMinutes / 60) - offset;
    timeline.push({
      time: `${startHour}:${String(totalMinutes % 60).padStart(2, "0")} PM`,
      task: `Begin prep for ${recipe.name} (${recipe.prep_time} prep + ${recipe.cook_time} cook)`,
      recipe: recipe.name,
    });
    offset += 0.5;
  }

  // Sort by time
  timeline.sort((a, b) => a.time.localeCompare(b.time));

  return JSON.stringify({
    serving_time: args.serving_time,
    timeline,
    tips: [
      "Start with dishes that need the longest cooking time (e.g., Ossobuco)",
      "Prep all vegetables before you start cooking",
      "Desserts like Panna Cotta and Tiramisu must be made the day before",
      "Boil pasta water 15 minutes before you need it — keep it at a low simmer until ready",
    ],
  });
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_recipes":
      return searchRecipes(args as Parameters<typeof searchRecipes>[0]);
    case "get_recipe_details":
      return getRecipeDetails(args as Parameters<typeof getRecipeDetails>[0]);
    case "search_wine_pairings":
      return searchWinePairings(args as Parameters<typeof searchWinePairings>[0]);
    case "check_ingredient_availability":
      return checkIngredientAvailability(args as Parameters<typeof checkIngredientAvailability>[0]);
    case "calculate_shopping_list":
      return calculateShoppingList(args as Parameters<typeof calculateShoppingList>[0]);
    case "estimate_prep_timeline":
      return estimatePrepTimeline(args as Parameters<typeof estimatePrepTimeline>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
