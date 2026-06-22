/**
 * Durable session flags — per-session-name persistence that survives bridge restarts.
 *
 * Flags are stored as JSON files at data/guidance/{sanitized-name}.json.
 * Each file contains a flat record of flag names to boolean values.
 *
 * Usage:
 *   hasDurableFlag("Overseer", "subsession_guidance_delivered") → false
 *   setDurableFlag("Overseer", "subsession_guidance_delivered")
 *   hasDurableFlag("Overseer", "subsession_guidance_delivered") → true
 *
 * In-process write-through cache avoids repeated disk reads per request.
 * All I/O is best-effort — errors are swallowed so flag checks never crash the bridge.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const FLAGS_DIR = resolve(REPO_ROOT, "data", "guidance");

// In-process write-through cache: avoids repeated disk reads per request.
const _cache = new Map<string, Record<string, boolean>>();

/** Sanitize a session name to a safe filename component (max 200 chars). */
function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9\-_]/g, "_").slice(0, 200) || "_empty";
}

function flagFilePath(name: string): string {
  return resolve(FLAGS_DIR, `${sanitizeName(name)}.json`);
}

/** Read flags from disk (or cache). Returns an empty record on any I/O error. */
function readFlags(name: string): Record<string, boolean> {
  const cached = _cache.get(name);
  if (cached !== undefined) return cached;

  const filePath = flagFilePath(name);
  if (!existsSync(filePath)) {
    _cache.set(name, {});
    return {};
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    _cache.set(name, parsed);
    return parsed;
  } catch {
    _cache.set(name, {});
    return {};
  }
}

/**
 * Check whether a durable flag is set for the given session name.
 * Returns false if the flag does not exist or on any I/O error.
 */
export function hasDurableFlag(name: string, flag: string): boolean {
  return readFlags(name)[flag];
}

/**
 * Set a durable flag for the given session name (value always `true`).
 * Writes to disk immediately. No-op on write failure (best-effort).
 */
export function setDurableFlag(name: string, flag: string): void {
  const flags = { ...readFlags(name), [flag]: true };
  _cache.set(name, flags);
  try {
    mkdirSync(FLAGS_DIR, { recursive: true });
    writeFileSync(flagFilePath(name), JSON.stringify(flags, null, 2) + "\n", "utf-8");
  } catch {
    // Best-effort: write failure is non-fatal
  }
}

/** Clear the in-process cache. For use in tests only. */
export function _resetDurableFlagsCacheForTest(): void {
  _cache.clear();
}
