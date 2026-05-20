/**
 * Channel subscription registry.
 *
 * Tracks which MCP server instances have an active inbox subscription for a
 * TMCP session. When the session queue receives a new message it calls
 * `notifyChannelSubscriber(sid)` which fires a
 * `notifications/resources/updated` over the SSE transport — no polling
 * or explicit `dequeue` call required on the client side.
 *
 * URI scheme: `telegram://inbox/<token>`
 *
 * Debounce model (mirrors the activity-file kick gate):
 *   - First inbound → notify immediately, set cooldown window.
 *   - Further inbounds during cooldown → set a "pending" flag; no extra notification.
 *   - Content-returning dequeue → clear cooldown + flag (agent consumed; no reminder needed).
 *   - Timeout dequeue exit → do nothing; cooldown expires on its own.
 *   - After cooldown expires naturally → next inbound fires a fresh notification.
 *
 * This means: at most one notification per cooldown window. If the agent missed it
 * and more messages arrived, a fresh notification fires as soon as the window lapses
 * and the next message comes in. No out-of-band timer fires.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDequeueDefault, setDequeueDefault, getKickLockoutMs } from "./session-manager.js";

interface ChannelEntry {
  server: McpServer;
  token: number;
  /** Timestamp (ms) when the cooldown window expires. null = no active cooldown. */
  cooldownUntil: number | null;
  /** True when an inbound arrived during cooldown (notify on next opportunity). */
  pendingNotify: boolean;
}

/** sid → active channel subscription */
const _subscribers = new Map<number, ChannelEntry>();

/** Register an MCP server as the inbox channel subscriber for a session. */
export function registerChannelSubscriber(sid: number, token: number, server: McpServer): void {
  _subscribers.set(sid, { server, token, cooldownUntil: null, pendingNotify: false });
  // Cap the session's dequeue default to 90 s — the channel provides wakeup,
  // so long polls beyond 90 s only delay reminder firing with no benefit.
  const CHANNEL_MAX_WAIT_S = 90;
  if (getDequeueDefault(sid) > CHANNEL_MAX_WAIT_S) {
    setDequeueDefault(sid, CHANNEL_MAX_WAIT_S);
  }
}

/** Remove a session's channel subscription (unsubscribe or session close). */
export function unregisterChannelSubscriber(sid: number): void {
  _subscribers.delete(sid);
}

/**
 * Send a `notifications/resources/updated` for a session's inbox URI and
 * arm the cooldown window.
 */
function _send(entry: ChannelEntry, sid: number): void {
  const uri = `telegram://inbox/${entry.token}`;
  entry.server.server.sendNotification({
    method: "notifications/resources/updated",
    params: { uri },
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[channel] notify failed sid=${sid}: ${msg}\n`);
  });
  entry.cooldownUntil = Date.now() + getKickLockoutMs(sid);
  entry.pendingNotify = false;
}

/**
 * Fire `notifications/resources/updated` for a session's inbox, if subscribed.
 * Called by the session-queue after every enqueue.
 *
 *   - Not in cooldown → notify immediately.
 *   - In cooldown → set pending flag (one notification will fire on next opportunity).
 */
export function notifyChannelSubscriber(sid: number): void {
  const entry = _subscribers.get(sid);
  if (!entry) return;

  if (entry.cooldownUntil === null || Date.now() >= entry.cooldownUntil) {
    _send(entry, sid);
  } else {
    entry.pendingNotify = true;
  }
}

/**
 * Reset debounce state after a content-returning dequeue.
 * Mirrors releaseKickLockout — clears the cooldown so the next inbound fires fresh.
 * No re-notification is needed: the agent just read the content.
 */
export function resetChannelDebounce(sid: number): void {
  const entry = _subscribers.get(sid);
  if (!entry) return;
  entry.cooldownUntil = null;
  entry.pendingNotify = false;
}

/** Return true if a channel subscription is registered for the session. */
export function isChannelActive(sid: number): boolean {
  return _subscribers.has(sid);
}

/** URI prefix used to identify inbox subscription requests. */
export const INBOX_URI_RE = /^telegram:\/\/inbox\/(\d+)$/;
