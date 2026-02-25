import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions ────────────────────────────────────────────────────────
//
// 6 travel tools organized into 3 domains: flights, hotels, activities.
// Each domain has 2 tools — enough to justify a specialist agent.
// Tool definitions are exported as grouped arrays so profiles can pick their scope.

// ── Flight Tools ─────────────────────────────────────────────────────────────

const searchFlightsDef: ToolDefinition = {
  type: "function",
  function: {
    name: "search_flights",
    description:
      "Search for available flights between two cities on a given date. Returns 2-3 flight options with airline, price, and duration.",
    parameters: {
      type: "object",
      properties: {
        origin: {
          type: "string",
          description: "Origin city or airport code",
        },
        destination: {
          type: "string",
          description: "Destination city or airport code",
        },
        date: {
          type: "string",
          description: "Departure date in YYYY-MM-DD format",
        },
      },
      required: ["origin", "destination", "date"],
    },
  },
};

const compareFlightPricesDef: ToolDefinition = {
  type: "function",
  function: {
    name: "compare_flight_prices",
    description:
      "Compare flight prices for a route, sorted from cheapest to most expensive. Shows potential savings between options. Use after search_flights to help the user pick the best deal.",
    parameters: {
      type: "object",
      properties: {
        origin: {
          type: "string",
          description: "Origin city or airport code",
        },
        destination: {
          type: "string",
          description: "Destination city or airport code",
        },
      },
      required: ["origin", "destination"],
    },
  },
};

// ── Hotel Tools ──────────────────────────────────────────────────────────────

const searchHotelsDef: ToolDefinition = {
  type: "function",
  function: {
    name: "search_hotels",
    description:
      "Search for hotels in a city for given dates. Returns 2-3 options with name, price per night, and star rating.",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "City name to search hotels in",
        },
        check_in: {
          type: "string",
          description: "Check-in date in YYYY-MM-DD format",
        },
        check_out: {
          type: "string",
          description: "Check-out date in YYYY-MM-DD format",
        },
      },
      required: ["city", "check_in", "check_out"],
    },
  },
};

const getHotelDetailsDef: ToolDefinition = {
  type: "function",
  function: {
    name: "get_hotel_details",
    description:
      "Get detailed information about a specific hotel including amenities, room types, and cancellation policy. Use after search_hotels when the user wants more details about a specific property.",
    parameters: {
      type: "object",
      properties: {
        hotel_name: {
          type: "string",
          description: "Exact name of the hotel to get details for",
        },
      },
      required: ["hotel_name"],
    },
  },
};

// ── Activity Tools ───────────────────────────────────────────────────────────

const findAttractionsDef: ToolDefinition = {
  type: "function",
  function: {
    name: "find_attractions",
    description:
      "Find top attractions in a city. Returns up to 5 attractions with name, description, and estimated visit time.",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "City name to find attractions in",
        },
      },
      required: ["city"],
    },
  },
};

const findRestaurantsDef: ToolDefinition = {
  type: "function",
  function: {
    name: "find_restaurants",
    description: "Find restaurant recommendations in a city, optionally filtered by cuisine type.",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "City name to find restaurants in",
        },
        cuisine: {
          type: "string",
          description: "Optional cuisine type filter (e.g. French, Japanese, seafood)",
        },
      },
      required: ["city"],
    },
  },
};

// ─── Grouped Exports ─────────────────────────────────────────────────────────

export const flightTools: ToolDefinition[] = [searchFlightsDef, compareFlightPricesDef];
export const hotelTools: ToolDefinition[] = [searchHotelsDef, getHotelDetailsDef];
export const activityTools: ToolDefinition[] = [findAttractionsDef, findRestaurantsDef];
export const allTools: ToolDefinition[] = [...flightTools, ...hotelTools, ...activityTools];

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_FLIGHTS: Record<
  string,
  Array<{ airline: string; price: number; duration: string; departure: string }>
> = {
  "new york-paris": [
    { airline: "Air France", price: 680, duration: "7h 20m", departure: "09:15" },
    { airline: "Delta", price: 720, duration: "7h 45m", departure: "14:30" },
    { airline: "United", price: 640, duration: "8h 10m", departure: "22:00" },
  ],
  "london-tokyo": [
    { airline: "Japan Airlines", price: 920, duration: "12h 5m", departure: "10:00" },
    { airline: "British Airways", price: 980, duration: "12h 30m", departure: "13:45" },
    { airline: "ANA", price: 860, duration: "11h 50m", departure: "18:20" },
  ],
  "new york-lisbon": [
    { airline: "TAP Air Portugal", price: 550, duration: "6h 50m", departure: "11:00" },
    { airline: "Delta", price: 610, duration: "7h 15m", departure: "16:45" },
  ],
  "london-paris": [
    { airline: "Eurostar", price: 140, duration: "2h 16m", departure: "08:31" },
    { airline: "Air France", price: 220, duration: "1h 20m", departure: "07:00" },
    { airline: "British Airways", price: 195, duration: "1h 15m", departure: "12:30" },
  ],
};

const MOCK_HOTELS: Record<
  string,
  Array<{ name: string; stars: number; pricePerNight: number; neighborhood: string }>
> = {
  paris: [
    { name: "Hôtel du Louvre", stars: 4, pricePerNight: 280, neighborhood: "1st arrondissement" },
    {
      name: "Citadines Apart'hotel Montmartre",
      stars: 3,
      pricePerNight: 145,
      neighborhood: "Montmartre",
    },
    { name: "Le Marais Boutique Hotel", stars: 4, pricePerNight: 220, neighborhood: "Le Marais" },
  ],
  tokyo: [
    { name: "Park Hyatt Tokyo", stars: 5, pricePerNight: 520, neighborhood: "Shinjuku" },
    { name: "Dormy Inn Asakusa", stars: 3, pricePerNight: 110, neighborhood: "Asakusa" },
    {
      name: "The Strings by InterContinental",
      stars: 4,
      pricePerNight: 310,
      neighborhood: "Shinagawa",
    },
  ],
  lisbon: [
    { name: "Bairro Alto Hotel", stars: 5, pricePerNight: 390, neighborhood: "Chiado" },
    { name: "Alfama Páteo", stars: 4, pricePerNight: 180, neighborhood: "Alfama" },
    { name: "Lisboa Tejo Hotel", stars: 3, pricePerNight: 95, neighborhood: "Mouraria" },
  ],
  "new york": [
    { name: "The High Line Hotel", stars: 4, pricePerNight: 340, neighborhood: "Chelsea" },
    { name: "Pod 51", stars: 3, pricePerNight: 160, neighborhood: "Midtown East" },
    { name: "The Standard", stars: 4, pricePerNight: 290, neighborhood: "Meatpacking District" },
  ],
};

const MOCK_HOTEL_DETAILS: Record<
  string,
  {
    amenities: string[];
    roomTypes: Array<{ type: string; pricePerNight: number }>;
    cancellation: string;
  }
> = {
  "hôtel du louvre": {
    amenities: ["Free WiFi", "Spa", "Fitness Center", "Concierge", "Room Service"],
    roomTypes: [
      { type: "Classic Double", pricePerNight: 280 },
      { type: "Superior Suite", pricePerNight: 420 },
      { type: "Prestige Suite", pricePerNight: 650 },
    ],
    cancellation: "Free cancellation up to 48 hours before check-in",
  },
  "citadines apart'hotel montmartre": {
    amenities: ["Kitchenette", "Free WiFi", "Laundry", "24h Reception"],
    roomTypes: [
      { type: "Studio", pricePerNight: 145 },
      { type: "One-Bedroom Apartment", pricePerNight: 195 },
    ],
    cancellation: "Free cancellation up to 24 hours before check-in",
  },
  "le marais boutique hotel": {
    amenities: ["Free WiFi", "Rooftop Bar", "Breakfast Included", "Bike Rental"],
    roomTypes: [
      { type: "Cozy Double", pricePerNight: 220 },
      { type: "Deluxe King", pricePerNight: 310 },
    ],
    cancellation: "Non-refundable. Modification allowed up to 72 hours before check-in",
  },
  "park hyatt tokyo": {
    amenities: ["Pool", "Spa", "Fitness Center", "Fine Dining", "Club Lounge", "Valet Parking"],
    roomTypes: [
      { type: "Park King", pricePerNight: 520 },
      { type: "Park Suite", pricePerNight: 890 },
      { type: "Diplomatic Suite", pricePerNight: 2100 },
    ],
    cancellation: "Free cancellation up to 72 hours before check-in",
  },
  "dormy inn asakusa": {
    amenities: ["Onsen Bath", "Free WiFi", "Breakfast Buffet", "Coin Laundry"],
    roomTypes: [
      { type: "Semi-Double", pricePerNight: 110 },
      { type: "Twin Room", pricePerNight: 150 },
    ],
    cancellation: "Free cancellation up to 24 hours before check-in",
  },
  "the strings by intercontinental": {
    amenities: ["Spa", "Pool", "Fitness Center", "Club Lounge", "Multiple Restaurants"],
    roomTypes: [
      { type: "Classic Room", pricePerNight: 310 },
      { type: "Club Room", pricePerNight: 420 },
    ],
    cancellation: "Free cancellation up to 48 hours before check-in",
  },
  "bairro alto hotel": {
    amenities: ["Rooftop Terrace", "Spa", "Free WiFi", "Concierge", "Bar"],
    roomTypes: [
      { type: "Superior Room", pricePerNight: 390 },
      { type: "Deluxe Suite", pricePerNight: 580 },
    ],
    cancellation: "Free cancellation up to 48 hours before check-in",
  },
  "alfama páteo": {
    amenities: ["Free WiFi", "Terrace", "Airport Shuttle", "Breakfast"],
    roomTypes: [
      { type: "Standard Double", pricePerNight: 180 },
      { type: "Family Room", pricePerNight: 240 },
    ],
    cancellation: "Free cancellation up to 24 hours before check-in",
  },
  "lisboa tejo hotel": {
    amenities: ["Free WiFi", "Bar", "24h Reception"],
    roomTypes: [
      { type: "Economy Double", pricePerNight: 95 },
      { type: "Standard Twin", pricePerNight: 115 },
    ],
    cancellation: "Free cancellation up to 12 hours before check-in",
  },
  "the high line hotel": {
    amenities: ["Garden", "Free WiFi", "Concierge", "Fitness Center", "Restaurant"],
    roomTypes: [
      { type: "Classic King", pricePerNight: 340 },
      { type: "Garden Suite", pricePerNight: 520 },
    ],
    cancellation: "Free cancellation up to 48 hours before check-in",
  },
  "pod 51": {
    amenities: ["Free WiFi", "Rooftop Bar", "Pod Café"],
    roomTypes: [
      { type: "Full Pod", pricePerNight: 160 },
      { type: "Queen Pod", pricePerNight: 200 },
    ],
    cancellation: "Free cancellation up to 24 hours before check-in",
  },
  "the standard": {
    amenities: ["Rooftop Bar", "Beer Garden", "Spa", "Free WiFi", "Fitness Center"],
    roomTypes: [
      { type: "Standard King", pricePerNight: 290 },
      { type: "Hudson River Suite", pricePerNight: 480 },
    ],
    cancellation: "Free cancellation up to 72 hours before check-in",
  },
};

const MOCK_ATTRACTIONS: Record<
  string,
  Array<{ name: string; description: string; visitTime: string }>
> = {
  paris: [
    {
      name: "Eiffel Tower",
      description: "Iconic iron lattice tower with panoramic views of the city",
      visitTime: "2-3 hours",
    },
    {
      name: "The Louvre",
      description: "World's largest art museum, home to the Mona Lisa",
      visitTime: "3-4 hours",
    },
    {
      name: "Musée d'Orsay",
      description: "Impressionist masterpieces in a stunning converted railway station",
      visitTime: "2-3 hours",
    },
    {
      name: "Notre-Dame Cathedral",
      description: "Medieval Gothic cathedral on the Île de la Cité",
      visitTime: "1-2 hours",
    },
    {
      name: "Sacré-Cœur & Montmartre",
      description: "Hilltop basilica with charming artists' quarter below",
      visitTime: "2-3 hours",
    },
  ],
  tokyo: [
    {
      name: "Senso-ji Temple",
      description: "Tokyo's oldest and most significant Buddhist temple in Asakusa",
      visitTime: "1-2 hours",
    },
    {
      name: "Shibuya Crossing",
      description: "World's busiest pedestrian crossing and surrounding entertainment district",
      visitTime: "1-2 hours",
    },
    {
      name: "Tsukiji Outer Market",
      description: "Vibrant market with fresh seafood, produce, and street food",
      visitTime: "2-3 hours",
    },
    {
      name: "Shinjuku Gyoen National Garden",
      description: "Expansive park blending Japanese, French, and English garden styles",
      visitTime: "2 hours",
    },
    {
      name: "teamLab Borderless",
      description: "Immersive digital art museum with interactive light installations",
      visitTime: "3-4 hours",
    },
  ],
  lisbon: [
    {
      name: "Belém Tower",
      description: "16th-century fortress and UNESCO World Heritage Site on the Tagus",
      visitTime: "1-2 hours",
    },
    {
      name: "Jerónimos Monastery",
      description: "Magnificent Manueline Gothic monastery, UNESCO World Heritage Site",
      visitTime: "2 hours",
    },
    {
      name: "Alfama District",
      description: "Lisbon's oldest neighbourhood with fado music and castle views",
      visitTime: "3 hours",
    },
    {
      name: "LX Factory",
      description: "Trendy cultural space in a 19th-century industrial complex",
      visitTime: "2 hours",
    },
    {
      name: "Time Out Market",
      description: "Iconic food hall showcasing the best of Portuguese cuisine",
      visitTime: "1-2 hours",
    },
  ],
  "new york": [
    {
      name: "Central Park",
      description: "Iconic 843-acre urban park in the heart of Manhattan",
      visitTime: "2-4 hours",
    },
    {
      name: "Metropolitan Museum of Art",
      description: "One of the world's largest and finest art museums",
      visitTime: "3-4 hours",
    },
    {
      name: "Brooklyn Bridge",
      description: "Historic suspension bridge with walkway and Manhattan skyline views",
      visitTime: "1-2 hours",
    },
    {
      name: "High Line",
      description: "Elevated linear park built on a former freight rail line",
      visitTime: "1-2 hours",
    },
    {
      name: "One World Observatory",
      description: "Observation deck atop One World Trade Center",
      visitTime: "1-2 hours",
    },
  ],
};

const MOCK_RESTAURANTS: Record<
  string,
  Array<{ name: string; cuisine: string; priceRange: string; mustTry: string }>
> = {
  paris: [
    {
      name: "Septime",
      cuisine: "Modern French",
      priceRange: "$$$",
      mustTry: "Seasonal tasting menu",
    },
    {
      name: "L'As du Fallafel",
      cuisine: "Middle Eastern",
      priceRange: "$",
      mustTry: "Classic falafel pita",
    },
    {
      name: "Frenchie",
      cuisine: "Franco-American",
      priceRange: "$$$",
      mustTry: "Natural wine pairing",
    },
  ],
  tokyo: [
    {
      name: "Ichiran Ramen",
      cuisine: "Japanese Ramen",
      priceRange: "$",
      mustTry: "Tonkotsu ramen in solo booth",
    },
    {
      name: "Sukiyabashi Jiro Honten",
      cuisine: "Sushi",
      priceRange: "$$$$",
      mustTry: "Omakase sushi experience",
    },
    {
      name: "Gonpachi Nishi-Azabu",
      cuisine: "Japanese Izakaya",
      priceRange: "$$",
      mustTry: "Grilled skewers and sake",
    },
  ],
  lisbon: [
    {
      name: "Cervejaria Ramiro",
      cuisine: "Portuguese Seafood",
      priceRange: "$$$",
      mustTry: "Percebes and giant tiger prawns",
    },
    {
      name: "A Cevicheria",
      cuisine: "Peruvian-Portuguese",
      priceRange: "$$",
      mustTry: "Octopus ceviche",
    },
    {
      name: "Solar dos Presuntos",
      cuisine: "Traditional Portuguese",
      priceRange: "$$",
      mustTry: "Bacalhau à Brás",
    },
  ],
  "new york": [
    {
      name: "Katz's Delicatessen",
      cuisine: "Jewish Deli",
      priceRange: "$$",
      mustTry: "Pastrami on rye",
    },
    {
      name: "Carbone",
      cuisine: "Italian-American",
      priceRange: "$$$$",
      mustTry: "Veal parmesan",
    },
    {
      name: "Xi'an Famous Foods",
      cuisine: "Chinese (Xi'an)",
      priceRange: "$",
      mustTry: "Spicy cumin lamb noodles",
    },
  ],
};

// ─── Tool Implementations ────────────────────────────────────────────────────

function normalizeCity(city: string): string {
  return city.toLowerCase().trim();
}

function searchFlights(args: { origin: string; destination: string; date: string }): string {
  const key = `${normalizeCity(args.origin)}-${normalizeCity(args.destination)}`;
  const reverseKey = `${normalizeCity(args.destination)}-${normalizeCity(args.origin)}`;
  const flights = MOCK_FLIGHTS[key] ?? MOCK_FLIGHTS[reverseKey];

  if (!flights) {
    return JSON.stringify({
      route: `${args.origin} → ${args.destination}`,
      date: args.date,
      options: [
        { airline: "Generic Air", price: 750, duration: "10h 00m", departure: "08:00" },
        { airline: "World Airways", price: 820, duration: "10h 30m", departure: "14:00" },
      ],
    });
  }

  return JSON.stringify({
    route: `${args.origin} → ${args.destination}`,
    date: args.date,
    options: flights,
  });
}

function compareFlightPrices(args: { origin: string; destination: string }): string {
  const key = `${normalizeCity(args.origin)}-${normalizeCity(args.destination)}`;
  const reverseKey = `${normalizeCity(args.destination)}-${normalizeCity(args.origin)}`;
  const flights = MOCK_FLIGHTS[key] ?? MOCK_FLIGHTS[reverseKey];

  if (!flights) {
    return JSON.stringify({
      route: `${args.origin} → ${args.destination}`,
      message: "No flights found for this route",
    });
  }

  const sorted = [...flights].sort((a, b) => a.price - b.price);
  const cheapest = sorted[0].price;

  return JSON.stringify({
    route: `${args.origin} → ${args.destination}`,
    comparison: sorted.map((f) => ({
      ...f,
      savings:
        f.price - cheapest > 0 ? `$${f.price - cheapest} more than cheapest` : "Cheapest option",
    })),
    cheapest: sorted[0].airline,
    mostExpensive: sorted[sorted.length - 1].airline,
    maxSavings: `$${sorted[sorted.length - 1].price - cheapest}`,
  });
}

function searchHotels(args: { city: string; check_in: string; check_out: string }): string {
  const city = normalizeCity(args.city);
  const hotels = MOCK_HOTELS[city];

  const checkIn = new Date(args.check_in);
  const checkOut = new Date(args.check_out);
  const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));

  if (!hotels) {
    return JSON.stringify({
      city: args.city,
      check_in: args.check_in,
      check_out: args.check_out,
      nights,
      options: [
        { name: "City Center Hotel", stars: 3, pricePerNight: 150, neighborhood: "City Center" },
        { name: "Boutique Guesthouse", stars: 4, pricePerNight: 200, neighborhood: "Old Town" },
      ],
    });
  }

  return JSON.stringify({
    city: args.city,
    check_in: args.check_in,
    check_out: args.check_out,
    nights,
    options: hotels.map((h) => ({ ...h, totalPrice: h.pricePerNight * nights })),
  });
}

function getHotelDetails(args: { hotel_name: string }): string {
  const key = args.hotel_name.toLowerCase().trim();
  const details = MOCK_HOTEL_DETAILS[key];

  if (!details) {
    return JSON.stringify({
      hotel: args.hotel_name,
      error: "Hotel not found. Use search_hotels first to find available hotels.",
    });
  }

  return JSON.stringify({
    hotel: args.hotel_name,
    ...details,
  });
}

function findAttractions(args: { city: string }): string {
  const city = normalizeCity(args.city);
  const attractions = MOCK_ATTRACTIONS[city];

  if (!attractions) {
    return JSON.stringify({
      city: args.city,
      attractions: [
        { name: "City Museum", description: "Main historical museum", visitTime: "2 hours" },
        { name: "Old Town", description: "Historic city centre", visitTime: "3 hours" },
        {
          name: "Local Market",
          description: "Traditional market with local produce",
          visitTime: "1-2 hours",
        },
      ],
    });
  }

  return JSON.stringify({ city: args.city, attractions });
}

function findRestaurants(args: { city: string; cuisine?: string }): string {
  const city = normalizeCity(args.city);
  let restaurants = MOCK_RESTAURANTS[city];

  if (!restaurants) {
    return JSON.stringify({
      city: args.city,
      restaurants: [
        { name: "La Bonne Table", cuisine: "Local", priceRange: "$$", mustTry: "Daily special" },
        {
          name: "The Corner Bistro",
          cuisine: "International",
          priceRange: "$$",
          mustTry: "Chef's recommendation",
        },
      ],
    });
  }

  if (args.cuisine) {
    const filtered = restaurants.filter((r) =>
      r.cuisine.toLowerCase().includes(args.cuisine!.toLowerCase()),
    );
    if (filtered.length > 0) restaurants = filtered;
  }

  return JSON.stringify({ city: args.city, cuisine_filter: args.cuisine ?? null, restaurants });
}

// ─── Scoped Dispatchers ──────────────────────────────────────────────────────
//
// Each dispatcher only handles its domain's tools.
// This is the key insight: the dispatcher is scoped to the profile's tool set,
// so even if the model hallucinates a tool name from another domain, it errors cleanly.

export function executeFlightTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_flights":
      return searchFlights(args as Parameters<typeof searchFlights>[0]);
    case "compare_flight_prices":
      return compareFlightPrices(args as Parameters<typeof compareFlightPrices>[0]);
    default:
      return JSON.stringify({ error: `Unknown flight tool: ${name}` });
  }
}

export function executeHotelTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_hotels":
      return searchHotels(args as Parameters<typeof searchHotels>[0]);
    case "get_hotel_details":
      return getHotelDetails(args as Parameters<typeof getHotelDetails>[0]);
    default:
      return JSON.stringify({ error: `Unknown hotel tool: ${name}` });
  }
}

export function executeActivityTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "find_attractions":
      return findAttractions(args as Parameters<typeof findAttractions>[0]);
    case "find_restaurants":
      return findRestaurants(args as Parameters<typeof findRestaurants>[0]);
    default:
      return JSON.stringify({ error: `Unknown activity tool: ${name}` });
  }
}

export function executeAnyTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "search_flights":
      return searchFlights(args as Parameters<typeof searchFlights>[0]);
    case "compare_flight_prices":
      return compareFlightPrices(args as Parameters<typeof compareFlightPrices>[0]);
    case "search_hotels":
      return searchHotels(args as Parameters<typeof searchHotels>[0]);
    case "get_hotel_details":
      return getHotelDetails(args as Parameters<typeof getHotelDetails>[0]);
    case "find_attractions":
      return findAttractions(args as Parameters<typeof findAttractions>[0]);
    case "find_restaurants":
      return findRestaurants(args as Parameters<typeof findRestaurants>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
