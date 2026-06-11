/**
 * activity/listen/get — read-only recovery query for the SSE endpoint.
 *
 * Returns the SSE URL and ready-to-run curl command for the current session,
 * identical to activity/listen but semantically scoped to recovery (re-arm
 * after compaction). No state change.
 *
 * Requires HTTP mode (--http flag). Returns HTTP_MODE_REQUIRED otherwise.
 *
 * Response: { ok: true, sse_url: string, command: string }
 */
import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getSseBaseUrl } from "../../http-mode.js";

export function handleActivityListenGet(args: Record<string, unknown>) {
  const _sid = requireAuth(args.token as number | undefined);
  if (typeof _sid !== "number") return toError(_sid);

  const baseUrl = getSseBaseUrl();
  if (baseUrl === null) {
    return toError({
      code: "HTTP_MODE_REQUIRED",
      message: "activity/listen/get requires HTTP mode. Start TMCP with --http to enable SSE endpoints.",
    });
  }

  const sseUrl = `${baseUrl}/sse?token=${args.token as number}`;
  return toResult({
    ok: true,
    sse_url: sseUrl,
    command: `curl -N '${sseUrl}'`,
  });
}
