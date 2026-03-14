/**
 * Shared helpers for button-based interaction tools (choose, send_choice, send_confirmation).
 */

import { getApi, ackVoiceMessage } from "../telegram.js";
import { markdownToV2, resolveParseMode } from "../markdown.js";
import { applyTopicToText } from "../topic-state.js";
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
// Button style type
// ---------------------------------------------------------------------------

/** Native Telegram inline button background color. */
export type ButtonStyle = "success" | "primary" | "danger";

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
  signal?: AbortSignal,
): Promise<ButtonResult | null> {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    if (signal?.aborted) return null;
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
      ...(signal ? [new Promise<void>((r) => { if (signal.aborted) r(); else signal.addEventListener("abort", () => r(), { once: true }); })] : []),
    ]);
  }
  return null;
}

/**
 * Wait for EITHER a callback_query on the given message OR a text/voice
 * message from the store queue. Used by choose.
 *
 * @param onVoiceDetected - Optional callback fired immediately when a voice
 *   message arrives, before transcription finishes. Use this to remove the
 *   interactive keyboard right away so the user doesn't see a delayed edit.
 */
export async function pollButtonOrTextOrVoice(
  _chatId: number,
  messageId: number,
  timeoutSeconds: number,
  onVoiceDetected?: () => void,
  signal?: AbortSignal,
): Promise<ButtonOrTextResult | null> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let voiceDetectedFired = false;

  while (Date.now() < deadline) {
    if (signal?.aborted) return null;
    let hasPendingVoice = false;

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
          // Don't consume until transcription is complete (two-phase recording)
          if (!event.content.text) {
            // Voice arrived but transcription not yet done — flag for immediate edit
            hasPendingVoice = true;
            return undefined;
          }
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

    // Fire onVoiceDetected once as soon as a voice message is seen (pre-transcription)
    if (hasPendingVoice && !voiceDetectedFired) {
      voiceDetectedFired = true;
      onVoiceDetected?.();
    }

    if (result) return result;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    await Promise.race([
      waitForEnqueue(),
      new Promise<void>((r) => setTimeout(r, Math.min(remaining, 5000))),
      ...(signal ? [new Promise<void>((r) => { if (signal.aborted) r(); else signal.addEventListener("abort", () => r(), { once: true }); })] : []),
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

// ---------------------------------------------------------------------------
// Shared keyboard-send helpers (used by choose + send_choice)
// ---------------------------------------------------------------------------

export interface KeyboardOption {
  label: string;
  value: string;
  style?: "success" | "primary" | "danger";
}

/** Arrange options into rows of `columns` buttons each. */
export function buildKeyboardRows(
  options: KeyboardOption[],
  columns: number,
): { text: string; callback_data: string; style?: ButtonStyle }[][] {
  const rows: { text: string; callback_data: string; style?: ButtonStyle }[][] = [];
  for (let i = 0; i < options.length; i += columns) {
    rows.push(
      options.slice(i, i + columns).map((o) => ({
        text: o.label,
        callback_data: o.value,
        ...(o.style ? { style: o.style as ButtonStyle } : {}),
      })),
    );
  }
  return rows;
}

export interface SendChoiceMessageOptions {
  text: string;
  options: KeyboardOption[];
  columns: number;
  parseMode: "Markdown" | "HTML" | "MarkdownV2";
  disableNotification?: boolean;
  replyToMessageId?: number;
}

/**
 * Send a message with an inline keyboard. Returns the message_id.
 * Does NOT register any auto-lock hook — callers decide what happens on press.
 */
export async function sendChoiceMessage(
  chatId: number,
  opts: SendChoiceMessageOptions,
): Promise<number> {
  const rows = buildKeyboardRows(opts.options, opts.columns);
  const textWithTopic = applyTopicToText(opts.text, opts.parseMode);
  const { text: finalText, parse_mode: finalMode } = resolveParseMode(textWithTopic, opts.parseMode);
  const sent = await getApi().sendMessage(chatId, finalText, {
    parse_mode: finalMode,
    reply_markup: { inline_keyboard: rows },
    disable_notification: opts.disableNotification,
    reply_parameters: opts.replyToMessageId ? { message_id: opts.replyToMessageId } : undefined,
    _rawText: opts.text,
  } as Record<string, unknown>);
  return sent.message_id;
}
