// ─── Tool Registry + Mock Tool Implementations ──────────────────────────────
//
// The ToolRegistry holds all namespaced tools (weather.lookup, math.evaluate, etc.)
// and provides list/describe/invoke operations that the JSON-RPC router calls.

import type { NamespacedTool, ToolParameterSchema } from "./types.js";

// ─── ToolRegistry ────────────────────────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, NamespacedTool>();

  register(tool: NamespacedTool): void {
    this.tools.set(tool.fullName, tool);
  }

  has(fullName: string): boolean {
    return this.tools.has(fullName);
  }

  list(): Array<{ fullName: string; description: string }> {
    return [...this.tools.values()].map((t) => ({
      fullName: t.fullName,
      description: t.description,
    }));
  }

  describe(fullName: string): NamespacedTool | undefined {
    return this.tools.get(fullName);
  }

  invoke(fullName: string, args: Record<string, string>): string {
    const tool = this.tools.get(fullName);
    if (!tool) {
      throw new Error(`Unknown tool: ${fullName}`);
    }
    return tool.implementation(args);
  }
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeTool(
  namespace: string,
  name: string,
  description: string,
  parameters: Record<string, ToolParameterSchema>,
  required: string[],
  implementation: (args: Record<string, string>) => string,
): NamespacedTool {
  return {
    namespace,
    name,
    fullName: `${namespace}.${name}`,
    description,
    parameters,
    required,
    implementation,
  };
}

// ─── Mock Tools ──────────────────────────────────────────────────────────────

const WEATHER_DATA: Record<
  string,
  { temp: number; conditions: string; humidity: number; wind: string }
> = {
  paris: { temp: 18, conditions: "Partly cloudy", humidity: 65, wind: "12 km/h NW" },
  tokyo: { temp: 22, conditions: "Clear", humidity: 55, wind: "8 km/h E" },
  "new york": { temp: 15, conditions: "Overcast", humidity: 72, wind: "18 km/h SW" },
  london: { temp: 12, conditions: "Light rain", humidity: 85, wind: "22 km/h W" },
  sydney: { temp: 26, conditions: "Sunny", humidity: 45, wind: "15 km/h NE" },
  berlin: { temp: 10, conditions: "Foggy", humidity: 90, wind: "5 km/h N" },
  mumbai: { temp: 32, conditions: "Hot and humid", humidity: 78, wind: "10 km/h S" },
  toronto: { temp: 8, conditions: "Snow flurries", humidity: 70, wind: "20 km/h NW" },
};

const MOCK_FILES = [
  "src/index.ts",
  "src/agent.ts",
  "src/tools.ts",
  "src/types.ts",
  "src/utils/config.ts",
  "src/utils/logger.ts",
  "src/utils/parser.ts",
  "src/components/header.tsx",
  "src/components/footer.tsx",
  "src/components/sidebar.tsx",
  "src/api/routes.ts",
  "src/api/middleware.ts",
  "src/api/handlers/users.ts",
  "src/api/handlers/orders.ts",
  "tests/agent.test.ts",
  "tests/tools.test.ts",
  "tests/api.test.ts",
  "package.json",
  "tsconfig.json",
  "README.md",
];

const RESTAURANT_DATA = [
  { name: "Le Petit Bistro", city: "paris", cuisine: "french", rating: 4.5, price: "$$$" },
  { name: "Sushi Yamamoto", city: "tokyo", cuisine: "japanese", rating: 4.8, price: "$$$$" },
  { name: "Ramen Ichiban", city: "tokyo", cuisine: "japanese", rating: 4.3, price: "$$" },
  { name: "Sakura Garden", city: "tokyo", cuisine: "japanese", rating: 4.1, price: "$$$" },
  { name: "Joe's Pizza", city: "new york", cuisine: "italian", rating: 4.2, price: "$" },
  { name: "Pasta Palace", city: "new york", cuisine: "italian", rating: 4.0, price: "$$" },
  { name: "Curry House", city: "london", cuisine: "indian", rating: 4.4, price: "$$" },
  { name: "Fish & Ships", city: "london", cuisine: "british", rating: 3.9, price: "$$" },
  { name: "Bondi Grill", city: "sydney", cuisine: "australian", rating: 4.1, price: "$$$" },
  { name: "Berlin Döner", city: "berlin", cuisine: "turkish", rating: 4.6, price: "$" },
  { name: "Spice Route", city: "mumbai", cuisine: "indian", rating: 4.7, price: "$$" },
  { name: "Tandoori Nights", city: "mumbai", cuisine: "indian", rating: 4.3, price: "$$$" },
  { name: "Maple Leaf Diner", city: "toronto", cuisine: "canadian", rating: 4.0, price: "$$" },
  { name: "Chez Marie", city: "paris", cuisine: "french", rating: 4.7, price: "$$$$" },
  { name: "Tokyo Taco", city: "tokyo", cuisine: "mexican", rating: 3.8, price: "$" },
];

// Safe arithmetic evaluator — no eval() or Function()
function safeEvaluate(expression: string): number {
  // Tokenize: numbers (including decimals), operators, parens, and function names
  const tokens: string[] = [];
  let i = 0;
  const expr = expression.replace(/\s+/g, "");

  while (i < expr.length) {
    // Number (including decimals)
    if (/[\d.]/.test(expr[i])) {
      let num = "";
      while (i < expr.length && /[\d.]/.test(expr[i])) {
        num += expr[i++];
      }
      tokens.push(num);
    }
    // Function name (letters)
    else if (/[a-z]/i.test(expr[i])) {
      let fn = "";
      while (i < expr.length && /[a-z]/i.test(expr[i])) {
        fn += expr[i++];
      }
      tokens.push(fn);
    }
    // Operators and parens
    else if ("+-*/()^%".includes(expr[i])) {
      tokens.push(expr[i++]);
    } else {
      throw new Error(`Unexpected character: ${expr[i]}`);
    }
  }

  // Recursive descent parser
  let pos = 0;

  function parseExpression(): number {
    let left = parseTerm();
    while (pos < tokens.length && (tokens[pos] === "+" || tokens[pos] === "-")) {
      const op = tokens[pos++];
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    while (
      pos < tokens.length &&
      (tokens[pos] === "*" || tokens[pos] === "/" || tokens[pos] === "%")
    ) {
      const op = tokens[pos++];
      const right = parsePower();
      if (op === "*") left *= right;
      else if (op === "/") left /= right;
      else left %= right;
    }
    return left;
  }

  function parsePower(): number {
    let base = parseUnary();
    while (pos < tokens.length && tokens[pos] === "^") {
      pos++;
      const exp = parseUnary();
      base = Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary(): number {
    if (tokens[pos] === "-") {
      pos++;
      return -parseAtom();
    }
    if (tokens[pos] === "+") {
      pos++;
    }
    return parseAtom();
  }

  const MATH_FNS: Record<string, (x: number) => number> = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    log: Math.log10,
    ln: Math.log,
    ceil: Math.ceil,
    floor: Math.floor,
    round: Math.round,
  };

  const MATH_CONSTANTS: Record<string, number> = {
    pi: Math.PI,
    e: Math.E,
  };

  function parseAtom(): number {
    const token = tokens[pos];

    // Function call: sqrt(x)
    if (token in MATH_FNS) {
      pos++; // skip function name
      if (tokens[pos] !== "(") throw new Error(`Expected ( after ${token}`);
      pos++; // skip (
      const arg = parseExpression();
      if (tokens[pos] !== ")") throw new Error(`Expected ) after ${token} argument`);
      pos++; // skip )
      return MATH_FNS[token](arg);
    }

    // Constants
    if (token in MATH_CONSTANTS) {
      pos++;
      return MATH_CONSTANTS[token];
    }

    // Parenthesized expression
    if (token === "(") {
      pos++;
      const value = parseExpression();
      if (tokens[pos] !== ")") throw new Error("Missing closing parenthesis");
      pos++;
      return value;
    }

    // Number
    const num = Number.parseFloat(token);
    if (Number.isNaN(num)) throw new Error(`Unexpected token: ${token}`);
    pos++;
    return num;
  }

  const result = parseExpression();
  if (pos < tokens.length) {
    throw new Error(`Unexpected token after expression: ${tokens[pos]}`);
  }
  return result;
}

// ─── Register All Tools ──────────────────────────────────────────────────────

export function registerAllTools(registry: ToolRegistry): void {
  registry.register(
    makeTool(
      "weather",
      "lookup",
      "Look up current weather conditions for a city",
      {
        city: { type: "string", description: "City name (e.g. 'Paris', 'Tokyo')" },
      },
      ["city"],
      (args) => {
        const city = args.city.toLowerCase();
        const data = WEATHER_DATA[city];
        if (!data) {
          return JSON.stringify({
            error: `No weather data for "${args.city}". Available cities: ${Object.keys(WEATHER_DATA).join(", ")}`,
          });
        }
        return JSON.stringify({
          city: args.city,
          temperature: `${data.temp}°C`,
          conditions: data.conditions,
          humidity: `${data.humidity}%`,
          wind: data.wind,
        });
      },
    ),
  );

  registry.register(
    makeTool(
      "math",
      "evaluate",
      "Evaluate a mathematical expression safely. Supports +, -, *, /, ^, %, parentheses, and functions: sqrt, abs, sin, cos, tan, log, ln, ceil, floor, round. Constants: pi, e.",
      {
        expression: {
          type: "string",
          description: "Mathematical expression (e.g. 'sqrt(144) + 25')",
        },
      },
      ["expression"],
      (args) => {
        try {
          const result = safeEvaluate(args.expression);
          return JSON.stringify({ expression: args.expression, result });
        } catch (err) {
          return JSON.stringify({ error: (err as Error).message, expression: args.expression });
        }
      },
    ),
  );

  registry.register(
    makeTool(
      "files",
      "search",
      "Search for files matching a glob-like pattern in a mock project directory",
      {
        pattern: { type: "string", description: "Search pattern (e.g. '*.ts', 'api/*', 'test')" },
        directory: { type: "string", description: "Directory prefix to filter (e.g. 'src/api')" },
      },
      ["pattern"],
      (args) => {
        const pattern = args.pattern.toLowerCase();
        const directory = args.directory?.toLowerCase();
        let results = MOCK_FILES;

        if (directory) {
          results = results.filter((f) => f.toLowerCase().startsWith(directory));
        }

        // Simple pattern matching: * as wildcard
        if (pattern !== "*") {
          const regex = new RegExp(pattern.replace(/\*/g, ".*").replace(/\?/g, "."), "i");
          results = results.filter((f) => {
            const filename = f.split("/").pop() ?? f;
            return regex.test(filename) || regex.test(f);
          });
        }

        return JSON.stringify({
          pattern: args.pattern,
          directory: args.directory ?? "/",
          matches: results,
          count: results.length,
        });
      },
    ),
  );

  registry.register(
    makeTool(
      "restaurant",
      "find",
      "Find restaurants by city and optional cuisine type",
      {
        city: { type: "string", description: "City name (e.g. 'Tokyo', 'Paris')" },
        cuisine: {
          type: "string",
          description: "Cuisine type to filter by (e.g. 'italian', 'japanese')",
        },
      },
      ["city"],
      (args) => {
        const city = args.city.toLowerCase();
        let results = RESTAURANT_DATA.filter((r) => r.city === city);

        if (args.cuisine) {
          const cuisine = args.cuisine.toLowerCase();
          results = results.filter((r) => r.cuisine === cuisine);
        }

        if (results.length === 0) {
          const availableCities = [...new Set(RESTAURANT_DATA.map((r) => r.city))];
          return JSON.stringify({
            error: `No restaurants found for the given criteria. Available cities: ${availableCities.join(", ")}`,
          });
        }

        return JSON.stringify({
          city: args.city,
          cuisine: args.cuisine ?? "all",
          restaurants: results.map((r) => ({
            name: r.name,
            cuisine: r.cuisine,
            rating: r.rating,
            price: r.price,
          })),
          count: results.length,
        });
      },
    ),
  );
}
