/**
 * activity/file/create — opt-in to the file-touch feature.
 *
 * Two call shapes:
 *   - With file_path: agent supplies the path; TMCP just records it.
 *   - Without file_path: TMCP generates a random file in data/activity/ and creates it.
 *
 * Response: { file_path: string, hint: "Call help('activity/file') now" }
 */

import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import {
  validateFilePath,
  setActivityFile,
  createTmcpOwnedFile,
  clearActivityFile,
  getActivityFile,
} from "./file-state.js";

export async function handleActivityFileCreate(args: Record<string, unknown>) {
  const _sid = requireAuth(args.token as number | undefined);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  const filePath = args.file_path as string | undefined;

  if (filePath !== undefined) {
    // Agent-supplied path
    const validationError = validateFilePath(filePath);
    if (validationError !== null) {
      return toError({ code: "INVALID_PATH" as const, message: validationError });
    }

    // If a previous registration exists, clear it (including TMCP-owned file deletion)
    if (getActivityFile(sid)) {
      await clearActivityFile(sid);
    }

    setActivityFile(sid, {
      filePath,
      tmcpOwned: false,
      lastTouchAt: null,
      debounceTimer: null,
      absorbedCount: 0,
      lastActivityAt: 0,
      inflightDequeue: false,
      nudgeArmed: true,
    });

    return toResult({ file_path: filePath, hint: "When this file changes, call GET /dequeue?token=<your-token> from your watcher — see help('dequeue-http') for curl/PowerShell/Node examples." });
  }

  // TMCP-generated path
  let generatedPath: string;
  try {
    generatedPath = await createTmcpOwnedFile();
  } catch (err) {
    return toError({ code: "UNKNOWN" as const, message: `Failed to create activity file: ${(err as Error).message}` });
  }

  // If a previous registration exists, clear it first
  if (getActivityFile(sid)) {
    await clearActivityFile(sid);
  }

  setActivityFile(sid, {
    filePath: generatedPath,
    tmcpOwned: true,
    lastTouchAt: null,
    debounceTimer: null,
    absorbedCount: 0,
    lastActivityAt: 0,
    inflightDequeue: false,
    nudgeArmed: true,
  });

  return toResult({ file_path: generatedPath, hint: "When this file changes, call GET /dequeue?token=<your-token> from your watcher — see help('dequeue-http') for curl/PowerShell/Node examples." });
}
