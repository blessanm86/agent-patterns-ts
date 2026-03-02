import { runVisionAgent } from "./agent.js";
import { prepareUserMessage } from "./image-utils.js";
import { createCLI } from "../shared/cli.js";
import { VISION_MODEL, MODEL } from "../shared/config.js";
import type { VisionMessage } from "./types.js";

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

const textOnly = process.argv.includes("--text-only");
const modelName = textOnly ? MODEL : VISION_MODEL;

createCLI({
  title: textOnly
    ? "Food Assistant — Text-Only Mode (no vision)"
    : "Food Assistant — Multi-Modal Agent",
  emoji: textOnly ? "📝" : "👁️",
  goodbye: "Bon appetit!",
  welcomeLines: [
    `    Model: ${modelName}${textOnly ? " (text-only, no image support)" : " (vision-language model)"}`,
    "",
    ...(textOnly
      ? [
          "    Running in text-only mode. The agent cannot see images.",
          "    Compare with vision mode: pnpm dev:multi-modal",
        ]
      : [
          "    Attach images with [image:path/to/file.jpg] syntax:",
          "",
          '    Try: "[image:samples/pasta-dish.png] What dish is this?"',
          '    Try: "[image:samples/restaurant-menu.png] What\'s on the menu?"',
          '    Try: "[image:samples/ingredients.png] What can I make with these?"',
        ]),
    "",
    "    Or just ask text questions:",
    "",
    '    Try: "Search for carbonara recipes"',
    '    Try: "What\'s the nutrition info for pad thai?"',
    '    Try: "Identify a dish with noodles, shrimp, and peanuts"',
  ],
  async onMessage(input, history) {
    let text: string;
    let images: string[] = [];

    if (textOnly) {
      // In text-only mode, strip image tags and warn
      const hasImageTags = /\[image:[^\]]+\]/.test(input);
      text = input.replace(/\[image:[^\]]+\]/g, "").trim() || input;
      if (hasImageTags) {
        console.log(
          "\n  ⚠️  Text-only mode: image references ignored. Run without --text-only for vision.",
        );
      }
    } else {
      try {
        const prepared = prepareUserMessage(input);
        text = prepared.text;
        images = prepared.images;
        if (images.length > 0) {
          console.log(`\n  🖼️  Loaded ${images.length} image(s)`);
        }
      } catch (err) {
        const error = err as Error;
        console.error(`\n  ❌ ${error.message}`);
        return { messages: history as VisionMessage[] };
      }
    }

    const messages = await runVisionAgent(text, images, history as VisionMessage[], { textOnly });
    return { messages };
  },
}).start();
