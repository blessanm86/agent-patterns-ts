import type { ToolDefinition } from "../shared/types.js";

// ─── The Cascade Matcher ──────────────────────────────────────────────────────
//
// A "Replacer" is a generator that takes the full file content and a search
// string, then yields candidate strings — substrings of the file — that could
// be the target location.
//
// The orchestrator (applyEdit) tries each replacer in order. For each yielded
// candidate it checks:
//   1. Does it appear in the file? (indexOf !== -1)
//   2. Does it appear exactly once? (indexOf === lastIndexOf)
//
// If both pass, the edit is applied and we return. If a candidate appears
// multiple times, that's flagged — we keep looking. If nothing works, we throw.

type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

// ── Strategy 1: Exact match ────────────────────────────────────────────────
// The simplest strategy: yield the search string as-is. The orchestrator will
// look for it verbatim in the file.

function* simpleReplacer(_content: string, find: string): Generator<string, void, unknown> {
  yield find;
}

// ── Strategy 2: Line-trimmed match ────────────────────────────────────────
// Slide a window of searchLines.length lines over the file. Compare each pair
// after calling .trim() on both. If all lines match when trimmed, yield the
// *original file content* for that window — preserving the file's actual
// whitespace so the replacement lands in the right bytes.
//
// Catches: extra/missing leading or trailing spaces per line.

function* lineTrimmedReplacer(content: string, find: string): Generator<string, void, unknown> {
  const fileLines = content.split("\n");
  const findLines = find.split("\n");
  // Strip trailing empty line that LLMs sometimes include
  if (findLines.at(-1) === "") findLines.pop();
  if (findLines.length === 0) return;

  for (let i = 0; i <= fileLines.length - findLines.length; i++) {
    let matches = true;
    for (let j = 0; j < findLines.length; j++) {
      if (fileLines[i + j].trim() !== findLines[j].trim()) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;

    // Compute byte offsets of this window in the original content string
    let matchStart = 0;
    for (let k = 0; k < i; k++) {
      matchStart += fileLines[k].length + 1; // +1 for '\n'
    }
    let matchEnd = matchStart;
    for (let k = 0; k < findLines.length; k++) {
      matchEnd += fileLines[i + k].length;
      if (k < findLines.length - 1) matchEnd += 1; // '\n' between lines
    }

    yield content.slice(matchStart, matchEnd);
  }
}

// ── Strategy 3: Whitespace-normalized match ────────────────────────────────
// Collapse all whitespace sequences to a single space on the whole block,
// then compare. Yields the original file block on match.
//
// Catches: tabs expanded to spaces, double spaces, mixed indentation.

function* whitespaceNormalizedReplacer(
  content: string,
  find: string,
): Generator<string, void, unknown> {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const normFind = norm(find);

  const fileLines = content.split("\n");
  const findLines = find.split("\n");
  if (findLines.at(-1) === "") findLines.pop();
  if (findLines.length === 0) return;

  for (let i = 0; i <= fileLines.length - findLines.length; i++) {
    const block = fileLines.slice(i, i + findLines.length).join("\n");
    if (norm(block) === normFind) yield block;
  }
}

// ── Strategy 4: Indentation-flexible match ────────────────────────────────
// Strip the minimum common indentation from both the search string and each
// candidate window, then compare. Yields the original file window on match.
//
// Catches: model de-indented the block by one level, or added an extra level.

function* indentationFlexibleReplacer(
  content: string,
  find: string,
): Generator<string, void, unknown> {
  const deindent = (s: string) => {
    const lines = s.split("\n");
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    if (!nonEmpty.length) return s;
    const minIndent = Math.min(
      ...nonEmpty.map((l) => {
        const m = l.match(/^(\s*)/);
        return m ? m[1].length : 0;
      }),
    );
    return lines.map((l) => (l.trim().length === 0 ? l : l.slice(minIndent))).join("\n");
  };

  const fileLines = content.split("\n");
  const findLines = find.split("\n");
  if (findLines.at(-1) === "") findLines.pop();
  if (findLines.length === 0) return;
  // Compute normFind from the cleaned-up findLines (after pop) so a trailing
  // newline in find doesn't cause a spurious mismatch with window blocks.
  const normFind = deindent(findLines.join("\n"));

  for (let i = 0; i <= fileLines.length - findLines.length; i++) {
    const block = fileLines.slice(i, i + findLines.length).join("\n");
    if (deindent(block) === normFind) yield block;
  }
}

// ── The strategy list (tried in order) ────────────────────────────────────

const REPLACERS: Array<{ name: string; fn: Replacer }> = [
  { name: "exact", fn: simpleReplacer },
  { name: "line-trimmed", fn: lineTrimmedReplacer },
  { name: "whitespace-normalized", fn: whitespaceNormalizedReplacer },
  { name: "indentation-flexible", fn: indentationFlexibleReplacer },
];

// ── applyEdit ─────────────────────────────────────────────────────────────
//
// Tries each strategy in order. For each candidate string:
//   - If it appears exactly once → apply the replacement and return
//   - If it appears multiple times → set foundButNotUnique flag and continue
//   - If it doesn't appear → continue to next strategy
//
// Throws a specific error message in each failure case, designed to help the
// LLM understand what to fix on the next attempt.

export interface EditResult {
  content: string; // new file content
  strategy: string; // which replacer succeeded
}

export function applyEdit(content: string, oldStr: string, newStr: string): EditResult {
  if (oldStr === newStr) throw new Error("No changes: old_str and new_str are identical.");

  let foundButNotUnique = false;

  for (const { name, fn } of REPLACERS) {
    for (const candidate of fn(content, oldStr)) {
      const idx = content.indexOf(candidate);
      if (idx === -1) continue; // candidate not in file

      const lastIdx = content.lastIndexOf(candidate);
      if (idx !== lastIdx) {
        // Found, but not unique — remember this and keep looking
        foundButNotUnique = true;
        continue;
      }

      // Unique match — apply the replacement
      return {
        content: content.slice(0, idx) + newStr + content.slice(idx + candidate.length),
        strategy: name,
      };
    }
  }

  if (foundButNotUnique) {
    throw new Error(
      "Found multiple matches for old_str. " +
        "Include 2-4 more lines of surrounding context to uniquely identify the target location.",
    );
  }
  throw new Error(
    "No match found for old_str. " +
      "Make sure old_str exactly matches the content returned by read_file, " +
      "including all whitespace, indentation, and punctuation.",
  );
}

// ─── Virtual Filesystem ───────────────────────────────────────────────────────
//
// The demo uses an in-memory filesystem so it's self-contained — no actual
// files are read or written. The menu.ts fixture is pre-loaded at startup.
// Use getVirtualFS() to inspect the current file state (e.g., for display).

export const MENU_INITIAL = `// Bella Italia Restaurant — Spring Menu
// Last updated: 2026

export const menu = {
  starters: [
    { name: "Bruschetta", price: 8.50, description: "Toasted bread with fresh tomatoes and basil" },
    { name: "Calamari Fritti", price: 12.00, description: "Crispy fried squid with marinara sauce" },
    { name: "Caprese Salad", price: 10.50, description: "Fresh mozzarella with heirloom tomatoes and basil oil" },
    { name: "Burrata", price: 14.00, description: "Creamy burrata with prosciutto and grilled peach" },
  ],
  mains: [
    { name: "Spaghetti Carbonara", price: 18.00, description: "Classic carbonara with guanciale, egg yolk, and pecorino" },
    { name: "Penne Arrabbiata", price: 16.00, description: "Penne with spicy tomato and chilli sauce" },
    { name: "Risotto ai Funghi", price: 20.00, description: "Creamy arborio risotto with wild mushrooms and truffle oil" },
    { name: "Grilled Salmon", price: 24.00, description: "Atlantic salmon with lemon butter sauce and asparagus" },
    { name: "Osso Buco", price: 28.00, description: "Braised veal shank with gremolata and saffron risotto" },
  ],
  desserts: [
    { name: "Tiramisu", price: 8.00, description: "Classic Italian dessert with espresso and mascarpone" },
    { name: "Panna Cotta", price: 7.00, description: "Vanilla cream with fresh berry coulis" },
    { name: "Cannoli Siciliani", price: 9.00, description: "Crispy shells filled with sweetened ricotta and pistachios" },
  ],
};
`;

// The virtual filesystem — mutable during the session
const vfs = new Map<string, string>([["menu.ts", MENU_INITIAL]]);

// Tracks which files have been read — enforces read-before-edit
const readSet = new Set<string>();

export function getVirtualFS(): Map<string, string> {
  return vfs;
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

function readFile(args: { path: string }): string {
  const content = vfs.get(args.path);
  if (content === undefined) {
    const available = [...vfs.keys()].join(", ");
    return JSON.stringify({
      error: `File not found: "${args.path}". Available files: ${available}`,
    });
  }
  readSet.add(args.path);
  return content;
}

function editFile(args: { path: string; old_str: string; new_str: string }): string {
  // Enforce read-before-edit: the agent must have seen the current file state
  if (!readSet.has(args.path)) {
    return JSON.stringify({
      error:
        `Must call read_file("${args.path}") before editing it. ` +
        `You need the current file content to craft a precise old_str.`,
    });
  }

  const content = vfs.get(args.path);
  if (content === undefined) {
    return JSON.stringify({ error: `File not found: "${args.path}"` });
  }

  try {
    const { content: newContent, strategy } = applyEdit(content, args.old_str, args.new_str);
    vfs.set(args.path, newContent);
    return `Edit applied successfully. (cascade strategy: ${strategy})`;
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

function createFile(args: { path: string; content: string }): string {
  if (vfs.has(args.path)) {
    return JSON.stringify({
      error: `File already exists: "${args.path}". Use edit_file to modify it.`,
    });
  }
  vfs.set(args.path, args.content);
  readSet.add(args.path); // newly created = already "read"
  return `File created: "${args.path}"`;
}

// ─── Tool Definitions (sent to the model) ─────────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the current contents of a file. You MUST call this before calling edit_file — " +
        "you need the current content to craft an accurate old_str.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path to read (e.g. menu.ts)",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Edit a file by replacing old_str with new_str. Rules:\n" +
        "1. Call read_file first — you need current content to write an accurate old_str.\n" +
        "2. old_str must uniquely identify the target location; include 2-4 lines of surrounding context.\n" +
        "3. old_str must match the file exactly — same whitespace, indentation, and punctuation.\n" +
        "If the edit fails, the error will say whether no match was found or multiple matches exist.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path to edit",
          },
          old_str: {
            type: "string",
            description:
              "The exact text to replace. Must appear exactly once in the file. " +
              "Include surrounding lines for context if the target text is short or repeated.",
          },
          new_str: {
            type: "string",
            description: "The replacement text.",
          },
        },
        required: ["path", "old_str", "new_str"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_file",
      description: "Create a new file with the given content.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path to create",
          },
          content: {
            type: "string",
            description: "The full file content",
          },
        },
        required: ["path", "content"],
      },
    },
  },
];

// ─── Tool Dispatcher ──────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "read_file":
      return readFile(args as Parameters<typeof readFile>[0]);
    case "edit_file":
      return editFile(args as Parameters<typeof editFile>[0]);
    case "create_file":
      return createFile(args as Parameters<typeof createFile>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
