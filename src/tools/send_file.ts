import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getApi, toResult, toError, validateCaption, resolveChat,
  callApi, resolveMediaSource, sendVoiceDirect,
} from "../telegram.js";
import { resolveParseMode } from "../markdown.js";
import { showTyping, typingGeneration, cancelTypingIfSameGeneration } from "../typing-state.js";
import { extname } from "path";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

// ---------------------------------------------------------------------------
// Auto-detection
// ---------------------------------------------------------------------------

const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv"]);
const AUDIO_EXTS = new Set([".mp3", ".m4a", ".flac", ".wav"]);
const VOICE_EXTS = new Set([".ogg", ".oga"]);

type FileType = "photo" | "document" | "video" | "audio" | "voice";

function detectType(file: string): FileType {
  // Extract extension from path or URL (strip query params)
  const clean = file.split("?")[0];
  const ext = extname(clean).toLowerCase();
  if (PHOTO_EXTS.has(ext)) return "photo";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VOICE_EXTS.has(ext)) return "voice";
  return "document";
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

const CDN_WARNING =
  "File persists on Telegram CDN indefinitely. Deleting the message does NOT delete the file. " +
  "Do not send Tier 2/3 content via send_file.";

const DESCRIPTION =
  "Sends a file (photo, document, video, audio, or voice note) to the chat. " +
  "Accepts a local file path, public HTTPS URL, or Telegram file_id. " +
  "Auto-detects the file type by extension when type=\"auto\" (default). " +
  "For file_id inputs, specify type explicitly since there's no extension to detect. " +
  "Requires an active session token. " +
  "WARNING: " + CDN_WARNING;

export async function handleSendFile({
  file, type = "auto", caption, parse_mode = "Markdown", duration, performer, title,
  width, height, disable_notification, reply_to, token,
}: {
  file: string;
  type?: "auto" | "photo" | "document" | "video" | "audio" | "voice";
  caption?: string;
  parse_mode?: "Markdown" | "HTML" | "MarkdownV2";
  duration?: number;
  performer?: string;
  title?: string;
  width?: number;
  height?: number;
  disable_notification?: boolean;
  reply_to?: number;
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);

  if (caption) {
    const capErr = validateCaption(caption);
    if (capErr) return toError(capErr);
  }

  const resolvedCaption = caption
    ? resolveParseMode(caption, parse_mode)
    : { text: undefined, parse_mode: undefined };

  const fileType: FileType = type === "auto" ? detectType(file) : type;

  // Validate media source for all types (rejects http://, path traversal)
  if (fileType !== "voice") {
    const mediaResult = resolveMediaSource(file);
    if ("code" in mediaResult) return toError(mediaResult);
  } else if (typeof file === "string" && file.startsWith("http://")) {
    // Voice bypasses resolveMediaSource for Buffer/file_id paths,
    // but http:// must still be rejected for consistency.
    const voiceResult = resolveMediaSource(file);
    if ("code" in voiceResult) return toError(voiceResult);
  }

  const replyTo = reply_to;
  const replyParams = replyTo
    ? { message_id: replyTo }
    : undefined;

  try {
    switch (fileType) {
      case "photo": {
        const mediaResult = resolveMediaSource(file);
        if ("code" in mediaResult) return toError(mediaResult);
        await showTyping(30, "upload_photo");
        const msg = await callApi(() =>
          getApi().sendPhoto(chatId, mediaResult.source, {
            caption: resolvedCaption.text,
            parse_mode: resolvedCaption.parse_mode,
            disable_notification,
            reply_parameters: replyParams,
          }),
        );
        return toResult({
          message_id: msg.message_id,
          type: "photo",
          caption: msg.caption,
          warning: CDN_WARNING,
        });
      }

      case "video": {
        await showTyping(120, "upload_video");
        const mediaResult = resolveMediaSource(file);
        if ("code" in mediaResult) return toError(mediaResult);
        const msg = await callApi(() =>
          getApi().sendVideo(chatId, mediaResult.source, {
            caption: resolvedCaption.text,
            parse_mode: resolvedCaption.parse_mode,
            duration, width, height,
            disable_notification,
            reply_parameters: replyParams,
          }),
        );
        return toResult({
          message_id: msg.message_id,
          type: "video",
          file_id: msg.video.file_id,
          duration: msg.video.duration,
          warning: CDN_WARNING,
        });
      }

      case "audio": {
        await showTyping(60, "upload_document");
        const mediaResult = resolveMediaSource(file);
        if ("code" in mediaResult) return toError(mediaResult);
        const msg = await callApi(() =>
          getApi().sendAudio(chatId, mediaResult.source, {
            caption: resolvedCaption.text,
            parse_mode: resolvedCaption.parse_mode,
            duration, performer, title,
            disable_notification,
            reply_parameters: replyParams,
          }),
        );
        return toResult({
          message_id: msg.message_id,
          type: "audio",
          file_id: msg.audio.file_id,
          title: msg.audio.title,
          warning: CDN_WARNING,
        });
      }

      case "voice": {
        await showTyping(30, "upload_voice");
        const gen = typingGeneration();
        try {
          const msg = await sendVoiceDirect(chatId, file, {
            caption: resolvedCaption.text,
            parse_mode: resolvedCaption.parse_mode,
            duration,
            disable_notification,
            reply_to_message_id: replyTo,
          });
          // Voice messages take 2-5s to render after API confirmation; keep
          // the upload indicator alive until the message appears in chat.
          await new Promise<void>(resolve => setTimeout(resolve, 3000));
          return toResult({
            message_id: msg.message_id,
            type: "voice",
            file_id: msg.voice?.file_id,
            warning: CDN_WARNING,
          });
        } finally {
          cancelTypingIfSameGeneration(gen);
        }
      }

      case "document":
      default: {
        await showTyping(60, "upload_document");
        const mediaResult = resolveMediaSource(file);
        if ("code" in mediaResult) return toError(mediaResult);
        const msg = await callApi(() =>
          getApi().sendDocument(chatId, mediaResult.source, {
            caption: resolvedCaption.text,
            parse_mode: resolvedCaption.parse_mode,
            disable_notification,
            reply_parameters: replyParams,
          }),
        );
        return toResult({
          message_id: msg.message_id,
          type: "document",
          file_id: msg.document.file_id,
          file_name: msg.document.file_name,
          warning: CDN_WARNING,
        });
      }
    }
  } catch (err) {
    return toError(err);
  }
}

export function register(server: McpServer) {
  server.registerTool(
    "send_file",
    {
      description: DESCRIPTION,
      inputSchema: {
        file: z
          .string()
          .describe("Local path, HTTPS URL, or Telegram file_id"),
        type: z
          .enum(["auto", "photo", "document", "video", "audio", "voice"])
          .default("auto")
          .describe("File type. auto = detect by extension (default)"),
        caption: z
          .string()
          .optional()
          .describe("Optional caption (up to 1024 chars)"),
        parse_mode: z
          .enum(["Markdown", "HTML", "MarkdownV2"])
          .default("Markdown")
          .describe("Caption parse mode"),
        duration: z
          .number()
          .int()
          .optional()
          .describe("Duration in seconds (audio, video, voice)"),
        performer: z
          .string()
          .optional()
          .describe("Performer name (audio only)"),
        title: z
          .string()
          .optional()
          .describe("Track title (audio only)"),
        width: z
          .number()
          .int()
          .optional()
          .describe("Width in pixels (video only)"),
        height: z
          .number()
          .int()
          .optional()
          .describe("Height in pixels (video only)"),
        disable_notification: z
          .boolean()
          .optional()
          .describe("Send silently"),
        reply_to: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Reply to this message ID"),
        token: TOKEN_SCHEMA,
      },
    },
    handleSendFile,
  );
}
