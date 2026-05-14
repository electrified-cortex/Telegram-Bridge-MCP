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
  createTmcpOwnedFile,
  replaceActivityFile,
  getActivityFile,
} from "./file-state.js";

export async function handleActivityFileCreate(args: Record<string, unknown>) {
  const _sid = requireAuth(args.token as number | undefined);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  const existing = getActivityFile(sid);
  if (existing) {
    return toError({
      code: "ALREADY_REGISTERED",
      message:
        "An activity file is already registered for this session. " +
        "Options: call activity/file/get to inspect the existing registration, " +
        "activity/file/edit to swap to a different path, or " +
        "activity/file/delete to remove it before calling create again.",
      details: {
        file_path: existing.filePath,
        tmcp_owned: existing.tmcpOwned,
      },
    });
  }

  const filePath = args.file_path as string | undefined;

  if (filePath !== undefined) {
    // Agent-supplied path
    const validationError = validateFilePath(filePath);
    if (validationError !== null) {
      return toError({ code: "INVALID_PATH" as const, message: validationError });
    }

    // Replace any previous registration, updating _state atomically so that
    // inbound messages during async cleanup always find a valid entry.
    await replaceActivityFile(sid, {
      filePath,
      tmcpOwned: false,
      lastTouchAt: null,
      debounceTimer: null,
      lastActivityAt: 0,
      inflightDequeue: false,
      nudgeArmed: true,
    });

    return toResult({ file_path: filePath, hint: "On file change, call /dequeue with your token. help('dequeue-http')." });
  }

  // TMCP-generated path
  let generatedPath: string;
  try {
    generatedPath = await createTmcpOwnedFile();
  } catch (err) {
    return toError({ code: "UNKNOWN" as const, message: `Failed to create activity file: ${(err as Error).message}` });
  }

  // Replace any previous registration, updating _state atomically so that
  // inbound messages during async cleanup always find a valid entry.
  await replaceActivityFile(sid, {
    filePath: generatedPath,
    tmcpOwned: true,
    lastTouchAt: null,
    debounceTimer: null,
    lastActivityAt: 0,
    inflightDequeue: false,
    nudgeArmed: true,
  });

  return toResult({ file_path: generatedPath, hint: "When this file changes, call GET /dequeue?token=<your-token> from your watcher — see help('dequeue-http') for curl/PowerShell/Node examples." });
}
