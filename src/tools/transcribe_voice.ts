import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { transcribeWithIndicator } from "../transcribe.js";
import { requireAuth } from "../session-gate.js";

const DESCRIPTION =
  "Transcribes a Telegram voice message by its file_id. " +
  "Voice messages returned by dequeue_update are already pre-transcribed — " +
  "only call this to re-process (e.g. transcription failed previously or " +
  "you want to re-run with updated settings).";

export function register(server: McpServer) {
  server.registerTool(
    "transcribe_voice",
    {
      description: DESCRIPTION,
      inputSchema: {
        file_id: z
        .string()
        .describe("The Telegram file_id of the voice message to transcribe"),
      message_id: z
        .number()
        .int()
        .optional()
        .describe("Optional message_id — if provided, adds a ✍ / 🫡 reaction to indicate transcription progress"),
              identity: z
          .tuple([z.number().int(), z.number().int()])
          .optional()
          .describe(
            "Identity tuple [sid, pin] from session_start. " +
            "Required when multiple sessions share the same server process.",
          ),
},
    },
    async ({ file_id, message_id, identity}) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);
      try {
        const text = await transcribeWithIndicator(file_id, message_id);
        return toResult({ text });
      } catch (err) {
        return toError(err);
      }
    },
  );
}
