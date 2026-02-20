import { Api, GrammyError, HttpError } from "grammy";
import type { Update } from "grammy/types";

// ---------------------------------------------------------------------------
// Telegram limits (for pre-validation before hitting the API)
// ---------------------------------------------------------------------------

export const LIMITS = {
  MESSAGE_TEXT: 4096,
  CAPTION: 1024,
  CALLBACK_DATA: 64,
  BUTTON_TEXT: 64,
  INLINE_KEYBOARD_ROWS: 8,
  INLINE_KEYBOARD_COLS: 8,
} as const;

// ---------------------------------------------------------------------------
// Structured error type agents can act on
// ---------------------------------------------------------------------------

export type TelegramErrorCode =
  | "MESSAGE_TOO_LONG"
  | "CAPTION_TOO_LONG"
  | "CALLBACK_DATA_TOO_LONG"
  | "EMPTY_MESSAGE"
  | "PARSE_MODE_INVALID"
  | "CHAT_NOT_FOUND"
  | "USER_NOT_FOUND"
  | "BOT_BLOCKED"
  | "NOT_ENOUGH_RIGHTS"
  | "MESSAGE_NOT_FOUND"
  | "MESSAGE_CANT_BE_EDITED"
  | "MESSAGE_CANT_BE_DELETED"
  | "RATE_LIMITED"
  | "BUTTON_DATA_INVALID"
  | "UNKNOWN";

export interface TelegramError {
  code: TelegramErrorCode;
  message: string;
  /** Seconds to wait before retrying (only for RATE_LIMITED) */
  retry_after?: number;
  /** The raw Telegram error description for debugging */
  raw?: string;
}

function classifyGrammyError(err: GrammyError): TelegramError {
  const desc = err.description.toLowerCase();
  const raw = err.description;

  if (desc.includes("message is too long"))
    return { code: "MESSAGE_TOO_LONG", message: `Message text exceeds ${LIMITS.MESSAGE_TEXT} characters. Shorten the text before sending.`, raw };

  if (desc.includes("caption is too long"))
    return { code: "CAPTION_TOO_LONG", message: `Caption exceeds ${LIMITS.CAPTION} characters. Shorten the caption before sending.`, raw };

  if (desc.includes("message text is empty") || desc.includes("text must be non-empty"))
    return { code: "EMPTY_MESSAGE", message: "Message text is empty. Provide a non-empty string.", raw };

  if (desc.includes("can't parse entities") || desc.includes("can't parse"))
    return { code: "PARSE_MODE_INVALID", message: "Telegram could not parse the message with the given parse_mode. Check for unclosed HTML tags or unescaped MarkdownV2 characters.", raw };

  if (desc.includes("chat not found"))
    return { code: "CHAT_NOT_FOUND", message: "Chat not found. Verify the chat_id is correct and the bot has been added to the chat.", raw };

  if (desc.includes("user not found"))
    return { code: "USER_NOT_FOUND", message: "User not found. Verify the user_id is correct.", raw };

  if (desc.includes("bot was blocked by the user") || desc.includes("bot was kicked"))
    return { code: "BOT_BLOCKED", message: "The user has blocked the bot. The message cannot be delivered.", raw };

  if (desc.includes("not enough rights") || desc.includes("have no rights") || desc.includes("need administrator"))
    return { code: "NOT_ENOUGH_RIGHTS", message: "The bot lacks the required permissions in this chat (e.g. pin, delete). Grant the bot admin rights.", raw };

  if (desc.includes("message to edit not found"))
    return { code: "MESSAGE_NOT_FOUND", message: "The message to edit was not found. It may have been deleted.", raw };

  if (desc.includes("message can't be edited"))
    return { code: "MESSAGE_CANT_BE_EDITED", message: "This message cannot be edited. Only messages sent by the bot within 48 hours can be edited.", raw };

  if (desc.includes("message can't be deleted") || desc.includes("message to delete not found"))
    return { code: "MESSAGE_CANT_BE_DELETED", message: "This message cannot be deleted. The bot may lack permissions, or the message is too old.", raw };

  if (err.error_code === 429) {
    const retry = (err as any).parameters?.retry_after as number | undefined;
    return { code: "RATE_LIMITED", message: `Rate limited by Telegram. Retry after ${retry ?? "a few"} seconds.`, retry_after: retry, raw };
  }

  if (desc.includes("button_data_invalid") || desc.includes("data is too long"))
    return { code: "BUTTON_DATA_INVALID", message: `Inline button callback_data exceeds ${LIMITS.CALLBACK_DATA} bytes. Shorten each button's data field.`, raw };

  return { code: "UNKNOWN", message: `Telegram API error ${err.error_code}: ${err.description}`, raw };
}

// ---------------------------------------------------------------------------
// Singleton API client
// ---------------------------------------------------------------------------

let _api: Api | null = null;

export function getApi(): Api {
  if (!_api) {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      console.error(
        "[telegram-mcp] Fatal: BOT_TOKEN environment variable is not set.\n" +
          "Set it in a .env file or pass it via the MCP server env config."
      );
      process.exit(1);
    }
    _api = new Api(token);
  }
  return _api;
}

// ---------------------------------------------------------------------------
// Polling offset state  (persists for the lifetime of the MCP server process)
// ---------------------------------------------------------------------------

let _offset = 0;

export function getOffset(): number {
  return _offset;
}

export function advanceOffset(updates: Update[]): void {
  if (updates.length > 0) {
    _offset = Math.max(...updates.map((u) => u.update_id)) + 1;
  }
}

export function resetOffset(): void {
  _offset = 0;
}

// ---------------------------------------------------------------------------
// Pre-send validators
// ---------------------------------------------------------------------------

export function validateText(text: string): TelegramError | null {
  if (!text || text.trim().length === 0)
    return { code: "EMPTY_MESSAGE", message: "Message text must not be empty." };
  if (text.length > LIMITS.MESSAGE_TEXT)
    return { code: "MESSAGE_TOO_LONG", message: `Message text is ${text.length} chars but the Telegram limit is ${LIMITS.MESSAGE_TEXT}. Shorten by at least ${text.length - LIMITS.MESSAGE_TEXT} characters.` };
  return null;
}

export function validateCaption(caption: string): TelegramError | null {
  if (caption.length > LIMITS.CAPTION)
    return { code: "CAPTION_TOO_LONG", message: `Caption is ${caption.length} chars but the Telegram limit is ${LIMITS.CAPTION}. Shorten by at least ${caption.length - LIMITS.CAPTION} characters.` };
  return null;
}

export function validateCallbackData(data: string): TelegramError | null {
  const byteLen = Buffer.byteLength(data, "utf8");
  if (byteLen > LIMITS.CALLBACK_DATA)
    return { code: "CALLBACK_DATA_TOO_LONG", message: `Callback data "${data}" is ${byteLen} bytes but the Telegram limit is ${LIMITS.CALLBACK_DATA} bytes.` };
  return null;
}

// ---------------------------------------------------------------------------
// MCP response helpers
// ---------------------------------------------------------------------------

export function toResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function toError(err: unknown) {
  let telegramError: TelegramError;

  if (err instanceof GrammyError) {
    telegramError = classifyGrammyError(err);
  } else if (err instanceof HttpError) {
    telegramError = { code: "UNKNOWN", message: `Network error reaching Telegram API: ${err.message}` };
  } else if (err && typeof err === "object" && "code" in err && "message" in err) {
    // Already a TelegramError (from pre-validation)
    telegramError = err as TelegramError;
  } else {
    telegramError = { code: "UNKNOWN", message: err instanceof Error ? err.message : String(err) };
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(telegramError, null, 2) }],
    isError: true as const,
  };
}
