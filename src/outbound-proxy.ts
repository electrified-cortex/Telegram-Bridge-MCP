/**
 * Outbound Proxy — transparent interception layer for Telegram API sends.
 *
 * Wraps the Grammy `Api` instance in a JS Proxy that fires cross-cutting
 * logic on every outbound send: cancel typing, expire temp messages,
 * promote the active animation (if any), and record the outgoing message.
 *
 * Tools call `getApi().sendMessage(...)` etc. exactly as before — the proxy
 * handles the rest. No tool imports from typing-state, temp-message,
 * animation-state, or message-store.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Api } from "grammy";
import { typingGeneration, cancelTypingIfSameGeneration } from "./typing-state.js";
import { clearPendingTemp } from "./temp-message.js";
import { recordOutgoing } from "./message-store.js";
import { fireTempReactionRestore } from "./temp-reaction.js";
import { getCallerSid } from "./session-context.js";
import { activeSessionCount, getSession } from "./session-manager.js";
import { escapeHtml, escapeV2 } from "./markdown.js";

// ---------------------------------------------------------------------------
// Session header injection
// ---------------------------------------------------------------------------

/**
 * Returns the `🤖 {name}\n` header when 2+ sessions are active
 * and the current session has a name, otherwise returns `""` or `"🤖 Session {sid}\n"`.
 * Uses parse-mode specific formatting for the name portion.
 */
export function buildHeader(parseMode?: string): { plain: string; formatted: string } {
  if (activeSessionCount() < 2) return { plain: "", formatted: "" };
  const sid = getCallerSid();
  const session = sid > 0 ? getSession(sid) : undefined;
  const name = session?.name || (sid > 0 ? `Session ${sid}` : "");
  if (!name) return { plain: "", formatted: "" };
  const colorPrefix = session?.color ? `${session.color} ` : "";
  const plain = `${colorPrefix}🤖 ${name}\n`;

  let formatted: string;
  if (parseMode === "MarkdownV2") {
    formatted = `${colorPrefix}🤖 \`${escapeV2(name)}\`\n`;
  } else if (parseMode === "HTML") {
    formatted = `${colorPrefix}🤖 <code>${escapeHtml(name)}</code>\n`;
  } else {
    // Markdown (legacy) or no parse_mode — use backtick formatting.
    // The caller is responsible for setting parse_mode: "Markdown" when
    // no parse_mode was originally provided (see sendMessage proxy).
    formatted = `${colorPrefix}🤖 \`${name}\`\n`;
  }

  return { plain, formatted };
}

// ---------------------------------------------------------------------------
// Animation interceptor — pluggable slot
// ---------------------------------------------------------------------------

/** Registered by animation-state when an animation starts. */
export interface SendInterceptor {
  /**
   * Called before a text send (sendMessage). If the animation is active,
   * edits the animation message to become the real content and returns
   * the repurposed message_id. Returns `{ intercepted: false }` otherwise.
   */
  beforeTextSend: (
    chatId: number,
    text: string,
    opts: Record<string, unknown>,
  ) => Promise<{ intercepted: true; message_id: number } | { intercepted: false }>;

  /** Called after a non-intercepted text send completes (persistent restart). */
  afterTextSend?: () => Promise<void>;

  /** Called before a file send — deletes the animation placeholder. */
  beforeFileSend: () => Promise<void>;

  /** Called after a file send — starts a new animation below. */
  afterFileSend: () => Promise<void>;

  /** Called when an edit occurs — resets the animation timeout. */
  onEdit: () => void;
}

const _interceptors = new Map<number, SendInterceptor>();

export function registerSendInterceptor(sid: number, i: SendInterceptor): void {
  _interceptors.set(sid, i);
}

export function clearSendInterceptor(sid?: number): void {
  if (sid !== undefined) {
    _interceptors.delete(sid);
  } else {
    _interceptors.clear();
  }
}

// ---------------------------------------------------------------------------
// Bypass flag — prevents re-entrancy when the animation system itself sends
// ---------------------------------------------------------------------------

const _bypassAls = new AsyncLocalStorage<boolean>();

/** Execute a callback with the proxy bypassed (for internal animation sends). */
export async function bypassProxy<T>(fn: () => Promise<T>): Promise<T> {
  return _bypassAls.run(true, fn);
}

/** True only within the async context of a `bypassProxy()` call. */
function isBypassing(): boolean {
  return _bypassAls.getStore() === true;
}

// ---------------------------------------------------------------------------
// Helpers for sendVoiceDirect (not a Grammy method, needs manual hooks)
// ---------------------------------------------------------------------------

const _fileSendTypingGenBySid = new Map<number, number>();

/** Call before a custom (non-Grammy) file send. */
export async function notifyBeforeFileSend(): Promise<void> {
  if (isBypassing()) return;
  const sid = getCallerSid();
  _fileSendTypingGenBySid.set(sid, typingGeneration());
  clearPendingTemp();
  await fireTempReactionRestore();
  const interceptor = sid > 0 ? _interceptors.get(sid) : undefined;
  if (interceptor) await interceptor.beforeFileSend();
}

/** Call after a custom (non-Grammy) file send. */
export async function notifyAfterFileSend(
  messageId: number,
  contentType: string,
  text?: string,
  caption?: string,
): Promise<void> {
  if (isBypassing()) return;
  const sid = getCallerSid();
  cancelTypingIfSameGeneration(_fileSendTypingGenBySid.get(sid) ?? 0);
  recordOutgoing(messageId, contentType, text, caption);
  const interceptor = sid > 0 ? _interceptors.get(sid) : undefined;
  if (interceptor) await interceptor.afterFileSend();
}

// ---------------------------------------------------------------------------
// Content-type detection for recording
// ---------------------------------------------------------------------------

const FILE_METHODS: Record<string, string> = {
  sendPhoto: "photo",
  sendVideo: "video",
  sendAudio: "audio",
  sendDocument: "document",
};

/** Extract file_id from a Grammy send response based on content type. */
function extractFileId(msg: Record<string, unknown>, contentType: string): string | undefined {
  try {
    if (contentType === "photo") {
      const photos = msg.photo as Array<{ file_id?: string }> | undefined;
      return photos?.[photos.length - 1]?.file_id;
    }
    const media = msg[contentType] as { file_id?: string } | undefined;
    return media?.file_id;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Proxy factory
// ---------------------------------------------------------------------------

export function createOutboundProxy(realApi: Api): Api {
  type ApiFn = (...args: unknown[]) => Promise<{ message_id: number }>;

  return new Proxy(realApi, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      const method = prop as string;
      const fn = (value as ApiFn).bind(target);

      // --- sendMessage: text path ---
      if (method === "sendMessage") {
        return async function proxiedSendMessage(
          chatId: number,
          text: string,
          opts?: Record<string, unknown>,
        ) {
          if (isBypassing()) return fn(chatId, text, opts);

          const gen = typingGeneration();
          clearPendingTemp();
          await fireTempReactionRestore();

          // Extract optional raw text for recording (tools can attach _rawText)
          const rawText = opts?._rawText as string | undefined;
          const cleanOpts = opts ? { ...opts } : undefined;
          if (cleanOpts) delete cleanOpts._rawText;

          // _skipHeader: internal flag — skip nametag injection for this call
          const skipHeader = cleanOpts?._skipHeader === true;
          if (cleanOpts) delete cleanOpts._skipHeader;

          // Session header — prepend "🤖 Name\n" in multi-session mode
          let parseMode = cleanOpts?.parse_mode as string | undefined;
          const { plain: headerPlain, formatted: headerFormatted } = buildHeader(parseMode);
          const finalText = headerFormatted && !skipHeader ? headerFormatted + text : text;

          // Auto-inject parse_mode so the backtick name tag renders
          let finalOpts = cleanOpts;
          if (headerFormatted && !skipHeader && !parseMode) {
            finalOpts = { ...cleanOpts, parse_mode: "Markdown" };
            parseMode = "Markdown";
          }
          const finalRawText = rawText !== undefined
            ? (headerPlain && !skipHeader ? headerPlain + rawText : rawText)
            : undefined;

          // Animation promote: edit animation → real content
          const callSid = getCallerSid();
          const activeInterceptor = callSid > 0 ? _interceptors.get(callSid) : undefined;
          if (activeInterceptor) {
            const savedInterceptor = activeInterceptor;
            const result = await activeInterceptor.beforeTextSend(chatId, finalText, finalOpts ?? {});
            if (result.intercepted) {
              cancelTypingIfSameGeneration(gen);
              recordOutgoing(result.message_id, "text", finalRawText ?? finalText);
              return { message_id: result.message_id };
            }
            // Not intercepted — send normally, then let animation restart below
            const msg = await fn(chatId, finalText, finalOpts);
            cancelTypingIfSameGeneration(gen);
            recordOutgoing(msg.message_id, "text", finalRawText ?? finalText);
            if (savedInterceptor.afterTextSend) {
              await savedInterceptor.afterTextSend();
            }
            return msg;
          }

          // Normal send
          const msg = await fn(chatId, finalText, finalOpts);
          cancelTypingIfSameGeneration(gen);
          recordOutgoing(msg.message_id, "text", finalRawText ?? finalText);
          return msg;
        };
      }

      // --- File sends: photo/video/audio/document ---
      const fileContentType = FILE_METHODS[method];
      if (fileContentType) {
        return async function proxiedFileSend(...args: unknown[]) {
          if (isBypassing()) return fn(...args);

          const gen = typingGeneration();
          clearPendingTemp();
          await fireTempReactionRestore();

          // Suspend animation (delete placeholder)
          const fileSid = getCallerSid();
          const fileInterceptor = fileSid > 0 ? _interceptors.get(fileSid) : undefined;
          const hadInterceptor = fileInterceptor != null;
          if (fileInterceptor) await fileInterceptor.beforeFileSend();

          try {
            // Inject session header into caption if multi-session active
            const optsArg = args[2] as Record<string, unknown> | undefined;
            let parseMode = optsArg?.parse_mode as string | undefined;
            const { formatted: captionHeaderFormatted } = buildHeader(parseMode);
            if (captionHeaderFormatted && optsArg?.caption) {
              if (!parseMode) {
                (args[2] as Record<string, unknown>).parse_mode = "Markdown";
                parseMode = "Markdown";
              }
              (args[2] as Record<string, unknown>).caption =
                captionHeaderFormatted + (optsArg.caption as string);
            }

            const msg = await fn(...args);
            cancelTypingIfSameGeneration(gen);

            // Extract caption for recording
            const finalCaption = (args[2] as Record<string, unknown> | undefined)
              ?.caption as string | undefined;

            // Extract file_id from the response (Grammy returns the full Message)
            const fileId = extractFileId(msg, fileContentType);
            recordOutgoing(msg.message_id, fileContentType, undefined, finalCaption, fileId);

            return msg;
          } finally {
            // Resume animation below — runs even if the API call threw
            if (hadInterceptor) {
              const resumeInterceptor = fileSid > 0 ? _interceptors.get(fileSid) : undefined;
              if (resumeInterceptor) await resumeInterceptor.afterFileSend();
            }
          }
        };
      }

      // --- editMessageText: cancel typing + reset animation timeout ---
      if (method === "editMessageText") {
        return async function proxiedEditMessageText(...args: unknown[]) {
          if (isBypassing()) return fn(...args);
          const gen = typingGeneration();
          await fireTempReactionRestore();

          // Inject session header into edit text if multi-session active
          // args: (chatId, messageId, text, opts?)
          const editOpts = args[3] as Record<string, unknown> | undefined;
          let editParseMode = editOpts?.parse_mode as string | undefined;
          const { formatted: editHeader } = buildHeader(editParseMode);
          if (editHeader) {
            args[2] = editHeader + (args[2] as string);
            // Auto-inject parse_mode so the backtick name tag renders
            if (!editParseMode) {
              args[3] = { ...editOpts, parse_mode: "Markdown" };
              editParseMode = "Markdown";
            }
          }

          const result = await fn(...args);
          cancelTypingIfSameGeneration(gen);
          const editSid = getCallerSid();
          const editInterceptor = editSid > 0 ? _interceptors.get(editSid) : undefined;
          if (editInterceptor) editInterceptor.onEdit();
          return result;
        };
      }

      // --- Everything else: pass through ---
      return value;
    },
  });
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function resetOutboundProxyForTest(): void {
  _interceptors.clear();
  _fileSendTypingGenBySid.clear();
}

/** Re-export for tests that need to assert temp-reaction interplay. */
export { fireTempReactionRestore } from "./temp-reaction.js";
