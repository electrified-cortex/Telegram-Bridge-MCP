/**
 * Tracks and manages automatic pins for blocking question messages.
 *
 * Blocking questions (choose/confirm) are auto-pinned on send and auto-unpinned
 * on resolution (answer, timeout, cancellation). This module tracks active pins
 * so that session-close cleanup can unpin any questions that were never resolved.
 *
 * Only non-DM chats are eligible for pinning (chatId < 0). DM chats are excluded
 * because pin semantics in DMs are irrelevant and may error.
 */

import { getApi } from "./telegram.js";
import { dlog } from "./debug-log.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface PinEntry {
  chatId: number;
  sid: number;
}

/** messageId → { chatId, sid } */
const _pinnedQuestions = new Map<number, PinEntry>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pin a blocking question message silently.
 *
 * Tracks the pin in state so that session cleanup can unpin on close.
 * DM chats (chatId > 0) are excluded — callers should check before calling.
 * Errors are swallowed and logged at debug level only.
 *
 * @returns true if the pin was applied and tracked; false on failure.
 */
export async function tryPinQuestion(chatId: number, messageId: number, sid: number): Promise<boolean> {
  try {
    await getApi().pinChatMessage(chatId, messageId, { disable_notification: true });
    _pinnedQuestions.set(messageId, { chatId, sid });
    return true;
  } catch (e) {
    dlog("tool", `[question-pin] pin failed msg=${messageId}: ${String(e)}`);
    return false;
  }
}

/**
 * Untrack and unpin a blocking question message.
 *
 * Removes from tracking first (regardless of API success), then calls unpin.
 * Errors are swallowed and logged at debug level only.
 * Call on question resolution — button press, timeout, or cancellation.
 */
export async function untrackAndUnpinQuestion(chatId: number, messageId: number): Promise<void> {
  _pinnedQuestions.delete(messageId);
  try {
    await getApi().unpinChatMessage(chatId, messageId);
  } catch (e) {
    dlog("tool", `[question-pin] unpin failed msg=${messageId}: ${String(e)}`);
  }
}

/**
 * On session close: unpin all tracked question messages for this session.
 *
 * Fire-and-forget — errors are swallowed. Removes entries from tracking before
 * calling unpin so double-unpin attempts (from both cleanup and the handler
 * finally block) are harmless.
 * Called from session-teardown.ts during `closeSessionById`.
 */
export function cleanupSessionQuestionPins(sid: number): void {
  for (const [messageId, entry] of _pinnedQuestions) {
    if (entry.sid === sid) {
      _pinnedQuestions.delete(messageId);
      getApi().unpinChatMessage(entry.chatId, messageId).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset all pin state. For testing only. */
export function resetQuestionPinsForTest(): void {
  _pinnedQuestions.clear();
}

/** Get all tracked pins for a session. For testing only. */
export function getQuestionPinsForSession(sid: number): Array<{ chatId: number; messageId: number }> {
  const result: Array<{ chatId: number; messageId: number }> = [];
  for (const [messageId, entry] of _pinnedQuestions) {
    if (entry.sid === sid) result.push({ chatId: entry.chatId, messageId });
  }
  return result;
}
