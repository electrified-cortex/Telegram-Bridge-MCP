import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getSession } from "../../session-manager.js";

/**
 * Handle profile/silent-lifecycle action.
 *
 * GET (enabled omitted): return current silent_lifecycle flag for this session.
 * SET (enabled: true|false): set silent_lifecycle flag, returns ok + previous.
 *
 * When silent_lifecycle is true, the public Telegram chat announcements for
 * session-start and session-close lifecycle events are suppressed.
 * Default: false (announcements shown).
 */
export function handleSilentLifecycle({ token, enabled }: { token: number; enabled?: boolean }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;
  const session = getSession(sid);

  if (enabled === undefined) {
    // GET form — return current value (undefined treated as false)
    return toResult({ ok: true, enabled: session?.silent_lifecycle ?? false, default: false });
  }

  // SET form — mutate session in place, return previous
  const previous = session?.silent_lifecycle ?? false;
  if (session) {
    session.silent_lifecycle = enabled;
  }
  return toResult({ ok: true, enabled, previous });
}
