/**
 * activity/file/create — opt-in to the file-touch feature.
 *
 * Two call shapes:
 *   - With file_path: agent supplies the path; TMCP just records it.
 *   - Without file_path: TMCP generates a random file in data/activity/ and creates it.
 *
 * Optional `refresh` flag:
 *   - When true and an existing registration is present: wipe the old registration
 *     via clearActivityFile() then proceed with the normal create branch.
 *     Response includes `replaced: boolean` (true if a prior registration was wiped).
 *   - When omitted or false: returns ALREADY_REGISTERED error if a registration exists
 *     (unchanged behavior).
 *
 * Response: { hint: "call dequeue(token: <TOKEN>) NOW — do not proceed without draining", file_path: string }
 */

import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getDequeueDefault, setDequeueDefault } from "../../session-manager.js";
import { deliverServiceMessage } from "../../session-queue.js";
import { SERVICE_MESSAGES } from "../../service-messages.js";
import {
  validateFilePath,
  createTmcpOwnedFile,
  replaceActivityFile,
  getActivityFile,
  clearActivityFile,
} from "./file-state.js";

/**
 * One-time event: when an activity file is registered, set the session's
 * dequeue default to this value (seconds) so the agent's loop interleaves
 * with crons + parallel signals. Not an ongoing cap — after this set, the
 * agent can change the default freely via profile/dequeue-default.
 * Matches CHANNEL_MAX_WAIT_S in channel.ts.
 */
const ACTIVITY_DEFAULT_WAIT_S = 90;

export async function handleActivityFileCreate(args: Record<string, unknown>) {
  const _sid = requireAuth(args.token as number | undefined);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  // Validate `refresh` arg — must be boolean or absent
  const refreshRaw = args.refresh;
  if (refreshRaw !== undefined && typeof refreshRaw !== "boolean") {
    return toError({
      code: "INVALID_ARG" as const,
      message: "`refresh` must be a boolean (true or false), not a " + typeof refreshRaw + ".",
    });
  }
  const refresh = refreshRaw === true;

  const existing = getActivityFile(sid);
  if (existing && !refresh) {
    return toError({
      code: "ALREADY_REGISTERED",
      message:
        "An activity file is already registered for this session. " +
        "Options: call activity/file/get to inspect the existing registration, " +
        "activity/file/edit to swap to a different path, " +
        "activity/file/delete to release it before calling create again, " +
        "or call activity/file/create with refresh: true to wipe-and-create in a single step.",
      details: {
        file_path: existing.filePath,
        tmcp_owned: existing.tmcpOwned,
      },
    });
  }

  // When refresh: true, wipe any prior registration before proceeding.
  // If the disk-side delete fails (locked file, permission denied), surface
  // the error and abort — never proceed to create after a failed wipe.
  const replaced = refresh && existing !== undefined;
  if (replaced) {
    try {
      await clearActivityFile(sid);
    } catch (err) {
      return toError({
        code: "REFRESH_DELETE_FAILED" as const,
        message: `Could not release existing activity file at ${existing.filePath}: ${(err as Error).message}. The prior registration may still be active. No new file was created.`,
        details: {
          file_path: existing.filePath,
          tmcp_owned: existing.tmcpOwned,
        },
      });
    }
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
      inflightDequeue: false,
      kickLockedUntil: null,
      kickPendingBecauseLocked: false,
      touchInFlight: false,
      pendingRetryHandle: null,
    });

    // One-time event: when an activity file is registered, set the session's
    // dequeue default to 90 s so the agent's loop interleaves with crons and
    // parallel signals. A monitor on the file provides the external wake.
    // Guard `> 90` so we never raise a value the agent has explicitly lowered.
    // This is a one-shot at registration — not an ongoing cap. After this,
    // the agent can re-set the default freely via profile/dequeue-default.
    if (getDequeueDefault(sid) > ACTIVITY_DEFAULT_WAIT_S) {
      setDequeueDefault(sid, ACTIVITY_DEFAULT_WAIT_S);
    }

    // Breadcrumb: queue the concrete monitor-invocation service message for
    // the next dequeue. Keeps the response itself terse — the agent's next
    // poll carries the actionable instruction.
    deliverServiceMessage(
      sid,
      SERVICE_MESSAGES.ACTIVITY_FILE_MONITOR_INSTRUCTIONS.text(filePath),
      SERVICE_MESSAGES.ACTIVITY_FILE_MONITOR_INSTRUCTIONS.eventType,
      { file_path: filePath },
    );

    const result: Record<string, unknown> = {
      hint: `call dequeue(token: ${sid}) NOW — your next dequeue carries the monitor invocation`,
      file_path: filePath,
    };
    if (refresh) result.replaced = replaced;
    return toResult(result);
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
    inflightDequeue: false,
    kickLockedUntil: null,
    kickPendingBecauseLocked: false,
    touchInFlight: false,
    pendingRetryHandle: null,
  });

  // Cap dequeue max_wait to 90 s once a file is registered. A monitor on
  // the file provides the external wake; longer holds only delay reminder
  // firing and parallel-signal interleaving. Only cap if currently higher.
  if (getDequeueDefault(sid) > ACTIVITY_DEFAULT_WAIT_S) {
    setDequeueDefault(sid, ACTIVITY_DEFAULT_WAIT_S);
  }

  // Breadcrumb: queue the concrete monitor-invocation service message for
  // the next dequeue. Keeps the response itself terse — the agent's next
  // poll carries the actionable instruction.
  deliverServiceMessage(
    sid,
    SERVICE_MESSAGES.ACTIVITY_FILE_MONITOR_INSTRUCTIONS.text(generatedPath),
    SERVICE_MESSAGES.ACTIVITY_FILE_MONITOR_INSTRUCTIONS.eventType,
    { file_path: generatedPath },
  );

  const result: Record<string, unknown> = {
    hint: `call dequeue(token: ${sid}) NOW — your next dequeue carries the monitor invocation`,
    file_path: generatedPath,
  };
  if (refresh) result.replaced = replaced;
  return toResult(result);
}
