import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, validateText, validateCallbackData, sendVoiceDirect } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { applyTopicToText } from "../topic-state.js";
import { registerCallbackHook, clearCallbackHook, registerMessageHook, clearMessageHook, pendingCount } from "../message-store.js";
import { getSessionQueue, peekSessionCategories } from "../session-queue.js";
import { requireAuth } from "../session-gate.js";
import {
  pollButtonOrTextOrVoice, ackAndEditSelection, editWithSkipped,
  type ButtonStyle,
} from "./button-helpers.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { validateButtonSymbolParity } from "../button-validation.js";
import { runInSessionContext } from "../session-context.js";
import { isTtsEnabled, stripForTts, synthesizeToOgg } from "../tts.js";
import { getSessionVoice, getSessionSpeed } from "../voice-state.js";
import { getDefaultVoice } from "../config.js";
import { showTyping, typingGeneration, cancelTypingIfSameGeneration } from "../typing-state.js";

const DESCRIPTION_CONFIRM =
  "Sends an OK/Cancel confirmation message and waits until the user presses a " +
  "button. Defaults to OK (primary/blue) and Cancel (unstyled/gray). " +
  "Automatically removes buttons and updates the message to show the " +
  "chosen option. Returns { confirmed: true|false }, or { timed_out: true } " +
  "if the timeout expires without input. " +
  "Fails if there are unread pending updates (unless replying to a specific message) — drain them with " +
  "dequeue(timeout:0) first, or pass ignore_pending: true to proceed anyway. Requires an active session token.";

const DESCRIPTION_CONFIRM_YN =
  "Yes/No confirmation variant. Same as confirm but defaults to 🟢 Yes / 🔴 No buttons with no color styling.";

const YES_TEXT_DESC = "Label for the affirmative button. When using yes_style, prefer plain text — the button color is the visual signal.";
const NO_TEXT_DESC = "Label for the negative button. Set to empty string to show only the primary/yes button (single-button CTA mode). When using no_style, prefer plain text — the button color is the visual signal.";
const YES_STYLE_DESC = "Optional color for the Yes button: success (green), primary (blue), danger (red). Omit for app-default style.";
const NO_STYLE_DESC = "Optional color for the No button: success (green), primary (blue), danger (red). Omit for app-default (gray/neutral).";

export interface ConfirmArgs {
  text: string;
  yes_text: string;
  no_text: string;
  yes_data: string;
  no_data: string;
  yes_style?: ButtonStyle;
  no_style?: ButtonStyle;
  timeout_seconds: number;
  reply_to?: number;
  ignore_pending?: boolean;
  ignore_parity?: boolean;
  audio?: string;
  token?: number;
}

export async function confirmHandler(
  { text, yes_text, no_text, yes_data, no_data, yes_style, no_style, timeout_seconds, reply_to, ignore_pending, ignore_parity, audio, token }: ConfirmArgs,
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
    const sid = _sid;
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
          `calling confirm, or pass ignore_pending: true to proceed anyway.`,
        pending,
        ...(breakdown ? { breakdown } : {}),
      });
    }
  }

  // Validate button symbol parity (only when both buttons are shown)
  if (!ignore_parity && no_text) {
    const parity = validateButtonSymbolParity([yes_text, no_text]);
    if (!parity.ok) {
      return toError({
        code: "BUTTON_SYMBOL_PARITY" as const,
        message: `Button labels are inconsistent: ${parity.withEmoji.length} of 2 have emoji. Either add emoji to all labels or remove them. Pass ignore_parity: true to send anyway.`,
        labels_with_emoji: parity.withEmoji,
        labels_without_emoji: parity.withoutEmoji,
      });
    }
  }

  const yesDataErr = validateCallbackData(yes_data);
  if (yesDataErr) return toError(yesDataErr);
  if (no_text) {
    const noDataErr = validateCallbackData(no_data);
    if (noDataErr) return toError(noDataErr);
  }

  try {
    const replyMarkup = {
      inline_keyboard: [[
        { text: yes_text, callback_data: yes_data, ...(yes_style ? { style: yes_style } : {}) },
        ...(no_text ? [{ text: no_text, callback_data: no_data, ...(no_style ? { style: no_style } : {}) }] : []),
      ]],
    };

    let sentMessageId: number;

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
        const msg = await sendVoiceDirect(chatId, ogg, {
          caption,
          parse_mode: "MarkdownV2",
          reply_to_message_id,
          reply_markup: replyMarkup,
        });
        sentMessageId = msg.message_id;
        voiceSent = true;
      } finally {
        if (voiceSent) {
          // Voice messages take 2-5s to render after API confirmation; keep indicator alive.
          await new Promise<void>(resolve => setTimeout(resolve, 3000));
        }
        cancelTypingIfSameGeneration(gen);
      }
    } else {
      const sent = await getApi().sendMessage(chatId, markdownToV2(applyTopicToText(text, "Markdown")), {
        parse_mode: "MarkdownV2",
        reply_parameters: reply_to_message_id ? { message_id: reply_to_message_id } : undefined,
        reply_markup: replyMarkup,
        _rawText: text,
      } as Record<string, unknown>);
      sentMessageId = sent.message_id;
    }

    // Create a proxy so the rest of the function can reference sent.message_id uniformly
    const sent = { message_id: sentMessageId };

    // Register callback hook — handles button clicks even after poll timeout.
    // One-shot: acks, shows selection, removes buttons. Event still queues for dequeue.
    // ownerSid tracks the session so teardown can replace the hook with a "Session closed" ack.
    registerCallbackHook(sent.message_id, (evt) => {
      const confirmed = evt.content.data === yes_data;
      // In single-button CTA mode (no_text is ""), ignore anything that isn't yes_data.
      if (!confirmed && !no_text) return;
      clearMessageHook(sent.message_id);
      const chosenLabel = confirmed ? yes_text : no_text;
        void ackAndEditSelection(chatId, sent.message_id, text, chosenLabel, evt.content.qid, !!audio)
        .catch((e: unknown) => process.stderr.write(`[warn] confirm hook failed: ${String(e)}\n`));
    }, _sid);

    // Fires immediately when a voice message is detected (before transcription).
    // This removes the keyboard right away so the user doesn't see a delayed edit.
    const editState = { done: false };
    const onVoiceDetected = () => {
      editState.done = true;
      clearCallbackHook(sent.message_id);
      editWithSkipped(chatId, sent.message_id, text, !!audio).catch(() => {/* non-fatal */});
    };

    const result = await pollButtonOrTextOrVoice(
      chatId, sent.message_id, timeout_seconds,
      onVoiceDetected, signal, _sid,
    );

    if (!result) {
      // Timeout — register a message hook so the next user message
      // cleans up the stale buttons (callback hook handles late clicks).
      // Run editWithSkipped in the tool's session context so the session
      // header remains consistent with the original message.
      registerMessageHook(sent.message_id, () => {
        clearCallbackHook(sent.message_id);
        void runInSessionContext(_sid, () =>
          editWithSkipped(chatId, sent.message_id, text, !!audio),
        ).catch(() => {/* non-fatal */});
      });
      return toResult({ timed_out: true, message_id: sent.message_id });
    }

    // User typed or spoke instead of pressing a button — mark as skipped
    if (result.kind === "text" || result.kind === "voice") {
      clearCallbackHook(sent.message_id);
      if (!editState.done) await editWithSkipped(chatId, sent.message_id, text, !!audio);
      return toResult({
        skipped: true,
        text_response: result.text,
        text_message_id: result.message_id,
        message_id: sent.message_id,
      });
    }

    // Slash command interrupted the confirmation — mark as skipped
    if (result.kind === "command") {
      clearCallbackHook(sent.message_id);
      await editWithSkipped(chatId, sent.message_id, text, !!audio);
      return toResult({
        skipped: true,
        command: result.command,
        args: result.args,
        message_id: sent.message_id,
      });
    }

    // Button was pressed — hook already acked + edited.
    const confirmed = result.data === yes_data;

    return toResult({
      timed_out: false,
      confirmed,
      value: result.data,
      message_id: sent.message_id,
    });
  } catch (err) {
    return toError(err);
  }
}

function makeInputSchema(defaults: { yes_text: string; no_text: string; yes_style_default?: "success" | "primary" | "danger" }) {
  return {
    text: z
      .string()
      .describe("The question or request requiring confirmation"),
    yes_text: z
      .string()
      .default(defaults.yes_text)
      .describe(YES_TEXT_DESC),
    no_text: z
      .string()
      .default(defaults.no_text)
      .describe(NO_TEXT_DESC),
    yes_data: z
      .string()
      .default("confirm_yes")
      .describe("Callback data sent when Yes is pressed"),
    no_data: z
      .string()
      .default("confirm_no")
      .describe("Callback data sent when No is pressed"),
    yes_style: defaults.yes_style_default
      ? z.enum(["success", "primary", "danger"]).default(defaults.yes_style_default).describe(YES_STYLE_DESC)
      : z.enum(["success", "primary", "danger"]).optional().describe(YES_STYLE_DESC),
    no_style: z
      .enum(["success", "primary", "danger"])
      .optional()
      .describe(NO_STYLE_DESC),
    timeout_seconds: z
      .number()
      .int()
      .min(1)
      .max(300)
      .default(60)
      .describe("Seconds to wait for a button press before returning timed_out: true"),
    reply_to: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Reply to this message ID — shows quoted message above the confirmation"),
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
      .describe("Spoken audio content for TTS — when present, sends the question as a voice note with the inline keyboard attached. Uses session/global voice settings. Requires TTS to be configured."),
    token: TOKEN_SCHEMA,
  };
}

export { confirmHandler as handleConfirm };

export function register(server: McpServer) {
  server.registerTool(
    "confirm",
    {
      description: DESCRIPTION_CONFIRM,
      inputSchema: makeInputSchema({ yes_text: "OK", no_text: "Cancel", yes_style_default: "primary" }),
    },
    async (params, { signal }) => confirmHandler(params, signal),
  );

  server.registerTool(
    "confirmYN",
    {
      description: DESCRIPTION_CONFIRM_YN,
      inputSchema: makeInputSchema({ yes_text: "🟢 Yes", no_text: "🔴 No" }),
    },
    async (params, { signal }) => confirmHandler(params, signal),
  );
}
