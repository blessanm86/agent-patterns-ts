import * as fs from "fs";
import * as path from "path";
import type { ParsedInput } from "./types.js";

// ─── Image Utilities ────────────────────────────────────────────────────────────
//
// Handles parsing [image:path] syntax from CLI input and loading images as base64.
// The bracket syntax lets users reference images inline:
//   [image:samples/pasta-dish.jpg] What dish is this?

const IMAGE_TAG_REGEX = /\[image:([^\]]+)\]/g;

export function parseImageReferences(input: string): ParsedInput {
  const imagePaths: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = IMAGE_TAG_REGEX.exec(input)) !== null) {
    imagePaths.push(match[1].trim());
  }

  const text = input.replace(IMAGE_TAG_REGEX, "").trim();

  return { text: text || "Describe this image.", imagePaths };
}

export function loadImageAsBase64(filePath: string): string {
  // Resolve relative paths from the multi-modal directory
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(path.dirname(new URL(import.meta.url).pathname), filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Image not found: ${resolved}`);
  }

  const buffer = fs.readFileSync(resolved);
  return buffer.toString("base64");
}

export function prepareUserMessage(input: string): { text: string; images: string[] } {
  const parsed = parseImageReferences(input);

  const images: string[] = [];
  for (const imagePath of parsed.imagePaths) {
    images.push(loadImageAsBase64(imagePath));
  }

  return { text: parsed.text, images };
}
