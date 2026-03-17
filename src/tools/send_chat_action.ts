import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { requireAuth } from "../session-gate.js";

const DESCRIPTION =
  'Sends a one-shot chat action indicator (e.g. "typing\u2026") that lasts ~5 s. ' +
  'For sustained typing, use show_typing instead.';

export function register(server: McpServer) {
  server.registerTool(
    "send_chat_action",
    {
      description: DESCRIPTION,
      inputSchema: {
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
              identity: z
          .tuple([z.number().int(), z.number().int()])
          .optional()
          .describe(
            "Identity tuple [sid, pin] from session_start. " +
            "Required when multiple sessions share the same server process.",
          ),
},
    },
    async ({ action, identity}) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      try {
        await getApi().sendChatAction(chatId, action);
        return toResult({ ok: true });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
