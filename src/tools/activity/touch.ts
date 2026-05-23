/**
 * activity/file/touch — bump the mtime of the registered activity file.
 *
 * Cheap utime()-style call: updates the file's mtime without appending content.
 * Callers use this to manually signal an armed activity-file monitor (e.g. during
 * compaction recovery or to force a watcher fire without waiting for an inbound).
 *
 * v1: no rate limit — adversarial rapid-fire loop noted; deferred to v2.
 *
 * Success: { touched: true, file_path: string, mtime: string }
 * Errors:
 *   NO_ACTIVITY_FILE      — no registration for this session
 *   ACTIVITY_FILE_MISSING — registered path does not exist on disk
 *   AUTH_FAILED           — standard auth failure
 */

import { utimes } from "fs/promises";
import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getActivityFile } from "./file-state.js";

export async function handleActivityFileTouch(args: Record<string, unknown>) {
  const _sid = requireAuth(args.token as number | undefined);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  const entry = getActivityFile(sid);
  if (!entry) {
    return toError({
      code: "NO_ACTIVITY_FILE",
      message: "No activity file registered. Call activity/file/create first.",
    });
  }

  const { filePath } = entry;
  const now = new Date();

  try {
    await utimes(filePath, now, now);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return toError({
        code: "ACTIVITY_FILE_MISSING",
        message: `Registered path '${filePath}' does not exist on disk.`,
        file_path: filePath,
      });
    }
    return toError({ code: "UNKNOWN" as const, message: `touch failed: ${(err as Error).message}` });
  }

  return toResult({
    touched: true,
    file_path: filePath,
    mtime: now.toISOString(),
  });
}
