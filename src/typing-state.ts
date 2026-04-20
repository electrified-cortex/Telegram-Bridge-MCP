/**
 * Per-session typing indicator manager.
 *
 * Design goals:
 *  - **Idempotent** — calling showTyping() while it's already active just
 *    extends the deadline; no extra Telegram API call, no duplicate interval.
 *  - **Auto-cancel** — the interval self-destructs when the deadline passes.
 *  - **Send-cancel** — every outbound tool (send_message, notify, choose, …)
 *    calls cancelTyping() after the Telegram API confirms delivery, so the
 *    indicator persists until the message actually appears for the user.
 *  - **Per-session** — each session has independent typing state so two
 *    concurrent sessions don't cancel each other's indicators.
 */

import { getApi, resolveChat } from "./telegram.js";
import { fireTempReactionRestore } from "./temp-reaction.js";
import { getCallerSid } from "./session-context.js";

export type TypingAction =
  | "typing"
  | "record_voice"
  | "upload_voice"
  | "upload_photo"
  | "upload_document"
  | "upload_video";

interface TypingState {
  timer: ReturnType<typeof setInterval> | null;
  safety: ReturnType<typeof setTimeout> | null;
  deadline: number;
  generation: number;
}

const _states = new Map<number, TypingState>();

const INTERVAL_MS = 4_000; // Telegram indicator expires in ~5 s; 4 s keeps it seamless

function _get(sid: number): TypingState {
  let s = _states.get(sid);
  if (!s) {
    s = { timer: null, safety: null, deadline: 0, generation: 0 };
    _states.set(sid, s);
  }
  return s;
}

function unrefTimer(t: ReturnType<typeof setTimeout>): void {
  if (typeof t === "object" && "unref" in t) t.unref();
}

/** Cancel the typing indicator for a specific SID (used in closures where SID is captured). */
function _cancelForSid(sid: number): boolean {
  const s = _states.get(sid);
  if (!s) return false;
  const wasActive = !!s.timer;
  if (s.timer) {
    clearInterval(s.timer);
    s.timer = null;
  }
  if (s.safety) {
    clearTimeout(s.safety);
    s.safety = null;
  }
  s.deadline = 0;
  return wasActive;
}

/**
 * Cancel the typing indicator immediately (no Telegram call needed — it just expires).
 * Returns true if an active indicator was cancelled, false if nothing was running.
 */
export function cancelTyping(): boolean {
  return _cancelForSid(getCallerSid());
}

/** Generation counter — incremented every time showTyping starts or extends. */
export function typingGeneration(): number {
  return _get(getCallerSid()).generation;
}

/**
 * Cancel typing only if no new showTyping() call has occurred since `gen` was captured.
 * Used by the outbound proxy to avoid clobbering a typing indicator that was
 * (re-)started while a send was in flight.
 */
export function cancelTypingIfSameGeneration(gen: number): boolean {
  const sid = getCallerSid();
  const s = _get(sid);
  if (s.generation !== gen) return false;
  return _cancelForSid(sid);
}

/**
 * Show the typing indicator for `timeoutSeconds` seconds.
 *
 * - If not currently running: sends the action immediately and starts the interval.
 * - If already running: extends the deadline only — no duplicate interval,
 *   no extra Telegram call. The existing 4-second tick will handle it.
 *
 * Returns true if the indicator was newly started, false if an existing one was just extended.
 */
export async function showTyping(timeoutSeconds: number, action: TypingAction = "typing"): Promise<boolean> {
  // Showing typing signals intent to respond — treat as outbound, restore temp reaction.
  await fireTempReactionRestore();

  const sid = getCallerSid();
  const s = _get(sid);
  const timeoutMs = timeoutSeconds * 1000;
  const newDeadline = Date.now() + timeoutMs;
  s.generation++;

  if (s.timer) {
    // Already running — just extend the deadline
    s.deadline = Math.max(s.deadline, newDeadline);
    // Reset the safety timeout too
    if (s.safety) clearTimeout(s.safety);
    s.safety = setTimeout(() => { _cancelForSid(sid); }, Math.max(0, s.deadline - Date.now()));
    unrefTimer(s.safety);
    return false; // extended, not newly started
  }

  // Not running — start fresh
  s.deadline = newDeadline;

  const chatId = resolveChat();
  if (typeof chatId !== "number") return false; // misconfigured — silently skip

  // Send immediately so there's no visible delay
  try {
    await getApi().sendChatAction(chatId, action);
  } catch {
    // Best-effort — never throw from a typing indicator
    return false;
  }

  s.timer = setInterval(() => {
    getApi().sendChatAction(chatId, action).catch(() => {
      _cancelForSid(sid);
    });
  }, INTERVAL_MS);

  unrefTimer(s.timer);

  // Safety: always stop at deadline even if tick math is off
  s.safety = setTimeout(() => _cancelForSid(sid), timeoutMs);
  unrefTimer(s.safety);

  return true; // newly started
}

/** True when the typing indicator is currently active for the calling session. */
export function isTypingActive(): boolean {
  return !!_get(getCallerSid()).timer;
}
