/**
 * activity/listen — return SSE URL and the FILTERED monitor arm command.
 *
 * Requires HTTP mode (--http flag). Returns HTTP_MODE_REQUIRED error otherwise.
 *
 * Side-effects:
 *   1. Delivers a setup breadcrumb as a service message in chat so the agent
 *      has the concrete arm command available even after context compaction.
 *   2. Schedules a one-shot ONBOARDING_ARM_REMINDER (~45 s) so the participant
 *      gets a gentle nudge if they never arm the Monitor.  The reminder is
 *      cancelled when the SSE connection opens.
 *
 * Response: {
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
import { resetMaxWait0NudgeState, resetColdDequeueState } from "../dequeue.js";
import { deliverServiceMessage } from "../../session-queue.js";
import { SERVICE_MESSAGES } from "../../service-messages.js";

export function handleActivityListen(args: Record<string, unknown>) {
  const sid = requireAuth(args.token as number | undefined);
  if (typeof sid !== "number") return toError(sid);

  const rawBaseUrl = getSseBaseUrl();
  if (rawBaseUrl === null) {
    return toError({
      code: "HTTP_MODE_REQUIRED",
      message: "activity/listen requires HTTP mode. Start TMCP with --http to enable SSE endpoints.",
    });
  }

  // Apply BRIDGE_ADVERTISE_HOST substitution: replace the bound host (e.g.
  // 0.0.0.0) with the address agents should actually connect to.
  // When unset or empty, the raw bind address is used unchanged (backward compat).
  const advertiseHost = process.env.BRIDGE_ADVERTISE_HOST?.trim();
  // Regex handles both IPv4/hostname hosts and IPv6 literal hosts (e.g. [::1]).
  // IPv6 literals are enclosed in brackets; [^/:] alone would stop at the first ':'
  // inside the bracket, corrupting the replacement. The alternation handles both forms.
  const baseUrl = advertiseHost
    ? rawBaseUrl.replace(/^(https?:\/\/)(\[[^\]]+\]|[^/:]+)/, `$1${advertiseHost}`)
    : rawBaseUrl;

  const sseUrl = `${baseUrl}/sse?token=${args.token as number}`;
  const downloadUrl = `${baseUrl}/tools/sse-monitor.sh`;
  // command uses a local path. Remote pods that don't have a repo checkout should
  // download the script from download_url, save it to a local path of their choice,
  // then arm:
  //   Monitor tool, persistent: true, command: bash <saved-path> '<sse_url>'
  const command = `bash sse-monitor.sh '${sseUrl}'`;

  // Reset per-session max_wait:0 nudge state — fresh grace window for the new subscription.
  resetMaxWait0NudgeState(sid);
  // Reset the cold-dequeue detector for the same reason (30-2205).
  resetColdDequeueState(sid);

  // Arm the one-shot reminder — cancelled if the SSE connection opens in time.
  scheduleArmReminder(sid, command);

  // Deliver the setup breadcrumb as a service message so the agent has the
  // concrete arm command available in chat even after context compaction.
  deliverServiceMessage(
    sid,
    SERVICE_MESSAGES.ACTIVITY_LISTEN_SETUP.text(command, downloadUrl),
    SERVICE_MESSAGES.ACTIVITY_LISTEN_SETUP.eventType,
  );

  return toResult({
    sse_url: sseUrl,
    command,
    monitor_type: "sse",
    heartbeat_warning:
      "The SSE stream sends a `: keepalive` heartbeat every 30s. Arming a raw curl makes every heartbeat a wake event = spam. This script filters them — you wake only on real messages.",
    arm_with: "Monitor tool, persistent: true",
    download_url: downloadUrl,
    arm_instructions:
      "If you have a repo checkout, run: bash <repo>/tools/sse-monitor.sh '<sse_url>'. " +
      "Otherwise: download the script from download_url, save it to a local path of your choice, then arm the Monitor tool with: bash <saved-path> '<sse_url>' and persistent: true.",
  });
}
