import { ConversationMetadataSchema, type ConversationMetadata, type SSEEvent } from "./types.js";

// ─── Sentinel Processor ─────────────────────────────────────────────────────
//
// A state machine that intercepts TextEvents in the SSE stream to detect
// <metadata>...</metadata> sentinel tags. When found, the metadata JSON is
// buffered (invisible to the user), parsed, validated, and emitted as a
// MetadataEvent. All other event types pass through unchanged.
//
// State machine:
//
//   PROSE  ──(detect "<metadata>")──>  BUFFERING  ──(detect "</metadata>")──>  DONE
//
// The hard part: the opening tag might be split across multiple text chunks.
// We handle this by keeping a trailing buffer of the last N-1 characters
// (where N = "<metadata>".length = 10) to check for partial tag matches.

const OPEN_TAG = "<metadata>";
const CLOSE_TAG = "</metadata>";

type State = "prose" | "buffering" | "done";

export type Emit = (event: SSEEvent) => void;

export interface SentinelResult {
  metadata: ConversationMetadata | null;
  detected: boolean;
}

/**
 * Creates a sentinel-aware emit wrapper. The returned `emit` function
 * intercepts TextEvents and runs the state machine. Call `flush()` when
 * the stream ends to handle the case where the model never emits a sentinel.
 */
export function createSentinelProcessor(innerEmit: Emit): {
  emit: Emit;
  flush: () => SentinelResult;
} {
  let state: State = "prose";

  // Accumulates all text we've seen — we search for the open tag here
  // instead of per-chunk to avoid missing cross-chunk boundaries.
  let textAccumulator = "";

  // Buffers the JSON between <metadata> and </metadata>
  let metadataBuffer = "";

  // Parsed metadata result
  let parsedMetadata: ConversationMetadata | null = null;
  let detected = false;

  // Track how many characters of textAccumulator we've already emitted
  let emittedUpTo = 0;

  function processText(content: string): void {
    if (state === "done") {
      // After metadata extraction, any remaining text passes through
      innerEmit({ type: "text", content });
      return;
    }

    textAccumulator += content;

    if (state === "prose") {
      const tagIndex = textAccumulator.indexOf(
        OPEN_TAG,
        Math.max(0, emittedUpTo - OPEN_TAG.length + 1),
      );

      if (tagIndex !== -1) {
        // Found the opening tag — emit any prose before it
        const proseBeforeTag = textAccumulator.substring(emittedUpTo, tagIndex);
        if (proseBeforeTag) {
          innerEmit({ type: "text", content: proseBeforeTag });
        }
        emittedUpTo = tagIndex + OPEN_TAG.length;

        // Start buffering after the tag
        metadataBuffer = textAccumulator.substring(emittedUpTo);
        state = "buffering";
        detected = true;

        // Check if the close tag is already in the buffer
        checkCloseTag();
      } else {
        // No tag found yet — emit text but keep a trailing window
        // in case the tag straddles chunk boundaries
        const safeEnd = textAccumulator.length - (OPEN_TAG.length - 1);
        if (safeEnd > emittedUpTo) {
          const safeText = textAccumulator.substring(emittedUpTo, safeEnd);
          innerEmit({ type: "text", content: safeText });
          emittedUpTo = safeEnd;
        }
      }
    } else if (state === "buffering") {
      // Append new content to metadata buffer
      metadataBuffer += content;
      checkCloseTag();
    }
  }

  function checkCloseTag(): void {
    const closeIndex = metadataBuffer.indexOf(CLOSE_TAG);
    if (closeIndex !== -1) {
      const jsonStr = metadataBuffer.substring(0, closeIndex).trim();
      const afterClose = metadataBuffer.substring(closeIndex + CLOSE_TAG.length);

      // Parse and validate the metadata JSON
      parsedMetadata = parseMetadata(jsonStr);
      if (parsedMetadata) {
        innerEmit({ type: "metadata", metadata: parsedMetadata });
      }

      state = "done";

      // If there's any text after </metadata>, emit it
      if (afterClose.trim()) {
        innerEmit({ type: "text", content: afterClose });
      }
    }
  }

  function parseMetadata(jsonStr: string): ConversationMetadata | null {
    try {
      const parsed = JSON.parse(jsonStr);
      const result = ConversationMetadataSchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      console.warn("[sentinel] Schema validation failed:", result.error.issues);
      return null;
    } catch (e) {
      console.warn("[sentinel] JSON parse failed:", (e as Error).message);
      return null;
    }
  }

  const emit: Emit = (event) => {
    if (event.type === "text") {
      processText(event.content);
    } else {
      // All non-text events pass through unchanged
      innerEmit(event);
    }
  };

  /**
   * Call when the stream ends. If we never found a sentinel, flush any
   * buffered text so nothing is silently swallowed.
   */
  function flush(): SentinelResult {
    if (state === "prose") {
      // No sentinel found — emit any un-emitted trailing text
      if (emittedUpTo < textAccumulator.length) {
        const remaining = textAccumulator.substring(emittedUpTo);
        innerEmit({ type: "text", content: remaining });
      }
    } else if (state === "buffering") {
      // Stream ended mid-metadata — treat buffered content as text
      // (graceful degradation: user sees the raw metadata block)
      console.warn("[sentinel] Stream ended while buffering metadata — flushing as text");
      innerEmit({ type: "text", content: OPEN_TAG + metadataBuffer });
    }

    return { metadata: parsedMetadata, detected };
  }

  return { emit, flush };
}
