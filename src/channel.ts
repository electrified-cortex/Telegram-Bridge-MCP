/**
 * Channel subscription registry.
 *
 * Tracks which MCP server instances have an active inbox subscription for a
 * TMCP session. When the session queue receives a new message it calls
 * `notifyChannelSubscriber(sid, event)` which fires:
 *   1. `notifications/claude/channel` — CC-proprietary wake mechanism that
 *      delivers message content directly into Claude's context as a <channel> tag.
 *   2. `notifications/resources/updated` — standard MCP for non-CC clients.
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
import type { TimelineEvent } from "./message-store.js";
import { isDequeueActive } from "./tools/activity/file-state.js";
import { getDequeueDefault, setDequeueDefault, getnotifyLockoutMs } from "./session-manager.js";

/** Maximum dequeue wait (seconds) for sessions with an active channel subscription. */
const CHANNEL_MAX_WAIT_S = 90;

interface ChannelEntry {
  server: McpServer;
  token: number;
  /** Timestamp (ms) when the cooldown window expires. null = no active cooldown. */
  cooldownUntil: number | null;
  /** True when an inbound arrived during cooldown (will fire on next opportunity). */
  pendingNotify: boolean;
  /** Latest event that triggered a pending notification (used for deferred delivery). */
  pendingEvent: TimelineEvent | undefined;
  /** The session's dequeue default before we capped it to CHANNEL_MAX_WAIT_S. */
  priorDequeueDefault: number;
}

/** sid → active channel subscription */
const _subscribers = new Map<number, ChannelEntry>();

/** Register an MCP server as the inbox channel subscriber for a session. */
export function registerChannelSubscriber(sid: number, token: number, server: McpServer): void {
  const prior = getDequeueDefault(sid);
  _subscribers.set(sid, { server, token, cooldownUntil: null, pendingNotify: false, pendingEvent: undefined, priorDequeueDefault: prior });
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

/** Extract human-readable content from an event for the channel notification payload. */
function _extractContent(event: TimelineEvent): string {
  const c = event.content;
  if ((c.type === "text" || c.type === "voice") && c.text) return c.text;
  if (c.type === "voice") return "[voice message — transcription pending]";
  if (c.type === "photo") return c.caption ? `[photo] ${c.caption}` : "[photo]";
  if (c.type === "document") return c.name ? `[file: ${c.name}]${c.caption ? ` ${c.caption}` : ""}` : `[file]${c.caption ? ` ${c.caption}` : ""}`;
  if (c.caption) return c.caption;
  return `[${c.type}]`;
}

/**
 * Send channel notifications for a new inbound event.
 * Fires both the CC-proprietary `notifications/claude/channel` (delivers content
 * into Claude's context) and the standard `notifications/resources/updated`
 * (for non-CC MCP clients). Cooldown is armed after the standard notification confirms.
 */
function _send(entry: ChannelEntry, sid: number, event: TimelineEvent | undefined): void {
  const uri = `telegram://inbox/${entry.token}`;
  entry.pendingNotify = false;
  entry.pendingEvent = undefined;

  // CC-proprietary channel notification — wakes Claude and delivers content.
  if (event !== undefined) {
    void entry.server.server.notification({
      method: "notifications/claude/channel",
      params: {
        content: _extractContent(event),
        meta: {
          source: "telegram-bridge-mcp",
          message_id: String(event.id),
          ts: event.timestamp,
          from: event.from,
          type: event.content.type,
          inbox_uri: uri,
        },
      },
    }).catch((e: unknown) => {
      process.stderr.write(`[channel] claude/channel notify failed sid=${sid}: ${String(e)}\n`);
    });
  }

  // Standard MCP notification for non-CC clients.
  entry.server.server.notification({
    method: "notifications/resources/updated",
    params: { uri },
  }).then(() => {
    entry.cooldownUntil = Date.now() + getnotifyLockoutMs(sid);
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[channel] notify failed sid=${sid}: ${msg}\n`);
    // cooldownUntil stays null — next notify will retry immediately.
  });
}

/**
 * Fire channel notifications for a session's inbox, if subscribed.
 * Called by the session-queue after every enqueue.
 *
 *   - In-flight dequeue → skip (agent is actively waiting, will see the event).
 *   - Not in cooldown → notify immediately.
 *   - In cooldown → set pending flag (fires on next opportunity).
 */
export function notifyChannelSubscriber(sid: number, event?: TimelineEvent): void {
  const entry = _subscribers.get(sid);
  if (!entry) return;
  if (isDequeueActive(sid)) return;

  if (entry.cooldownUntil === null || Date.now() >= entry.cooldownUntil) {
    _send(entry, sid, event);
  } else {
    entry.pendingNotify = true;
    if (event !== undefined) entry.pendingEvent = event;
  }
}

/**
 * Fire a deferred pending notification if one is queued and cooldown has expired.
 * Called when cooldown may have just expired (e.g. after a timeout dequeue).
 */
export function flushPendingChannelNotify(sid: number): void {
  const entry = _subscribers.get(sid);
  if (!entry || !entry.pendingNotify) return;
  if (entry.cooldownUntil !== null && Date.now() < entry.cooldownUntil) return;
  _send(entry, sid, entry.pendingEvent);
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
  entry.pendingEvent = undefined;
}

/** Return true if a channel subscription is registered for the session. */
export function isChannelActive(sid: number): boolean {
  return _subscribers.has(sid);
}

/** URI pattern used to identify inbox subscription requests. */
export const INBOX_URI_RE = /^telegram:\/\/inbox\/(\d+)$/;
