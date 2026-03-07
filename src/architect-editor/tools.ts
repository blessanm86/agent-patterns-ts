import type { ToolDefinition } from "../shared/types.js";

// ─── The Cascade Matcher ──────────────────────────────────────────────────────
//
// Tries progressively looser matching strategies so that minor whitespace
// drift in the model's old_str doesn't cause a hard failure.
//
// Each "Replacer" generator yields candidate substrings from the file that
// could be the match target. The orchestrator (applyEdit) checks each candidate:
//   1. Does it appear in the file? (indexOf !== -1)
//   2. Does it appear exactly once? (indexOf === lastIndexOf)
//
// The first strategy to produce a unique match wins.

type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

function* simpleReplacer(_content: string, find: string): Generator<string, void, unknown> {
  yield find;
}

function* lineTrimmedReplacer(content: string, find: string): Generator<string, void, unknown> {
  const fileLines = content.split("\n");
  const findLines = find.split("\n");
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

    let matchStart = 0;
    for (let k = 0; k < i; k++) matchStart += fileLines[k].length + 1;
    let matchEnd = matchStart;
    for (let k = 0; k < findLines.length; k++) {
      matchEnd += fileLines[i + k].length;
      if (k < findLines.length - 1) matchEnd += 1;
    }
    yield content.slice(matchStart, matchEnd);
  }
}

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
  const normFind = deindent(findLines.join("\n"));

  for (let i = 0; i <= fileLines.length - findLines.length; i++) {
    const block = fileLines.slice(i, i + findLines.length).join("\n");
    if (deindent(block) === normFind) yield block;
  }
}

const REPLACERS: Array<{ name: string; fn: Replacer }> = [
  { name: "exact", fn: simpleReplacer },
  { name: "line-trimmed", fn: lineTrimmedReplacer },
  { name: "whitespace-normalized", fn: whitespaceNormalizedReplacer },
  { name: "indentation-flexible", fn: indentationFlexibleReplacer },
];

export function applyEdit(content: string, oldStr: string, newStr: string): string {
  if (oldStr === newStr) throw new Error("No changes: old_str and new_str are identical.");

  let foundButNotUnique = false;

  for (const { fn } of REPLACERS) {
    for (const candidate of fn(content, oldStr)) {
      const idx = content.indexOf(candidate);
      if (idx === -1) continue;
      const lastIdx = content.lastIndexOf(candidate);
      if (idx !== lastIdx) {
        foundButNotUnique = true;
        continue;
      }
      return content.slice(0, idx) + newStr + content.slice(idx + candidate.length);
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

export const RECIPE_FILE = "carbonara.md";

export const RECIPE_INITIAL = `# Spaghetti Carbonara

Serves: 4
Prep time: 10 minutes
Cook time: 20 minutes

## Ingredients

- 400g spaghetti
- 200g guanciale (or pancetta), diced
- 4 large eggs
- 100g Pecorino Romano, finely grated
- 50g Parmesan, finely grated
- 2 cloves garlic
- Freshly ground black pepper
- Salt for pasta water

## Instructions

1. Bring a large pot of salted water to a boil. Cook spaghetti until al dente,
   reserving 250ml pasta water before draining.
2. Fry guanciale in a large skillet over medium heat until crispy. Remove from heat.
3. Whisk eggs, Pecorino Romano, and Parmesan together. Season generously with black pepper.
4. Crush garlic cloves and add to guanciale; discard garlic after 1 minute.
5. Add hot drained pasta to the skillet and toss with guanciale fat off the heat.
6. Pour egg mixture over pasta; toss constantly, adding reserved pasta water a splash
   at a time until sauce is silky and coats every strand.
7. Serve immediately with extra cheese and black pepper.

## Notes

- Guanciale is traditional; pancetta is a widely available substitute.
- Never add cream — carbonara gets its creaminess from the egg-fat emulsion.
- The pan must be off heat when adding eggs to avoid scrambling.
`;

// The virtual filesystem — mutable during the session
const vfs = new Map<string, string>([[RECIPE_FILE, RECIPE_INITIAL]]);

// Tracks which files have been read — enforces read-before-edit
const readSet = new Set<string>();

export function getVirtualFS(): Map<string, string> {
  return vfs;
}

// Snapshot the current VFS state so compare mode can restore it between runs
export function snapshotVFS(): Map<string, string> {
  return new Map(vfs);
}

// Restore a previously snapshotted state and reset the read tracker
export function restoreVFS(snapshot: Map<string, string>): void {
  vfs.clear();
  for (const [k, v] of snapshot) vfs.set(k, v);
  readSet.clear();
}

// Clear read tracking between editor sessions so enforcement stays accurate
export function clearReadSet(): void {
  readSet.clear();
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

function readFile(args: { path: string }): string {
  const content = vfs.get(args.path);
  if (content === undefined) {
    const available = [...vfs.keys()].join(", ");
    return JSON.stringify({ error: `File not found: "${args.path}". Available: ${available}` });
  }
  readSet.add(args.path);
  return content;
}

function editFile(args: { path: string; old_str: string; new_str: string }): string {
  if (!readSet.has(args.path)) {
    return JSON.stringify({
      error:
        `Must call read_file("${args.path}") before editing. ` +
        `You need the current content to craft a precise old_str.`,
    });
  }
  const content = vfs.get(args.path);
  if (content === undefined) {
    return JSON.stringify({ error: `File not found: "${args.path}"` });
  }
  try {
    const newContent = applyEdit(content, args.old_str, args.new_str);
    vfs.set(args.path, newContent);
    return `Edit applied successfully.`;
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the current contents of a file. Call this before edit_file — " +
        "you need the current content to craft an accurate old_str.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file path to read (e.g. carbonara.md)" },
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
        "Edit a file by replacing old_str with new_str.\n" +
        "1. Call read_file first.\n" +
        "2. old_str must uniquely identify the target — include 2+ neighboring lines.\n" +
        "3. old_str must match exactly — same whitespace and punctuation.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The file path to edit" },
          old_str: {
            type: "string",
            description:
              "The exact text to replace. Must appear exactly once in the file. " +
              "Include surrounding lines for context.",
          },
          new_str: { type: "string", description: "The replacement text." },
        },
        required: ["path", "old_str", "new_str"],
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
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
