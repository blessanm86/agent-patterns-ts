// ─── Shared Mock Data ────────────────────────────────────────────────────────
//
// Both the MCP server (server.ts) and the static baseline (tools.ts) import
// from here. This keeps the focus on the protocol difference, not the data.

export interface Recipe {
  id: string;
  name: string;
  cuisine: string;
  prepTimeMinutes: number;
  servings: number;
  ingredients: string[];
  instructions: string[];
  tags: string[];
}

export const RECIPES: Recipe[] = [
  {
    id: "r1",
    name: "Spaghetti Carbonara",
    cuisine: "Italian",
    prepTimeMinutes: 25,
    servings: 4,
    ingredients: [
      "400g spaghetti",
      "200g guanciale",
      "4 egg yolks",
      "100g pecorino romano",
      "black pepper",
    ],
    instructions: [
      "Boil spaghetti in salted water until al dente",
      "Crisp guanciale in a pan over medium heat",
      "Whisk egg yolks with grated pecorino and pepper",
      "Toss hot pasta with guanciale, remove from heat, stir in egg mixture",
      "Serve immediately with extra pecorino",
    ],
    tags: ["pasta", "quick", "classic"],
  },
  {
    id: "r2",
    name: "Chicken Tikka Masala",
    cuisine: "Indian",
    prepTimeMinutes: 45,
    servings: 4,
    ingredients: [
      "500g chicken breast",
      "200ml yogurt",
      "2 tbsp tikka paste",
      "400g canned tomatoes",
      "200ml cream",
      "1 onion",
      "3 garlic cloves",
    ],
    instructions: [
      "Marinate chicken in yogurt and tikka paste for 30 minutes",
      "Grill or pan-fry chicken until charred",
      "Saut\u00E9 onion and garlic, add tomatoes, simmer 15 minutes",
      "Stir in cream and cooked chicken, simmer 10 minutes",
      "Serve with basmati rice or naan",
    ],
    tags: ["curry", "spicy", "popular"],
  },
  {
    id: "r3",
    name: "Tacos al Pastor",
    cuisine: "Mexican",
    prepTimeMinutes: 40,
    servings: 6,
    ingredients: [
      "500g pork shoulder",
      "3 dried guajillo chiles",
      "1 cup pineapple chunks",
      "corn tortillas",
      "white onion",
      "cilantro",
      "lime",
    ],
    instructions: [
      "Toast and rehydrate guajillo chiles, blend into a paste",
      "Marinate sliced pork in chile paste for 1 hour",
      "Cook pork on high heat with pineapple until charred",
      "Warm tortillas and assemble with pork, onion, cilantro",
      "Squeeze lime over tacos and serve",
    ],
    tags: ["street-food", "pork", "spicy"],
  },
  {
    id: "r4",
    name: "Miso Ramen",
    cuisine: "Japanese",
    prepTimeMinutes: 35,
    servings: 2,
    ingredients: [
      "2 packs ramen noodles",
      "3 tbsp white miso paste",
      "800ml dashi stock",
      "2 soft-boiled eggs",
      "100g chashu pork",
      "nori sheets",
      "green onions",
    ],
    instructions: [
      "Heat dashi stock, whisk in miso paste (don't boil)",
      "Cook ramen noodles according to package",
      "Slice chashu pork and halve soft-boiled eggs",
      "Divide noodles between bowls, ladle broth over",
      "Top with pork, egg, nori, and sliced green onions",
    ],
    tags: ["soup", "noodles", "comfort"],
  },
  {
    id: "r5",
    name: "Classic Cheeseburger",
    cuisine: "American",
    prepTimeMinutes: 20,
    servings: 4,
    ingredients: [
      "500g ground beef",
      "4 burger buns",
      "4 slices cheddar",
      "lettuce",
      "tomato",
      "onion",
      "pickles",
      "ketchup",
      "mustard",
    ],
    instructions: [
      "Form beef into 4 patties, season with salt and pepper",
      "Grill or pan-fry patties 4 minutes per side",
      "Add cheese in the last minute, cover to melt",
      "Toast buns lightly on the grill",
      "Assemble with lettuce, tomato, onion, pickles, and sauces",
    ],
    tags: ["grilled", "quick", "classic"],
  },
  {
    id: "r6",
    name: "Margherita Pizza",
    cuisine: "Italian",
    prepTimeMinutes: 30,
    servings: 2,
    ingredients: [
      "250g pizza dough",
      "100ml San Marzano tomato sauce",
      "200g fresh mozzarella",
      "fresh basil",
      "olive oil",
      "salt",
    ],
    instructions: [
      "Preheat oven to 250\u00B0C (480\u00B0F) with a pizza stone",
      "Stretch dough into a thin round",
      "Spread tomato sauce, leaving a border for crust",
      "Tear mozzarella over the pizza",
      "Bake 8-10 minutes until crust is golden and cheese bubbles",
      "Top with fresh basil and a drizzle of olive oil",
    ],
    tags: ["pizza", "vegetarian", "classic"],
  },
  {
    id: "r7",
    name: "Pad Thai",
    cuisine: "Thai",
    prepTimeMinutes: 25,
    servings: 2,
    ingredients: [
      "200g rice noodles",
      "200g shrimp",
      "2 eggs",
      "100g bean sprouts",
      "3 tbsp fish sauce",
      "2 tbsp tamarind paste",
      "1 tbsp sugar",
      "peanuts",
      "lime",
    ],
    instructions: [
      "Soak rice noodles in warm water for 20 minutes, drain",
      "Mix fish sauce, tamarind paste, and sugar for the sauce",
      "Stir-fry shrimp until pink, push to the side, scramble eggs",
      "Add noodles and sauce, toss everything together",
      "Serve topped with bean sprouts, crushed peanuts, and lime",
    ],
    tags: ["noodles", "seafood", "quick"],
  },
  {
    id: "r8",
    name: "Guacamole",
    cuisine: "Mexican",
    prepTimeMinutes: 10,
    servings: 4,
    ingredients: [
      "3 ripe avocados",
      "1 lime",
      "half red onion",
      "1 jalape\u00F1o",
      "cilantro",
      "salt",
      "1 tomato",
    ],
    instructions: [
      "Halve avocados, remove pits, scoop into a bowl",
      "Mash to desired consistency (chunky or smooth)",
      "Dice onion, jalape\u00F1o, tomato, and chop cilantro",
      "Mix in diced vegetables, squeeze lime juice, add salt",
      "Serve immediately with tortilla chips",
    ],
    tags: ["dip", "quick", "vegetarian"],
  },
];

// ─── Unit Conversions ──────────────────────────────────────────────────────────

export const CONVERSIONS: Record<string, Record<string, number>> = {
  cups: { ml: 236.588, tbsp: 16, tsp: 48, oz: 8 },
  ml: { cups: 1 / 236.588, tbsp: 1 / 14.787, tsp: 1 / 4.929, oz: 1 / 29.574 },
  tbsp: { tsp: 3, ml: 14.787, cups: 1 / 16, oz: 0.5 },
  tsp: { tbsp: 1 / 3, ml: 4.929, cups: 1 / 48, oz: 1 / 6 },
  oz: { g: 28.3495, ml: 29.574, cups: 1 / 8, tbsp: 2 },
  g: { oz: 1 / 28.3495, kg: 1 / 1000 },
  kg: { g: 1000, oz: 35.274 },
  fahrenheit: { celsius: -1 }, // special case — handled in convertUnits
  celsius: { fahrenheit: -1 }, // special case
};

// ─── Pure Functions ────────────────────────────────────────────────────────────

export function searchRecipes(query: string, cuisine?: string): string {
  let results = RECIPES;

  if (cuisine) {
    results = results.filter((r) => r.cuisine.toLowerCase() === cuisine.toLowerCase());
  }

  const q = query.toLowerCase();
  results = results.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.tags.some((t) => t.toLowerCase().includes(q)) ||
      r.ingredients.some((i) => i.toLowerCase().includes(q)) ||
      r.cuisine.toLowerCase().includes(q),
  );

  if (results.length === 0) {
    return JSON.stringify({ results: [], message: "No recipes found matching your query" });
  }

  return JSON.stringify({
    results: results.map((r) => ({
      id: r.id,
      name: r.name,
      cuisine: r.cuisine,
      prepTimeMinutes: r.prepTimeMinutes,
      servings: r.servings,
      tags: r.tags,
    })),
  });
}

export function getRecipe(id: string): string {
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) {
    return JSON.stringify({ error: `Recipe not found: ${id}` });
  }
  return JSON.stringify(recipe);
}

export function convertUnits(value: number, fromUnit: string, toUnit: string): string {
  const from = fromUnit.toLowerCase();
  const to = toUnit.toLowerCase();

  // Special case: temperature
  if (from === "fahrenheit" && to === "celsius") {
    const result = ((value - 32) * 5) / 9;
    return JSON.stringify({
      value,
      from: fromUnit,
      to: toUnit,
      result: Math.round(result * 100) / 100,
    });
  }
  if (from === "celsius" && to === "fahrenheit") {
    const result = (value * 9) / 5 + 32;
    return JSON.stringify({
      value,
      from: fromUnit,
      to: toUnit,
      result: Math.round(result * 100) / 100,
    });
  }

  const conversionTable = CONVERSIONS[from];
  if (!conversionTable) {
    return JSON.stringify({ error: `Unknown unit: ${fromUnit}` });
  }

  const factor = conversionTable[to];
  if (!factor || factor === -1) {
    return JSON.stringify({ error: `Cannot convert from ${fromUnit} to ${toUnit}` });
  }

  const result = value * factor;
  return JSON.stringify({
    value,
    from: fromUnit,
    to: toUnit,
    result: Math.round(result * 100) / 100,
  });
}
