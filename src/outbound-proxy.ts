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

import type { Api } from "grammy";
import { cancelTyping, typingGeneration, cancelTypingIfSameGeneration } from "./typing-state.js";
import { clearPendingTemp } from "./temp-message.js";
import { recordOutgoing } from "./message-store.js";
import { fireTempReactionRestore } from "./temp-reaction.js";

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

let _interceptor: SendInterceptor | null = null;

export function registerSendInterceptor(i: SendInterceptor): void {
  _interceptor = i;
}

export function clearSendInterceptor(): void {
  _interceptor = null;
}

// ---------------------------------------------------------------------------
// Bypass flag — prevents re-entrancy when the animation system itself sends
// ---------------------------------------------------------------------------

let _bypassing = false;

/** Execute a callback with the proxy bypassed (for internal animation sends). */
export async function bypassProxy<T>(fn: () => Promise<T>): Promise<T> {
  _bypassing = true;
  try {
    return await fn();
  } finally {
    _bypassing = false;
  }
}

// ---------------------------------------------------------------------------
// Helpers for sendVoiceDirect (not a Grammy method, needs manual hooks)
// ---------------------------------------------------------------------------

let _fileSendTypingGen = 0;

/** Call before a custom (non-Grammy) file send. */
export async function notifyBeforeFileSend(): Promise<void> {
  if (_bypassing) return;
  _fileSendTypingGen = typingGeneration();
  clearPendingTemp();
  await fireTempReactionRestore();
  if (_interceptor) await _interceptor.beforeFileSend();
}

/** Call after a custom (non-Grammy) file send. */
export async function notifyAfterFileSend(
  messageId: number,
  contentType: string,
  text?: string,
  caption?: string,
): Promise<void> {
  if (_bypassing) return;
  cancelTypingIfSameGeneration(_fileSendTypingGen);
  recordOutgoing(messageId, contentType, text, caption);
  if (_interceptor) await _interceptor.afterFileSend();
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
          if (_bypassing) return fn(chatId, text, opts);

          const gen = typingGeneration();
          clearPendingTemp();
          await fireTempReactionRestore();

          // Extract optional raw text for recording (tools can attach _rawText)
          const rawText = opts?._rawText as string | undefined;
          const cleanOpts = opts ? { ...opts } : undefined;
          if (cleanOpts) delete cleanOpts._rawText;

          // Animation promote: edit animation → real content
          if (_interceptor) {
            const savedInterceptor = _interceptor;
            const result = await _interceptor.beforeTextSend(chatId, text, cleanOpts ?? {});
            if (result.intercepted) {
              cancelTypingIfSameGeneration(gen);
              recordOutgoing(result.message_id, "text", rawText ?? text);
              return { message_id: result.message_id };
            }
            // Not intercepted — send normally, then let animation restart below
            const msg = await fn(chatId, text, cleanOpts);
            cancelTypingIfSameGeneration(gen);
            recordOutgoing(msg.message_id, "text", rawText ?? text);
            if (savedInterceptor.afterTextSend) {
              await savedInterceptor.afterTextSend();
            }
            return msg;
          }

          // Normal send
          const msg = await fn(chatId, text, cleanOpts);
          cancelTypingIfSameGeneration(gen);
          recordOutgoing(msg.message_id, "text", rawText ?? text);
          return msg;
        };
      }

      // --- File sends: photo/video/audio/document ---
      const fileContentType = FILE_METHODS[method];
      if (fileContentType) {
        return async function proxiedFileSend(...args: unknown[]) {
          if (_bypassing) return fn(...args);

          const gen = typingGeneration();
          clearPendingTemp();
          await fireTempReactionRestore();

          // Suspend animation (delete placeholder)
          const hadInterceptor = _interceptor != null;
          if (_interceptor) await _interceptor.beforeFileSend();

          try {
            const msg = await fn(...args);
            cancelTypingIfSameGeneration(gen);

            // Extract caption for recording
            const optsArg = args[2] as Record<string, unknown> | undefined;
            const caption = optsArg?.caption as string | undefined;
            recordOutgoing(msg.message_id, fileContentType, undefined, caption);

            return msg;
          } finally {
            // Resume animation below — runs even if the API call threw
            if (hadInterceptor && _interceptor) {
              await _interceptor.afterFileSend();
            }
          }
        };
      }

      // --- editMessageText: cancel typing + reset animation timeout ---
      if (method === "editMessageText") {
        return async function proxiedEditMessageText(...args: unknown[]) {
          if (_bypassing) return fn(...args);
          const gen = typingGeneration();
          await fireTempReactionRestore();
          const result = await fn(...args);
          cancelTypingIfSameGeneration(gen);
          if (_interceptor) _interceptor.onEdit();
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
  _interceptor = null;
  _bypassing = false;
  _fileSendTypingGen = 0;
}

/** Re-export for tests that need to assert temp-reaction interplay. */
export { fireTempReactionRestore } from "./temp-reaction.js";
