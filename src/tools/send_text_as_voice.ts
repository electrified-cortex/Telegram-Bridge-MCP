import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, validateText, resolveChat, splitMessage, sendVoiceDirect } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { showTyping, cancelTyping } from "../typing-state.js";
import { isTtsEnabled, stripForTts, synthesizeToOgg } from "../tts.js";
import { getTopic } from "../topic-state.js";
import { getSessionVoice, getSessionSpeed } from "../voice-state.js";
import { getDefaultVoice } from "../config.js";
import { requireAuth } from "../session-gate.js";
import { IDENTITY_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Synthesizes plain text to speech and sends it as a Telegram voice note. " +
  "Requires TTS_HOST or OPENAI_API_KEY to be configured. " +
  "IMPORTANT: All Markdown formatting and special symbols are stripped before " +
  "synthesis — asterisks, underscores, backticks, brackets, and similar " +
  "characters become noise in audio. Write the text as natural spoken language: " +
  "no bullet points, no headers, no code blocks, no URLs. Punctuation like " +
  "periods and commas helps pacing; everything else should be plain prose. " +
  "Ensure session_start has been called.";

export function register(server: McpServer) {
  server.registerTool(
    "send_text_as_voice",
    {
      description: DESCRIPTION,
      inputSchema: {
        text: z.string().describe("Text to synthesize and send as a voice note."),
        voice: z.string().min(1).optional().describe(
          "Voice name for this call only. Overrides the session default and global default for this message. " +
          "To change your voice persistently across all calls, use `set_voice` instead — " +
          "that sets a session-scoped default so you don't need to repeat it on every call."
        ),
        caption: z.string().optional().describe(
          "Optional caption text shown below the voice note. " +
          "If a topic is set, it is automatically prepended."
        ),
        disable_notification: z.boolean().optional().describe("Send silently"),
        reply_to_message_id: z.number().int().min(1).optional().describe("Reply to this message ID"),
        reply_markup: z
          .object({
            inline_keyboard: z
              .array(
                z.array(
                  z.object({
                    text: z.string(),
                    callback_data: z.string().optional(),
                    url: z.string().optional(),
                  })
                )
              )
              .describe("Array of button rows"),
          })
          .optional()
          .describe(
            "Inline keyboard attached to the voice message. " +
            "Only applied to the first chunk if the message is split."
          ),
              identity: IDENTITY_SCHEMA,
},
    },
    async ({ text, voice, caption, disable_notification, reply_to_message_id, reply_markup, identity}) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      if (!isTtsEnabled()) {
        return toError({
          code: "TTS_NOT_CONFIGURED",
          message: "TTS is not configured. Set TTS_HOST or OPENAI_API_KEY to use send_text_as_voice.",
        } as const);
      }

      const textErr = validateText(text);
      if (textErr) return toError(textErr);

      const plainText = stripForTts(text);
      if (!plainText)
        return toError({ code: "EMPTY_MESSAGE", message: "Message text is empty after stripping formatting for TTS." } as const);

      const voiceChunks = splitMessage(plainText);
      try {
        const topic = getTopic();
        let resolvedCaption: string | undefined;
        let captionParseMode: "MarkdownV2" | undefined;
        if (topic) {
          const topicLabel = `**[${topic}]**`;
          const mdCaption = caption ? `${topicLabel}\n${caption}` : topicLabel;
          resolvedCaption = markdownToV2(mdCaption);
          captionParseMode = "MarkdownV2";
        } else if (caption) {
          resolvedCaption = caption;
        }
        // Voice resolution: explicit param > session override > config default > env/provider
        const resolvedVoice =
          voice ?? getSessionVoice() ?? getDefaultVoice() ?? undefined;
        const resolvedSpeed = getSessionSpeed() ?? undefined;
        const typingSeconds = Math.min(120, Math.max(5, Math.ceil(plainText.length / 20)));
        await showTyping(typingSeconds, "record_voice");
        const message_ids: number[] = [];
        for (let i = 0; i < voiceChunks.length; i++) {
          const ogg = await synthesizeToOgg(voiceChunks[i], resolvedVoice, resolvedSpeed);
          const isFirst = i === 0;
          const msg = await sendVoiceDirect(chatId, ogg, {
            caption: isFirst ? resolvedCaption : undefined,
            ...(captionParseMode ? { parse_mode: captionParseMode } : {}),
            disable_notification,
            reply_to_message_id: isFirst ? reply_to_message_id : undefined,
            reply_markup: isFirst ? reply_markup : undefined,
          });
          message_ids.push(msg.message_id);
        }
        if (message_ids.length === 1) {
          return toResult({ message_id: message_ids[0], voice: true });
        }
        return toResult({ message_ids, split_count: message_ids.length, split: true, voice: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("user restricted receiving of voice note messages")) {
          return toError({
            code: "VOICE_RESTRICTED",
            message:
              "Telegram blocked voice delivery — the user's privacy settings restrict voice notes from bots. " +
              "To fix: Telegram → Settings → Privacy and Security → Voice Messages → " +
              "Add Exceptions → Always Allow → add this bot.",
          } as const);
        }
        return toError(err);
      } finally {
        cancelTyping();
      }
    }
  );
}
