import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InputFile } from "grammy";
import { z } from "zod";
import { getApi, toResult, toError, validateText, resolveChat, splitMessage, callApi } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { cancelTyping } from "../typing-state.js";
import { applyTopicToText } from "../topic-state.js";
import { isTtsEnabled, stripForTts, synthesizeToOgg } from "../tts.js";

export function register(server: McpServer) {
  server.tool(
    "send_message",
    "Sends a text message to a Telegram chat. Default parse_mode is Markdown — write standard Markdown (*bold*, _italic_, `code`, **bold**, [links](url)) and it is auto-converted so no manual escaping is needed. Use MarkdownV2 for full control, or HTML for punctuation-heavy content. Messages longer than 4096 characters are automatically split and sent as sequential parts. When TTS is configured (TTS_PROVIDER env var), setting voice:true sends the message as a spoken voice note instead; formatting is stripped to plain text before synthesis.",
    {
      text: z.string().describe("Message text. Automatically split into multiple messages if longer than 4096 characters."),
      parse_mode: z
        .enum(["Markdown", "HTML", "MarkdownV2"])
        .default("Markdown")
        .describe("Markdown = standard Markdown auto-converted (default); MarkdownV2 = raw Telegram V2 (manual escaping required); HTML = HTML tags"),
      disable_notification: z
        .boolean()
        .optional()
        .describe("Send message silently"),
      reply_to_message_id: z
        .number()
        .int()
        .optional()
        .describe("Reply to this message ID"),
      voice: z
        .boolean()
        .optional()
        .describe(
          "Send as a spoken voice note via TTS instead of text. " +
          "Defaults to true when TTS_PROVIDER is globally configured; " +
          "pass false to force plain text even when TTS is active. " +
          "Formatting is stripped to plain text before synthesis — no markdown in audio."
        ),
    },
    async ({ text, parse_mode, disable_notification, reply_to_message_id, voice }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);

      // ── Voice (TTS) mode ────────────────────────────────────────────────
      const useVoice = voice ?? isTtsEnabled();
      if (useVoice) {
        const textErr = validateText(text);
        if (textErr) return toError(textErr);

        const plainText = stripForTts(text);
        if (!plainText) return toError({ code: "EMPTY_MESSAGE", message: "Message text is empty after stripping formatting for TTS." } as const);

        const voiceChunks = splitMessage(plainText);
        try {
          cancelTyping();
          const message_ids: number[] = [];
          for (let i = 0; i < voiceChunks.length; i++) {
            const ogg = await synthesizeToOgg(voiceChunks[i]);
            const inputFile = new InputFile(ogg, "voice.ogg");
            const msg = await callApi(() =>
              getApi().sendVoice(chatId, inputFile, {
                disable_notification,
                reply_parameters: i === 0 && reply_to_message_id
                  ? { message_id: reply_to_message_id }
                  : undefined,
              })
            );
            message_ids.push(msg.message_id);
          }
          if (message_ids.length === 1) {
            return toResult({ message_id: message_ids[0], voice: true });
          }
          return toResult({ message_ids, chunks: message_ids.length, split: true, voice: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("user restricted receiving of voice note messages")) {
            return toError({
              code: "VOICE_RESTRICTED",
              message:
                "Telegram blocked voice delivery — the user's privacy settings restrict voice notes from bots. " +
                "To fix: Telegram → Settings → Privacy and Security → Voice Messages → " +
                "Add Exceptions → Always Allow → add this bot. " +
                "The base setting can remain as-is; the 'Always Allow' exception is sufficient.",
            } as const);
          }
          return toError(err);
        }
      }

      // ── Text mode ───────────────────────────────────────────────────────
      const textWithTopic = applyTopicToText(text, parse_mode);
      const finalText = parse_mode === "Markdown" ? markdownToV2(textWithTopic) : textWithTopic;
      const finalMode = parse_mode === "Markdown" ? "MarkdownV2" : parse_mode;

      // Empty check only — length is handled by auto-splitting
      if (!finalText || finalText.trim().length === 0) return toError({ code: "EMPTY_MESSAGE", message: "Message text must not be empty." } as const);

      const chunks = splitMessage(finalText);

      try {
        cancelTyping();
        const message_ids: number[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const textErr = validateText(chunk);
          if (textErr) return toError(textErr);
          const msg = await callApi(() =>
            getApi().sendMessage(chatId, chunk, {
              parse_mode: finalMode,
              disable_notification,
              // Only attach reply to the first chunk
              reply_parameters: i === 0 && reply_to_message_id
                ? { message_id: reply_to_message_id }
                : undefined,
            })
          );
          message_ids.push(msg.message_id);
        }

        if (message_ids.length === 1) {
          return toResult({ message_id: message_ids[0] });
        }
        return toResult({ message_ids, chunks: message_ids.length, split: true });
      } catch (err) {
        return toError(err);
      }
    }
  );
}

