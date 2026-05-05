/**
 * Profile storage — read/write session configuration snapshots to JSON files.
 *
 * Key resolution:
 *   - Bare key (no `/`)  → `data/profiles/{key}.json`
 *   - Path key (has `/`) → `{key}.json` relative to repo root
 *
 * Security: null bytes, path traversal (`..`), and absolute paths are rejected.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname, isAbsolute } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReminderDef =
  | { trigger?: "time"; text: string; recurring: boolean; delay_seconds: number; disabled?: boolean }
  | { trigger: "startup"; text: string; recurring: boolean; delay_seconds?: number; disabled?: boolean };

export interface ProfileData {
  voice?: string;
  voice_speed?: number;
  animation_default?: string[];
  animation_presets?: Record<string, string[]>;
  reminders?: ReminderDef[];
  name_tag?: string;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a profile key to an absolute file path.
 * Throws on invalid keys (null bytes, traversal, absolute paths).
 */
export function resolveProfilePath(key: string): string {
  if (key.includes("\0")) {
    throw new Error("Invalid profile key: null byte");
  }
  if (key.includes("..")) {
    throw new Error("Invalid profile key: path traversal not allowed");
  }
  if (isAbsolute(key)) {
    throw new Error("Invalid profile key: absolute paths not allowed");
  }
  if (key.includes(":")) {
    throw new Error("Invalid profile key: colon not allowed");
  }

  if (key.includes("/")) {
    // Path key — resolve relative to repo root
    return resolve(REPO_ROOT, `${key}.json`);
  }
  // Bare key — resolve into gitignored data/profiles/
  return resolve(REPO_ROOT, "data", "profiles", `${key}.json`);
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/**
 * Read and parse a profile file. Returns null if the file does not exist.
 * Throws on parse errors or other I/O failures.
 */
export function readProfile(key: string): ProfileData | null {
  const filePath = resolveProfilePath(key);
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as ProfileData;
}

/**
 * Write a profile to disk, creating intermediate directories as needed.
 */
export function writeProfile(key: string, data: ProfileData): void {
  const filePath = resolveProfilePath(key);
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
