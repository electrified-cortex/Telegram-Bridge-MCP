import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, validateText } from "../telegram.js";
import { resolveParseMode } from "../markdown.js";
import { getMessage, recordOutgoingEdit, CURRENT } from "../message-store.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Delta-append text to an existing message. The server reads the current text " +
  "from the store, concatenates the new chunk after a separator, and edits the " +
  "message in-place. Agent sends only the new chunk — O(1) token cost per call. " +
  "Each append creates an edit event in the timeline with the full accumulated text.";

export async function handleAppendText({
  message_id, text, separator = "\n", parse_mode = "Markdown", token,
}: {
  message_id: number;
  text: string;
  separator?: string;
  parse_mode?: "Markdown" | "HTML" | "MarkdownV2";
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);

  // Read current text from the store
  const current = getMessage(message_id, CURRENT);
  if (!current) {
    return toError({ code: "MESSAGE_NOT_FOUND" as const, message: `No stored message found for ID ${message_id}.` });
  }
  if (current.content.type !== "text") {
    return toError({ code: "MESSAGE_NOT_TEXT" as const, message: "append_text only supports text messages." });
  }
  const currentText = current.content.text ?? "";

  // Concatenate
  const accumulated = currentText
    ? `${currentText}${separator}${text}`
    : text;

  const resolved = resolveParseMode(accumulated, parse_mode);
  const textErr = validateText(resolved.text);
  if (textErr) return toError(textErr);

  try {
    const result = await getApi().editMessageText(
      chatId,
      message_id,
      resolved.text,
      { parse_mode: resolved.parse_mode },
    );
    const editedId = typeof result === "boolean" ? message_id : result.message_id;
    recordOutgoingEdit(editedId, "text", accumulated);
    return toResult({ message_id: editedId, length: accumulated.length });
  } catch (err) {
    return toError(err);
  }
}

export function register(server: McpServer) {
  server.registerTool(
    "append_text",
    {
      description: DESCRIPTION,
      inputSchema: {
        message_id: z.number().int().min(1).describe("Message ID to append to"),
        text: z.string().describe("New chunk to append"),
        separator: z
          .string()
          .default("\n")
          .describe("Join character between existing text and new chunk (default: newline)"),
        parse_mode: z
          .enum(["Markdown", "HTML", "MarkdownV2"])
          .default("Markdown")
          .describe("Re-render the accumulated text with this parse mode"),
              token: TOKEN_SCHEMA,
},
    },
    handleAppendText,
  );
}
