import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getApi, resolveChat,
  toResult, toError, validateText, validateCallbackData, LIMITS, sendVoiceDirect,
} from "../../telegram.js";
import { registerCallbackHook, clearCallbackHook, registerMessageHook, clearMessageHook, pendingCount } from "../../message-store.js";
import { getSessionQueue, peekSessionCategories } from "../../session-queue.js";
import { getCallerSid, runInSessionContext } from "../../session-context.js";
import { requireAuth } from "../../session-gate.js";
import {
  pollButtonOrTextOrVoice, ackAndEditSelection, editWithSkipped, editWithReplied, editWithTimedOut,
  sendChoiceMessage, buildKeyboardRows, type KeyboardOption,
} from "../button-helpers.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";
import { validateButtonSymbolParity } from "../../button-validation.js";
import { isTtsEnabled, stripForTts, synthesizeToOgg } from "../../tts.js";
import { getSessionVoice, getSessionSpeed } from "../../voice-state.js";
import { getDefaultVoice } from "../../config.js";
import { showTyping, typingGeneration, cancelTypingIfSameGeneration } from "../../typing-state.js";
import { applyTopicToText } from "../../topic-state.js";
import { markdownToV2 } from "../../markdown.js";

const DESCRIPTION =
  "Send a prompt with 2–8 buttons and wait for the user to press one. " +
  "Returns { label, value } on selection; { skipped: true, text_response } if the user types instead; " +
  "{ timed_out: true } on deadline (buttons stay live, late clicks still handled). " +
  "Drain pending updates with dequeue(timeout:0) before calling, or pass ignore_pending: true. " +
  "Call `help(topic: 'choose')` for details.";


export type ChooseOption = { label: string; value: string; style?: "success" | "primary" | "danger" };

export async function handleChoose(
  {
    text,
    options,
    timeout_seconds,
    columns = 2,
    reply_to,
    ignore_pending,
    ignore_parity,
    audio,
    token,
    response_format,
  }: {
    text: string;
    options: ChooseOption[];
    timeout_seconds?: number;
    columns?: number;
    reply_to?: number;
    ignore_pending?: boolean;
    ignore_parity?: boolean;
    audio?: string;
    token: number;
    response_format?: "default" | "compact";
  },
  signal: AbortSignal,
) {
  const reply_to_message_id = reply_to;
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);
  const textErr = validateText(text);
  if (textErr) return toError(textErr);

  if (!ignore_pending && !reply_to_message_id) {
    const sid = getCallerSid();
    const sq = sid > 0 ? getSessionQueue(sid) : undefined;
    const pending = sq ? sq.pendingCount() : pendingCount();
    if (pending > 0) {
      const breakdown = sid > 0 ? peekSessionCategories(sid) : undefined;
      const summary = breakdown
        ? Object.entries(breakdown).map(([k, v]) => `${v} ${k}`).join(", ")
        : undefined;
      const detail = summary
        ? `${pending} unread update(s): ${summary}.`
        : `${pending} unread update(s).`;
      return toError({
        code: "PENDING_UPDATES" as const,
        message:
          `${detail} Consider draining with dequeue(timeout:0) before ` +
          `calling choose, or pass ignore_pending: true to proceed anyway.`,
        pending,
        ...(breakdown ? { breakdown } : {}),
      });
    }
  }

  // Validate button symbol parity
  if (!ignore_parity) {
    const parity = validateButtonSymbolParity(options.map((o) => o.label));
    if (!parity.ok) {
      return toError({
        code: "BUTTON_SYMBOL_PARITY" as const,
        message: `Button labels are inconsistent: ${parity.withEmoji.length} of ${options.length} have emoji. Either add emoji to all labels or remove them. Pass ignore_parity: true to send anyway.`,
        labels_with_emoji: parity.withEmoji,
        labels_without_emoji: parity.withoutEmoji,
      });
    }
  }

  // Validate all callback data up front
  const displayMax = columns >= 2
    ? LIMITS.BUTTON_DISPLAY_MULTI_COL
    : LIMITS.BUTTON_DISPLAY_SINGLE_COL;
  for (const opt of options) {
    const dataErr = validateCallbackData(opt.value);
    if (dataErr) return toError(dataErr);
    if (opt.label.length > LIMITS.BUTTON_TEXT)
      return toError({
        code: "BUTTON_DATA_INVALID" as const,
        message: `Button label "${opt.label}" is ${opt.label.length} chars but the Telegram limit is ${LIMITS.BUTTON_TEXT}.`,
      });
    if (opt.label.length > displayMax)
      return toError({
        code: "BUTTON_LABEL_TOO_LONG" as const,
        message: `Button label "${opt.label}" (${opt.label.length} chars) will be cut off on mobile. With columns=${columns}, keep labels under ${displayMax} chars. Use columns=1 for longer labels (max ${LIMITS.BUTTON_DISPLAY_SINGLE_COL} chars).`,
      });
  }

  try {
    let messageId: number;

    if (audio !== undefined) {
      if (!isTtsEnabled()) {
        return toError({
          code: "TTS_NOT_CONFIGURED" as const,
          message: "TTS is not configured. Set TTS_HOST or OPENAI_API_KEY to use voice mode.",
        });
      }
      const plainText = stripForTts(audio);
      if (!plainText) {
        return toError({ code: "EMPTY_MESSAGE" as const, message: "Audio text is empty after stripping formatting for TTS. Provide non-empty spoken content in the audio field." });
      }
      const resolvedVoice = getSessionVoice() || getDefaultVoice() || undefined;
      const resolvedSpeed = getSessionSpeed() ?? undefined;
      const typingSeconds = Math.min(120, Math.max(5, Math.ceil(plainText.length / 20)));
      await showTyping(typingSeconds, "record_voice");
      const gen = typingGeneration();
      let voiceSent = false;
      try {
        const ogg = await synthesizeToOgg(plainText, resolvedVoice, resolvedSpeed);
        // Apply topic prefix to caption (not to TTS input — don't read the prefix aloud).
        // Reserve 60 chars for the session header that sendVoiceDirect prepends, to stay under the 1024 caption limit.
        const MAX_CAPTION = 1024 - 60;
        const rawCaption = applyTopicToText(text, "Markdown");
        let caption = markdownToV2(rawCaption);
        if (caption.length > MAX_CAPTION) {
          caption = caption.slice(0, MAX_CAPTION);
          if (caption.endsWith("\\")) caption = caption.slice(0, -1);
        }
        const rows = buildKeyboardRows(options as KeyboardOption[], columns);
        const msg = await sendVoiceDirect(chatId, ogg, {
          caption,
          parse_mode: "MarkdownV2",
          reply_to_message_id,
          reply_markup: { inline_keyboard: rows },
        });
        messageId = msg.message_id;
        voiceSent = true;
      } finally {
        if (voiceSent) {
          // Voice messages take 2-5s to render after API confirmation; keep indicator alive.
          await new Promise<void>(resolve => setTimeout(resolve, 3000));
        }
        cancelTypingIfSameGeneration(gen);
      }
    } else {
      messageId = await sendChoiceMessage(chatId, {
        text: text,
        options: options as KeyboardOption[],
        columns,
        parseMode: "Markdown",
        replyToMessageId: reply_to_message_id,
      });
    }

    // Register callback hook — handles button clicks even after poll timeout.
    // One-shot: acks, shows selection, removes buttons. Event still queues for dequeue.
    // ownerSid tracks the session so teardown can replace the hook with a "Session closed" ack.
    registerCallbackHook(messageId, (evt) => {
      const chosen = options.find((o) => o.value === evt.content.data);
      const chosenLabel = chosen?.label ?? evt.content.data ?? "";
      clearMessageHook(messageId);
      void ackAndEditSelection(chatId, messageId, text, chosenLabel, evt.content.qid, !!audio)
        .catch((e: unknown) => process.stderr.write(`[warn] choose hook failed: ${String(e)}\n`));
    }, _sid);

    // Fires immediately when a voice message is detected (before transcription).
    // This removes the keyboard right away so the user doesn't see a delayed edit.
    let skippedEditDone = false;
    const onVoiceDetected = () => {
      skippedEditDone = true;
      clearCallbackHook(messageId);
      editWithSkipped(chatId, messageId, text, !!audio).catch(() => {/* non-fatal */});
    };

    const match = await pollButtonOrTextOrVoice(
      chatId, messageId, timeout_seconds,
      onVoiceDetected, signal, getCallerSid(),
    );

    if (!match) {
      // Timeout or abort — immediately remove the buttons and show "Timed out".
      // Run in the tool's session context so the session header is consistent.
      void runInSessionContext(_sid, () =>
        editWithTimedOut(chatId, messageId, text, !!audio),
      ).catch(() => {/* non-fatal */});
      // Replace the callback hook with an ack-only version: if a late button
      // press arrives, we still acknowledge it (removes the Telegram spinner)
      // but skip the re-edit since the message was already cleaned up above.
      clearCallbackHook(messageId);
      registerCallbackHook(messageId, (evt) => {
        const qid = evt.content.qid;
        clearMessageHook(messageId);
        if (qid) {
          void getApi().answerCallbackQuery(qid).catch(() => {/* non-fatal */});
        }
      }, _sid);
      // Also register a message hook: if a late click still comes in before
      // the callback hook processes it, the next message will clear up anything
      // that remains (buttons already gone, but hook cleans the callback hook).
      registerMessageHook(messageId, () => {
        clearCallbackHook(messageId);
      });
      return toResult({
        timed_out: true,
        message_id: messageId,
      });
    }

    if (match.kind === "text") {
      clearCallbackHook(messageId);
      if (match.reply_to === messageId) {
        await editWithReplied(chatId, messageId, text, !!audio);
        return toResult({ resolution: "replied", text: match.text, message_id: match.message_id });
      }
      await editWithSkipped(chatId, messageId, text, !!audio);
      return toResult({
        skipped: true,
        text_response: match.text,
        text_message_id: match.message_id,
        message_id: messageId,
      });
    }

    if (match.kind === "voice") {
      clearCallbackHook(messageId);
      if (match.reply_to === messageId) {
        // Override any early "Skipped" edit that onVoiceDetected may have applied
        await editWithReplied(chatId, messageId, text, !!audio);
        return toResult({ resolution: "replied", text: match.text ?? "[no transcription]", message_id: match.message_id });
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- skippedEditDone may be true if onVoiceDetected fired before poll returned
      if (!skippedEditDone) await editWithSkipped(chatId, messageId, text, !!audio);
      return toResult({
        skipped: true,
        text_response: match.text ?? "[no transcription]",
        text_message_id: match.message_id,
        message_id: messageId,
        voice: true,
      });
    }

    if (match.kind === "command") {
      clearCallbackHook(messageId);
      await editWithSkipped(chatId, messageId, text, !!audio);
      return toResult({
        skipped: true,
        command: match.command,
        args: match.args,
        message_id: messageId,
      });
    }

    // Button was pressed — hook already acked + edited.
    const chosen = options.find((o) => o.value === match.data);
    const chosenLabel = chosen?.label ?? match.data;
    const compact = response_format === "compact";

    return toResult({
      ...(compact ? {} : { timed_out: false }),
      label: chosenLabel,
      value: match.data,
      message_id: messageId,
    });
  } catch (err) {
    return toError(err);
  }
}

export function register(server: McpServer) {
  server.registerTool(
    "choose",
    {
      description: DESCRIPTION,
      inputSchema: {
        text: z.string().describe("The message to display above the buttons"),
      options: z
        .array(
          z.object({
            label: z.string().describe(`Button label. Keep under ${LIMITS.BUTTON_DISPLAY_MULTI_COL} chars for 2-col layout, or ${LIMITS.BUTTON_DISPLAY_SINGLE_COL} chars for single-column. API hard limit is ${LIMITS.BUTTON_TEXT} chars but labels over the display limit are cut off on mobile.`),
            value: z.string().describe(`Callback data (max ${LIMITS.CALLBACK_DATA} bytes)`),
            style: z
              .enum(["success", "primary", "danger"])
              .optional()
              .describe("Optional button color: success (green), primary (blue), danger (red). Omit for default app style."),
          })
        )
        .min(2)
        .max(8)
        .describe("2–8 options. Buttons are laid out 2 per row automatically."),
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(86400)
        .optional()
        .describe("Seconds to wait before returning timed_out: true and removing buttons. Omit to use the server maximum (24 h). A text or voice message immediately returns skipped regardless of timeout."),
      columns: z
        .number()
        .int()
        .min(1)
        .max(4)
        .default(2)
        .describe("Buttons per row (default 2)"),
      reply_to: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Reply to this message ID — shows quoted message above the question"),
      ignore_pending: z
        .boolean()
        .optional()
        .describe("Set true to skip the pending-updates check and block immediately"),
      ignore_parity: z
        .boolean()
        .optional()
        .describe("Set true to bypass button label emoji-consistency check"),
      audio: z
        .string()
        .optional()
        .describe("Spoken TTS content — when present, sends the prompt as a voice note with the inline keyboard attached. Uses session/global voice settings. Requires TTS to be configured."),
              token: TOKEN_SCHEMA,
      response_format: z
        .enum(["default", "compact"])
        .optional()
        .describe("Response format. \"compact\" omits inferrable fields to reduce token usage. Compact only suppresses `timed_out: false` on the success (button-press) path; `timed_out: true` and `skipped: true` are always emitted regardless of compact mode. Defaults to \"default\"."),
},
    },
    async (args, { signal }) => handleChoose(args, signal),
  );
}
