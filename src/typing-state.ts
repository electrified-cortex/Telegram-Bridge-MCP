/**
 * Module-level singleton for the Telegram "typing" indicator.
 *
 * Design goals:
 *  - **Idempotent** — calling showTyping() while it's already active just
 *    extends the deadline; no extra Telegram API call, no duplicate interval.
 *  - **Auto-cancel** — the interval self-destructs when the deadline passes.
 *  - **Send-cancel** — every outbound tool (send_message, notify, choose, …)
 *    calls cancelTyping() after the Telegram API confirms delivery, so the
 *    indicator persists until the message actually appears for the user.
 */

import { getApi, resolveChat } from "./telegram.js";
import { isAnimationActive, isAnimationPersistent, cancelAnimation } from "./animation-state.js";
import { fireTempReactionRestore } from "./temp-reaction.js";

export type TypingAction =
  | "typing"
  | "record_voice"
  | "upload_voice"
  | "upload_photo"
  | "upload_document"
  | "upload_video";

let _timer: ReturnType<typeof setInterval> | null = null;
let _safety: ReturnType<typeof setTimeout> | null = null;
let _deadline = 0;
let _generation = 0;

const INTERVAL_MS = 4_000; // Telegram indicator expires in ~5 s; 4 s keeps it seamless

function unrefTimer(t: ReturnType<typeof setTimeout>): void {
  if (typeof t === "object" && "unref" in t) t.unref();
}

/**
 * Cancel the typing indicator immediately (no Telegram call needed — it just expires).
 * Returns true if an active indicator was cancelled, false if nothing was running.
 */
export function cancelTyping(): boolean {
  const wasActive = !!_timer;
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  if (_safety) {
    clearTimeout(_safety);
    _safety = null;
  }
  _deadline = 0;
  return wasActive;
}

/** Generation counter — incremented every time showTyping starts or extends. */
export function typingGeneration(): number {
  return _generation;
}

/**
 * Cancel typing only if no new showTyping() call has occurred since `gen` was captured.
 * Used by the outbound proxy to avoid clobbering a typing indicator that was
 * (re-)started while a send was in flight.
 */
export function cancelTypingIfSameGeneration(gen: number): boolean {
  if (_generation !== gen) return false;
  return cancelTyping();
}

/**
 * Show the typing indicator for `timeoutMs` milliseconds.
 *
 * - If not currently running: sends the action immediately and starts the interval.
 * - If already running: extends the deadline only — no duplicate interval,
 *   no extra Telegram call. The existing 4-second tick will handle it.
 */
/**
 * Returns true if the indicator was newly started, false if an existing one was just extended.
 */
export async function showTyping(timeoutSeconds: number, action: TypingAction = "typing"): Promise<boolean> {
  // Cancel temporary animations — typing indicator replaces the placeholder.
  // Persistent animations are agent-controlled and survive show_typing.
  if (isAnimationActive() && !isAnimationPersistent()) {
    await cancelAnimation();
  }

  // Showing typing signals intent to respond — treat as outbound, restore temp reaction.
  await fireTempReactionRestore();

  const timeoutMs = timeoutSeconds * 1000;
  const newDeadline = Date.now() + timeoutMs;
  _generation++;

  if (_timer) {
    // Already running — just extend the deadline
    _deadline = Math.max(_deadline, newDeadline);
    // Reset the safety timeout too
    if (_safety) clearTimeout(_safety);
    _safety = setTimeout(() => { cancelTyping(); }, Math.max(0, _deadline - Date.now()));
    unrefTimer(_safety);
    return false; // extended, not newly started
  }

  // Not running — start fresh
  _deadline = newDeadline;

  const chatId = resolveChat();
  if (typeof chatId !== "number") return false; // misconfigured — silently skip

  // Send immediately so there's no visible delay
  try {
    await getApi().sendChatAction(chatId, action);
  } catch {
    // Best-effort — never throw from a typing indicator
    return false;
  }

  _timer = setInterval(() => {
    if (Date.now() >= _deadline) {
      cancelTyping();
      return;
    }
    getApi().sendChatAction(chatId, action).catch(() => {
      cancelTyping();
    });
  }, INTERVAL_MS);

  unrefTimer(_timer);

  // Safety: always stop at deadline even if tick math is off
  _safety = setTimeout(() => cancelTyping(), timeoutMs);
  unrefTimer(_safety);

  return true; // newly started
}

/** True when the typing indicator is currently active. For testing only. */
export function isTypingActive(): boolean {
  return !!_timer;
}
