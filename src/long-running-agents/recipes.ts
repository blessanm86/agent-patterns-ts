// ─── Recipe Data — Old Format + Target Schema ──────────────────────────────
//
// 20 messy "old format" recipe records (free-text descriptions, inconsistent
// units, embedded ingredients) that the migration pipeline transforms into
// clean structured records.

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OldRecipe {
  id: string;
  name: string;
  description: string; // free-text with embedded ingredients, times, etc.
  category: string; // inconsistent: "main", "Main Course", "APPETIZER", etc.
  servings: string; // "4", "serves 6-8", "2 people", etc.
  time: string; // "30 min", "1 hour 15 minutes", "about 45m", etc.
}

export interface Ingredient {
  name: string;
  amount: number;
  unit: string; // normalized: "g", "ml", "tsp", "tbsp", "cup", "piece"
}

export type RecipeCategory = "appetizer" | "main" | "side" | "dessert" | "beverage";

export interface NewRecipe {
  id: string;
  name: string;
  category: RecipeCategory;
  servings: number;
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  totalTimeMinutes: number;
  ingredients: Ingredient[];
  steps: string[];
}

export interface MigrationResult {
  recipeId: string;
  recipeName: string;
  status: "success" | "failed" | "skipped";
  error?: string;
  durationMs: number;
}

// ─── Old Recipe Data ────────────────────────────────────────────────────────

export const OLD_RECIPES: OldRecipe[] = [
  {
    id: "recipe-001",
    name: "Spaghetti Carbonara",
    description:
      "Classic Roman pasta. Cook 400g spaghetti until al dente. Fry 200g guanciale (or pancetta) until crispy. Mix 4 egg yolks with 100g pecorino romano and black pepper. Toss hot pasta with guanciale, remove from heat, stir in egg mixture quickly. The residual heat cooks the eggs into a creamy sauce. Garnish with extra pecorino.",
    category: "Main Course",
    servings: "4",
    time: "25 minutes",
  },
  {
    id: "recipe-002",
    name: "Caesar Salad",
    description:
      "Tear 2 heads of romaine lettuce into pieces. For the dressing: blend 2 anchovy fillets, 1 clove garlic, juice of 1 lemon (about 30ml), 1 tsp Dijon mustard, 60ml olive oil, and 50g parmesan. Toss lettuce with dressing. Make croutons by cubing 3 slices bread and toasting with 2 tbsp olive oil. Top with croutons and shaved parmesan.",
    category: "appetizer",
    servings: "serves 4",
    time: "15 min",
  },
  {
    id: "recipe-003",
    name: "Banana Bread",
    description:
      "Mash 3 very ripe bananas. Mix with 75g melted butter, 150g sugar, 1 egg, 1 tsp vanilla extract. Fold in 190g all-purpose flour, 1 tsp baking soda, pinch of salt. Pour into greased loaf pan. Bake at 175C for about 60 minutes until toothpick comes out clean. Cool for 10 mins before slicing. Optional: add 100g walnuts or chocolate chips.",
    category: "DESSERT",
    servings: "8 slices",
    time: "1 hour 15 minutes",
  },
  {
    id: "recipe-004",
    name: "Chicken Tikka Masala",
    description:
      "Marinate 600g chicken thighs in 200ml yogurt, 2 tsp garam masala, 1 tsp turmeric, 1 tsp cumin, salt for at least 1 hour. Grill or bake chicken until charred. For sauce: sauté 1 diced onion in 2 tbsp oil, add 3 minced garlic cloves, 1 tbsp grated ginger, 2 tsp garam masala, 1 tsp paprika. Add 400g canned tomatoes and 200ml cream. Simmer 20 min. Add chicken pieces, cook 10 more minutes. Serve with basmati rice and naan.",
    category: "main",
    servings: "4 people",
    time: "about 1 hour plus marinating",
  },
  {
    id: "recipe-005",
    name: "Guacamole",
    description:
      "Halve and pit 3 ripe avocados, scoop into bowl, mash with fork leaving some chunks. Mix in 1/2 diced red onion, 1 diced tomato, 1 minced jalapeño (seeds removed for less heat), juice of 2 limes (about 30ml), handful of fresh cilantro chopped, salt to taste. Serve immediately with tortilla chips. Best eaten fresh — oxidizes within a couple hours.",
    category: "Appetizer",
    servings: "6",
    time: "10 min",
  },
  {
    id: "recipe-006",
    name: "Beef Stew",
    description:
      "Cut 800g beef chuck into 3cm cubes, season with salt and pepper. Brown in batches in 2 tbsp oil in a Dutch oven. Remove beef, sauté 2 diced onions, 3 diced carrots, 3 diced celery stalks until soft (about 8 min). Add 3 minced garlic cloves, 2 tbsp tomato paste, cook 1 min. Deglaze with 250ml red wine. Return beef, add 500ml beef stock, 2 bay leaves, 1 tsp thyme. Cover and simmer 2 hours. Add 500g cubed potatoes, cook 30 min more. Season to taste.",
    category: "Main",
    servings: "6",
    time: "3 hours",
  },
  {
    id: "recipe-007",
    name: "Mango Lassi",
    description:
      "Blend together 2 ripe mangoes (about 400g flesh), 400ml plain yogurt, 200ml cold milk, 3 tbsp sugar (or honey), pinch of cardamom. Blend until smooth and frothy. Pour over ice. Garnish with a sprinkle of ground cardamom or pistachios. Can substitute frozen mango chunks if fresh not available.",
    category: "Beverage",
    servings: "4 glasses",
    time: "5 minutes",
  },
  {
    id: "recipe-008",
    name: "Garlic Roasted Broccoli",
    description:
      "Cut 500g broccoli into florets. Toss with 3 tbsp olive oil, 4 minced garlic cloves, salt, pepper, and pinch of red pepper flakes. Spread on baking sheet in single layer. Roast at 220C for 20-25 minutes until edges are crispy and slightly charred. Squeeze half a lemon over top before serving. Optional: sprinkle with 30g parmesan.",
    category: "Side dish",
    servings: "4",
    time: "30 min",
  },
  {
    id: "recipe-009",
    name: "Chocolate Mousse",
    description:
      "Melt 200g dark chocolate (70% cocoa) in a double boiler. Let cool slightly. Separate 4 eggs. Whisk yolks with 50g sugar until pale. Fold melted chocolate into yolk mixture. Whip egg whites to stiff peaks with a pinch of salt. Gently fold whites into chocolate mixture in 3 additions — don't deflate! Pour into ramekins, refrigerate at least 4 hours or overnight. Serve with whipped cream.",
    category: "dessert",
    servings: "6 ramekins",
    time: "30 min plus 4 hours chilling",
  },
  {
    id: "recipe-010",
    name: "Thai Green Curry",
    description:
      "Heat 2 tbsp coconut oil in a wok. Fry 3 tbsp green curry paste for 1 minute. Add 400ml coconut milk, stir well. Add 500g sliced chicken breast, 1 diced eggplant, 100g bamboo shoots, handful of Thai basil. Simmer 15 minutes. Season with 2 tbsp fish sauce, 1 tbsp palm sugar, juice of 1 lime. Add 100g snow peas, cook 2 more minutes. Serve over jasmine rice.",
    category: "main course",
    servings: "4",
    time: "30 minutes",
  },
  {
    id: "recipe-011",
    name: "Bruschetta",
    description:
      "Dice 4 ripe tomatoes, mix with 1/4 cup fresh basil (chiffonade), 2 minced garlic cloves, 2 tbsp extra virgin olive oil, 1 tbsp balsamic vinegar, salt and pepper. Let marinate 15 minutes. Slice 1 baguette diagonally into 12 pieces, brush with olive oil, grill or toast until golden. Rub warm bread with a cut garlic clove. Spoon tomato mixture on top. Serve immediately.",
    category: "APPETIZER",
    servings: "12 pieces / serves 4-6",
    time: "20 min",
  },
  {
    id: "recipe-012",
    name: "Lemon Herb Rice",
    description:
      "Rinse 300g basmati rice until water runs clear. In a pot, heat 1 tbsp butter, sauté 1 minced shallot for 2 min. Add rice, stir 1 min. Add 500ml chicken stock, zest of 1 lemon, salt. Bring to boil, cover, reduce heat, simmer 15 minutes. Remove from heat, let stand 5 min. Fluff with fork, stir in juice of 1 lemon, 2 tbsp chopped parsley, 1 tbsp chopped dill.",
    category: "Side",
    servings: "4",
    time: "25 minutes",
  },
  {
    id: "recipe-013",
    name: "Tiramisu",
    description:
      "Separate 6 eggs. Beat yolks with 150g sugar until thick and pale. Add 500g mascarpone, mix until smooth. Whip whites to stiff peaks, fold into mascarpone mixture. Brew 300ml strong espresso, let cool, add 2 tbsp Marsala wine. Briefly dip 300g ladyfinger biscuits in coffee — don't soak! Layer in dish: biscuits, cream, biscuits, cream. Dust top with 2 tbsp cocoa powder. Refrigerate 6 hours minimum, overnight is better.",
    category: "Dessert",
    servings: "8",
    time: "45 min plus 6 hours chilling",
  },
  {
    id: "recipe-014",
    name: "Fish Tacos",
    description:
      "Season 500g white fish fillets (cod or mahi-mahi) with 1 tsp cumin, 1 tsp chili powder, salt, pepper. Grill or pan-fry 3-4 min per side. Make slaw: shred 1/4 cabbage, mix with 1 diced mango, 1/4 cup cilantro, juice of 2 limes. Make crema: mix 120ml sour cream with 1 tsp chipotle, juice of 1 lime. Warm 8 small corn tortillas. Assemble: tortilla, fish, slaw, crema drizzle.",
    category: "Main",
    servings: "4 (2 tacos each)",
    time: "25 min",
  },
  {
    id: "recipe-015",
    name: "Iced Matcha Latte",
    description:
      "Sift 2 tsp matcha powder into a bowl to remove lumps. Add 2 tbsp hot water (not boiling — about 80C). Whisk vigorously with a bamboo whisk or small regular whisk until smooth and frothy with no clumps. Pour 250ml cold milk of choice into a glass with ice. Pour matcha concentrate over milk. Sweeten with 1-2 tsp honey or simple syrup if desired. Stir gently.",
    category: "beverage",
    servings: "1",
    time: "5 min",
  },
  {
    id: "recipe-016",
    name: "Stuffed Bell Peppers",
    description:
      "Cut tops off 4 bell peppers, remove seeds. Cook 200g rice according to package directions. Brown 400g ground beef with 1 diced onion and 2 minced garlic cloves. Mix beef with rice, 200g canned diced tomatoes, 100g shredded cheese, 1 tsp oregano, salt, pepper. Stuff peppers with mixture, place in baking dish. Pour remaining tomato sauce around peppers. Top with more cheese. Bake at 190C for 35 minutes until peppers are tender.",
    category: "Main Course",
    servings: "4",
    time: "1 hour",
  },
  {
    id: "recipe-017",
    name: "Coleslaw",
    description:
      "Shred 1/2 green cabbage and 1/4 red cabbage. Grate 2 carrots. Mix dressing: 120ml mayonnaise, 2 tbsp apple cider vinegar, 1 tbsp sugar, 1/2 tsp celery seed, salt and pepper. Toss vegetables with dressing. Refrigerate at least 30 minutes before serving — tastes even better the next day. Good with BBQ, fish tacos, or pulled pork sandwiches.",
    category: "side",
    servings: "6-8",
    time: "15 min plus 30 min chilling",
  },
  {
    id: "recipe-018",
    name: "Hot Chocolate",
    description:
      "Heat 500ml whole milk in a saucepan over medium heat — don't let it boil. Chop 100g dark chocolate and add to warm milk. Stir constantly until chocolate is completely melted and smooth. Add 2 tbsp sugar (or to taste), 1/2 tsp vanilla extract, tiny pinch of salt. Whisk vigorously for 30 seconds to make it frothy. Pour into 2 mugs. Top with whipped cream and marshmallows. For a Mexican twist, add 1/4 tsp cinnamon and pinch of cayenne.",
    category: "Beverage",
    servings: "2 mugs",
    time: "10 minutes",
  },
  {
    id: "recipe-019",
    name: "Caprese Skewers",
    description:
      "Thread onto small wooden skewers: 1 cherry tomato, 1 small fresh mozzarella ball (bocconcini), 1 fresh basil leaf. Repeat to make about 20 skewers. You'll need roughly 20 cherry tomatoes, 20 mozzarella balls (about 250g), and a large bunch of basil. Arrange on a platter. Drizzle with 3 tbsp extra virgin olive oil, 1 tbsp balsamic glaze, and a sprinkle of flaky sea salt and cracked black pepper.",
    category: "appetizer",
    servings: "20 skewers / serves 6-8",
    time: "15 min",
  },
  {
    id: "recipe-020",
    name: "Sweet Potato Fries",
    description:
      "Peel and cut 3 large sweet potatoes (about 900g total) into thin fries/sticks. Toss with 2 tbsp olive oil, 1 tsp smoked paprika, 1/2 tsp garlic powder, salt, and pepper. Spread in a single layer on 2 baking sheets — don't crowd or they'll steam instead of crisp. Bake at 220C for 25-30 minutes, flipping halfway. For dipping sauce: mix 60ml mayo with 1 tbsp sriracha and squeeze of lime.",
    category: "Side Dish",
    servings: "4",
    time: "40 min",
  },
];
