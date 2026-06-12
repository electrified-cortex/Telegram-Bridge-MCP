import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getNotifyDebounceMs, setNotifyDebounceMs } from "../../session-manager.js";
import {
  NOTIFY_DEBOUNCE_MIN_MS,
  NOTIFY_DEBOUNCE_MAX_MS,
  NOTIFY_DEBOUNCE_MS,
} from "../activity/file-state.js";

/**
 * Handle profile/kick-gate action.
 *
 * GET (ms omitted): return current per-session kick gate lockout window.
 * SET (ms provided): set per-session kick gate lockout window.
 *
 * The kick gate is a post-kick lockout: after the session is kicked (activity
 * file touched / SSE stream notified), further kicks are suppressed until either
 * the lockout window expires or a content-returning dequeue releases it early.
 * This eliminates redundant retries while preserving cold-start responsiveness.
 *
 * Default: 300 000 ms (5 minutes). Range: 1 000–3 600 000 ms (1 s–1 h).
 */
export function handleKickGate({ token, ms }: { token: number; ms?: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  if (ms === undefined) {
    return toResult({ ok: true, ms: getNotifyDebounceMs(sid), default_ms: NOTIFY_DEBOUNCE_MS });
  }

  if (ms < NOTIFY_DEBOUNCE_MIN_MS || ms > NOTIFY_DEBOUNCE_MAX_MS) {
    return toError(
      `kick_gate ms must be between ${NOTIFY_DEBOUNCE_MIN_MS} and ${NOTIFY_DEBOUNCE_MAX_MS}. Got ${ms}.`,
    );
  }

  const previous = getNotifyDebounceMs(sid);
  setNotifyDebounceMs(sid, ms);
  return toResult({ ok: true, ms, previous });
}
