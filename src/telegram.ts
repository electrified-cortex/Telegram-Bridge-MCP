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
  /** Mobile display limit — labels longer than this are cut off in multi-column layouts */
  BUTTON_DISPLAY_MULTI_COL: 20,
  /** Mobile display limit for single-column (full-width) buttons */
  BUTTON_DISPLAY_SINGLE_COL: 35,
  INLINE_KEYBOARD_ROWS: 8,
  INLINE_KEYBOARD_COLS: 8,
} as const;

/**
 * Default update types to request from Telegram.  Telegram *remembers* the
 * last `allowed_updates` value across `getUpdates` calls, so every call
 * should pass this to avoid accidentally filtering out callback_query, etc.
 */
export const DEFAULT_ALLOWED_UPDATES = [
  "message",
  "callback_query",
  "my_chat_member",
  "message_reaction",
] as const;

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
  | "BUTTON_LABEL_TOO_LONG"
  | "UNAUTHORIZED_SENDER"
  | "UNAUTHORIZED_CHAT"
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
        "[telegram-bridge-mcp] Fatal: BOT_TOKEN environment variable is not set.\n" +
          "Set it in a .env file or pass it via the MCP server env config."
      );
      process.exit(1);
    }
    _api = new Api(token);
  }
  return _api;
}

// ---------------------------------------------------------------------------
// Security: allowed user / chat enforcement
// ---------------------------------------------------------------------------

/**
 * ALLOWED_USER_ID  — Numeric Telegram user ID of the owner.
 *   When set, every inbound update whose sender is NOT this user is dropped.
 *   Prevents message-injection attacks from anyone who discovers the bot username.
 *
 * ALLOWED_CHAT_ID  — Chat ID (numeric string, may be negative for groups) that
 *   the bot is permitted to operate in.
 *   When set:
 *     • Inbound updates from other chats are dropped.
 *     • Outbound send calls targeting a different chat are rejected before
 *       hitting the Telegram API.
 *
 * Both are optional at runtime, but omitting ALLOWED_USER_ID is strongly
 * discouraged — a startup warning is emitted.
 */
export interface SecurityConfig {
  userId: number | null;
  chatId: string | null;
}

let _securityConfig: SecurityConfig | null = null;

export function getSecurityConfig(): SecurityConfig {
  if (_securityConfig) return _securityConfig;

  const rawUser = process.env.ALLOWED_USER_ID?.trim();
  const rawChat = process.env.ALLOWED_CHAT_ID?.trim();

  let userId: number | null = rawUser ? parseInt(rawUser, 10) : null;
  if (userId !== null && isNaN(userId)) {
    console.warn(
      `[telegram-bridge-mcp] WARNING: ALLOWED_USER_ID "${rawUser}" is not a valid integer — user filter disabled. ` +
        "Set ALLOWED_USER_ID to your numeric Telegram user ID."
    );
    userId = null;
  }
  const chatId = rawChat ?? null;

  if (!userId) {
    console.warn(
      "[telegram-bridge-mcp] WARNING: ALLOWED_USER_ID is not set. " +
        "Any Telegram user who messages the bot can inject updates. " +
        "Set ALLOWED_USER_ID to your numeric Telegram user ID."
    );
  }

  _securityConfig = { userId, chatId };
  return _securityConfig;
}

/** For testing only: resets the security config singleton so env vars are re-read. */
export function resetSecurityConfig(): void {
  _securityConfig = null;
}

/** Structured error for inbound updates that fail the sender check. */
export function unauthorizedSenderError(fromId: number | undefined): TelegramError {
  return {
    code: "UNAUTHORIZED_SENDER",
    message: `Update discarded: sender ${fromId ?? "unknown"} is not the configured ALLOWED_USER_ID.`,
  };
}

/** Structured error for outbound sends targeting a disallowed chat. */
export function unauthorizedChatError(chatId: string): TelegramError {
  return {
    code: "UNAUTHORIZED_CHAT",
    message: `Operation rejected: chat ${chatId} is not the configured ALLOWED_CHAT_ID. This server is locked to a single conversation.`,
  };
}

/**
 * Filters an update array to only those from the allowed user and/or chat.
 * Updates that fail the check are silently consumed (offset still advances)
 * to keep the Telegram queue clean — they are never surfaced to the agent.
 */
export function filterAllowedUpdates(updates: Update[]): Update[] {
  const { userId, chatId } = getSecurityConfig();
  if (!userId && !chatId) return updates;

  return updates.filter((u) => {
    const senderId = u.message?.from?.id ?? u.callback_query?.from?.id;
    const updateChatId =
      u.message?.chat.id != null
        ? String(u.message.chat.id)
        : u.callback_query?.message?.chat.id != null
          ? String(u.callback_query.message.chat.id)
          : null;

    if (userId && senderId !== undefined && senderId !== userId) return false;
    if (chatId && updateChatId !== null && updateChatId !== chatId) return false;
    return true;
  });
}

/**
 * Validates that an outbound target chat is permitted.
 * Returns a TelegramError if ALLOWED_CHAT_ID is set and the target differs.
 */
export function validateTargetChat(chatId: string): TelegramError | null {
  const { chatId: allowed } = getSecurityConfig();
  if (!allowed) return null;
  if (String(chatId).trim() !== String(allowed).trim()) {
    return unauthorizedChatError(chatId);
  }
  return null;
}

/**
 * Resolves the target chat ID for all outbound tool calls.
 *
 * The server is designed for a single-user/single-chat workflow — the chat is
 * always fully determined by ALLOWED_CHAT_ID in the server config. Tools never
 * accept or expose chat_id as a parameter; it is resolved here transparently.
 *
 * Returns the chat ID string on success, or a TelegramError if ALLOWED_CHAT_ID
 * has not been configured (use `typeof result !== "string"` to detect errors).
 */
export function resolveChat(): string | TelegramError {
  const { chatId } = getSecurityConfig();
  if (!chatId) {
    return {
      code: "UNAUTHORIZED_CHAT",
      message:
        "ALLOWED_CHAT_ID is not configured. Set it in your .env or MCP server " +
        "config to lock this server to its intended conversation.",
    };
  }
  return chatId;
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

// ---------------------------------------------------------------------------
// Shared polling helper — 1 s ticks for responsive waiting
// ---------------------------------------------------------------------------

/**
 * Polls `getUpdates` with 1-second ticks until `matcher` returns a truthy
 * value from the allowed updates, or `timeoutSeconds` expires.
 *
 * Returns `{ match, missed }` — `match` is the matcher result (or undefined
 * on timeout), `missed` collects all non-matching allowed updates so the
 * caller can surface them (e.g. text messages during a `choose`).
 */
export async function pollUntil<T>(
  matcher: (updates: Update[]) => T | undefined,
  timeoutSeconds: number,
): Promise<{ match: T | undefined; missed: Update[] }> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const missed: Update[] = [];

  while (Date.now() < deadline) {
    const updates = await getApi().getUpdates({
      offset: getOffset(),
      limit: 100,
      timeout: 25,
      allowed_updates: [...DEFAULT_ALLOWED_UPDATES] as any,
    });

    advanceOffset(updates);
    const allowed = filterAllowedUpdates(updates);

    const result = matcher(allowed);
    if (result !== undefined) {
      // Collect remaining non-matching updates as missed
      for (const u of allowed) {
        if (!matcher([u])) missed.push(u);
      }
      return { match: result, missed };
    }

    // No match — everything in this batch is missed
    missed.push(...allowed);
  }

  return { match: undefined, missed };
}
