import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "send_chat_action",
    'Sends a one-shot chat action indicator (e.g. "typing…") that lasts ~5 s. For sustained typing, use show_typing instead.',
    {
      action: z
        .enum([
          "typing",
          "upload_photo",
          "record_video",
          "upload_video",
          "record_voice",
          "upload_voice",
          "upload_document",
          "find_location",
          "record_video_note",
          "upload_video_note",
          "choose_sticker",
        ])
        .default("typing")
        .describe('Action to broadcast. Defaults to "typing".'),
    },
    async ({ action }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      try {
        await getApi().sendChatAction(chatId, action);
        return toResult({ ok: true });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
