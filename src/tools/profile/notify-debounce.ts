import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getNotifyDebounceMs, setNotifyDebounceMs } from "../../session-manager.js";
import { deliverServiceMessage } from "../../session-queue.js";
import {
  NOTIFY_DEBOUNCE_MIN_MS,
  NOTIFY_DEBOUNCE_MAX_MS,
  NOTIFY_DEBOUNCE_MS,
} from "../activity/file-state.js";

/**
 * Handle profile/notify-debounce action.
 *
 * GET (ms omitted): return current per-session post-notify debounce window.
 * SET (ms provided): set per-session post-notify debounce window.
 */
export function handleNotifyDebounce({ token, ms }: { token: number; ms?: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  if (ms === undefined) {
    return toResult({ ok: true, ms: getNotifyDebounceMs(sid), default_ms: NOTIFY_DEBOUNCE_MS });
  }

  if (ms < NOTIFY_DEBOUNCE_MIN_MS || ms > NOTIFY_DEBOUNCE_MAX_MS) {
    return toError(
      `notify_debounce ms must be between ${NOTIFY_DEBOUNCE_MIN_MS} and ${NOTIFY_DEBOUNCE_MAX_MS}. Got ${ms}.`,
    );
  }

  const previous = getNotifyDebounceMs(sid);
  setNotifyDebounceMs(sid, ms);
  return toResult({ ok: true, ms, previous });
}

// Legacy max for the deprecated kick-debounce handler (old range was 1_000–600_000).
const _LEGACY_DEBOUNCE_MAX_MS = 600_000;

/**
 * Handle deprecated profile/kick-debounce action.
 *
 * The old pre-kick-debounce-floor semantics are gone; the numeric ms value is
 * translated directly to the new post-notify debounce window (literal translation,
 * no minimum floor). Response includes a deprecation field. A service message
 * is delivered to surface the deprecation to the operator.
 */
export function handleKickDebounce({ token, ms }: { token: number; ms?: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  if (ms === undefined) {
    // GET: return current kick gate value with deprecation notice
    return toResult({
      ok: true,
      deprecated: true,
      replacement: "profile/kick-gate",
      current_as_kick_gate_ms: getNotifyDebounceMs(sid),
    });
  }

  // SET: validate against old range, then translate to kick gate window
  if (ms < NOTIFY_DEBOUNCE_MIN_MS || ms > _LEGACY_DEBOUNCE_MAX_MS) {
    return toError(
      `kick_debounce ms must be between ${NOTIFY_DEBOUNCE_MIN_MS} and ${_LEGACY_DEBOUNCE_MAX_MS}. Got ${ms}.`,
    );
  }

  setNotifyDebounceMs(sid, ms); // literal translation: same ms value becomes the kick gate window

  // Surface deprecation via service message
  deliverServiceMessage(
    sid,
    `profile/kick-debounce is deprecated. ` +
      `Your value (${ms} ms) has been applied as the new kick gate window. ` +
      `Switch to action(type: 'profile/kick-gate', ms: ${ms}) to silence this warning.`,
    "kick_debounce_deprecated",
  );

  return toResult({
    ok: true,
    deprecated: true,
    replacement: "profile/kick-gate",
    translated_value: ms,
  });
}
