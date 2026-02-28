import { z } from "zod";
import type { ToolDefinition } from "../shared/types.js";

// ─── Agent Mode ──────────────────────────────────────────────────────────────

export type AgentMode = "validated" | "one-shot";

// ─── Menu Schema ─────────────────────────────────────────────────────────────
//
// Zod schema defining a valid restaurant menu configuration.
// This is the single source of truth: it drives runtime validation in the
// validate_menu tool and TypeScript types via z.infer.
//
// Deliberately constrained to surface common LLM generation errors:
//   - category enum: LLMs often invent categories like "snacks" or "sides"
//   - dietaryTags enum: LLMs frequently add invalid tags like "dairy-free" or "organic"
//   - price 0.50-500: LLMs may use 0 or unreasonable values
//   - items min(1) max(20) per category: prevents empty or bloated categories
//   - prepTime 1-180: LLMs may skip this or use unreasonable values

const VALID_CATEGORIES = ["appetizers", "mains", "desserts", "drinks"] as const;
const VALID_DIETARY_TAGS = ["vegetarian", "vegan", "gluten-free", "nut-free", "spicy"] as const;

const MenuItemSchema = z.object({
  name: z.string().min(1, "Item name is required"),
  description: z.string().min(1, "Item description is required"),
  price: z.number().min(0.5).max(500),
  dietaryTags: z.array(z.enum(VALID_DIETARY_TAGS)),
  prepTime: z.number().int().min(1).max(180),
});

const MenuCategorySchema = z.object({
  category: z.enum(VALID_CATEGORIES),
  items: z.array(MenuItemSchema).min(1).max(20),
});

export const MenuSchema = z.object({
  restaurantName: z.string().min(1, "Restaurant name is required"),
  cuisine: z.string().min(1, "Cuisine type is required"),
  categories: z.array(MenuCategorySchema).min(1).max(4),
  currency: z.enum(["USD", "EUR", "GBP"]),
  lastUpdated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
});

export type Menu = z.infer<typeof MenuSchema>;

// ─── Mock Data ───────────────────────────────────────────────────────────────

const SAMPLE_INGREDIENTS = [
  { name: "Organic Salmon", available: true, allergens: ["fish"] },
  { name: "Wagyu Beef", available: true, allergens: [] },
  { name: "Portobello Mushrooms", available: true, allergens: [] },
  { name: "Arborio Rice", available: true, allergens: [] },
  { name: "Dark Chocolate", available: true, allergens: ["dairy"] },
  { name: "Fresh Pasta", available: true, allergens: ["gluten"] },
  { name: "Tofu", available: true, allergens: ["soy"] },
  { name: "Seasonal Vegetables", available: true, allergens: [] },
  { name: "Truffle Oil", available: false, allergens: [] },
  { name: "Lobster", available: true, allergens: ["shellfish"] },
];

const EXISTING_MENUS = [
  {
    name: "Lunch Special",
    categories: ["appetizers", "mains"],
    itemCount: 8,
    lastUpdated: "2026-02-15",
  },
  {
    name: "Dinner Menu",
    categories: ["appetizers", "mains", "desserts", "drinks"],
    itemCount: 24,
    lastUpdated: "2026-02-20",
  },
  {
    name: "Brunch Menu",
    categories: ["mains", "drinks"],
    itemCount: 10,
    lastUpdated: "2026-02-01",
  },
];

// ─── Tool Definitions ────────────────────────────────────────────────────────

const listIngredientsTool: ToolDefinition = {
  type: "function",
  function: {
    name: "list_ingredients",
    description:
      "List all available ingredients with their allergen information and availability status.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const listExistingMenusTool: ToolDefinition = {
  type: "function",
  function: {
    name: "list_existing_menus",
    description: "List all existing restaurant menus with their categories and item counts.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const validateMenuTool: ToolDefinition = {
  type: "function",
  function: {
    name: "validate_menu",
    description: `Validate a restaurant menu configuration JSON string against the schema.
Returns { valid: true } on success, or { valid: false, errors: [...] } with specific error details on failure.

IMPORTANT: You MUST call this tool to validate your menu configuration BEFORE delivering it to the user. If validation fails, fix the errors and re-validate until it passes.

The menu schema requires:
- restaurantName: non-empty string
- cuisine: non-empty string (e.g. "Italian", "Japanese", "American")
- categories: array of 1-4 category objects, each with:
  - category: one of "appetizers", "mains", "desserts", "drinks"
  - items: array of 1-20 items, each with:
    - name: non-empty string
    - description: non-empty string
    - price: number between 0.50 and 500
    - dietaryTags: array of tags, each one of "vegetarian", "vegan", "gluten-free", "nut-free", "spicy"
    - prepTime: integer between 1 and 180 (minutes)
- currency: one of "USD", "EUR", "GBP"
- lastUpdated: date string in YYYY-MM-DD format

When calling validate_menu, pass the complete menu JSON as a string in the menu_json parameter.`,
    parameters: {
      type: "object",
      properties: {
        menu_json: {
          type: "string",
          description: "The menu configuration as a JSON string to validate",
        },
      },
      required: ["menu_json"],
    },
  },
};

// ─── Tool Implementations ────────────────────────────────────────────────────

function listIngredients(): string {
  return JSON.stringify({
    ingredients: SAMPLE_INGREDIENTS,
    total: SAMPLE_INGREDIENTS.length,
    note: "Use these ingredients as inspiration for menu items. Check allergens for dietary tag accuracy.",
  });
}

function listExistingMenus(): string {
  return JSON.stringify({
    menus: EXISTING_MENUS,
    total: EXISTING_MENUS.length,
    note: "Existing menus for reference. Valid categories: appetizers, mains, desserts, drinks.",
  });
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  menu?: Menu;
}

function validateMenu(args: { menu_json: string }): string {
  // Layer 1: JSON syntax validation
  let parsed: unknown;
  try {
    parsed = JSON.parse(args.menu_json);
  } catch (e) {
    const error = e as SyntaxError;
    return JSON.stringify({
      valid: false,
      errors: [`JSON parse error: ${error.message}`],
    } satisfies ValidationResult);
  }

  // Layer 2: Schema validation via Zod
  const result = MenuSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
    );
    return JSON.stringify({
      valid: false,
      errors,
    } satisfies ValidationResult);
  }

  // Layer 3: Semantic validation (beyond what Zod can express)
  const semanticErrors: string[] = [];

  // Check for duplicate category names
  const categoryNames = result.data.categories.map((c) => c.category);
  const uniqueCategories = new Set(categoryNames);
  if (uniqueCategories.size !== categoryNames.length) {
    semanticErrors.push(
      `categories: duplicate category found. Each category can only appear once.`,
    );
  }

  // Check for duplicate item names within a category
  for (let i = 0; i < result.data.categories.length; i++) {
    const cat = result.data.categories[i];
    const itemNames = cat.items.map((item) => item.name.toLowerCase());
    const uniqueItems = new Set(itemNames);
    if (uniqueItems.size !== itemNames.length) {
      semanticErrors.push(
        `categories.${i}.items: duplicate item names found in "${cat.category}" category.`,
      );
    }

    // Check that vegan items don't have non-vegan descriptions
    for (let j = 0; j < cat.items.length; j++) {
      const item = cat.items[j];
      if (item.dietaryTags.includes("vegan") && item.dietaryTags.includes("spicy")) {
        // This is fine, just a valid combination
      }
      // Check price reasonability for drinks vs mains
      if (cat.category === "drinks" && item.price > 50) {
        semanticErrors.push(
          `categories.${i}.items.${j}: drink "${item.name}" has price $${item.price}, which exceeds the $50 limit for drinks.`,
        );
      }
    }
  }

  if (semanticErrors.length > 0) {
    return JSON.stringify({
      valid: false,
      errors: semanticErrors,
    } satisfies ValidationResult);
  }

  return JSON.stringify({
    valid: true,
    menu: result.data,
  } satisfies ValidationResult);
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "list_ingredients":
      return listIngredients();
    case "list_existing_menus":
      return listExistingMenus();
    case "validate_menu":
      return validateMenu(args as { menu_json: string });
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ─── Build Tools For Mode ────────────────────────────────────────────────────

export function buildTools(mode: AgentMode): ToolDefinition[] {
  if (mode === "validated") {
    return [listIngredientsTool, listExistingMenusTool, validateMenuTool];
  }
  // one-shot: no validate tool
  return [listIngredientsTool, listExistingMenusTool];
}
