import * as fs from "fs";
import type { AmbientContext, ContextType, ContextStats, ContextStore } from "./types.js";

// ─── Ambient Context Store ───────────────────────────────────────────────────
//
// Reference-counted store that tracks what the user is currently viewing.
// UI components (or CLI pages) register contexts on mount and unregister on
// unmount. The store serializes active contexts as XML tags for injection
// into the agent's system prompt.
//
// Key lifecycle semantics:
//   register()   → refCount++ (create at 1 if new)
//   unregister() → refCount-- (remove at 0)
//   exclude()    → user toggles a context off without removing it
//   persist()    → save to disk for cross-session survival
//   restore()    → load from disk, mark all as temporary until reclaimed

// ─── XML Tag Name Mapping ────────────────────────────────────────────────────

const TAG_NAMES: Record<ContextType, string> = {
  product: "Product",
  cart: "Cart",
  category: "Category",
  order: "Order",
  user: "User",
  "time-range": "TimeRange",
  filter: "Filter",
};

// ─── Implementation ──────────────────────────────────────────────────────────

export function createContextStore(): ContextStore {
  const contexts = new Map<string, AmbientContext>();

  function makeId(type: ContextType, identifier: string): string {
    return `${type}:${identifier}`;
  }

  function register(
    type: ContextType,
    identifier: string,
    data: Record<string, string>,
    source: string,
  ): void {
    const id = makeId(type, identifier);
    const existing = contexts.get(id);

    if (existing) {
      existing.refCount++;
      existing.temporary = false; // reclaimed from persistence
      existing.data = { ...existing.data, ...data }; // merge fresh data
      console.log(`  📌 Context registered: ${id} (refCount: ${existing.refCount})`);
    } else {
      contexts.set(id, {
        id,
        type,
        data,
        refCount: 1,
        excluded: false,
        temporary: false,
        source,
      });
      console.log(`  📌 Context registered: ${id} (new)`);
    }
  }

  function unregister(type: ContextType, identifier: string, _source: string): void {
    const id = makeId(type, identifier);
    const existing = contexts.get(id);
    if (!existing) return;

    existing.refCount--;
    console.log(`  📤 Context unregistered: ${id} (refCount: ${existing.refCount})`);

    if (existing.refCount <= 0) {
      contexts.delete(id);
      console.log(`  🗑️  Context removed: ${id}`);
    }
  }

  function exclude(contextId: string): boolean {
    const ctx = contexts.get(contextId);
    if (!ctx) return false;
    ctx.excluded = true;
    return true;
  }

  function include(contextId: string): boolean {
    const ctx = contexts.get(contextId);
    if (!ctx) return false;
    ctx.excluded = false;
    return true;
  }

  function getActive(): AmbientContext[] {
    return [...contexts.values()].filter((c) => c.refCount > 0 && !c.excluded);
  }

  function getAll(): AmbientContext[] {
    return [...contexts.values()].filter((c) => c.refCount > 0);
  }

  function serialize(): string {
    const active = getActive();
    if (active.length === 0) return "";

    const tags = active.map((ctx) => {
      const tagName = TAG_NAMES[ctx.type];
      const attrs = Object.entries(ctx.data)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `  <${tagName} ${attrs} />`;
    });

    return `<AmbientContext>\n${tags.join("\n")}\n</AmbientContext>`;
  }

  function persist(filePath: string): void {
    const all = getAll();
    const data = all.map((ctx) => ({
      id: ctx.id,
      type: ctx.type,
      data: ctx.data,
      source: ctx.source,
      excluded: ctx.excluded,
    }));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  function restore(filePath: string): number {
    if (!fs.existsSync(filePath)) return 0;

    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as {
      id: string;
      type: ContextType;
      data: Record<string, string>;
      source: string;
      excluded: boolean;
    }[];

    let count = 0;
    for (const entry of data) {
      if (!contexts.has(entry.id)) {
        contexts.set(entry.id, {
          id: entry.id,
          type: entry.type,
          data: entry.data,
          refCount: 1,
          excluded: entry.excluded,
          temporary: true, // mark as temporary until a page reclaims it
          source: entry.source,
        });
        count++;
      }
    }
    return count;
  }

  function getDisplayChips(): string[] {
    const all = getAll();
    if (all.length === 0) return ["  (no active contexts)"];

    return all.map((ctx) => {
      const status = ctx.excluded ? "excluded" : "included";
      const temp = ctx.temporary ? " [temporary]" : "";
      const icon = ctx.excluded ? "○" : "●";
      const label = ctx.data.name || ctx.data.status || ctx.id.split(":")[1];
      return `  ${icon} ${ctx.id} → ${label} [${status}]${temp} (ref: ${ctx.refCount})`;
    });
  }

  function getStats(): ContextStats {
    const all = getAll();
    return {
      total: all.length,
      active: getActive().length,
      excluded: all.filter((c) => c.excluded).length,
      temporary: all.filter((c) => c.temporary).length,
    };
  }

  return {
    register,
    unregister,
    exclude,
    include,
    getActive,
    getAll,
    serialize,
    persist,
    restore,
    getDisplayChips,
    getStats,
  };
}
