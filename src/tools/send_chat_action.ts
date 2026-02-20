import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, validateTargetChat } from "../telegram.js";

export function register(server: McpServer) {
  server.tool(
    "send_chat_action",
    'Sends a chat action indicator to the user (e.g. "typing…"). The indicator displays for ~5 s. Call once when you start processing a message to signal you are working.',
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
      const authErr = validateTargetChat(chatId);
      if (authErr) return toError(authErr);
      try {
        await getApi().sendChatAction(chatId, action);
        return toResult({ ok: true });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
