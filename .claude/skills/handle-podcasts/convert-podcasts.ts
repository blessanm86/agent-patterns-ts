#!/usr/bin/env npx tsx
import { execSync } from "child_process";
import { readdirSync, unlinkSync } from "fs";
import { join, basename, dirname } from "path";

interface ConversionResult {
  mp3Path: string;
  duration: string;
  success: boolean;
  error?: string;
}

function findM4A(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findM4A(full));
    else if (entry.isFile() && entry.name.endsWith(".m4a")) results.push(full);
  }
  return results;
}

for (const cmd of ["ffmpeg", "ffprobe"]) {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
  } catch {
    console.error(`ERROR: ${cmd} not found. Run: brew install ffmpeg`);
    process.exit(1);
  }
}

const srcDir = join(process.cwd(), "src");
const files = findM4A(srcDir);

if (files.length === 0) {
  console.log("No .m4a files found under src/");
  process.exit(0);
}

const results: ConversionResult[] = [];
for (const m4a of files) {
  const mp3 = join(dirname(m4a), `${basename(m4a, ".m4a")}.mp3`);
  try {
    execSync(`ffmpeg -i "${m4a}" -vn -ar 44100 -ac 1 -b:a 64k -f mp3 "${mp3}" -y -loglevel error`);
    const raw = execSync(
      `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${mp3}"`,
    )
      .toString()
      .trim();
    const secs = Math.round(parseFloat(raw));
    const duration = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    unlinkSync(m4a);
    results.push({ mp3Path: mp3, duration, success: true });
    console.log(`OK: ${mp3} (${duration})`);
  } catch (e) {
    results.push({ mp3Path: mp3, duration: "", success: false, error: String(e) });
    console.error(`FAILED: ${m4a}`);
  }
}

process.stdout.write("\nRESULTS_JSON:" + JSON.stringify(results) + "\n");
const failed = results.filter((r) => !r.success);
process.exit(failed.length > 0 ? 1 : 0);
