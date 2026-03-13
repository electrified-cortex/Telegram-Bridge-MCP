/**
 * Shared helpers for button-based interaction tools (choose, send_confirmation).
 */

import { getApi, ackVoiceMessage } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { dequeueMatch, waitForEnqueue, type TimelineEvent } from "../message-store.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ButtonResult {
  kind: "button";
  callback_query_id: string;
  data: string;
  message_id: number;
}

export interface TextResult {
  kind: "text";
  message_id: number;
  text: string;
}

export interface VoiceResult {
  kind: "voice";
  message_id: number;
  text?: string;
}

export interface CommandResult {
  kind: "command";
  message_id: number;
  command: string;
  args?: string;
}

export type ButtonOrTextResult =
  | ButtonResult
  | TextResult
  | VoiceResult
  | CommandResult;

// ---------------------------------------------------------------------------
// Button style helpers
// ---------------------------------------------------------------------------

export type ButtonStyle = "success" | "primary" | "danger";

const STYLE_EMOJI: Record<ButtonStyle, string> = {
  success: "🟢",
  primary: "🔵",
  danger: "🔴",
};

/**
 * Prepends a colored circle emoji to the button label based on the style.
 * Returns the original text unchanged when no style is provided.
 * This is the only reliable way to achieve colored buttons in Telegram.
 */
export function applyButtonStyle(text: string, style?: ButtonStyle): string {
  if (!style) return text;
  return `${STYLE_EMOJI[style]} ${text}`;
}

// ---------------------------------------------------------------------------
// Store-based polling helpers
// ---------------------------------------------------------------------------

/**
 * Wait for a callback_query on a specific message from the store queue.
 * Used by send_confirmation (button-only response expected).
 */
export async function pollButtonPress(
  _chatId: number,
  messageId: number,
  timeoutSeconds: number,
): Promise<ButtonResult | null> {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const result = dequeueMatch((event: TimelineEvent) => {
      if (event.event === "callback" && event.content.target === messageId) {
        const qid = event.content.qid;
        const data = event.content.data;
        if (!qid || !data) return undefined;
        return { kind: "button" as const, callback_query_id: qid, data, message_id: messageId };
      }
      return undefined;
    });
    if (result) return result;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    await Promise.race([
      waitForEnqueue(),
      new Promise<void>((r) => setTimeout(r, Math.min(remaining, 5000))),
    ]);
  }
  return null;
}

/**
 * Wait for EITHER a callback_query on the given message OR a text/voice
 * message from the store queue. Used by choose.
 */
export async function pollButtonOrTextOrVoice(
  _chatId: number,
  messageId: number,
  timeoutSeconds: number,
): Promise<ButtonOrTextResult | null> {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const result = dequeueMatch((event: TimelineEvent) => {
      // Check for callback on the specific message
      if (event.event === "callback" && event.content.target === messageId) {
        const qid = event.content.qid;
        const data = event.content.data;
        if (!qid || !data) return undefined;
        return { kind: "button" as const, callback_query_id: qid, data, message_id: messageId };
      }
      // Check for text/voice/command message sent AFTER the question
      if (event.event === "message" && event.id > messageId) {
        if (event.content.type === "text") {
          const text = event.content.text;
          if (!text) return undefined;
          return { kind: "text" as const, message_id: event.id, text };
        }
        if (event.content.type === "voice") {
          ackVoiceMessage(event.id);
          return {
            kind: "voice" as const,
            message_id: event.id,
            text: event.content.text,
          };
        }
        if (event.content.type === "command") {
          return {
            kind: "command" as const,
            message_id: event.id,
            command: event.content.text ?? "",
            args: event.content.data,
          };
        }
      }
      return undefined;
    });
    if (result) return result;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    await Promise.race([
      waitForEnqueue(),
      new Promise<void>((r) => setTimeout(r, Math.min(remaining, 5000))),
    ]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Post-press helpers
// ---------------------------------------------------------------------------

async function appendSuffixAndEdit(
  chatId: number,
  messageId: number,
  text: string,
  suffix: string,
): Promise<void> {
  await getApi()
    .editMessageText(chatId, messageId, markdownToV2(`${text}\n\n${suffix}`), {
      parse_mode: "MarkdownV2",
      reply_markup: { inline_keyboard: [] },
    })
    .catch((e: unknown) => { console.error("[button-helpers] editMessageText failed:", e); });
}

/**
 * Acknowledges a callback_query (removes the Telegram spinner) and edits the
 * host message to show ▸ chosenLabel with all buttons removed.
 */
export async function ackAndEditSelection(
  chatId: number,
  messageId: number,
  originalText: string,
  chosenLabel: string,
  callbackQueryId: string | undefined,
): Promise<void> {
  if (callbackQueryId) {
    await getApi()
      .answerCallbackQuery(callbackQueryId)
      .catch(() => {/* non-fatal */});
  }
  await appendSuffixAndEdit(chatId, messageId, originalText, `▸ *${chosenLabel}*`);
}

/**
 * Edits the host message to show ⏱ Timed out with all buttons removed.
 * Used by send_confirmation when no button was pressed within the timeout.
 */
export async function editWithTimedOut(
  chatId: number,
  messageId: number,
  originalText: string,
): Promise<void> {
  await appendSuffixAndEdit(chatId, messageId, originalText, "⏱ _Timed out_");
}

/**
 * Edits the host message to show ⏭ Skipped with all buttons removed.
 * Used by choose when the user typed/spoke instead of pressing a button.
 */
export async function editWithSkipped(
  chatId: number,
  messageId: number,
  originalText: string,
): Promise<void> {
  await appendSuffixAndEdit(chatId, messageId, originalText, "⏭ _Skipped_");
}
