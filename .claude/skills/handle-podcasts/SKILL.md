---
name: handle-podcasts
description: Convert new .m4a podcast files to .mp3 and update concept READMEs and root patterns table
---

# Handle Podcasts

Process any new `.m4a` podcast files in `src/`, convert them to `.mp3`, and update all relevant READMEs.

---

## Phase 1 — Dependency Check

**Check ffmpeg:**
Run `which ffmpeg`. If missing, stop and tell the user: `ffmpeg is required. Run: brew install ffmpeg`

**Check git-lfs:**
Run `which git-lfs`. If missing, stop and tell the user:

```
git-lfs is required. Run:
  brew install git-lfs && git lfs install
```

**Ensure .gitattributes tracks \*.mp3:**
Check if `.gitattributes` exists and contains `*.mp3`. If not, run:
`git lfs track "*.mp3"`
This creates or updates `.gitattributes`. Stage it immediately: `git add .gitattributes`

---

## Phase 2 — Convert

Run:

```bash
npx tsx .claude/skills/handle-podcasts/convert-podcasts.ts
```

Parse the `RESULTS_JSON:...` line from stdout to get the list of converted files and their durations.

If no `.m4a` files were found, stop and tell the user.
If any conversions failed, report which files failed and stop.

---

## Phase 3 — Update Concept READMEs

For each successfully converted `.mp3`, open the corresponding concept `README.md` (same folder as the `.mp3`).

**Insertion point:** Find the first `---` separator within the first 15 lines of the file.

- If found: insert after it (with a blank line above and below)
- If not found: insert directly after the title line `# ...`, wrapped in its own `---` separators:

  ```
  # Title

  ---

  🎧 **Audio Overview** — [Listen](./file.mp3) · MM:SS

  ---

  (rest of file)
  ```

**Line to insert:**

```
🎧 **Audio Overview** — [Listen](./FILENAME.mp3) · DURATION
```

Example: `🎧 **Audio Overview** — [Listen](./react-podcast.mp3) · 23:45`

**Duplicate guard:** Before inserting, check if a `🎧` line already exists. If so, update it in place.

---

## Phase 4 — Update Root README Patterns Table

Open `README.md` at the repo root.

**Add Audio column if absent:**

- Find the table header: `| Pattern | Demo | Run | Builds on |`
- Replace with: `| Pattern | Demo | Run | Audio | Builds on |`
- Update the separator row to match
- Update the intro sentence to add: `The **Audio** column links to a NotebookLM podcast overview where available.`
- Add `—` in the Audio cell for every existing row

**For each newly converted concept**, find the matching row and set its Audio cell to:
`[🎧](src/CONCEPT-FOLDER/FILENAME.mp3)`

**If the Audio column already exists**, only update cells for the newly converted concepts.

---

## Phase 5 — Summary

Print:

```
Podcast handling complete.

Converted:
  src/react/react-podcast.mp3  (23:45)
  ...

READMEs updated:
  src/react/README.md — audio link added
  README.md — Audio column added, N rows updated
```
