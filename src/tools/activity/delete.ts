/**
 * activity/file/delete — unregister the activity file.
 *
 * If TMCP created the file (tmcp_owned), it is deleted from disk.
 * If agent-supplied, only the registration is forgotten.
 *
 * Response: { ok: true, deleted_file: boolean }
 *   deleted_file = true only when TMCP actually deleted a file from disk.
 */

import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getActivityFile, clearActivityFile } from "./file-state.js";

export async function handleActivityFileDelete(args: Record<string, unknown>) {
  const _sid = requireAuth(args.token as number | undefined);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  const existing = getActivityFile(sid);
  if (!existing) {
    return toResult({ deleted_file: false });
  }

  const wasOwned = existing.tmcpOwned;
  await clearActivityFile(sid);

  return toResult({ deleted_file: wasOwned });
}
