import { createCLI } from "../shared/cli.js";
import type { Message } from "../shared/types.js";
import { runAgent } from "./agent.js";
import { renderForPlatform, ALL_PLATFORMS } from "./renderers/index.js";
import { formatPlatformPanel, formatEntityStats } from "./display.js";
import type { PlatformType } from "./types.js";

// ─── CLI Options ─────────────────────────────────────────────────────────────
//
// --platform <name>  Show only one platform's rendering (terminal|markdown|html|slack)
// default:           Show all 4 platform renderings

function parsePlatformArg(): PlatformType | null {
  const idx = process.argv.indexOf("--platform");
  if (idx === -1 || idx + 1 >= process.argv.length) return null;

  const value = process.argv[idx + 1] as PlatformType;
  if (ALL_PLATFORMS.includes(value)) return value;

  console.error(`\nUnknown platform: "${process.argv[idx + 1]}"`);
  console.error(`Valid platforms: ${ALL_PLATFORMS.join(", ")}\n`);
  process.exit(1);
}

const selectedPlatform = parsePlatformArg();

// ─── Determine which platforms to show ──────────────────────────────────────

// Terminal is always the primary display (shown in the main response line).
// Other platforms are shown as panels below the response.
const panelPlatforms: PlatformType[] = selectedPlatform
  ? selectedPlatform === "terminal"
    ? []
    : [selectedPlatform]
  : ["markdown", "html", "slack"];

// ─── CLI Entry Point ────────────────────────────────────────────────────────

let rawHistory: Message[] = [];

const cli = createCLI({
  title: "NovaMart Support \u2014 Cross-Platform Rendering",
  emoji: "\u{1F310}",
  goodbye: "Goodbye! \u{1F310}",
  welcomeLines: [
    selectedPlatform
      ? `    Platform: ${selectedPlatform}`
      : "    Showing all platforms: terminal, markdown, html, slack",
    "",
    "    The same agent response rendered for each platform.",
    '    Try: "Look up Alice Johnson" or "What\'s in order ORD-5001?"',
    "",
    "    Usage: pnpm dev:cross-platform-rendering [--platform terminal|markdown|html|slack]",
    "",
  ],

  async onMessage(input: string, _history: Message[]) {
    const result = await runAgent(input, rawHistory);
    rawHistory = result.rawHistory;

    // Render for terminal (primary display) — this goes into the response line
    const terminal = renderForPlatform(result.rawContent, "terminal");

    // Build stats lines: entity stats + platform panels
    const stats: string[] = [];

    // Entity stats panel
    if (result.entityStats) {
      stats.push(...formatEntityStats(result.entityStats));
    }

    // Platform panels (non-terminal renderings)
    for (const platform of panelPlatforms) {
      const { rendered } = renderForPlatform(result.rawContent, platform);
      stats.push(...formatPlatformPanel(platform, rendered));
    }

    // Return terminal rendering as the main "message" for printResponse,
    // and platform panels as stats lines below
    const messages: Message[] = [
      ...rawHistory.slice(0, -1),
      {
        role: "assistant" as const,
        content: terminal.rendered,
      },
    ];

    return { messages, stats };
  },
});

cli.start();
