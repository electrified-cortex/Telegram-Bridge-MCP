import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, validateText, resolveChat, splitMessage, sendVoiceDirect } from "../telegram.js";
import { showTyping, cancelTyping } from "../typing-state.js";
import { isTtsEnabled, stripForTts, synthesizeToOgg } from "../tts.js";
import { getTopic } from "../topic-state.js";
import { getDefaultVoice } from "../config.js";

const DESCRIPTION =
  "Synthesizes plain text to speech and sends it as a Telegram voice note. " +
  "Requires TTS_HOST or OPENAI_API_KEY to be configured. " +
  "IMPORTANT: All Markdown formatting and special symbols are stripped before " +
  "synthesis — asterisks, underscores, backticks, brackets, and similar " +
  "characters become noise in audio. Write the text as natural spoken language: " +
  "no bullet points, no headers, no code blocks, no URLs. Punctuation like " +
  "periods and commas helps pacing; everything else should be plain prose.";

export function register(server: McpServer) {
  server.registerTool(
    "send_text_as_voice",
    {
      description: DESCRIPTION,
      inputSchema: {
        text: z.string().describe("Text to synthesize and send as a voice note."),
        voice: z.string().optional().describe(
          "Voice name to use for synthesis. Overrides the default voice. " +
          "Available voices depend on the TTS provider."
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
      },
    },
    async ({ text, voice, caption, disable_notification, reply_to_message_id, reply_markup }) => {
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
        const resolvedCaption = topic
          ? caption ? `[${topic}] ${caption}` : `[${topic}]`
          : caption ?? undefined;
        // Voice resolution: explicit param > config default > env/provider
        const resolvedVoice =
          voice ?? getDefaultVoice() ?? undefined;
        const typingSeconds = Math.min(120, Math.max(5, Math.ceil(plainText.length / 20)));
        await showTyping(typingSeconds, "record_voice");
        const message_ids: number[] = [];
        for (let i = 0; i < voiceChunks.length; i++) {
          const ogg = await synthesizeToOgg(voiceChunks[i], resolvedVoice);
          const isFirst = i === 0;
          const msg = await sendVoiceDirect(chatId, ogg, {
            caption: isFirst ? resolvedCaption : undefined,
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
