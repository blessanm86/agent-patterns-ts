import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions ────────────────────────────────────────────────────────
//
// 27 tools across 3 domains: e-commerce, recipes, travel.
// Each tool has a well-written description (strong style from tool-descriptions).
// The challenge: sending all 27 to the model dilutes attention and wastes tokens.
// Dynamic tool selection filters to the ~5 most relevant per query.

// ─── E-Commerce Tools (9) ────────────────────────────────────────────────────

const searchProducts: ToolDefinition = {
  type: "function",
  function: {
    name: "search_products",
    description:
      "Searches the product catalog by keyword, category, or price range. " +
      "Use this when the user wants to browse or find products. " +
      "Returns a list of matching products with name, price, and rating.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords, e.g. 'wireless headphones'" },
        category: {
          type: "string",
          description: "Optional category filter",
          enum: ["electronics", "clothing", "home", "sports", "books"],
        },
        max_price: { type: "string", description: "Maximum price filter, e.g. '100'" },
      },
      required: ["query"],
    },
  },
};

const getProductDetails: ToolDefinition = {
  type: "function",
  function: {
    name: "get_product_details",
    description:
      "Fetches full details for a specific product by ID including description, " +
      "specifications, reviews, and stock availability. " +
      "Use this after search_products to get more info about a specific item.",
    parameters: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "Product ID, e.g. 'PROD-001'" },
      },
      required: ["product_id"],
    },
  },
};

const addToCart: ToolDefinition = {
  type: "function",
  function: {
    name: "add_to_cart",
    description:
      "Adds a product to the user's shopping cart. " +
      "Requires a valid product_id from search_products or get_product_details. " +
      "Returns the updated cart summary.",
    parameters: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "Product ID to add" },
        quantity: { type: "string", description: "Number of items, default '1'" },
      },
      required: ["product_id"],
    },
  },
};

const removeFromCart: ToolDefinition = {
  type: "function",
  function: {
    name: "remove_from_cart",
    description:
      "Removes a product from the shopping cart by product ID. " +
      "Use get_cart first to see what's in the cart.",
    parameters: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "Product ID to remove" },
      },
      required: ["product_id"],
    },
  },
};

const getCart: ToolDefinition = {
  type: "function",
  function: {
    name: "get_cart",
    description:
      "Returns the current contents of the user's shopping cart " +
      "including items, quantities, prices, and total.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const applyCoupon: ToolDefinition = {
  type: "function",
  function: {
    name: "apply_coupon",
    description:
      "Applies a coupon or discount code to the shopping cart. " +
      "Returns the updated total with discount applied. " +
      "Only one coupon can be active at a time.",
    parameters: {
      type: "object",
      properties: {
        coupon_code: { type: "string", description: "Coupon code, e.g. 'SAVE20'" },
      },
      required: ["coupon_code"],
    },
  },
};

const checkout: ToolDefinition = {
  type: "function",
  function: {
    name: "checkout",
    description:
      "Processes the checkout for the current cart. " +
      "Confirms the order and returns an order confirmation number. " +
      "The cart must have at least one item.",
    parameters: {
      type: "object",
      properties: {
        payment_method: {
          type: "string",
          description: "Payment method",
          enum: ["credit_card", "paypal", "apple_pay"],
        },
      },
      required: ["payment_method"],
    },
  },
};

const trackOrder: ToolDefinition = {
  type: "function",
  function: {
    name: "track_order",
    description:
      "Tracks the shipping status of an existing order by order ID. " +
      "Returns current status, location, and estimated delivery date.",
    parameters: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "Order ID, e.g. 'ORD-12345'" },
      },
      required: ["order_id"],
    },
  },
};

const getReturnPolicy: ToolDefinition = {
  type: "function",
  function: {
    name: "get_return_policy",
    description:
      "Returns the store's return and refund policy including time windows, " +
      "conditions, and process for initiating a return.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Optional product category for category-specific policies",
        },
      },
      required: [],
    },
  },
};

// ─── Recipe Tools (9) ────────────────────────────────────────────────────────

const searchRecipes: ToolDefinition = {
  type: "function",
  function: {
    name: "search_recipes",
    description:
      "Searches the recipe database by ingredient, cuisine, or dish name. " +
      "Returns matching recipes with name, prep time, and difficulty level.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms, e.g. 'chicken pasta'" },
        cuisine: {
          type: "string",
          description: "Cuisine filter",
          enum: ["italian", "mexican", "asian", "american", "mediterranean"],
        },
        max_time: { type: "string", description: "Max prep time in minutes, e.g. '30'" },
      },
      required: ["query"],
    },
  },
};

const getRecipeDetails: ToolDefinition = {
  type: "function",
  function: {
    name: "get_recipe_details",
    description:
      "Fetches the full recipe by ID including ingredients list, " +
      "step-by-step instructions, and serving size.",
    parameters: {
      type: "object",
      properties: {
        recipe_id: { type: "string", description: "Recipe ID, e.g. 'RCP-001'" },
      },
      required: ["recipe_id"],
    },
  },
};

const getNutritionInfo: ToolDefinition = {
  type: "function",
  function: {
    name: "get_nutrition_info",
    description:
      "Returns detailed nutritional information for a recipe or ingredient — " +
      "calories, protein, carbs, fat, fiber per serving.",
    parameters: {
      type: "object",
      properties: {
        recipe_id: { type: "string", description: "Recipe ID for full recipe nutrition" },
        ingredient: {
          type: "string",
          description: "Single ingredient name for ingredient nutrition",
        },
      },
      required: [],
    },
  },
};

const convertUnits: ToolDefinition = {
  type: "function",
  function: {
    name: "convert_units",
    description:
      "Converts cooking measurements between units — cups to ml, " +
      "fahrenheit to celsius, ounces to grams, tablespoons to teaspoons, etc.",
    parameters: {
      type: "object",
      properties: {
        value: { type: "string", description: "Numeric value to convert, e.g. '2.5'" },
        from_unit: { type: "string", description: "Source unit, e.g. 'cups'" },
        to_unit: { type: "string", description: "Target unit, e.g. 'ml'" },
      },
      required: ["value", "from_unit", "to_unit"],
    },
  },
};

const findSubstitutes: ToolDefinition = {
  type: "function",
  function: {
    name: "find_substitutes",
    description:
      "Finds ingredient substitutions for dietary restrictions or missing ingredients. " +
      "Returns alternatives with ratio adjustments.",
    parameters: {
      type: "object",
      properties: {
        ingredient: { type: "string", description: "Ingredient to substitute, e.g. 'butter'" },
        reason: {
          type: "string",
          description: "Reason for substitution",
          enum: ["allergy", "vegan", "unavailable", "healthier"],
        },
      },
      required: ["ingredient"],
    },
  },
};

const getCookingTips: ToolDefinition = {
  type: "function",
  function: {
    name: "get_cooking_tips",
    description:
      "Returns cooking tips and techniques for a specific method or ingredient — " +
      "how to sear, blanch, deglaze, temper chocolate, etc.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Cooking technique or ingredient, e.g. 'searing steak'",
        },
      },
      required: ["topic"],
    },
  },
};

const rateRecipe: ToolDefinition = {
  type: "function",
  function: {
    name: "rate_recipe",
    description:
      "Submits a rating and optional review for a recipe. " + "Rating must be 1-5 stars.",
    parameters: {
      type: "object",
      properties: {
        recipe_id: { type: "string", description: "Recipe ID to rate" },
        rating: { type: "string", description: "Star rating 1-5" },
        review: { type: "string", description: "Optional text review" },
      },
      required: ["recipe_id", "rating"],
    },
  },
};

const getMealPlan: ToolDefinition = {
  type: "function",
  function: {
    name: "get_meal_plan",
    description:
      "Generates a meal plan for a specified number of days based on " +
      "dietary preferences, calorie targets, and cuisine preferences.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "string", description: "Number of days, e.g. '7'" },
        diet: {
          type: "string",
          description: "Dietary preference",
          enum: ["balanced", "low-carb", "vegetarian", "vegan", "keto"],
        },
        calories_per_day: { type: "string", description: "Target calories per day, e.g. '2000'" },
      },
      required: ["days"],
    },
  },
};

const getDietaryFilters: ToolDefinition = {
  type: "function",
  function: {
    name: "get_dietary_filters",
    description:
      "Returns available dietary filter options for recipe search — " +
      "allergen-free, gluten-free, dairy-free, nut-free, etc.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

// ─── Travel Tools (9) ────────────────────────────────────────────────────────

const searchFlights: ToolDefinition = {
  type: "function",
  function: {
    name: "search_flights",
    description:
      "Searches for available flights between two airports on a given date. " +
      "Returns flights with airline, departure/arrival times, duration, and price.",
    parameters: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Departure airport code, e.g. 'SFO'" },
        destination: { type: "string", description: "Arrival airport code, e.g. 'JFK'" },
        date: { type: "string", description: "Travel date, e.g. '2026-04-15'" },
        class: {
          type: "string",
          description: "Cabin class",
          enum: ["economy", "business", "first"],
        },
      },
      required: ["origin", "destination", "date"],
    },
  },
};

const getFlightDetails: ToolDefinition = {
  type: "function",
  function: {
    name: "get_flight_details",
    description:
      "Fetches detailed information about a specific flight by flight number — " +
      "seat map, baggage allowance, amenities, and layover details.",
    parameters: {
      type: "object",
      properties: {
        flight_id: { type: "string", description: "Flight ID, e.g. 'FL-001'" },
      },
      required: ["flight_id"],
    },
  },
};

const searchHotels: ToolDefinition = {
  type: "function",
  function: {
    name: "search_hotels",
    description:
      "Searches for hotels in a city for given check-in/check-out dates. " +
      "Returns hotels with name, star rating, price per night, and amenities.",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name, e.g. 'Paris'" },
        check_in: { type: "string", description: "Check-in date, e.g. '2026-04-15'" },
        check_out: { type: "string", description: "Check-out date, e.g. '2026-04-20'" },
        min_stars: { type: "string", description: "Minimum star rating 1-5" },
      },
      required: ["city", "check_in", "check_out"],
    },
  },
};

const getHotelDetails: ToolDefinition = {
  type: "function",
  function: {
    name: "get_hotel_details",
    description:
      "Fetches full details for a specific hotel — room types, cancellation policy, " +
      "photos, guest reviews, and nearby attractions.",
    parameters: {
      type: "object",
      properties: {
        hotel_id: { type: "string", description: "Hotel ID, e.g. 'HTL-001'" },
      },
      required: ["hotel_id"],
    },
  },
};

const bookHotel: ToolDefinition = {
  type: "function",
  function: {
    name: "book_hotel",
    description:
      "Books a hotel room. Requires hotel_id and room_type from get_hotel_details. " +
      "Returns a booking confirmation number.",
    parameters: {
      type: "object",
      properties: {
        hotel_id: { type: "string", description: "Hotel ID from search_hotels" },
        room_type: {
          type: "string",
          description: "Room type",
          enum: ["standard", "deluxe", "suite"],
        },
        guests: { type: "string", description: "Number of guests, e.g. '2'" },
      },
      required: ["hotel_id", "room_type"],
    },
  },
};

const searchActivities: ToolDefinition = {
  type: "function",
  function: {
    name: "search_activities",
    description:
      "Searches for tours, attractions, and activities in a destination. " +
      "Returns available activities with descriptions, prices, and ratings.",
    parameters: {
      type: "object",
      properties: {
        destination: { type: "string", description: "City or region, e.g. 'Rome'" },
        category: {
          type: "string",
          description: "Activity type",
          enum: ["tours", "museums", "outdoor", "food", "nightlife"],
        },
        date: { type: "string", description: "Date for availability check" },
      },
      required: ["destination"],
    },
  },
};

const getWeatherForecast: ToolDefinition = {
  type: "function",
  function: {
    name: "get_weather_forecast",
    description:
      "Returns the weather forecast for a city on a specific date or date range. " +
      "Includes temperature, precipitation, and recommended clothing.",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name, e.g. 'Tokyo'" },
        date: { type: "string", description: "Date or start date, e.g. '2026-04-15'" },
      },
      required: ["city", "date"],
    },
  },
};

const convertCurrency: ToolDefinition = {
  type: "function",
  function: {
    name: "convert_currency",
    description:
      "Converts an amount between two currencies using current exchange rates. " +
      "Use this for travel budget planning.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "string", description: "Amount to convert, e.g. '500'" },
        from: { type: "string", description: "Source currency code, e.g. 'USD'" },
        to: { type: "string", description: "Target currency code, e.g. 'EUR'" },
      },
      required: ["amount", "from", "to"],
    },
  },
};

const getVisaRequirements: ToolDefinition = {
  type: "function",
  function: {
    name: "get_visa_requirements",
    description:
      "Returns visa requirements for traveling from one country to another — " +
      "visa type needed, application process, processing time, and required documents.",
    parameters: {
      type: "object",
      properties: {
        nationality: { type: "string", description: "Traveler's nationality, e.g. 'US'" },
        destination: { type: "string", description: "Destination country, e.g. 'Japan'" },
      },
      required: ["nationality", "destination"],
    },
  },
};

// ─── All Tools (exported) ────────────────────────────────────────────────────

export const allTools: ToolDefinition[] = [
  // E-commerce
  searchProducts,
  getProductDetails,
  addToCart,
  removeFromCart,
  getCart,
  applyCoupon,
  checkout,
  trackOrder,
  getReturnPolicy,
  // Recipes
  searchRecipes,
  getRecipeDetails,
  getNutritionInfo,
  convertUnits,
  findSubstitutes,
  getCookingTips,
  rateRecipe,
  getMealPlan,
  getDietaryFilters,
  // Travel
  searchFlights,
  getFlightDetails,
  searchHotels,
  getHotelDetails,
  bookHotel,
  searchActivities,
  getWeatherForecast,
  convertCurrency,
  getVisaRequirements,
];

// ─── Mock Implementations ────────────────────────────────────────────────────
//
// Lightweight mocks — just enough to prove tool selection works.
// The demo is about WHICH tools get selected, not what they return.

const MOCK_PRODUCTS = [
  {
    id: "PROD-001",
    name: "Wireless Noise-Cancelling Headphones",
    price: 149.99,
    rating: 4.5,
    category: "electronics",
  },
  { id: "PROD-002", name: "Running Shoes Pro", price: 89.99, rating: 4.2, category: "sports" },
  { id: "PROD-003", name: "Ceramic Coffee Mug Set", price: 34.99, rating: 4.8, category: "home" },
  { id: "PROD-004", name: "TypeScript Handbook", price: 39.99, rating: 4.6, category: "books" },
];

const MOCK_RECIPES = [
  {
    id: "RCP-001",
    name: "Spaghetti Carbonara",
    cuisine: "italian",
    time: 25,
    difficulty: "medium",
  },
  { id: "RCP-002", name: "Chicken Tikka Masala", cuisine: "asian", time: 45, difficulty: "medium" },
  { id: "RCP-003", name: "Caesar Salad", cuisine: "american", time: 15, difficulty: "easy" },
  { id: "RCP-004", name: "Vegetable Stir Fry", cuisine: "asian", time: 20, difficulty: "easy" },
];

const MOCK_FLIGHTS = [
  { id: "FL-001", airline: "SkyWay", origin: "SFO", dest: "JFK", price: 320, duration: "5h30m" },
  {
    id: "FL-002",
    airline: "AirConnect",
    origin: "SFO",
    dest: "JFK",
    price: 275,
    duration: "6h15m",
  },
];

const MOCK_HOTELS = [
  {
    id: "HTL-001",
    name: "Grand Plaza Hotel",
    city: "Paris",
    stars: 4,
    price: 189,
    amenities: ["wifi", "pool", "spa"],
  },
  {
    id: "HTL-002",
    name: "Budget Inn Express",
    city: "Paris",
    stars: 2,
    price: 79,
    amenities: ["wifi"],
  },
];

let cart: Array<{ productId: string; name: string; price: number; quantity: number }> = [];

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    // ── E-commerce ──
    case "search_products": {
      const query = (args.query ?? "").toLowerCase();
      const matches = MOCK_PRODUCTS.filter(
        (p) => p.name.toLowerCase().includes(query) || p.category === args.category,
      );
      return JSON.stringify({ products: matches.length > 0 ? matches : MOCK_PRODUCTS.slice(0, 2) });
    }
    case "get_product_details": {
      const product = MOCK_PRODUCTS.find((p) => p.id === args.product_id);
      return product
        ? JSON.stringify({ ...product, stock: 15, description: `High-quality ${product.name}` })
        : JSON.stringify({ error: `Product ${args.product_id} not found` });
    }
    case "add_to_cart": {
      const product = MOCK_PRODUCTS.find((p) => p.id === args.product_id);
      if (!product) return JSON.stringify({ error: `Product ${args.product_id} not found` });
      const qty = parseInt(args.quantity ?? "1", 10);
      cart.push({ productId: product.id, name: product.name, price: product.price, quantity: qty });
      return JSON.stringify({ success: true, cart_size: cart.length, item: product.name });
    }
    case "remove_from_cart": {
      cart = cart.filter((i) => i.productId !== args.product_id);
      return JSON.stringify({ success: true, cart_size: cart.length });
    }
    case "get_cart": {
      const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
      return JSON.stringify({ items: cart, total });
    }
    case "apply_coupon": {
      const code = args.coupon_code?.toUpperCase();
      const discount = code === "SAVE20" ? 0.2 : code === "WELCOME10" ? 0.1 : 0;
      if (discount === 0) return JSON.stringify({ error: `Invalid coupon: ${args.coupon_code}` });
      const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
      return JSON.stringify({ discount: `${discount * 100}%`, new_total: total * (1 - discount) });
    }
    case "checkout": {
      if (cart.length === 0) return JSON.stringify({ error: "Cart is empty" });
      const orderId = `ORD-${Date.now()}`;
      const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
      cart = [];
      return JSON.stringify({
        order_id: orderId,
        total,
        payment: args.payment_method,
        status: "confirmed",
      });
    }
    case "track_order":
      return JSON.stringify({
        order_id: args.order_id,
        status: "in_transit",
        eta: "2026-03-10",
        location: "Distribution Center",
      });
    case "get_return_policy":
      return JSON.stringify({
        window: "30 days",
        condition: "unused with tags",
        process: "Online return portal",
        refund: "5-7 business days",
      });

    // ── Recipes ──
    case "search_recipes": {
      const query = (args.query ?? "").toLowerCase();
      const matches = MOCK_RECIPES.filter(
        (r) => r.name.toLowerCase().includes(query) || r.cuisine === args.cuisine,
      );
      return JSON.stringify({ recipes: matches.length > 0 ? matches : MOCK_RECIPES.slice(0, 2) });
    }
    case "get_recipe_details": {
      const recipe = MOCK_RECIPES.find((r) => r.id === args.recipe_id);
      if (!recipe) return JSON.stringify({ error: `Recipe ${args.recipe_id} not found` });
      return JSON.stringify({
        ...recipe,
        servings: 4,
        ingredients: ["pasta", "eggs", "parmesan", "pancetta", "black pepper"],
        steps: ["Boil pasta", "Cook pancetta", "Mix eggs and cheese", "Combine and toss"],
      });
    }
    case "get_nutrition_info":
      return JSON.stringify({
        calories: 520,
        protein: "22g",
        carbs: "65g",
        fat: "18g",
        fiber: "3g",
        serving: "1 plate",
      });
    case "convert_units": {
      const val = parseFloat(args.value ?? "0");
      const conversions: Record<string, number> = {
        cups_ml: 236.6,
        oz_g: 28.35,
        f_c: -17.22,
        tbsp_tsp: 3,
      };
      const key = `${args.from_unit}_${args.to_unit}`;
      const factor = conversions[key] ?? 1;
      return JSON.stringify({
        value: args.value,
        from: args.from_unit,
        to: args.to_unit,
        result: (val * factor).toFixed(2),
      });
    }
    case "find_substitutes":
      return JSON.stringify({
        ingredient: args.ingredient,
        substitutes: [
          { name: "coconut oil", ratio: "1:1", notes: "Works well for baking" },
          { name: "applesauce", ratio: "1:0.5", notes: "Reduces fat content" },
        ],
      });
    case "get_cooking_tips":
      return JSON.stringify({
        topic: args.topic,
        tips: [
          "Use high heat for a good sear",
          "Let meat rest before cutting",
          "Pat dry for crispy skin",
        ],
      });
    case "rate_recipe":
      return JSON.stringify({ success: true, recipe_id: args.recipe_id, rating: args.rating });
    case "get_meal_plan":
      return JSON.stringify({
        days: args.days,
        diet: args.diet ?? "balanced",
        plan: [{ day: 1, breakfast: "Oatmeal", lunch: "Caesar Salad", dinner: "Grilled Salmon" }],
      });
    case "get_dietary_filters":
      return JSON.stringify({
        filters: [
          "gluten-free",
          "dairy-free",
          "nut-free",
          "vegan",
          "vegetarian",
          "low-carb",
          "keto",
        ],
      });

    // ── Travel ──
    case "search_flights":
      return JSON.stringify({ flights: MOCK_FLIGHTS.map((f) => ({ ...f, date: args.date })) });
    case "get_flight_details": {
      const flight = MOCK_FLIGHTS.find((f) => f.id === args.flight_id);
      return flight
        ? JSON.stringify({
            ...flight,
            baggage: "1 carry-on + 1 checked",
            wifi: true,
            meals: "included",
          })
        : JSON.stringify({ error: `Flight ${args.flight_id} not found` });
    }
    case "search_hotels":
      return JSON.stringify({
        hotels: MOCK_HOTELS.map((h) => ({
          ...h,
          check_in: args.check_in,
          check_out: args.check_out,
        })),
      });
    case "get_hotel_details": {
      const hotel = MOCK_HOTELS.find((h) => h.id === args.hotel_id);
      return hotel
        ? JSON.stringify({
            ...hotel,
            rooms: ["standard", "deluxe", "suite"],
            cancellation: "Free until 24h before",
          })
        : JSON.stringify({ error: `Hotel ${args.hotel_id} not found` });
    }
    case "book_hotel":
      return JSON.stringify({
        booking_id: `BK-${Date.now()}`,
        hotel_id: args.hotel_id,
        room: args.room_type,
        status: "confirmed",
      });
    case "search_activities":
      return JSON.stringify({
        activities: [
          { name: "Walking Food Tour", price: 65, rating: 4.9, duration: "3h" },
          { name: "Historical City Tour", price: 45, rating: 4.7, duration: "2h" },
        ],
      });
    case "get_weather_forecast":
      return JSON.stringify({
        city: args.city,
        date: args.date,
        temp: "18-24C",
        condition: "Partly cloudy",
        rain: "10%",
      });
    case "convert_currency": {
      const amt = parseFloat(args.amount ?? "0");
      const rates: Record<string, number> = {
        USD_EUR: 0.92,
        EUR_USD: 1.09,
        USD_GBP: 0.79,
        USD_JPY: 149.5,
      };
      const key = `${args.from}_${args.to}`;
      const rate = rates[key] ?? 1;
      return JSON.stringify({
        amount: args.amount,
        from: args.from,
        to: args.to,
        result: (amt * rate).toFixed(2),
        rate,
      });
    }
    case "get_visa_requirements":
      return JSON.stringify({
        nationality: args.nationality,
        destination: args.destination,
        visa_required: true,
        type: "Tourist visa",
        processing: "5-7 business days",
        documents: ["Valid passport", "Photo", "Travel itinerary", "Bank statement"],
      });

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
