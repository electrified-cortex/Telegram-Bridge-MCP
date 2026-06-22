/**
 * activity/listen — return SSE URL and the FILTERED monitor arm command.
 *
 * Requires HTTP mode (--http flag). Returns HTTP_MODE_REQUIRED error otherwise.
 *
 * Side-effect: schedules a one-shot ONBOARDING_ARM_REMINDER (~45 s) so the
 * participant gets a gentle nudge if they receive this response but never arm
 * the Monitor. The reminder is cancelled when the SSE connection opens.
 *
 * Response: {
 *   ok: true,
 *   sse_url: string,
 *   command: string,          — filtered sse-monitor.sh invocation (NOT raw curl)
 *   monitor_type: "sse",
 *   heartbeat_warning: string,
 *   arm_with: string,
 *   download_url: string,     — GET this URL to download sse-monitor.sh
 * }
 */
import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getSseBaseUrl } from "../../http-mode.js";
import { scheduleArmReminder } from "../../sse-endpoint.js";

export function handleActivityListen(args: Record<string, unknown>) {
  const sid = requireAuth(args.token as number | undefined);
  if (typeof sid !== "number") return toError(sid);

  const baseUrl = getSseBaseUrl();
  if (baseUrl === null) {
    return toError({
      code: "HTTP_MODE_REQUIRED",
      message: "activity/listen requires HTTP mode. Start TMCP with --http to enable SSE endpoints.",
    });
  }

  const sseUrl = `${baseUrl}/sse?token=${args.token as number}`;
  const downloadUrl = `${baseUrl}/tools/sse-monitor.sh`;
  // command uses a local path. Remote pods that don't have a repo checkout should
  // download the script from download_url, save it to a local path of their choice
  // (e.g. their pod root or memory/ dir), then arm:
  //   Monitor tool, persistent: true, command: bash <saved-path> '<sse_url>'
  const command = `bash sse-monitor.sh '${sseUrl}'`;

  // Arm the one-shot reminder — cancelled if the SSE connection opens in time.
  scheduleArmReminder(sid, command);

  return toResult({
    ok: true,
    sse_url: sseUrl,
    command,
    monitor_type: "sse",
    heartbeat_warning:
      "The SSE stream sends a `: keepalive` heartbeat every 30s. Arming a raw curl makes every heartbeat a wake event = spam. This script filters them — you wake only on real messages.",
    arm_with: "Monitor tool, persistent: true",
    download_url: downloadUrl,
    arm_instructions:
      "If you have a repo checkout, run: bash <repo>/tools/sse-monitor.sh '<sse_url>'. " +
      "Otherwise: download the script from download_url, save it to a local path (e.g. your pod root or memory/ dir), then arm the Monitor tool with: bash <saved-path> '<sse_url>' and persistent: true.",
  });
}
