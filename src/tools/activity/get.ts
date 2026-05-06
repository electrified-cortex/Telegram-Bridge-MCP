/**
 * activity/file/get — read-only query of the current activity file registration.
 *
 * Response:
 *   { registered: true, file_path: string, tmcp_owned: boolean, last_touch_at: string|null }
 *   { registered: false }
 */

import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getActivityFile } from "./file-state.js";

export function handleActivityFileGet(args: Record<string, unknown>) {
  const _sid = requireAuth(args.token as number | undefined);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  const entry = getActivityFile(sid);
  if (!entry) {
    return toResult({});
  }

  return toResult({
    file_path: entry.filePath,
    tmcp_owned: entry.tmcpOwned,
    last_touch_at: entry.lastTouchAt !== null ? new Date(entry.lastTouchAt).toISOString() : null,
  });
}
