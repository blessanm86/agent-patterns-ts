import type { KBDocument, Chunk } from "./types.js";

// ─── Document Chunker ───────────────────────────────────────────────────────
//
// Splits KBDocuments into smaller Chunk objects suitable for search.
// Strategy: split by ## headings first, then by paragraph (\n\n).
// Tiny chunks (<50 words) are merged into the previous chunk.

const MIN_CHUNK_WORDS = 50;

export function chunkDocuments(docs: KBDocument[]): Chunk[] {
  const chunks: Chunk[] = [];
  let chunkId = 0;

  for (const doc of docs) {
    const sections = splitBySections(doc.content);

    for (const section of sections) {
      const heading = section.heading || doc.title;
      const paragraphs = section.body
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter(Boolean);

      // Merge small paragraphs together
      let buffer = "";
      for (const para of paragraphs) {
        if (buffer && wordCount(buffer) >= MIN_CHUNK_WORDS) {
          chunks.push({
            id: `chunk-${chunkId++}`,
            source: doc.id,
            heading,
            content: buffer.trim(),
          });
          buffer = "";
        }
        buffer += (buffer ? "\n\n" : "") + para;
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        // If the remaining buffer is tiny and there's a previous chunk from the same section, merge
        if (wordCount(buffer) < MIN_CHUNK_WORDS && chunks.length > 0) {
          const last = chunks[chunks.length - 1];
          if (last.source === doc.id && last.heading === heading) {
            last.content += "\n\n" + buffer.trim();
            continue;
          }
        }
        chunks.push({
          id: `chunk-${chunkId++}`,
          source: doc.id,
          heading,
          content: buffer.trim(),
        });
      }
    }
  }

  return chunks;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface Section {
  heading: string;
  body: string;
}

function splitBySections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentHeading = "";
  let currentBody: string[] = [];

  for (const line of lines) {
    // Match ## headings (level 2) — level 1 (#) is the doc title
    const headingMatch = line.match(/^#{2,3}\s+(.+)/);
    if (headingMatch) {
      // Save previous section
      if (currentBody.length > 0) {
        sections.push({ heading: currentHeading, body: currentBody.join("\n") });
      }
      currentHeading = headingMatch[1];
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  // Flush last section
  if (currentBody.length > 0) {
    sections.push({ heading: currentHeading, body: currentBody.join("\n") });
  }

  return sections;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
