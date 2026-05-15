import { Api, GrammyError, HttpError, InputFile } from "grammy";
import type { ReactionTypeEmoji, Update } from "grammy/types";
import { readFileSync, existsSync, realpathSync } from "fs";
import path, { resolve } from "path";
import { tmpdir } from "os";
import { getBotReaction, recordBotReaction } from "./message-store.js";
import {
  recordRateLimit,
  rateLimitRemainingSecs,
  resetRateLimiterForTest,
} from "./rate-limiter.js";

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
    const resolvedPath = realpathSync(input); // realpathSync resolves symlinks; resolve() is lexical only
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
  | "MISSING_MESSAGE_ID"
  | "RATE_LIMITED"
  | "BUTTON_DATA_INVALID"
  | "BUTTON_LABEL_TOO_LONG"
  | "REACTION_EMOJI_INVALID"
  | "UNAUTHORIZED_SENDER"
  | "UNAUTHORIZED_CHAT"
  | "VOICE_RESTRICTED"
  | "DUAL_INSTANCE_CONFLICT"
  | "SID_REQUIRED"
  | "AUTH_FAILED"
  | "NAME_CONFLICT"
  | "BLOCKED"
  | "MISSING_CONTENT"
  | "MISSING_PARAM"
  | "MISSING_QUESTION_TYPE"
  | "TTS_NOT_CONFIGURED"
  | "UNKNOWN_ACTION"
  | "UNKNOWN_TYPE"
  | "NOT_GOVERNOR"
  | "LAST_SESSION"
  | "SESSION_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "NOT_PENDING"
  | "INVALID_COLOR"
  | "UNKNOWN_PRESET"
  | "UNKNOWN";

export interface TelegramError {
  code: TelegramErrorCode;
  message: string;
  /** Recovery hint for the caller — what to do next */
  hint?: string;
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
    const retry = err.parameters.retry_after;
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
// Rate limit tracking — delegated to rate-limiter.ts (single source of truth)
// ---------------------------------------------------------------------------

/** @see recordRateLimit in rate-limiter.ts */
export const recordRateLimitHit = recordRateLimit;

/** @see rateLimitRemainingSecs in rate-limiter.ts */
export const getRateLimitRemaining = rateLimitRemainingSecs;

/** Clears the rate limit window. For use in tests only. */
export const clearRateLimitForTest = resetRateLimiterForTest;

// ---------------------------------------------------------------------------
// Singleton API client
// ---------------------------------------------------------------------------

let _rawApi: Api | null = null;
let _proxiedApi: Api | null = null;

/** Returns the raw (unproxied) Grammy Api — for internal use by animation-state. */
export function getRawApi(): Api {
  if (_rawApi) return _rawApi;
  const token = process.env.BOT_TOKEN;
  if (token) return (_rawApi = new Api(token));
  throw new Error(
    "[telegram-bridge-mcp] Fatal: BOT_TOKEN environment variable is not set.\n" +
      "Set it in a .env file or pass it via the MCP server env config."
  );
}

/**
 * Sends a formatted service message (📦 header + status line) via the raw API,
 * bypassing the outbound proxy so it never appears in the message store.
 * Returns the message_id on success, or undefined if the chat is not configured.
 */
export async function sendServiceMessage(status: string): Promise<number | undefined> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") {
    process.stderr.write(`[service-msg] skipped: chatId is not a number\n`);
    return undefined;
  }
  process.stderr.write(`[service-msg] sending: ${status}\n`);
  const msg = await getRawApi().sendMessage(
    chatId,
    `📦 *Telegram Bridge MCP*\n\n${status}`,
    { parse_mode: "Markdown" },
  );
  process.stderr.write(`[service-msg] sent: ${status}\n`);
  return msg.message_id;
}

/**
 * Install the outbound proxy. Called once at startup from server.ts,
 * after all modules are loaded (avoids circular-import issues).
 */
export function installOutboundProxy(wrap: (raw: Api) => Api): void {
  _proxiedApi = wrap(getRawApi());
}

/** Returns the proxied Api instance — all tool code should use this. */
export function getApi(): Api {
  return _proxiedApi ?? getRawApi();
}

/** Clears the cached Api instances — for use in tests only. */
export function resetApi(): void {
  _rawApi = null;
  _proxiedApi = null;
}

// ---------------------------------------------------------------------------
// Security: allowed user / chat enforcement
// ---------------------------------------------------------------------------

/**
 * ALLOWED_USER_ID  — Numeric Telegram user ID of the owner.
 *   When set, every inbound update whose sender is NOT this user is dropped.
 *   Also used as the outbound chat target — for private 1-on-1 bots, chat.id === user.id.
 *   Prevents message-injection attacks from anyone who discovers the bot username.
 *   Optional at runtime, but strongly discouraged to omit — a startup warning is emitted.
 */
export interface SecurityConfig {
  userId: number; // 0 — no filter
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

  if (userId) return (_securityConfig = { userId });

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

  return (_securityConfig = { userId });
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

/**
 * Filters an update array to only those from the allowed user.
 * Updates that fail the check are silently consumed (offset still advances)
 * to keep the Telegram queue clean — they are never surfaced to the agent.
 */
export function filterAllowedUpdates(updates: Update[]): Update[] {
  const { userId } = getSecurityConfig();
  if (!userId) return updates;

  return updates.filter((u) => {
    const senderId =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- from is typed as required but absent on channel posts
      u.message?.from?.id ??
      u.callback_query?.from.id ??
      u.message_reaction?.user?.id ??
      u.my_chat_member?.from.id;
    return senderId !== undefined && senderId === userId;
  });
}

/**
 * Resolves the target chat ID for all outbound tool calls.
 *
 * Uses ALLOWED_USER_ID as the chat target — for private 1-on-1 bots,
 * chat.id === user.id. Tools never accept or expose chat_id as a parameter;
 * it is resolved here transparently.
 *
 * Returns the chat ID on success, or a TelegramError if ALLOWED_USER_ID
 * has not been configured (use `typeof result !== "number"` to detect errors).
 */
export function resolveChat(): number | TelegramError {
  const { userId } = getSecurityConfig();
  if (userId) return userId;
  return {
    code: "UNAUTHORIZED_CHAT",
    message:
      "ALLOWED_USER_ID is not configured. Set it in your .env or MCP server " +
      "config so the server knows which conversation to target.",
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
  const tokens = raw.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  const has = (name: "console" | "telegram" | "agent") => tokens.includes(name);
  return { console: has("console"), telegram: has("telegram"), agent: has("agent") };
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
    const chatId = resolveChat();
    if (typeof chatId === "number")
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
  return warning;
}

export function resetOffset(): void {
  _offset = 0;
}

/** Returns true if the agent channel is enabled for hijack warnings. */
export function hijackNotifyAgent(): boolean {
  const raw = (process.env.HIJACK_NOTIFY ?? "console,telegram").toLowerCase();
  return raw.split(",").map((t) => t.trim()).includes("agent");
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
    reply_markup?: {
      inline_keyboard: {
        text: string;
        callback_data?: string;
        url?: string;
      }[][];
    };
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
    const resolved = realpathSync(voice); // realpathSync resolves symlinks; resolve() is lexical only
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

  // Inject session header into caption (multi-session name tag)
  const { notifyBeforeFileSend, notifyAfterFileSend, buildHeader } = await import("./outbound-proxy.js");
  const { plain: captionHeader, formatted: captionHeaderFmt } = buildHeader(options.parse_mode);
  let finalCaption = options.caption;
  let finalParseMode = options.parse_mode;
  if (captionHeaderFmt) {
    // Prepend name tag; if no caption existed, use the header alone (trim trailing \n)
    if (finalCaption) {
      finalCaption = captionHeaderFmt + finalCaption;
    } else {
      finalCaption = captionHeaderFmt.trimEnd();
    }
    // Auto-inject Markdown parse_mode for backtick rendering
    if (!finalParseMode) {
      finalParseMode = "Markdown";
    }
  }

  if (finalCaption) form.append("caption", finalCaption);
  if (finalParseMode) form.append("parse_mode", finalParseMode);
  if (options.duration != null) form.append("duration", String(options.duration));
  if (options.disable_notification) form.append("disable_notification", "true");
  if (options.reply_to_message_id != null)
    form.append("reply_parameters", JSON.stringify({ message_id: options.reply_to_message_id }));
  if (options.reply_markup)
    form.append("reply_markup", JSON.stringify(options.reply_markup));

  // Hook into the outbound proxy so animation/typing/temp/recording are handled
  await notifyBeforeFileSend();

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
      { ok: false, error_code: json.error_code ?? 0, description: desc },
      "sendVoice",
      {}
    );
  }

  const recordCaption = captionHeader && options.caption
    ? captionHeader + options.caption
    : options.caption;
  await notifyAfterFileSend(json.result.message_id, "voice", undefined, recordCaption);
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

const REACT_SALUTE = "\uD83E\uDEE1" as ReactionEmoji; // 🫡

/**
 * Fire-and-forget 🫡 on a voice message to signal the agent received it.
 * Safe to call from any dequeue path — resolves chat internally.
 */
export function ackVoiceMessage(messageId: number): void {
  const resolved = resolveChat();
  const chatId = typeof resolved === "number" ? resolved : undefined;
  if (!chatId) return;
  // No-op if the message already has 🫡 recorded in the store
  if (getBotReaction(messageId) === REACT_SALUTE) return;
  void trySetMessageReaction(chatId, messageId, REACT_SALUTE)
    .then((ok) => {
      if (ok) recordBotReaction(messageId, REACT_SALUTE);
      else process.stderr.write(`[ack] 🫡 failed for msg ${messageId}\n`);
    });
}

/**
 * Wraps a single Telegram API call with automatic rate-limit retry.
 * On a 429 RATE_LIMITED response, waits `retry_after` seconds (capped at 60s)
 * and retries up to `maxRetries` times before re-throwing.
 * Pre-checks the tracked rate limit window — if Telegram has recently returned
 * a 429, subsequent calls fail immediately without hitting the API again.
 */
export async function callApi<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  // Fast-fail if we are inside a known rate limit window
  const remaining = rateLimitRemainingSecs();
  if (remaining > 0) {
    const desc = `Too Many Requests: retry after ${remaining}`;
    throw new GrammyError(
      desc,
      { ok: false, error_code: 429, description: desc, parameters: { retry_after: remaining } },
      "callApi",
      {}
    );
  }

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GrammyError && attempt < maxRetries) {
        const classified = classifyGrammyError(err);
        if (classified.code === "RATE_LIMITED") {
          recordRateLimit(classified.retry_after);
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

