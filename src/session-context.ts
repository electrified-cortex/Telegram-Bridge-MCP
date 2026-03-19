/**
 * Per-request session context via AsyncLocalStorage.
 *
 * Provides an async-safe SID that persists across awaits within a single
 * tool-call handler. This solves the global `_activeSessionId` race
 * condition when multiple sessions dequeue and send concurrently.
 *
 * Usage:
 *   runInSessionContext(sid, async () => { ... });
 *   const sid = getCallerSid(); // 0 if not in context
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { getActiveSession } from "./session-manager.js";

const _als = new AsyncLocalStorage<number>();

/**
 * Execute `fn` with `sid` as the caller's session context.
 * Any code within `fn` (including across awaits) can call
 * `getCallerSid()` to retrieve the value.
 */
export function runInSessionContext<T>(
  sid: number,
  fn: () => T,
): T {
  return _als.run(sid, fn);
}

/**
 * Get the SID of the session that initiated the current tool call.
 * Falls back to `getActiveSession()` when no context is set
 * (single-session or non-tool code paths).
 */
export function getCallerSid(): number {
  return _als.getStore() ?? getActiveSession();
}
