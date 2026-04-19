import { toResult, toError } from "../telegram.js";
import { getSession } from "../session-manager.js";
import { getGovernorSid } from "../routing-mode.js";
import { requireAuth } from "../session-gate.js";
import { deliverServiceMessage, notifySessionWaiters } from "../session-queue.js";
import { closeSessionById } from "../session-teardown.js";
import { refreshGovernorCommand } from "../built-in-commands.js";

export async function handleCloseSessionSignal({
  token,
  target_sid,
  timeout_seconds,
}: {
  token?: number;
  target_sid: number;
  timeout_seconds?: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const callerSid = _sid;

  if (getGovernorSid() !== callerSid) {
    return toError({
      code: "PERMISSION_DENIED",
      message: "Only the governor can signal a session to close.",
    });
  }

  if (target_sid === callerSid) {
    return toError({
      code: "INVALID_TARGET",
      message: "Use action(type: 'session/close') without target_sid to close your own session.",
    });
  }

  const targetInfo = getSession(target_sid);
  if (!targetInfo) {
    return toError({
      code: "SESSION_NOT_FOUND",
      message: `Session ${target_sid} not found.`,
    });
  }

  const timeoutMs = (timeout_seconds ?? 30) * 1000;

  deliverServiceMessage(
    target_sid,
    `\u26d4 Governor requested shutdown. Save state and call \`action(type: "session/close")\` within ${timeout_seconds ?? 30} seconds.`,
    "session_close_signal",
  );
  notifySessionWaiters();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!getSession(target_sid)) {
      void refreshGovernorCommand();
      return toResult({ signaled: true, closed: true, sid: target_sid, reason: "self_closed" });
    }
    await new Promise<void>((r) => setTimeout(r, 500));
  }

  // Re-validate governor status after the wait — it may have changed during the polling window
  if (getGovernorSid() !== callerSid) {
    return toError({
      code: "PERMISSION_DENIED",
      message: "Governor status changed during wait — close aborted.",
    });
  }

  const result = closeSessionById(target_sid);
  void refreshGovernorCommand();
  return toResult({ signaled: true, closed: result.closed, sid: target_sid, reason: "force_closed_after_timeout" });
}
