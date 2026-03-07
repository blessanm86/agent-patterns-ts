import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions ─────────────────────────────────────────────────────────
//
// Each specialist has two scoped tools. Tools are sent to the model as JSON
// schema — the model decides which to call based on its task.

export const requirementsTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "analyze_product_features",
      description:
        "Analyze a product's core features and identify key differentiators vs. the competition",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Product name" },
          features: { type: "string", description: "Key product features, comma-separated" },
          price: { type: "string", description: "Target retail price (e.g. '$79')" },
        },
        required: ["product_name", "features", "price"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "identify_target_customer",
      description:
        "Profile the primary target customer segment: who they are, what they value, where they shop",
      parameters: {
        type: "object",
        properties: {
          product_category: {
            type: "string",
            description: "Product category (e.g. 'smart wallet', 'fitness tracker')",
          },
          price_range: {
            type: "string",
            description: "Price range (e.g. 'under $50', '$50–$100', 'over $100')",
          },
        },
        required: ["product_category", "price_range"],
      },
    },
  },
];

export const pricingTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "research_competitor_prices",
      description: "Look up competitor products and their current prices in the same category",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Product category to research" },
        },
        required: ["category"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_pricing_strategy",
      description: "Recommend a pricing strategy based on product positioning and market data",
      parameters: {
        type: "object",
        properties: {
          target_price: { type: "string", description: "Intended retail price" },
          positioning: {
            type: "string",
            description: "Desired market positioning: budget, mid, or premium",
          },
        },
        required: ["target_price", "positioning"],
      },
    },
  },
];

export const marketingTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "generate_product_messaging",
      description: "Generate a product headline, tagline, and 3 key selling messages",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Product name" },
          top_benefit: {
            type: "string",
            description: "The single most compelling benefit to lead with",
          },
          target_audience: { type: "string", description: "Who the product is for" },
        },
        required: ["product_name", "top_benefit", "target_audience"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select_launch_channels",
      description: "Choose the top marketing channels for this product's launch",
      parameters: {
        type: "object",
        properties: {
          target_audience: { type: "string", description: "Target customer description" },
          budget_tier: { type: "string", description: "Marketing budget: low, medium, or high" },
        },
        required: ["target_audience", "budget_tier"],
      },
    },
  },
];

export const technicalTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "validate_technical_claims",
      description:
        "Check which technical claims are solid, which need disclaimers, and which are red flags",
      parameters: {
        type: "object",
        properties: {
          claims: { type: "string", description: "Technical claims to validate, comma-separated" },
          product_type: {
            type: "string",
            description: "Product type for context-appropriate validation",
          },
        },
        required: ["claims", "product_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_compliance_requirements",
      description:
        "List the regulatory certifications and compliance requirements for a product category",
      parameters: {
        type: "object",
        properties: {
          product_type: { type: "string", description: "Product type / category" },
          markets: { type: "string", description: "Target markets (e.g. 'US, EU')" },
        },
        required: ["product_type", "markets"],
      },
    },
  },
];

// ─── Tool Implementations ─────────────────────────────────────────────────────
//
// All implementations are deterministic mocks — no external API calls.
// The model never sees these; it only sees the JSON schema above.

function analyzeProductFeatures(args: Record<string, string>): string {
  const { product_name, price } = args;
  const priceNum = parseFloat(price.replace(/[^0-9.]/g, ""));
  const tier = priceNum < 50 ? "budget" : priceNum < 120 ? "mid-range" : "premium";
  return JSON.stringify({
    product: product_name,
    price_tier: tier,
    key_differentiators: [
      "Only slim wallet combining GPS tracking + RFID blocking in one device",
      "2-year battery life — no charging needed, unlike rechargeable competitors",
      "Real-time location via iOS/Android app with location history",
    ],
    positioning: `${tier} — undercuts GPS-native competitors ($119+) while matching tracker-card add-on price ($79–$89)`,
    launch_readiness: "hardware validated; app in beta; FCC/CE certification pending",
    biggest_risk: "2-year battery claim requires careful usage-assumption disclosure",
  });
}

function identifyTargetCustomer(args: Record<string, string>): string {
  const { price_range } = args;
  return JSON.stringify({
    primary_segment: "Frequent travelers (25–44) who have lost a wallet or fear pickpocketing",
    secondary_segment: "Urban commuters concerned about contactless card skimming",
    psychographic: "Tech-forward, security-conscious, values peace of mind over brand prestige",
    price_sensitivity: price_range,
    discovery_channels: [
      "Reddit r/EDC",
      "YouTube gear reviews",
      "ProductHunt",
      "TikTok tech demos",
    ],
    purchase_triggers: [
      "Recently lost a wallet or experienced identity theft",
      "Saw a competitor ad and wanted something with GPS built in (not an add-on)",
      "Traveling internationally and worried about pickpockets",
    ],
    willingness_to_pay:
      "Up to $99 for the right combination of features — price-sensitive above $100",
  });
}

function researchCompetitorPrices(args: Record<string, string>): string {
  const { category } = args;
  const isWallet =
    category.toLowerCase().includes("wallet") || category.toLowerCase().includes("track");
  const competitors = isWallet
    ? [
        {
          name: "Ekster Parliament (Tracker Card add-on)",
          price: 89,
          gps: false,
          rfid: true,
          battery: "1 year (Tile card)",
          note: "Requires separate Tile subscription ($3/mo)",
        },
        {
          name: "Bellroy Hide & Seek w/ AirTag pocket",
          price: 95,
          gps: false,
          rfid: false,
          battery: "1 year (AirTag)",
          note: "AirTag sold separately ($29); no RFID blocking",
        },
        {
          name: "Woolet Pro",
          price: 119,
          gps: true,
          rfid: true,
          battery: "6 months",
          note: "GPS + RFID but 6-month battery requires charging",
        },
        {
          name: "Volterman Smart Wallet",
          price: 149,
          gps: true,
          rfid: true,
          battery: "rechargeable",
          note: "Premium; includes camera and power bank; bulky",
        },
      ]
    : [
        { name: "Budget Competitor", price: 49 },
        { name: "Mid Competitor", price: 89 },
        { name: "Premium Competitor", price: 139 },
      ];
  return JSON.stringify({
    category,
    competitors,
    price_gap:
      "Sweet spot at $79: undercuts Woolet Pro ($119) while matching Ekster tracker-card bundle ($89) but with built-in GPS",
    anchor_competitors: ["Ekster Parliament (Tracker Card)", "Woolet Pro"],
    market_insight:
      "No competitor offers 2-year battery — this is a unique and defensible differentiator",
  });
}

function recommendPricingStrategy(args: Record<string, string>): string {
  const { target_price, positioning } = args;
  const price = parseInt(target_price.replace(/[^0-9]/g, ""));
  return JSON.stringify({
    recommended_price: `$${price}`,
    strategy:
      positioning === "premium"
        ? "Prestige pricing — hold price, lean into exclusivity"
        : `Value penetration — $${price} sits below all GPS-native competitors, creating a compelling first-mover price point`,
    launch_pricing: {
      early_bird: `$${price - 10} (first 300 orders, Kickstarter)`,
      standard: `$${price}`,
      bundle: `$${price + 18} (+ extra backup tracker card)`,
    },
    key_message: `Best GPS + RFID value on the market at $${price} — Woolet Pro charges $119 for 6-month battery vs. our 2-year`,
    projected_conversion:
      "3.1% (vs 1.8% category average) — driven by clear price-value gap vs. nearest GPS competitor",
  });
}

function generateProductMessaging(args: Record<string, string>): string {
  const { product_name, top_benefit, target_audience } = args;
  return JSON.stringify({
    headline: "Never Lose What Matters Most",
    tagline: `${product_name} — GPS tracking and RFID protection, slim enough to forget it's there`,
    key_messages: [
      `${top_benefit} — without the bulk or the charging cable`,
      "2-year battery life. Zero charging anxiety. Just carry and go.",
      `Built for ${target_audience} who refuse to compromise on peace of mind`,
    ],
    elevator_pitch: `The world's first wallet combining real-time GPS tracking and bank-grade RFID blocking in a slim, card-slot design. ${product_name} fits in any pocket and lasts 2 years on a single battery.`,
    cta: "Back it on Kickstarter",
    tone_notes:
      "Confident but not boastful. Lead with security, follow with convenience. Avoid 'smart' — overused.",
  });
}

function selectLaunchChannels(_args: Record<string, string>): string {
  return JSON.stringify({
    primary_channels: [
      {
        channel: "Kickstarter",
        priority: "high",
        rationale:
          "Ideal for hardware launches — validates demand, creates urgency, funds early production",
        format: "60-second demo video + early-bird pricing tiers",
      },
      {
        channel: "Reddit (r/EDC, r/travel, r/gadgets)",
        priority: "high",
        rationale: "Exact target audience; organic posts and AMAs convert better than paid here",
        format: "Founder AMA + 'I built this' post with demo video",
      },
      {
        channel: "YouTube gear review channels (100K–2M subs)",
        priority: "high",
        rationale:
          "Pickpocket demo videos go viral; purchase-ready audience; 3–5% affiliate conversion",
        format: "Seed 15–20 units to reviewers 4 weeks before launch",
      },
    ],
    secondary_channels: [
      {
        channel: "TikTok (pickpocket demo content)",
        priority: "medium",
        format: "Short-form shock demos",
      },
      {
        channel: "Amazon (post-launch)",
        priority: "medium",
        format: "Optimized listing + A+ content",
      },
    ],
    avoid: [
      "TV/radio (wrong demographic)",
      "Facebook ads (poor ROAS for this price point)",
      "Cold email",
    ],
  });
}

function validateTechnicalClaims(args: Record<string, string>): string {
  const { claims } = args;
  const claimList = claims.split(",").map((c) => c.trim());
  return JSON.stringify({
    verified_claims: claimList
      .filter((c) => c.toLowerCase().includes("rfid") || c.toLowerCase().includes("bluetooth"))
      .concat([
        "RFID blocking (13.56 MHz ISO/IEC 14443): achievable with standard aluminum foil lining",
        "Bluetooth LE connectivity: mature technology, well within reach",
      ]),
    requires_disclaimers: [
      "2-year battery: achievable ONLY at ~1 GPS ping/hour — must state 'based on 1 location update per hour'",
      "GPS accuracy: spec as ±15m outdoors / ±50m indoors — do not claim 'precise' without qualification",
      "Slim design: specify dimensions; 'slim' is relative and subjective",
    ],
    red_flags: [],
    recommended_copy_changes: [
      "Change '2-year battery life' → '2-year battery life (at 1 ping/hour — see specs)'",
      "Change 'precise GPS' → 'GPS accurate to ±15m outdoors'",
    ],
  });
}

function checkComplianceRequirements(args: Record<string, string>): string {
  const { product_type, markets } = args;
  return JSON.stringify({
    product_type,
    target_markets: markets,
    required: [
      "FCC Part 15 (GPS + Bluetooth radio emissions — required for US market)",
      "CE Mark — RED Directive (radio equipment — required for EU market)",
      "Bluetooth SIG Qualification (required to use Bluetooth logo)",
      "REACH / RoHS (hazardous substances — required for EU)",
    ],
    recommended: [
      "IP54 water resistance rating (adds credibility vs. unrated competitors)",
      "MFi certification (if claiming 'optimized for iPhone' in marketing)",
    ],
    timeline: "FCC + CE: 8–12 weeks | Bluetooth SIG: 4–6 weeks | Run in parallel",
    estimated_cost: "$9,000–$14,000 for full compliance package",
    blocking_issues:
      "None — GPS wallets are consumer electronics; no special import permits required",
  });
}

// ─── Executors ─────────────────────────────────────────────────────────────────

export function executeRequirementsTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "analyze_product_features":
      return analyzeProductFeatures(args);
    case "identify_target_customer":
      return identifyTargetCustomer(args);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

export function executePricingTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "research_competitor_prices":
      return researchCompetitorPrices(args);
    case "recommend_pricing_strategy":
      return recommendPricingStrategy(args);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

export function executeMarketingTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "generate_product_messaging":
      return generateProductMessaging(args);
    case "select_launch_channels":
      return selectLaunchChannels(args);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

export function executeTechnicalTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "validate_technical_claims":
      return validateTechnicalClaims(args);
    case "check_compliance_requirements":
      return checkComplianceRequirements(args);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
