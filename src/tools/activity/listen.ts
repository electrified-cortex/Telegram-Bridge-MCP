/**
 * activity/listen — return SSE URL and ready-to-run curl command.
 *
 * Requires HTTP mode (--http flag). Returns HTTP_MODE_REQUIRED error otherwise.
 * No state change — purely informational.
 *
 * Response: { ok: true, sse_url: string, command: string }
 */
import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getSseBaseUrl } from "../../http-mode.js";

export async function handleActivityListen(args: Record<string, unknown>) {
  const _sid = requireAuth(args.token as number | undefined);
  if (typeof _sid !== "number") return toError(_sid);

  const baseUrl = getSseBaseUrl();
  if (baseUrl === null) {
    return toError({
      code: "HTTP_MODE_REQUIRED",
      message: "activity/listen requires HTTP mode. Start TMCP with --http to enable SSE endpoints.",
    });
  }

  const sseUrl = `${baseUrl}/sse?token=${args.token as number}`;
  return toResult({
    ok: true,
    sse_url: sseUrl,
    command: `curl -N '${sseUrl}'`,
  });
}
