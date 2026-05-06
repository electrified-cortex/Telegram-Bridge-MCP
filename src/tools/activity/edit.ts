/**
 * activity/file/edit — change the registered activity file.
 *
 * New file_path replaces the old one. Ownership rules apply per-call
 * (same semantics as create). If the old file was TMCP-owned, it is deleted.
 *
 * Response: { file_path: string, hint: string, previous_path: string }
 * Error: NOT_REGISTERED if no file is currently registered.
 */

import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import {
  validateFilePath,
  setActivityFile,
  getActivityFile,
  clearActivityFile,
  createTmcpOwnedFile,
} from "./file-state.js";

export async function handleActivityFileEdit(args: Record<string, unknown>) {
  const _sid = requireAuth(args.token as number | undefined);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  const existing = getActivityFile(sid);
  if (!existing) {
    return toError({
      code: "NOT_REGISTERED" as const,
      message: "No activity file is registered for this session. Call action(type: 'activity/file/create') first.",
    });
  }

  const previousPath = existing.filePath;
  const filePath = args.file_path as string | undefined;

  if (filePath !== undefined) {
    // Agent-supplied path
    const validationError = validateFilePath(filePath);
    if (validationError !== null) {
      return toError({ code: "INVALID_PATH" as const, message: validationError });
    }

    // Clear old registration (deletes TMCP-owned file if applicable)
    await clearActivityFile(sid);

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

    return toResult({ file_path: filePath, hint: "Call help('activity/file') now", previous_path: previousPath });
  }

  // TMCP-generated path
  let generatedPath: string;
  try {
    generatedPath = await createTmcpOwnedFile();
  } catch (err) {
    return toError({ code: "UNKNOWN" as const, message: `Failed to create activity file: ${(err as Error).message}` });
  }

  // Clear old registration (deletes TMCP-owned file if applicable)
  await clearActivityFile(sid);

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

  return toResult({ file_path: generatedPath, hint: "Call help('activity/file') now", previous_path: previousPath });
}
