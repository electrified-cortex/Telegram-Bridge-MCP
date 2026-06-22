/**
 * activity/listen — return SSE URL and the FILTERED monitor arm command.
 *
 * Requires HTTP mode (--http flag). Returns HTTP_MODE_REQUIRED error otherwise.
 *
 * Side-effects:
 *   - First call only: delivers ACTIVITY_LISTEN_BREADCRUMB as a service message
 *     so the agent receives arm instructions in the chat without cluttering the
 *     tool response.
 *   - Schedules a one-shot ONBOARDING_ARM_REMINDER (~45 s) so the participant
 *     gets a gentle nudge if they receive this response but never arm the Monitor.
 *     The reminder is cancelled when the SSE connection opens.
 *
 * Response: {
 *   sse_url: string,
 *   command: string,          — filtered sse-monitor.sh invocation (NOT raw curl)
 *   monitor_type: "sse",
 *   arm_with: string,
 *   download_url: string,     — GET this URL to download sse-monitor.sh
 * }
 */
import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getSseBaseUrl } from "../../http-mode.js";
import { scheduleArmReminder } from "../../sse-endpoint.js";
import { markFirstUseHintSeen } from "../../first-use-hints.js";
import { deliverServiceMessage } from "../../session-queue.js";
import { SERVICE_MESSAGES } from "../../service-messages.js";

/** Hint key for the activity/listen breadcrumb — fires once per session. */
const HINT_KEY = "activity:listen";

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

  // First-call breadcrumb: deliver setup instructions as a service message.
  // markFirstUseHintSeen returns true the first time only; subsequent calls are no-ops.
  if (markFirstUseHintSeen(sid, HINT_KEY)) {
    deliverServiceMessage(
      sid,
      SERVICE_MESSAGES.ACTIVITY_LISTEN_BREADCRUMB.text(command, downloadUrl),
      SERVICE_MESSAGES.ACTIVITY_LISTEN_BREADCRUMB.eventType,
    );
  }

  // Arm the one-shot reminder — cancelled if the SSE connection opens in time.
  scheduleArmReminder(sid, command);

  return toResult({
    sse_url: sseUrl,
    command,
    monitor_type: "sse",
    arm_with: "Monitor tool, persistent: true",
    download_url: downloadUrl,
  });
}
