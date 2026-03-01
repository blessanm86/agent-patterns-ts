import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search_restaurants",
      description:
        "Search for restaurants by cuisine type, neighborhood, and/or price range. Returns a list of matching restaurants with basic info.",
      parameters: {
        type: "object",
        properties: {
          cuisine: {
            type: "string",
            description: "Type of cuisine to search for",
            enum: [
              "italian",
              "thai",
              "japanese",
              "mexican",
              "indian",
              "american",
              "french",
              "chinese",
            ],
          },
          neighborhood: {
            type: "string",
            description: "Neighborhood to search in",
            enum: [
              "midtown",
              "downtown",
              "uptown",
              "west-village",
              "east-village",
              "soho",
              "tribeca",
              "chelsea",
            ],
          },
          price_range: {
            type: "string",
            description: "Price range: $ (under $15), $$ ($15-30), $$$ ($30-60), $$$$ (over $60)",
            enum: ["$", "$$", "$$$", "$$$$"],
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_restaurant_details",
      description:
        "Get detailed information about a specific restaurant including full menu highlights, hours, and dietary accommodations.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: {
            type: "string",
            description: "The unique restaurant identifier (e.g. 'r-001')",
          },
        },
        required: ["restaurant_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_reviews",
      description: "Get recent customer reviews for a specific restaurant.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: {
            type: "string",
            description: "The unique restaurant identifier (e.g. 'r-001')",
          },
        },
        required: ["restaurant_id"],
      },
    },
  },
];

// ─── Mock Data ───────────────────────────────────────────────────────────────

interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  neighborhood: string;
  priceRange: string;
  rating: number;
  dietaryOptions: string[];
  menuHighlights: string[];
  hours: string;
  address: string;
}

const RESTAURANTS: Restaurant[] = [
  {
    id: "r-001",
    name: "Basil & Vine",
    cuisine: "italian",
    neighborhood: "west-village",
    priceRange: "$$$",
    rating: 4.6,
    dietaryOptions: ["vegetarian", "vegan", "gluten-free"],
    menuHighlights: ["Truffle Mushroom Risotto", "Eggplant Parmigiana", "Tiramisu"],
    hours: "Mon-Sun 11:30am-10:30pm",
    address: "142 Bleecker St",
  },
  {
    id: "r-002",
    name: "Siam Garden",
    cuisine: "thai",
    neighborhood: "midtown",
    priceRange: "$$",
    rating: 4.4,
    dietaryOptions: ["vegetarian", "vegan"],
    menuHighlights: ["Pad Thai", "Green Curry", "Mango Sticky Rice", "Tom Kha Gai"],
    hours: "Mon-Sat 11am-10pm, Sun 12pm-9pm",
    address: "305 W 46th St",
  },
  {
    id: "r-003",
    name: "Sakura House",
    cuisine: "japanese",
    neighborhood: "east-village",
    priceRange: "$$$$",
    rating: 4.8,
    dietaryOptions: ["gluten-free"],
    menuHighlights: ["Omakase (12 course)", "A5 Wagyu", "Uni Sashimi"],
    hours: "Tue-Sat 5:30pm-10pm",
    address: "89 E 7th St",
  },
  {
    id: "r-004",
    name: "Verde Cocina",
    cuisine: "mexican",
    neighborhood: "chelsea",
    priceRange: "$$",
    rating: 4.3,
    dietaryOptions: ["vegetarian", "vegan", "gluten-free"],
    menuHighlights: ["Jackfruit Tacos", "Black Bean Enchiladas", "Churros"],
    hours: "Mon-Sun 11am-11pm",
    address: "220 8th Ave",
  },
  {
    id: "r-005",
    name: "Spice Route",
    cuisine: "indian",
    neighborhood: "midtown",
    priceRange: "$$",
    rating: 4.5,
    dietaryOptions: ["vegetarian", "vegan", "halal"],
    menuHighlights: ["Paneer Tikka Masala", "Dal Makhani", "Biryani", "Garlic Naan"],
    hours: "Mon-Sun 11:30am-10:30pm",
    address: "411 Lexington Ave",
  },
  {
    id: "r-006",
    name: "The Copper Pot",
    cuisine: "american",
    neighborhood: "soho",
    priceRange: "$$$",
    rating: 4.2,
    dietaryOptions: ["gluten-free"],
    menuHighlights: ["Dry-Aged Burger", "Lobster Mac & Cheese", "NY Cheesecake"],
    hours: "Mon-Thu 11am-10pm, Fri-Sun 11am-11pm",
    address: "78 Spring St",
  },
  {
    id: "r-007",
    name: "Le Petit Jardin",
    cuisine: "french",
    neighborhood: "tribeca",
    priceRange: "$$$$",
    rating: 4.7,
    dietaryOptions: ["vegetarian"],
    menuHighlights: ["Duck Confit", "Bouillabaisse", "Crème Brûlée", "Ratatouille"],
    hours: "Tue-Sun 5pm-10:30pm",
    address: "55 Warren St",
  },
  {
    id: "r-008",
    name: "Golden Dragon",
    cuisine: "chinese",
    neighborhood: "downtown",
    priceRange: "$",
    rating: 4.1,
    dietaryOptions: ["vegetarian", "vegan"],
    menuHighlights: ["Mapo Tofu", "Kung Pao Chicken", "Dim Sum Platter", "Scallion Pancakes"],
    hours: "Mon-Sun 10:30am-11pm",
    address: "18 Doyers St",
  },
];

interface Review {
  restaurantId: string;
  author: string;
  rating: number;
  text: string;
  date: string;
}

const REVIEWS: Review[] = [
  {
    restaurantId: "r-001",
    author: "FoodieNYC",
    rating: 5,
    text: "Best vegetarian Italian in the city. The truffle risotto is transcendent.",
    date: "2026-02-15",
  },
  {
    restaurantId: "r-001",
    author: "Marco_P",
    rating: 4,
    text: "Wonderful ambiance, great pasta. A bit pricey but worth it for a special dinner.",
    date: "2026-02-10",
  },
  {
    restaurantId: "r-002",
    author: "SpiceLover",
    rating: 5,
    text: "Authentic Thai flavors. The green curry is perfectly balanced — not too sweet.",
    date: "2026-02-20",
  },
  {
    restaurantId: "r-002",
    author: "JaneDoe42",
    rating: 4,
    text: "Great lunch spot near the office. Quick service and generous portions.",
    date: "2026-02-18",
  },
  {
    restaurantId: "r-003",
    author: "SushiMaster",
    rating: 5,
    text: "The omakase is a masterpiece. Chef Tanaka sources fish directly from Tsukiji.",
    date: "2026-02-22",
  },
  {
    restaurantId: "r-004",
    author: "VeganVibes",
    rating: 5,
    text: "Finally a Mexican place that takes vegan seriously. The jackfruit tacos are incredible.",
    date: "2026-02-19",
  },
  {
    restaurantId: "r-005",
    author: "CurryFan",
    rating: 4,
    text: "Solid Indian food in Midtown. The paneer tikka masala is rich and flavorful.",
    date: "2026-02-21",
  },
  {
    restaurantId: "r-005",
    author: "LunchBreak",
    rating: 5,
    text: "The lunch buffet is the best deal in Midtown. Everything is fresh and delicious.",
    date: "2026-02-14",
  },
  {
    restaurantId: "r-006",
    author: "BurgerBuff",
    rating: 4,
    text: "The dry-aged burger lives up to the hype. Great cocktail menu too.",
    date: "2026-02-17",
  },
  {
    restaurantId: "r-007",
    author: "ParisInNY",
    rating: 5,
    text: "Closest thing to a Parisian bistro I've found in NYC. The duck confit is perfection.",
    date: "2026-02-23",
  },
  {
    restaurantId: "r-008",
    author: "DimSumDan",
    rating: 4,
    text: "Affordable and authentic. The dim sum platter is perfect for sharing.",
    date: "2026-02-16",
  },
];

// ─── Tool Implementations ────────────────────────────────────────────────────

function searchRestaurants(args: {
  cuisine?: string;
  neighborhood?: string;
  price_range?: string;
}): string {
  let results = [...RESTAURANTS];

  if (args.cuisine) {
    results = results.filter((r) => r.cuisine === args.cuisine);
  }
  if (args.neighborhood) {
    results = results.filter((r) => r.neighborhood === args.neighborhood);
  }
  if (args.price_range) {
    results = results.filter((r) => r.priceRange === args.price_range);
  }

  if (results.length === 0) {
    return JSON.stringify({ found: false, message: "No restaurants match those criteria." });
  }

  return JSON.stringify({
    found: true,
    count: results.length,
    restaurants: results.map((r) => ({
      id: r.id,
      name: r.name,
      cuisine: r.cuisine,
      neighborhood: r.neighborhood,
      priceRange: r.priceRange,
      rating: r.rating,
      dietaryOptions: r.dietaryOptions,
    })),
  });
}

function getRestaurantDetails(args: { restaurant_id: string }): string {
  const restaurant = RESTAURANTS.find((r) => r.id === args.restaurant_id);
  if (!restaurant) {
    return JSON.stringify({ error: `Restaurant not found: ${args.restaurant_id}` });
  }
  return JSON.stringify(restaurant);
}

function getReviews(args: { restaurant_id: string }): string {
  const restaurant = RESTAURANTS.find((r) => r.id === args.restaurant_id);
  if (!restaurant) {
    return JSON.stringify({ error: `Restaurant not found: ${args.restaurant_id}` });
  }

  const reviews = REVIEWS.filter((r) => r.restaurantId === args.restaurant_id);
  return JSON.stringify({
    restaurant: restaurant.name,
    reviewCount: reviews.length,
    reviews,
  });
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_restaurants":
      return searchRestaurants(args);
    case "get_restaurant_details":
      return getRestaurantDetails(args as Parameters<typeof getRestaurantDetails>[0]);
    case "get_reviews":
      return getReviews(args as Parameters<typeof getReviews>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
