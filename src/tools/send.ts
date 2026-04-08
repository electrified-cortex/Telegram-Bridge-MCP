// Never call 'send' from send.ts handler — use telegram.js primitives directly
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, validateText, resolveChat, splitMessage, callApi, sendVoiceDirect } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { applyTopicToText, getTopic } from "../topic-state.js";
import { showTyping, cancelTyping } from "../typing-state.js";
import { isTtsEnabled, stripForTts, synthesizeToOgg } from "../tts.js";
import { getSessionVoice, getSessionSpeed } from "../voice-state.js";
import { getDefaultVoice } from "../config.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const TABLE_WARNING = "Message sent. Note: markdown tables were detected but not formatted — Telegram does not support table rendering.";

const MARKDOWN_TABLE_RE = /^\|.*\|$/;

function containsMarkdownTable(text: string): boolean {
  return text.split("\n").some((line) => MARKDOWN_TABLE_RE.test(line.trim()));
}

const DESCRIPTION =
  "Send a message as text, audio (TTS), or both. " +
  "text only → text message with auto-split and Markdown. " +
  "audio only → TTS voice note (spoken content). " +
  "Both → voice note with text as caption (keep brief — topic context before playback). " +
  "At least one of text or audio is required. " +
  "For structured status, use notify. For file attachments, use send_file. " +
  "For interactive prompts, use ask, choose, or confirm.";

export function register(server: McpServer) {
  server.registerTool(
    "send",
    {
      description: DESCRIPTION,
      inputSchema: {
        text: z
          .string()
          .optional()
          .describe("Text message OR caption when audio is also provided. At least one of text/audio required."),
        audio: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Spoken TTS content. When present, sends a voice note. " +
            "Use voice/speed to override TTS settings. Requires TTS to be configured.",
          ),
        voice: z
          .string()
          .min(1)
          .optional()
          .describe("TTS voice name override. Falls back to session/global default."),
        speed: z
          .number()
          .optional()
          .describe("TTS speed override. Falls back to session/global default."),
        parse_mode: z
          .enum(["Markdown", "HTML", "MarkdownV2"])
          .default("Markdown")
          .describe("For text content only. Default Markdown (auto-converted)."),
        disable_notification: z
          .boolean()
          .optional()
          .describe("Send silently (no sound/notification)"),
        reply_to_message_id: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Reply to this message ID"),
        token: TOKEN_SCHEMA,
      },
    },
    async ({ text, audio, voice, speed, parse_mode, disable_notification, reply_to_message_id, token }) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      // Require at least one of text or voice
      if (!text && !audio) {
        return toError({ code: "MISSING_CONTENT", message: "At least one of 'text' or 'audio' is required." });
      }

      // ── Voice mode ───────────────────────────────────────────────────────
      if (audio) {
        if (!isTtsEnabled()) {
          return toError({
            code: "TTS_NOT_CONFIGURED",
            message: "TTS is not configured. Set TTS_HOST or OPENAI_API_KEY to use voice.",
          } as const);
        }

        // Resolve spoken text and voice params
        const spokenText = audio;

        const spokenErr = validateText(spokenText);
        if (spokenErr) return toError(spokenErr);

        const plainText = stripForTts(spokenText);
        if (!plainText) {
          return toError({ code: "EMPTY_MESSAGE", message: "Voice text is empty after stripping formatting for TTS." } as const);
        }

        // Voice resolution: explicit voice param > session default > config default
        const resolvedVoice = voice ?? getSessionVoice() ?? getDefaultVoice() ?? undefined;
        const resolvedSpeed = speed ?? getSessionSpeed() ?? undefined;

        // Caption resolution (text param becomes caption on voice note)
        let resolvedCaption: string | undefined;
        let captionParseMode: "MarkdownV2" | undefined;
        let captionTruncated = false;
        if (text) {
          // text is the caption — apply topic prefix, convert to MarkdownV2,
          // then clip the final string (post-conversion length is what Telegram counts).
          const MAX_CAPTION = 1024 - 60;
          const converted = markdownToV2(applyTopicToText(text, "Markdown"));
          captionTruncated = converted.length > MAX_CAPTION;
          resolvedCaption = captionTruncated ? converted.slice(0, MAX_CAPTION) : converted;
          captionParseMode = "MarkdownV2";
        } else {
          // Voice-only: still apply topic label as caption if topic is set
          const topic = getTopic();
          if (topic) {
            const topicLabel = `**[${topic}]**`;
            resolvedCaption = markdownToV2(topicLabel);
            captionParseMode = "MarkdownV2";
          }
        }

        const voiceChunks = splitMessage(plainText);
        const typingSeconds = Math.min(120, Math.max(5, Math.ceil(plainText.length / 20)));
        try {
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
            });
            message_ids.push(msg.message_id);
          }
          if (message_ids.length === 1) {
            return toResult({
              message_id: message_ids[0],
              audio: true,
              ...(captionTruncated ? { info: "Caption was truncated to fit Telegram's 1024-character limit." } : {}),
            });
          }
          return toResult({
            message_ids,
            split_count: message_ids.length,
            split: true,
            audio: true,
            ...(captionTruncated ? { info: "Caption was truncated to fit Telegram's 1024-character limit." } : {}),
          });
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

      // ── Text-only mode ───────────────────────────────────────────────────
      // text is guaranteed non-empty here (checked above)
      const textWithTopic = applyTopicToText(text ?? "", parse_mode);
      const finalText = parse_mode === "Markdown" ? markdownToV2(textWithTopic) : textWithTopic;
      const finalMode = parse_mode === "Markdown" ? "MarkdownV2" : parse_mode;

      if (!finalText || finalText.trim().length === 0) {
        return toError({ code: "EMPTY_MESSAGE" as const, message: "Message text must not be empty." });
      }

      const chunks = splitMessage(finalText);

      try {
        const message_ids: number[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const textErr = validateText(chunk);
          if (textErr) return toError(textErr);

          const msg = await callApi(() =>
            getApi().sendMessage(chatId, chunk, {
              parse_mode: finalMode,
              disable_notification,
              reply_parameters:
                i === 0 && reply_to_message_id !== undefined
                  ? { message_id: reply_to_message_id }
                  : undefined,
              _rawText: chunks.length === 1 ? text : undefined,
            } as Record<string, unknown>),
          );
          message_ids.push(msg.message_id);
        }

        const hasTable = containsMarkdownTable(text ?? "");
        if (message_ids.length === 1) {
          return toResult(hasTable
            ? { message_id: message_ids[0], info: TABLE_WARNING }
            : { message_id: message_ids[0] });
        }
        return toResult(hasTable
          ? { message_ids, split_count: message_ids.length, split: true, info: TABLE_WARNING }
          : { message_ids, split_count: message_ids.length, split: true });
      } catch (err) {
        return toError(err);
      }
    },
  );
}
