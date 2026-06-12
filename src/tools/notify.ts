import type { NotifySource } from "./activity/file-state.js";
import { notifyIfAllowed } from "./activity/file-state.js";
import { notifySseSubscriber } from "../sse-endpoint.js";

/**
 * Notify a session via the SSE activity stream.
 *
 * @param sid - Session to notify.
 * @param source - Notification source (controls gate behaviour).
 * @param inflightAtEnqueue - True when the session is actively blocked in dequeue.
 * @param originatorSid - Session that originated the event (0 or undefined = external/system).
 *   When set to a positive value equal to `sid`, the notification is suppressed:
 *   agents must not wake themselves on their own sends/reactions (AC-1 self-notify filter).
 *   The gate (notifyIfAllowed) is intentionally bypassed on self-events so self-
 *   originated activity does not consume the lockout budget or trigger a file touch.
 */
export function notifySession(
  sid: number,
  source: NotifySource,
  inflightAtEnqueue: boolean,
  originatorSid?: number,
): void {
  // AC-1 self-notify filter: drop events where the subscriber is the originator.
  if (originatorSid !== undefined && originatorSid > 0 && originatorSid === sid) {
    return;
  }
  if (notifyIfAllowed(sid, source, inflightAtEnqueue)) {
    notifySseSubscriber(sid);
  }
}
