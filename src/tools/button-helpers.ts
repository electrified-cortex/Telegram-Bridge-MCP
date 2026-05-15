/**
 * Shared helpers for button-based interaction tools (choose, send_choice, confirm).
 */

import { getApi, ackVoiceMessage } from "../telegram.js";
import { markdownToV2, resolveParseMode } from "../markdown.js";
import { applyTopicToText } from "../topic-state.js";
import { dequeueMatch, waitForEnqueue, type TimelineEvent } from "../message-store.js";
import { getSessionQueue } from "../session-queue.js";

const NO_TIMEOUT_CEILING_SECONDS = 86_400; // 24 h server-side ceiling when no timeout requested
export const BUTTON_COLLAPSE_DELAY_MS = 250;

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
  /** Set when the operator used Telegram's reply feature to target a specific message. */
  reply_to?: number;
}

export interface VoiceResult {
  kind: "voice";
  message_id: number;
  text?: string;
  /** Set when the operator used Telegram's reply feature to target a specific message. */
  reply_to?: number;
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
 * Used by confirm (button-only response expected).
 */
export async function pollButtonPress(
  _chatId: number,
  messageId: number,
  timeoutSeconds: number | undefined,
  signal?: AbortSignal,
  sid?: number,
): Promise<ButtonResult | null> {
  const effectiveTimeout = timeoutSeconds ?? NO_TIMEOUT_CEILING_SECONDS;
  const sq = sid && sid > 0
    ? getSessionQueue(sid)
    : undefined;
  const deadline = Date.now() + effectiveTimeout * 1000;
  const abortPromise = signal
    ? new Promise<void>((r) => { if (signal.aborted) r(); else signal.addEventListener("abort", () => { r(); }, { once: true }); })
    : null;

  // No reply_to guard needed here: pollButtonPress only matches callback events,
  // never text or voice. Callbacks carry a target message_id via event.content.target
  // (exact-match on messageId) so off-target button presses are already excluded.
  const matchFn = (event: TimelineEvent) => {
    if (event.event === "callback" && event.content.target === messageId) {
      const qid = event.content.qid;
      const data = event.content.data;
      if (!qid || !data) return undefined;
      return { kind: "button" as const, callback_query_id: qid, data, message_id: messageId };
    }
    return undefined;
  };

  while (Date.now() < deadline) {
    if (signal?.aborted) return null;
    const result = sq
      ? sq.dequeueMatch(matchFn)
      : dequeueMatch(matchFn);
    if (result) return result;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    await Promise.race([
      sq ? sq.waitForEnqueue() : waitForEnqueue(),
      new Promise<void>((r) => setTimeout(r, Math.min(remaining, 5000))),
      ...(abortPromise ? [abortPromise] : []),
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
  timeoutSeconds: number | undefined,
  onVoiceDetected?: () => void,
  signal?: AbortSignal,
  sid?: number,
): Promise<ButtonOrTextResult | null> {
  const effectiveTimeout = timeoutSeconds ?? NO_TIMEOUT_CEILING_SECONDS;
  const sq = sid && sid > 0
    ? getSessionQueue(sid)
    : undefined;
  const deadline = Date.now() + effectiveTimeout * 1000;
  let voiceDetectedFired = false;
  const abortPromise = signal
    ? new Promise<void>((r) => { if (signal.aborted) r(); else signal.addEventListener("abort", () => { r(); }, { once: true }); })
    : null;

  while (Date.now() < deadline) {
    if (signal?.aborted) return null;
    const state = { hasPendingVoice: false };

    const matchFn = (event: TimelineEvent) => {
      // Check for callback on the specific message
      if (event.event === "callback" && event.content.target === messageId) {
        const qid = event.content.qid;
        const data = event.content.data;
        if (!qid || !data) return undefined;
        return { kind: "button" as const, callback_query_id: qid, data, message_id: messageId };
      }
      // Check for text/voice/command message sent AFTER the question.
      // Telegram guarantees message IDs are monotonically increasing, so
      // event.id > messageId is a reliable proxy for "sent after the question".
      if (event.event === "message" && event.id > messageId) {
        // Three-way reply_to classification:
        //   reply_to === undefined       → ambiguous (no explicit target) → existing skip behaviour
        //   reply_to === messageId       → explicitly targets the active question → existing behaviour
        //   reply_to !== messageId       → targets a different message → not a response to us
        //
        // dequeueMatch re-enqueues non-matched items, so returning undefined here
        // does NOT drop the event — it stays in the queue for the next consumer.
        const replyTo = event.content.reply_to;
        if (replyTo !== undefined && replyTo !== messageId) {
          return undefined;
        }
        if (event.content.type === "text") {
          const text = event.content.text;
          if (!text) return undefined;
          return { kind: "text" as const, message_id: event.id, text, reply_to: event.content.reply_to };
        }
        if (event.content.type === "voice") {
          // Don't consume until transcription is complete (two-phase recording)
          if (!event.content.text) {
            // Voice arrived but transcription not yet done — flag for immediate edit
            state.hasPendingVoice = true;
            return undefined;
          }
          ackVoiceMessage(event.id);
          return {
            kind: "voice" as const,
            message_id: event.id,
            text: event.content.text,
            reply_to: event.content.reply_to,
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
    };
    const result = sq
      ? sq.dequeueMatch(matchFn)
      : dequeueMatch(matchFn);

    // Fire onVoiceDetected once as soon as a voice message is seen (pre-transcription)
    if (state.hasPendingVoice && !voiceDetectedFired) {
      voiceDetectedFired = true;
      onVoiceDetected?.();
    }

    if (result) return result;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    await Promise.race([
      sq ? sq.waitForEnqueue() : waitForEnqueue(),
      new Promise<void>((r) => setTimeout(r, Math.min(remaining, 5000))),
      ...(abortPromise ? [abortPromise] : []),
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
  isVoice?: boolean,
  replyMarkup?: { inline_keyboard: { text: string; callback_data: string; style?: ButtonStyle }[][] },
): Promise<void> {
  const markup = replyMarkup ?? { inline_keyboard: [] };
  if (isVoice) {
    await getApi()
      .editMessageCaption(chatId, messageId, {
        caption: markdownToV2(`${text}\n\n${suffix}`),
        parse_mode: "MarkdownV2",
        reply_markup: markup,
      })
      .catch((e: unknown) => { console.error("[button-helpers] editMessageCaption failed:", e); });
  } else {
    await getApi()
      .editMessageText(chatId, messageId, markdownToV2(`${text}\n\n${suffix}`), {
        parse_mode: "MarkdownV2",
        reply_markup: markup,
      })
      .catch((e: unknown) => { console.error("[button-helpers] editMessageText failed:", e); });
  }
}

/**
 * Acknowledges a callback_query (removes the Telegram spinner) and edits the
 * host message to show ▸ chosenLabel. When highlightedRows is provided the
 * keyboard is updated to mark the clicked button as primary; otherwise all
 * buttons are removed.
 *
 * @param delayMs - Milliseconds to wait after acking before editing. Only
 *   applied when callbackQueryId is provided (i.e. a button was actually
 *   clicked and a color-flip occurred). Default BUTTON_COLLAPSE_DELAY_MS.
 */
export async function ackAndEditSelection(
  chatId: number,
  messageId: number,
  originalText: string,
  chosenLabel: string,
  callbackQueryId: string | undefined,
  isVoice?: boolean,
  highlightedRows?: { text: string; callback_data: string; style?: ButtonStyle }[][],
  delayMs = BUTTON_COLLAPSE_DELAY_MS,
): Promise<void> {
  if (callbackQueryId) {
    await getApi()
      .answerCallbackQuery(callbackQueryId)
      .catch((e: unknown) => { console.error('[ackAndEditSelection] answerCallbackQuery failed:', e); });
    // Brief delay so the button color-flip (from answerCallbackQuery) is visible
    // before the keyboard collapses and the selection suffix appears.
    await new Promise<void>((r) => setTimeout(r, delayMs));
  }
  const replyMarkup = highlightedRows ? { inline_keyboard: highlightedRows } : undefined;
  await appendSuffixAndEdit(chatId, messageId, originalText, `▸ *${chosenLabel}*`, isVoice, replyMarkup);
}

/**
 * Perform a two-stage highlight-then-collapse for one-shot choice callbacks:
 *
 * Stage 1 (immediate): Answer the callback query (removes Telegram spinner) and
 *   edit the keyboard so the chosen button is highlighted while all others are
 *   stripped plain. The message text is NOT changed yet.
 *
 * Stage 2 (~delayMs later): Remove the keyboard entirely and append the
 *   "▸ label" selection suffix to the message text — matching the end state of
 *   send(type:"question") / choose.
 *
 * Race condition: if a second tap arrives between stage 1 and stage 2, the
 * keyboard is already in collapse-pending state. Intended behaviour: ignore —
 * the keyboard is being removed and any additional callback query for this
 * message will be acked-only by the caller's hook (which is one-shot and won't
 * re-enter this path). This is acceptable because the user already committed
 * to a choice in stage 1.
 *
 * @param delayMs - Milliseconds between stage 1 and stage 2. Default BUTTON_COLLAPSE_DELAY_MS.
 */
export async function highlightThenCollapse(
  chatId: number,
  messageId: number,
  originalText: string,
  chosenLabel: string,
  callbackQueryId: string | undefined,
  highlightedRows: { text: string; callback_data: string; style?: ButtonStyle }[][],
  delayMs = BUTTON_COLLAPSE_DELAY_MS,
): Promise<void> {
  // Stage 1: ack spinner + show highlight keyboard immediately.
  if (callbackQueryId) {
    await getApi()
      .answerCallbackQuery(callbackQueryId)
      .catch(() => {/* non-fatal */});
  }
  // Edit only the reply_markup (no text change yet) — keyboard shows highlight.
  await getApi()
    .editMessageReplyMarkup(chatId, messageId, { reply_markup: { inline_keyboard: highlightedRows } })
    .catch((e: unknown) => { console.error("[button-helpers] highlightThenCollapse stage-1 failed:", e); });

  // Stage 2: collapse after brief delay — remove keyboard and append suffix.
  await new Promise<void>((r) => setTimeout(r, delayMs));
  // Must pass reply_markup: { inline_keyboard: [] } explicitly; editMessageText alone
  // does NOT clear an existing inline keyboard.
  // isVoice is always false here: highlightThenCollapse is only used by send_choice
  // (non-blocking keyboard), which is a text message context. Voice context is handled
  // by choose/confirm via ackAndEditSelection which has an explicit isVoice parameter.
  await appendSuffixAndEdit(chatId, messageId, originalText, `▸ *${chosenLabel}*`, false, { inline_keyboard: [] });
}

/**
 * Edits the host message to show ⏱ Timed out with all buttons removed.
 * Used by confirm when no button was pressed within the timeout.
 */
export async function editWithTimedOut(
  chatId: number,
  messageId: number,
  originalText: string,
  isVoice?: boolean,
): Promise<void> {
  await appendSuffixAndEdit(chatId, messageId, originalText, "⏱ _Timed out_", isVoice);
}

/**
 * Edits the host message to show ⏭ Skipped with all buttons removed.
 * Used by choose when the user typed/spoke instead of pressing a button.
 */
export async function editWithSkipped(
  chatId: number,
  messageId: number,
  originalText: string,
  isVoice?: boolean,
): Promise<void> {
  await appendSuffixAndEdit(chatId, messageId, originalText, "⏭ _Skipped_", isVoice);
}

/**
 * Edits the host message to show ↩ Replied with all buttons removed.
 * Used by choose/confirm when the operator replied directly to the question message.
 */
export async function editWithReplied(
  chatId: number,
  messageId: number,
  originalText: string,
  isVoice?: boolean,
): Promise<void> {
  await appendSuffixAndEdit(chatId, messageId, originalText, "↩ _Replied_", isVoice);
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

/**
 * Rebuild keyboard rows for the highlight step of a one-shot choice:
 * - The clicked button keeps its original style, or falls back to "primary".
 * - All other buttons have their style stripped (plain Telegram default — no color).
 *
 * This creates a clear visual "winner" before the keyboard collapses entirely
 * in the subsequent collapse step (~250 ms later).
 */
export function buildHighlightedRows(
  options: KeyboardOption[],
  columns: number,
  clickedValue: string,
): { text: string; callback_data: string; style?: ButtonStyle }[][] {
  return buildKeyboardRows(
    options.map((o) => {
      if (o.value === clickedValue) {
        // Keep original style if set; fall back to primary as highlight indicator.
        return { ...o, style: (o.style ?? "primary") as ButtonStyle };
      }
      // Strip style from all non-clicked buttons so they appear plain.
      const { style: _dropped, ...rest } = o;
      return rest;
    }),
    columns,
  );
}

export interface SendChoiceMessageOptions {
  text: string;
  options: KeyboardOption[];
  columns: number;
  parseMode: "Markdown" | "HTML" | "MarkdownV2";
  disableNotification?: boolean;
  replyToMessageId?: number;
  /** Per-message topic override — passed to applyTopicToText. Undefined = use profile topic. */
  topicOverride?: string;
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
  const textWithTopic = applyTopicToText(opts.text, opts.parseMode, opts.topicOverride);
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
