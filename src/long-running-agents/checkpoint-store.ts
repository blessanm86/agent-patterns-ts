// ─── Checkpoint Store ────────────────────────────────────────────────────────
//
// JSON-file persistence for migration run state. Each checkpoint captures
// which recipes have been processed so the agent can resume after a crash.
//
// Key durability guarantee: atomic writes via write-tmp-then-rename.
// This prevents half-written checkpoints from corrupting state on crash.

import * as fs from "node:fs";
import * as path from "node:path";
import type { MigrationResult } from "./recipes.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Checkpoint {
  runId: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
  totalItems: number;
  completedItems: number;
  completedIds: string[]; // recipe IDs already processed
  results: MigrationResult[];
  status: "in_progress" | "completed" | "cancelled";
}

// ─── Store ──────────────────────────────────────────────────────────────────

export class CheckpointStore {
  private directory: string;

  constructor(directory = ".checkpoints") {
    this.directory = directory;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }
  }

  private filePath(runId: string): string {
    return path.join(this.directory, `${runId}.json`);
  }

  // ── Atomic Write ────────────────────────────────────────────────────────
  //
  // Write to a .tmp file, then rename. On most filesystems rename is atomic,
  // so a crash mid-write leaves the old checkpoint intact rather than a
  // half-written JSON file.

  save(checkpoint: Checkpoint): void {
    const target = this.filePath(checkpoint.runId);
    const tmp = `${target}.tmp`;

    checkpoint.updatedAt = new Date().toISOString();

    fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2));
    fs.renameSync(tmp, target);
  }

  load(runId: string): Checkpoint | null {
    const target = this.filePath(runId);
    try {
      const raw = fs.readFileSync(target, "utf-8");
      return JSON.parse(raw) as Checkpoint;
    } catch {
      return null;
    }
  }

  // Find all runs that were interrupted (status === "in_progress")
  findInProgress(): Checkpoint[] {
    this.ensureDirectory();
    const files = fs.readdirSync(this.directory).filter((f) => f.endsWith(".json"));
    const inProgress: Checkpoint[] = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(this.directory, file), "utf-8");
        const checkpoint = JSON.parse(raw) as Checkpoint;
        if (checkpoint.status === "in_progress") {
          inProgress.push(checkpoint);
        }
      } catch {
        // Skip corrupted files
      }
    }

    // Most recent first
    inProgress.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return inProgress;
  }

  delete(runId: string): void {
    const target = this.filePath(runId);
    try {
      fs.unlinkSync(target);
    } catch {
      // Already deleted or never existed
    }
  }
}
