/**
 * In-memory file store for the bridge HTTP file-transfer endpoint.
 *
 * Files are stored by UUID with a TTL. On first successful GET the entry is
 * deleted (one-time token semantics). A periodic eviction loop removes entries
 * that were never downloaded before their TTL elapsed.
 *
 * No disk I/O — everything lives in process memory. This keeps latency low and
 * avoids temp-file cleanup races. The trade-off is that files are lost on
 * process restart, which is acceptable because the bridge URLs are short-lived
 * and only used within the same session.
 */

import { randomUUID } from "crypto";

export interface FileEntry {
  buffer: Buffer;
  contentType: string;
  expiresAt: number;
}

const _store = new Map<string, FileEntry>();

/** Default TTL in milliseconds (5 minutes). */
export const DEFAULT_TTL_MS = 300_000;

let _evictionInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background eviction loop.
 * Safe to call multiple times — only one interval is active at a time.
 * Calls `.unref()` on the timer so it does not prevent process exit in tests.
 */
export function startEviction(intervalMs = 60_000): void {
  if (_evictionInterval !== null) return;
  _evictionInterval = setInterval(() => {
    const now = Date.now();
    for (const [uuid, entry] of _store) {
      if (entry.expiresAt <= now) _store.delete(uuid);
    }
  }, intervalMs);
  // Allow process to exit cleanly even if the interval is still armed.
  _evictionInterval.unref?.();
}

/** Stop the eviction loop. Called on server shutdown to avoid test leaks. */
export function stopEviction(): void {
  if (_evictionInterval !== null) {
    clearInterval(_evictionInterval);
    _evictionInterval = null;
  }
}

/**
 * Store a file and return its UUID.
 *
 * @param buffer      File bytes.
 * @param contentType MIME type (e.g. "image/png").
 * @param ttlMs       Time-to-live in milliseconds (default 300 s).
 */
export function putFile(buffer: Buffer, contentType: string, ttlMs = DEFAULT_TTL_MS): string {
  const uuid = randomUUID();
  _store.set(uuid, { buffer, contentType, expiresAt: Date.now() + ttlMs });
  return uuid;
}

/**
 * Retrieve and delete a file entry (one-time token).
 *
 * Returns `undefined` if the entry does not exist or has expired.
 */
export function getAndDeleteFile(uuid: string): FileEntry | undefined {
  const entry = _store.get(uuid);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    _store.delete(uuid);
    return undefined;
  }
  _store.delete(uuid);
  return entry;
}

/** Peek at an entry without consuming it (internal use only). */
export function peekFile(uuid: string): FileEntry | undefined {
  const entry = _store.get(uuid);
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry;
}

/** Current number of live entries. Primarily for tests. */
export function storeSize(): number {
  return _store.size;
}

/** For tests only: clear all entries and stop any pending eviction. */
export function clearStoreForTest(): void {
  _store.clear();
}
