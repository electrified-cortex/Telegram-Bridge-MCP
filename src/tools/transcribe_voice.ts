import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { transcribeWithIndicator } from "../transcribe.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Transcribes a Telegram voice message by its file_id. " +
  "Voice messages returned by dequeue are already pre-transcribed — " +
  "only call this to re-process (e.g. transcription failed previously or " +
  "you want to re-run with updated settings).";

export async function handleTranscribeVoice({ file_id, message_id, token }: {
  file_id: string;
  message_id?: number;
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  try {
    const text = await transcribeWithIndicator(file_id, message_id);
    return toResult({ text });
  } catch (err) {
    return toError(err);
  }
}

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
              token: TOKEN_SCHEMA,
},
    },
    handleTranscribeVoice,
  );
}
