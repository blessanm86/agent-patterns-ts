import type { Message } from "../shared/types.js";

// ─── Vision Message ──────────────────────────────────────────────────────────────
//
// Extends the shared Message type with an optional images array.
// Ollama accepts images as base64-encoded strings on user messages.

export interface VisionMessage extends Message {
  images?: string[]; // base64-encoded image data
}

// ─── Parsed Input ───────────────────────────────────────────────────────────────
//
// Result of parsing a user's input for image references like [image:path/to/file.jpg]

export interface ParsedInput {
  text: string; // the input with image references removed
  imagePaths: string[]; // resolved file paths extracted from [image:...] tags
}
