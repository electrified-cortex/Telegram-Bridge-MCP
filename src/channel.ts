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
 * Cooldown model (mirrors the activity-file kick gate):
 *   - First inbound → notify immediately; cooldown arms after send confirms.
 *   - Further inbounds during cooldown → set a "pending" flag; no extra notification.
 *   - Content-returning dequeue → clear cooldown + flag (agent consumed; no reminder needed).
 *   - Timeout dequeue exit → do nothing; cooldown expires on its own.
 *   - After cooldown expires naturally → next inbound fires a fresh notification.
 *   - In-flight dequeue → skip notification (agent is actively waiting, will see the event).
 *
 * This means: at most one notification per cooldown window. The 90 s dequeue cap
 * ensures the agent wakes up within 90 s even if no further notifications fire.
 * No out-of-band timers are used.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isDequeueActive } from "./tools/activity/file-state.js";
import { getDequeueDefault, setDequeueDefault, getKickLockoutMs } from "./session-manager.js";

/** Maximum dequeue wait (seconds) for sessions with an active channel subscription. */
const CHANNEL_MAX_WAIT_S = 90;

interface ChannelEntry {
  server: McpServer;
  token: number;
  /** Timestamp (ms) when the cooldown window expires. null = no active cooldown. */
  cooldownUntil: number | null;
  /** True when an inbound arrived during cooldown (will fire on next opportunity). */
  pendingNotify: boolean;
  /** The session's dequeue default before we capped it to CHANNEL_MAX_WAIT_S. */
  priorDequeueDefault: number;
}

/** sid → active channel subscription */
const _subscribers = new Map<number, ChannelEntry>();

/** Register an MCP server as the inbox channel subscriber for a session. */
export function registerChannelSubscriber(sid: number, token: number, server: McpServer): void {
  const prior = getDequeueDefault(sid);
  _subscribers.set(sid, { server, token, cooldownUntil: null, pendingNotify: false, priorDequeueDefault: prior });
  // Cap the session's dequeue default to 90 s — the channel provides wakeup,
  // so long polls beyond 90 s only delay reminder firing with no benefit.
  if (prior > CHANNEL_MAX_WAIT_S) {
    setDequeueDefault(sid, CHANNEL_MAX_WAIT_S);
  }
}

/** Remove a session's channel subscription (unsubscribe or session close). */
export function unregisterChannelSubscriber(sid: number): void {
  const entry = _subscribers.get(sid);
  if (!entry) return;
  // Restore the dequeue default to whatever it was before we capped it.
  setDequeueDefault(sid, entry.priorDequeueDefault);
  _subscribers.delete(sid);
}

/**
 * Send a `notifications/resources/updated` for a session's inbox URI.
 * Cooldown is armed only after the send resolves — a failed send leaves
 * cooldownUntil null so the next notify call retries immediately.
 */
function _send(entry: ChannelEntry, sid: number): void {
  const uri = `telegram://inbox/${entry.token}`;
  entry.pendingNotify = false;
  entry.server.server.notification({
    method: "notifications/resources/updated",
    params: { uri },
  }).then(() => {
    entry.cooldownUntil = Date.now() + getKickLockoutMs(sid);
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[channel] notify failed sid=${sid}: ${msg}\n`);
    // cooldownUntil stays null — next notify will retry immediately.
  });
}

/**
 * Fire `notifications/resources/updated` for a session's inbox, if subscribed.
 * Called by the session-queue after every enqueue.
 *
 *   - In-flight dequeue → skip (agent is actively waiting, will see the event).
 *   - Not in cooldown → notify immediately.
 *   - In cooldown → set pending flag (fires on next opportunity).
 */
export function notifyChannelSubscriber(sid: number): void {
  const entry = _subscribers.get(sid);
  if (!entry) return;
  if (isDequeueActive(sid)) return;

  if (entry.cooldownUntil === null || Date.now() >= entry.cooldownUntil) {
    _send(entry, sid);
  } else {
    entry.pendingNotify = true;
  }
}

/**
 * Reset the cooldown state after a content-returning dequeue exit.
 * Clears both the cooldown window and the pending-notify flag — the agent
 * just read the content, so no re-notification is needed.
 */
export function resetChannelCooldown(sid: number): void {
  const entry = _subscribers.get(sid);
  if (!entry) return;
  entry.cooldownUntil = null;
  entry.pendingNotify = false;
}

/** Return true if a channel subscription is registered for the session. */
export function isChannelActive(sid: number): boolean {
  return _subscribers.has(sid);
}

/** URI pattern used to identify inbox subscription requests. */
export const INBOX_URI_RE = /^telegram:\/\/inbox\/(\d+)$/;
