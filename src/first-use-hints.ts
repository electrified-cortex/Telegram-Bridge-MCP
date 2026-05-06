/**
 * First-use hint system for send-type bridge features.
 *
 * On the first call to `send(type: X)` within a session, a one-time hint is
 * appended to the tool response (NOT sent as a Telegram message). Subsequent
 * calls to the same type return null — no repeat hints.
 *
 * Session-scoped: hints reset on session restart (in-memory, no persistence).
 */
import { getOrInitHintsSeen, getSession } from "./session-manager.js";
import { dlog } from "./debug-log.js";

// ── Hint text per send type ────────────────────────────────────────────────

const HINTS: Record<string, string> = {
  "send:choice":
    'Non-blocking buttons only. To wait for a selection, use send(type: "question", choose: [...]). help(\'send\').',

  "send:question:choose":
    'First use — blocking button prompt: send(type: "question", choose: [...]) blocks until the operator selects a button (or timeout). ' +
    'If you want non-blocking buttons (fire-and-forget), use send(type: "choice") instead. ' +
    'See help("send") → choice/question comparison.',

  "send:progress":
    'First use — progress bar: Creates a pinned bar. ' +
    'Update with action(type: "progress/update", percent: N). ' +
    'Close explicitly when done — orphaned bars stay pinned until dismissed. ' +
    'See help("progress").',

  "send:checklist":
    'First use — pinned checklist: Creates a pinned step-status list. ' +
    'Update individual steps with action(type: "checklist/update", step: N, status: "done"). ' +
    'See help("checklist").',

  "send:animation":
    'Animation is temporary. Cancel it when work ends. help(\'animation\').',

  "send:append":
    'First use — in-place message growth: Appends text to an existing message without creating a new one. ' +
    'Only works on messages from the current session. ' +
    'Keep accumulated length under 3800 chars. ' +
    'See help("send") → Append Mode section.',
};

// ── Public helpers ─────────────────────────────────────────────────────────

/**
 * Mark a hint key as seen for a session.
 * Returns true if this is the first time (hint should fire), false if already seen.
 * Returns false if the session does not exist.
 */
export function markFirstUseHintSeen(sid: number, hintKey: string): boolean {
  const seen = getOrInitHintsSeen(sid);
  if (!seen) return false;
  if (seen.has(hintKey)) return false;
  seen.add(hintKey);
  return true;
}

/**
 * Return true if the given hint key has already been shown to this session.
 * Returns false if the session does not exist or the hint has not been seen.
 * Pure read — does NOT initialise firstUseHintsSeen if it is absent.
 */
export function hasSeenHint(sid: number, hintKey: string): boolean {
  return getSession(sid)?.firstUseHintsSeen?.has(hintKey) ?? false;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns the first-use hint for a given session and hint key, or null if:
 * - The hint has already been shown for this session
 * - The session does not exist
 * - No hint is defined for the key
 *
 * Side effect: marks the hint key as seen so subsequent calls return null.
 *
 * @param sid     Session ID
 * @param hintKey Hint key (e.g. "send:choice", "send:question:choose")
 */
export function getFirstUseHint(sid: number, hintKey: string): string | null {
  const text = HINTS[hintKey];
  if (!text) return null;
  const isFirst = markFirstUseHintSeen(sid, hintKey);
  return isFirst ? text : null;
}

/**
 * Append a first-use hint to an MCP tool result object.
 *
 * Mutates the first content[0].text entry by parsing the JSON, adding a
 * `_first_use_hint` field, and re-serialising it. If the hint is null or
 * the result is an error, the result is returned unchanged.
 *
 * Generic so the exact result type (including `type: "text"` literal) is
 * preserved for TypeScript callers.
 */
export function appendHintToResult<T extends { content: { type: string; text: string }[]; isError?: true }>(
  result: T,
  hint: string | null,
): T {
  if (!hint || result.isError) return result;
  try {
    const entry = result.content[0] as typeof result.content[0] | undefined;
    if (!entry || entry.type !== "text") return result;
    const parsed = JSON.parse(entry.text) as Record<string, unknown>;
    parsed._first_use_hint = hint;
    entry.text = JSON.stringify(parsed, null, 2);
  } catch (err) {
    // If JSON parsing fails for any reason, return the result as-is rather
    // than breaking the tool response.
    dlog("tool", "appendHintToResult: failed to parse content JSON", { err: String(err) });
  }
  return result;
}
