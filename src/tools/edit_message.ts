import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { InlineKeyboardMarkup } from "grammy/types";
import { z } from "zod";
import {
  getApi, toResult, toError, resolveChat, validateText, validateCallbackData, LIMITS,
} from "../telegram.js";
import { resolveParseMode } from "../markdown.js";
import { recordOutgoingEdit } from "../message-store.js";
import type { ButtonStyle } from "./button-helpers.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Edit an existing message by ID — updates text, inline keyboard, or both. " +
  "Pass text to update message content, keyboard to update or remove buttons, or both together. " +
  "Pass keyboard: null to remove all buttons while leaving text unchanged. " +
  "Omit text to update only the keyboard (uses editMessageReplyMarkup internally). " +
  "Omit keyboard to update only the text (keyboard is preserved). " +
  "Default parse_mode is Markdown (auto-converted).";

const buttonSchema = z.object({
  label: z
    .string()
    .describe(`Button label text (hard limit ${LIMITS.BUTTON_TEXT} chars)`),
  value: z
    .string()
    .describe(`Callback data (max ${LIMITS.CALLBACK_DATA} bytes)`),
  style: z
    .enum(["success", "primary", "danger"])
    .optional()
    .describe("Button background color: success (green), primary (blue), danger (red). Omit for default."),
});

type ButtonInput = z.infer<typeof buttonSchema>;

export async function handleEditMessage({ message_id, text, keyboard, parse_mode, token }: {
  message_id: number;
  text?: string;
  keyboard?: ButtonInput[][] | null;
  parse_mode: "Markdown" | "HTML" | "MarkdownV2";
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);

  if (keyboard != null) {
    for (const row of keyboard) {
      for (const btn of row) {
        const dataErr = validateCallbackData(btn.value);
        if (dataErr) return toError(dataErr);
        if (btn.label.length > LIMITS.BUTTON_TEXT) {
          return toError({
            code: "BUTTON_LABEL_EXCEEDS_LIMIT" as const,
            message: `Button label "${btn.label}" is ${btn.label.length} chars; Telegram hard limit is ${LIMITS.BUTTON_TEXT}.`,
          });
        }
      }
    }
  }

  // Build the reply_markup to pass (if keyboard param was supplied)
  let reply_markup: InlineKeyboardMarkup | undefined;
  if (keyboard !== undefined) {
    reply_markup = {
      inline_keyboard: keyboard === null
        ? []
        : keyboard.map((row) =>
            row.map((btn) => ({
              text: btn.label,
              callback_data: btn.value,
              ...(btn.style ? { style: btn.style as ButtonStyle } : {}),
            })),
          ),
    };
  }

  try {
    if (text !== undefined) {
      // Update text (and optionally keyboard)
      const { text: finalText, parse_mode: finalMode } = resolveParseMode(text, parse_mode);
      const textErr = validateText(finalText);
      if (textErr) return toError(textErr);
      const result = await getApi().editMessageText(chatId, message_id, finalText, {
        parse_mode: finalMode,
        reply_markup,
      });
      const editedId = typeof result === "boolean" ? message_id : result.message_id;
      recordOutgoingEdit(editedId, "text", text);
      return toResult({ message_id: editedId });
    } else if (reply_markup !== undefined) {
      // Keyboard-only update
      const result = await getApi().editMessageReplyMarkup(chatId, message_id, {
        reply_markup,
      });
      const editedId = typeof result === "boolean" ? message_id : result.message_id;
      return toResult({ message_id: editedId });
    } else {
      return toError({
        code: "EMPTY_MESSAGE" as const,
        message: "At least one of text or keyboard must be provided.",
      });
    }
  } catch (err) {
    return toError(err);
  }
}

export function register(server: McpServer) {
  server.registerTool(
    "edit_message",
    {
      description: DESCRIPTION,
      inputSchema: {
        message_id: z.number().int().min(1).describe("ID of the message to edit"),
        text: z
          .string()
          .optional()
          .describe("New text content. Omit to leave text unchanged (keyboard-only update)."),
        keyboard: z
          .array(z.array(buttonSchema))
          .nullable()
          .optional()
          .describe(
            "Inline keyboard update: outer array = rows, inner array = buttons in each row. " +
            "Pass null to remove all buttons. Omit to leave keyboard unchanged.",
          ),
        parse_mode: z
          .enum(["Markdown", "HTML", "MarkdownV2"])
          .default("Markdown")
          .describe("Markdown = auto-converted (default); MarkdownV2 = raw; HTML = HTML tags"),
              token: TOKEN_SCHEMA,
},
    },
    handleEditMessage,
  );
}
