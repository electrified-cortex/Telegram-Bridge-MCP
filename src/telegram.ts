import { Api, GrammyError, HttpError, InputFile } from "grammy";
import type { ApiError, ReactionTypeEmoji, Update } from "grammy/types";
import { readFileSync, existsSync } from "fs";
import path, { resolve } from "path";
import { tmpdir } from "os";
import { enqueueUpdates, dequeueMatch } from "./update-buffer.js";
import { recordUpdate } from "./session-recording.js";

/** Directory where downloaded files are stored — only local paths under this dir are allowed for file uploads. */
export const SAFE_FILE_DIR = resolve(tmpdir(), "telegram-bridge-mcp");

/**
 * Resolves a user-provided media input (file path, HTTPS URL, or Telegram file_id)
 * into an InputFile or passthrough string. Rejects http:// and paths outside SAFE_FILE_DIR.
 * Returns { source } on success, TelegramError on failure.
 */
export function resolveMediaSource(input: string): { source: string | InputFile } | TelegramError {
  if (input.startsWith("http://"))
    return { code: "UNKNOWN", message: "Plain HTTP URLs are not accepted — use HTTPS to prevent interception in transit." };
  if (input.startsWith("https://")) return { source: input };
  if (existsSync(input)) {
    const resolvedPath = resolve(input);
    const rel = path.relative(SAFE_FILE_DIR, resolvedPath);
    if (rel.startsWith("..") || path.isAbsolute(rel))
      return { code: "UNKNOWN", message: `Local file access is restricted to ${SAFE_FILE_DIR}. Use download_file to stage files first.` };
    return { source: new InputFile(resolvedPath) };
  }
  return { source: input }; // Telegram file_id
}

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
  | "VOICE_RESTRICTED"
  | "DUAL_INSTANCE_CONFLICT"
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
    return {
      code: "MESSAGE_TOO_LONG",
      message: `Message text exceeds ${LIMITS.MESSAGE_TEXT} characters. Shorten the text before sending.`,
      raw,
    };

  if (desc.includes("caption is too long"))
    return {
      code: "CAPTION_TOO_LONG",
      message: `Caption exceeds ${LIMITS.CAPTION} characters. Shorten the caption before sending.`,
      raw,
    };

  if (desc.includes("message text is empty") || desc.includes("text must be non-empty"))
    return { code: "EMPTY_MESSAGE", message: "Message text is empty. Provide a non-empty string.", raw };

  if (desc.includes("can't parse entities") || desc.includes("can't parse"))
    return {
      code: "PARSE_MODE_INVALID",
      message: "Telegram could not parse the message with the given parse_mode. Check for unclosed HTML tags or unescaped MarkdownV2 characters.",
      raw,
    };

  if (desc.includes("chat not found"))
    return {
      code: "CHAT_NOT_FOUND",
      message: "Chat not found. Verify the chat_id is correct and the bot has been added to the chat.",
      raw,
    };

  if (desc.includes("user not found"))
    return { code: "USER_NOT_FOUND", message: "User not found. Verify the user_id is correct.", raw };

  if (desc.includes("bot was blocked by the user") || desc.includes("bot was kicked"))
    return {
      code: "BOT_BLOCKED",
      message: "The user has blocked the bot. The message cannot be delivered.",
      raw,
    };

  if (desc.includes("not enough rights") || desc.includes("have no rights") || desc.includes("need administrator"))
    return {
      code: "NOT_ENOUGH_RIGHTS",
      message: "The bot lacks the required permissions in this chat (e.g. pin, delete). Grant the bot admin rights.",
      raw,
    };

  if (desc.includes("message to edit not found"))
    return {
      code: "MESSAGE_NOT_FOUND",
      message: "The message to edit was not found. It may have been deleted.",
      raw,
    };

  if (desc.includes("message can't be edited"))
    return {
      code: "MESSAGE_CANT_BE_EDITED",
      message: "This message cannot be edited. Only messages sent by the bot within 48 hours can be edited.",
      raw,
    };

  if (desc.includes("message can't be deleted") || desc.includes("message to delete not found"))
    return {
      code: "MESSAGE_CANT_BE_DELETED",
      message: "This message cannot be deleted. The bot may lack permissions, or the message is too old.",
      raw,
    };

  if (err.error_code === 409)
    return {
      code: "DUAL_INSTANCE_CONFLICT",
      message:
        "Telegram rejected the poll: another getUpdates request is already active for this bot token. " +
        "Ensure only one MCP instance is running against this bot token.",
      raw,
    };

  if (err.error_code === 429) {
    const retry = err.parameters?.retry_after;
    return {
      code: "RATE_LIMITED",
      message: `Rate limited by Telegram. Retry after ${retry ?? "a few"} seconds.`,
      retry_after: retry,
      raw,
    };
  }

  if (desc.includes("button_data_invalid") || desc.includes("data is too long"))
    return {
      code: "BUTTON_DATA_INVALID",
      message: `Inline button callback_data exceeds ${LIMITS.CALLBACK_DATA} bytes. Shorten each button's data field.`,
      raw,
    };

  return { code: "UNKNOWN", message: `Telegram API error ${err.error_code}: ${err.description}`, raw };
}

// ---------------------------------------------------------------------------
// Singleton API client
// ---------------------------------------------------------------------------

let _api: Api | null = null;

export function getApi(): Api {
  if (_api) return _api;
  const token = process.env.BOT_TOKEN;
  if (token) return (_api = new Api(token));
  throw new Error(
    "[telegram-bridge-mcp] Fatal: BOT_TOKEN environment variable is not set.\n" +
      "Set it in a .env file or pass it via the MCP server env config."
  );
}

// ---------------------------------------------------------------------------
// Security: allowed user / chat enforcement
// ---------------------------------------------------------------------------

/**
 * ALLOWED_USER_ID  — Numeric Telegram user ID of the owner.
 *   When set, every inbound update whose sender is NOT this user is dropped.
 *   Prevents message-injection attacks from anyone who discovers the bot username.
 *
 * ALLOWED_CHAT_ID  — Chat ID (integer, may be negative for group/channel chats) that
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
  userId: number; // 0 — no filter
  chatId: number; // 0 — no filter
}

let _securityConfig: SecurityConfig | null = null;

/** Reads an env var, trims it, parses as integer. Returns 0 if unset or not a valid integer. */
function parseEnvInt(envVar: string): number {
  const raw = process.env[envVar]?.trim();
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  if (Number.isFinite(n)) return n;
  console.warn(
    `[telegram-bridge-mcp] WARNING: ${envVar} "${raw}" is not a valid integer — ignored.`
  );
  return 0;
}

export function getSecurityConfig(): SecurityConfig {
  if (_securityConfig) return _securityConfig;

  const userId = parseEnvInt("ALLOWED_USER_ID");
  const chatId = parseEnvInt("ALLOWED_CHAT_ID");

  if (userId) return (_securityConfig = { userId, chatId });

  if (process.env.ALLOW_ALL_USERS !== "true")
    throw new Error(
      "[telegram-bridge-mcp] ALLOWED_USER_ID is not set. " +
        "Any Telegram user who messages the bot can inject updates. " +
        "Set ALLOWED_USER_ID to your numeric Telegram user ID, " +
        "or set ALLOW_ALL_USERS=true to explicitly bypass this check."
    );

  console.warn(
    "[telegram-bridge-mcp] WARNING: ALLOWED_USER_ID is not set and ALLOW_ALL_USERS=true. " +
      "Any Telegram user who messages the bot can inject updates."
  );

  return (_securityConfig = { userId, chatId });
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
  const hasUserFilter = userId > 0;
  if (!hasUserFilter && !chatId) return updates;

  return updates.filter((u) => {
    const senderId =
      u.message?.from?.id ??
      u.callback_query?.from?.id ??
      u.message_reaction?.user?.id ??
      u.my_chat_member?.from?.id;
    const updateChatId =
      u.message?.chat?.id ??
      u.callback_query?.message?.chat.id ??
      u.message_reaction?.chat?.id ??
      u.my_chat_member?.chat?.id ??
      null;

    if (hasUserFilter && (!senderId || senderId !== userId)) return false;
    if (chatId && (!updateChatId || updateChatId !== chatId)) return false;
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
  if (chatId.trim() === String(allowed)) return null;
  return unauthorizedChatError(chatId);
}

/**
 * Resolves the target chat ID for all outbound tool calls.
 *
 * The server is designed for a single-user/single-chat workflow — the chat is
 * always fully determined by ALLOWED_CHAT_ID in the server config. Tools never
 * accept or expose chat_id as a parameter; it is resolved here transparently.
 *
 * Returns the chat ID on success, or a TelegramError if ALLOWED_CHAT_ID
 * has not been configured (use `typeof result !== "number"` to detect errors).
 */
export function resolveChat(): number | TelegramError {
  const { chatId } = getSecurityConfig();
  if (chatId) return chatId;
  return {
    code: "UNAUTHORIZED_CHAT",
    message:
      "ALLOWED_CHAT_ID is not configured. Set it in your .env or MCP server " +
      "config to lock this server to its intended conversation.",
  };
}

// ---------------------------------------------------------------------------
// Polling offset state  (persists for the lifetime of the MCP server process)
// ---------------------------------------------------------------------------

let _offset = 0;

export function getOffset(): number {
  return _offset;
}

/**
 * Channels for dual-instance hijack warnings.
 * Set HIJACK_NOTIFY to a comma-separated list of: console, telegram, agent
 * Default: "console,telegram"
 */
function getHijackNotifyConfig(): { console: boolean; telegram: boolean; agent: boolean } {
  const raw = (process.env.HIJACK_NOTIFY ?? "console,telegram").toLowerCase();
  return {
    console: raw.includes("console"),
    telegram: raw.includes("telegram"),
    agent: raw.includes("agent"),
  };
}

/**
 * Fires hijack notifications on the configured channels (console + telegram).
 * Does NOT handle the `agent` channel — callers decide whether to surface the
 * message to the agent based on `hijackNotifyAgent()`.
 */
export function fireHijackNotification(message: string): void {
  const notify = getHijackNotifyConfig();
  if (notify.console)
    console.error(`[telegram-bridge-mcp] WARNING: ${message}`);
  if (notify.telegram) {
    const { chatId } = getSecurityConfig();
    if (chatId)
      getApi().sendMessage(chatId, message).catch(() => {}); // best-effort
  }
}

/**
 * Advances the polling offset and checks for update_id gaps that indicate
 * another MCP instance is consuming the same bot's update queue.
 * Returns a warning string if a gap was detected (for agent notification),
 * or null if everything is contiguous.
 */
export function advanceOffset(updates: Update[]): string | null {
  if (updates.length === 0) return null;
  const minId = Math.min(...updates.map((u) => u.update_id));
  let warning: string | null = null;
  if (_offset > 0 && minId > _offset) {
    const gap = minId - _offset;
    warning =
      `⚠️ Update ID gap detected — expected ${_offset}, got ${minId}. ` +
      `${gap} update(s) may have been consumed by another process. ` +
      "Ensure only one MCP instance is running against this bot token.";
    fireHijackNotification(warning);
  }
  _offset = Math.max(...updates.map((u) => u.update_id)) + 1;
  for (const u of updates) recordUpdate(u);
  return warning;
}

export function resetOffset(): void {
  _offset = 0;
}

/** Returns true if the agent channel is enabled for hijack warnings. */
export function hijackNotifyAgent(): boolean {
  return (process.env.HIJACK_NOTIFY ?? "console,telegram").toLowerCase().includes("agent");
}

// ---------------------------------------------------------------------------
// Pre-send validators
// ---------------------------------------------------------------------------

export function validateText(text: string): TelegramError | null {
  if (!text || text.trim().length === 0)
    return { code: "EMPTY_MESSAGE", message: "Message text must not be empty." };
  if (text.length <= LIMITS.MESSAGE_TEXT) return null;
  return {
    code: "MESSAGE_TOO_LONG",
    message: `Message text is ${text.length} chars but the Telegram limit is ${LIMITS.MESSAGE_TEXT}. Shorten by at least ${text.length - LIMITS.MESSAGE_TEXT} characters.`,
  };
}

/**
 * Splits text that exceeds Telegram's 4096-char message limit into an ordered
 * array of chunks, each within the limit.  Prefers splitting at paragraph
 * breaks (double newline), then single newlines, then word spaces — falling
 * back to a hard cut only when no whitespace is found.
 *
 * Splitting is done on the already-processed (post-Markdown-conversion) text
 * so character counts are exact.
 */
export function splitMessage(text: string): string[] {
  if (text.length <= LIMITS.MESSAGE_TEXT) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > LIMITS.MESSAGE_TEXT) {
    const limit = LIMITS.MESSAGE_TEXT;
    let splitAt = limit;

    // Prefer paragraph break
    const paraAt = remaining.lastIndexOf("\n\n", limit);
    if (paraAt > limit * 0.5) {
      splitAt = paraAt + 2;
    } else {
      // Then single newline
      const nlAt = remaining.lastIndexOf("\n", limit);
      if (nlAt > limit * 0.5) {
        splitAt = nlAt + 1;
      } else {
        // Then word space
        const spAt = remaining.lastIndexOf(" ", limit);
        if (spAt > limit * 0.5) splitAt = spAt + 1;
        // else hard cut at limit
      }
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

/**
 * Sends a voice note directly via the Telegram Bot API using fetch + FormData,
 * bypassing grammY to ensure correct multipart MIME typing (audio/ogg).
 * Accepts a Buffer (TTS-generated OGG), a local file path, a public URL, or a Telegram file_id.
 */
export async function sendVoiceDirect(
  chatId: number | string,
  voice: Buffer | string,
  options: {
    caption?: string;
    parse_mode?: string;
    duration?: number;
    disable_notification?: boolean;
    reply_to_message_id?: number;
  } = {}
): Promise<{ message_id: number; voice?: Record<string, unknown> }> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN not set");

  const form = new FormData();
  form.append("chat_id", chatId);

  if (voice instanceof Buffer) {
    form.append("voice", new Blob([new Uint8Array(voice)], { type: "audio/ogg" }), "voice.ogg");
  } else if (typeof voice === "string" && !voice.startsWith("http") && existsSync(voice)) {
    // Only allow reading local files from the safe temp directory to prevent arbitrary file exfiltration
    const resolved = resolve(voice);
    const safeRelative = path.relative(SAFE_FILE_DIR, resolved);
    if (safeRelative.startsWith("..") || path.isAbsolute(safeRelative)) {
      throw new Error(`Local file read restricted to ${SAFE_FILE_DIR}. Refusing to read: ${resolved}`);
    }
    const data = readFileSync(resolved);
    form.append("voice", new Blob([data], { type: "audio/ogg" }), "voice.ogg");
  } else {
    // URL or Telegram file_id
    form.append("voice", voice);
  }

  if (options.caption) form.append("caption", options.caption);
  if (options.parse_mode) form.append("parse_mode", options.parse_mode);
  if (options.duration != null) form.append("duration", String(options.duration));
  if (options.disable_notification) form.append("disable_notification", "true");
  if (options.reply_to_message_id != null)
    form.append("reply_parameters", JSON.stringify({ message_id: options.reply_to_message_id }));

  const res = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, {
    method: "POST",
    body: form,
  });

  const json = (await res.json()) as {
    ok: boolean;
    result: { message_id: number; voice?: Record<string, unknown> };
    description?: string;
    error_code?: number;
  };

  if (!json.ok) {
    const desc = json.description ?? `Telegram API error ${json.error_code}`;
    // Throw as GrammyError so classifyGrammyError in toError() can classify it
    throw new GrammyError(
      desc,
      { ok: false, error_code: json.error_code ?? 0, description: desc } as ApiError,
      "sendVoice",
      {}
    );
  }

  return json.result;
}

/** Canonical type for a Telegram reaction emoji string. */
export type ReactionEmoji = ReactionTypeEmoji["emoji"];

/**
 * Sets a reaction emoji on a message. Returns true on success, false if the
 * reaction is not supported or the message is too old. Never throws.
 */
export function trySetMessageReaction(
  chatId: number,
  messageId: number,
  emoji: ReactionEmoji,
): Promise<boolean> {
  return getApi()
    .setMessageReaction(chatId, messageId, [{ type: "emoji", emoji }])
    .then(() => true, () => false);
}

/**
 * Wraps a single Telegram API call with automatic rate-limit retry.
 * On a 429 RATE_LIMITED response, waits `retry_after` seconds (capped at 60s)
 * and retries up to `maxRetries` times before re-throwing.
 */
export async function callApi<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GrammyError && attempt < maxRetries) {
        const classified = classifyGrammyError(err);
        if (classified.code === "RATE_LIMITED") {
          const delay = Math.min((classified.retry_after ?? 5) * 1000, 60_000);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      throw err;
    }
  }
}

export function validateCaption(caption: string): TelegramError | null {
  if (caption.length <= LIMITS.CAPTION) return null;
  return {
    code: "CAPTION_TOO_LONG",
    message: `Caption is ${caption.length} chars but the Telegram limit is ${LIMITS.CAPTION}. Shorten by at least ${caption.length - LIMITS.CAPTION} characters.`,
  };
}

export function validateCallbackData(data: string): TelegramError | null {
  const byteLen = Buffer.byteLength(data, "utf8");
  if (byteLen <= LIMITS.CALLBACK_DATA) return null;
  return {
    code: "CALLBACK_DATA_TOO_LONG",
    message: `Callback data "${data}" is ${byteLen} bytes but the Telegram limit is ${LIMITS.CALLBACK_DATA} bytes.`,
  };
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

  // 1. Check the shared buffer — a previous poll may have already fetched the
  //    update we need. Consume it from the buffer without hitting Telegram.
  const buffered = dequeueMatch((u) => matcher([u]));
  if (buffered !== undefined) {
    return { match: buffered, missed: [] };
  }

  while (Date.now() < deadline) {
    const updates = await getApi().getUpdates({
      offset: getOffset(),
      limit: 1,   // one at a time — prevents batch-drop when multiple messages arrive simultaneously
      timeout: 25,
      allowed_updates: [...DEFAULT_ALLOWED_UPDATES] as ReadonlyArray<Exclude<keyof Update, "update_id">>,
    });

    advanceOffset(updates);
    const allowed = filterAllowedUpdates(updates);

    const result = matcher(allowed);
    if (result !== undefined) {
      // Buffer any non-matching updates from the same batch — nothing is dropped.
      const rest = allowed.filter((u) => matcher([u]) === undefined);
      if (rest.length > 0) enqueueUpdates(rest);
      return { match: result, missed: [] };
    }

    // No match — buffer these updates so other tools can consume them later.
    // Nothing is ever dropped.
    if (allowed.length > 0) enqueueUpdates(allowed);
  }

  return { match: undefined, missed: [] };
}
