import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getKickDebounceMs, setKickDebounceMs } from "../../session-manager.js";
import { KICK_DEBOUNCE_MIN_MS, KICK_DEBOUNCE_MAX_MS, KICK_DEBOUNCE_DEFAULT_MS } from "../activity/file-state.js";

/**
 * Handle profile/kick-debounce action.
 *
 * GET (ms omitted): return the current per-session kick debounce window.
 * SET (ms provided): set the per-session kick debounce window.
 *
 * Validates range [KICK_DEBOUNCE_MIN_MS, KICK_DEBOUNCE_MAX_MS].
 */
export function handleKickDebounce({ token, ms }: { token: number; ms?: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  if (ms === undefined) {
    // GET
    return toResult({ ok: true, ms: getKickDebounceMs(sid), default_ms: KICK_DEBOUNCE_DEFAULT_MS });
  }

  // SET — validate range
  if (ms < KICK_DEBOUNCE_MIN_MS || ms > KICK_DEBOUNCE_MAX_MS) {
    return toError(
      `kick_debounce ms must be between ${KICK_DEBOUNCE_MIN_MS} and ${KICK_DEBOUNCE_MAX_MS}. Got ${ms}.`,
    );
  }

  const previous = getKickDebounceMs(sid);
  setKickDebounceMs(sid, ms);
  return toResult({ ok: true, ms, previous });
}
