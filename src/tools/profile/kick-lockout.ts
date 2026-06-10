import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getNotifyLockoutMs, setNotifyLockoutMs } from "../../session-manager.js";
import { deliverServiceMessage } from "../../session-queue.js";
import {
  LOCKOUT_MIN_MS,
  LOCKOUT_MAX_MS,
  LOCKOUT_DEFAULT_MS,
  NOTIFY_DEBOUNCE_MIN_MS,
  NOTIFY_DEBOUNCE_MAX_MS,
} from "../activity/file-state.js";

/**
 * Handle profile/kick-lockout action.
 *
 * GET (ms omitted): return current per-session post-kick lockout window.
 * SET (ms provided): set per-session post-kick lockout window.
 */
export function handleKickLockout({ token, ms }: { token: number; ms?: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  if (ms === undefined) {
    return toResult({ ok: true, ms: getNotifyLockoutMs(sid), default_ms: LOCKOUT_DEFAULT_MS });
  }

  if (ms < LOCKOUT_MIN_MS || ms > LOCKOUT_MAX_MS) {
    return toError(
      `kick_lockout ms must be between ${LOCKOUT_MIN_MS} and ${LOCKOUT_MAX_MS}. Got ${ms}.`,
    );
  }

  const previous = getNotifyLockoutMs(sid);
  setNotifyLockoutMs(sid, ms);
  return toResult({ ok: true, ms, previous });
}

/**
 * Handle deprecated profile/kick-debounce action.
 *
 * The old pre-kick-debounce-floor semantics are gone; the numeric ms value is
 * translated directly to the new post-kick lockout window (literal translation,
 * no minimum floor). Response includes a deprecation field. A service message
 * is delivered to surface the deprecation to the operator.
 */
export function handleKickDebounce({ token, ms }: { token: number; ms?: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  if (ms === undefined) {
    // GET: return current lockout value with deprecation notice
    return toResult({
      ok: true,
      deprecated: true,
      replacement: "profile/kick-lockout",
      current_as_lockout_ms: getNotifyLockoutMs(sid),
    });
  }

  // SET: validate against old range, then translate to lockout
  if (ms < NOTIFY_DEBOUNCE_MIN_MS || ms > NOTIFY_DEBOUNCE_MAX_MS) {
    return toError(
      `kick_debounce ms must be between ${NOTIFY_DEBOUNCE_MIN_MS} and ${NOTIFY_DEBOUNCE_MAX_MS}. Got ${ms}.`,
    );
  }

  setNotifyLockoutMs(sid, ms); // literal translation: same ms value becomes the lockout window

  // Surface deprecation via service message
  deliverServiceMessage(
    sid,
    `profile/kick-debounce is deprecated. ` +
      `Your value (${ms} ms) has been applied as the new kick-lockout window. ` +
      `Switch to action(type: 'profile/kick-lockout', ms: ${ms}) to silence this warning.`,
    "kick_debounce_deprecated",
  );

  return toResult({
    ok: true,
    deprecated: true,
    replacement: "profile/kick-lockout",
    translated_value: ms,
  });
}
