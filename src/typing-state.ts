/**
 * Module-level singleton for the Telegram "typing" indicator.
 *
 * Design goals:
 *  - **Idempotent** — calling showTyping() while it's already active just
 *    extends the deadline; no extra Telegram API call, no duplicate interval.
 *  - **Auto-cancel** — the interval self-destructs when the deadline passes.
 *  - **Send-cancel** — every outbound tool (send_message, notify, choose, …)
 *    calls cancelTyping() before sending, so the indicator stops the moment
 *    a real message goes out.
 */

import { getApi, resolveChat } from "./telegram.js";

let _timer: ReturnType<typeof setInterval> | null = null;
let _safety: ReturnType<typeof setTimeout> | null = null;
let _deadline = 0;

const INTERVAL_MS = 4_000; // Telegram indicator expires in ~5 s; 4 s keeps it seamless

/**
 * Cancel the typing indicator immediately (no Telegram call needed — it just expires).
 * Returns true if an active indicator was cancelled, false if nothing was running.
 */
export function cancelTyping(): boolean {
  const wasActive = _timer !== null;
  if (_timer !== null) {
    clearInterval(_timer);
    _timer = null;
  }
  if (_safety !== null) {
    clearTimeout(_safety);
    _safety = null;
  }
  _deadline = 0;
  return wasActive;
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
export async function showTyping(timeoutSeconds: number, action: "typing" | "record_voice" | "upload_voice" | "upload_photo" | "upload_document" | "upload_video" = "typing"): Promise<boolean> {
  const timeoutMs = timeoutSeconds * 1000;
  const newDeadline = Date.now() + timeoutMs;

  if (_timer !== null) {
    // Already running — just extend the deadline
    _deadline = Math.max(_deadline, newDeadline);
    // Reset the safety timeout too
    if (_safety !== null) clearTimeout(_safety);
    _safety = setTimeout(() => cancelTyping(), Math.max(0, _deadline - Date.now()));
    if (typeof _safety === "object" && "unref" in _safety) _safety.unref();
    return false; // extended, not newly started
  }

  // Not running — start fresh
  _deadline = newDeadline;

  const chatId = resolveChat();
  if (typeof chatId !== "string") return false; // misconfigured — silently skip

  // Send immediately so there's no visible delay
  try {
    await getApi().sendChatAction(chatId, action);
  } catch {
    // Best-effort — never throw from a typing indicator
    return false;
  }

  _timer = setInterval(async () => {
    if (Date.now() >= _deadline) {
      cancelTyping();
      return;
    }
    try {
      await getApi().sendChatAction(chatId, action);
    } catch {
      cancelTyping();
    }
  }, INTERVAL_MS);

  if (typeof _timer === "object" && "unref" in _timer) _timer.unref();

  // Safety: always stop at deadline even if tick math is off
  _safety = setTimeout(() => cancelTyping(), timeoutMs);
  if (typeof _safety === "object" && "unref" in _safety) _safety.unref();

  return true; // newly started
}

/** True when the typing indicator is currently active. For testing only. */
export function isTypingActive(): boolean {
  return _timer !== null;
}
