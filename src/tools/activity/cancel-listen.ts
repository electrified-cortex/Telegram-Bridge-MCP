/**
 * activity/listen/cancel — close the open SSE connection for this session.
 *
 * Sends `data: cancelled` on the stream then calls res.end().
 * Idempotent — returns ok:true even when no connection is open.
 *
 * Response: { ok: true }
 */
import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { cancelSseConnection } from "../../sse-endpoint.js";

export function handleActivityListenCancel(args: Record<string, unknown>) {
  const _sid = requireAuth(args.token as number | undefined);
  if (typeof _sid !== "number") return toError(_sid);

  cancelSseConnection(_sid);
  return toResult({ ok: true });
}
