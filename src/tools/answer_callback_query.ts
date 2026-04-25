import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Acknowledges a callback query from an inline button press. " +
  "Only needed when handling button presses manually — " +
  "choose, confirm, and send_choice auto-ack button presses automatically. " +
  "For non-blocking keyboards, use send_choice. " +
  "Must be called within 30 s of receiving the update. " +
  "Optionally shows a toast or alert to the user. " +
  "Pass remove_keyboard: true with message_id to also clear the inline keyboard " +
  "in one call (combines answerCallbackQuery + editMessageReplyMarkup). " +
  "message_id is required when remove_keyboard is true.";

function formatUnknownError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}

export async function handleAnswerCallbackQuery({ callback_query_id, text, show_alert, url, cache_time, remove_keyboard, message_id, token }: {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
  url?: string;
  cache_time?: number;
  remove_keyboard?: boolean;
  message_id?: number;
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  if (remove_keyboard && !message_id) {
    return toError({
      code: "MISSING_MESSAGE_ID",
      message: "message_id is required when remove_keyboard is true.",
    });
  }

  try {
    await getApi().answerCallbackQuery(callback_query_id, {
      text,
      show_alert,
      url,
      cache_time,
    });

    if (remove_keyboard && message_id) {
      const chatId = resolveChat();
      if (typeof chatId === "number") {
        try {
          await getApi().editMessageReplyMarkup(chatId, message_id, {
            reply_markup: { inline_keyboard: [] },
          });
        } catch (e) {
          process.stderr.write(`[warn] remove_keyboard failed: ${formatUnknownError(e)}\n`);
        }
      } else {
        process.stderr.write(
          `[warn] remove_keyboard skipped: could not resolve chat (${chatId.code}: ${chatId.message})\n`,
        );
      }
    }

    return toResult({});
  } catch (err) {
    return toError(err);
  }
}

export function register(server: McpServer) {
  server.registerTool(
    "answer_callback_query",
    {
      description: DESCRIPTION,
      inputSchema: {
        callback_query_id: z.string().describe("ID from the callback_query update"),
      text: z
        .string()
        .optional()
        .describe("Toast notification text shown to the user (up to 200 chars)"),
      show_alert: z
        .boolean()
        .optional()
        .describe("Show as a dialog alert instead of a toast"),
      url: z
        .string()
        .optional()
        .describe("URL to open in the user's browser (for games)"),
      cache_time: z
        .number()
        .int()
        .optional()
        .describe("Seconds the result may be cached client-side"),
      message_id: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Message ID of the keyboard-bearing message. Required when remove_keyboard is true."),
      remove_keyboard: z
        .boolean()
        .optional()
        .describe("When true, calls editMessageReplyMarkup to clear the inline keyboard on message_id after answering. Ack still succeeds even if the edit fails. Requires message_id."),
      token: TOKEN_SCHEMA,
      },
    },
    handleAnswerCallbackQuery,
  );
}
