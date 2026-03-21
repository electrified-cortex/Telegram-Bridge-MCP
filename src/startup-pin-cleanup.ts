import { getApi, resolveChat } from "./telegram.js";

/** Pattern that identifies a session announcement message sent by the bot. */
const SESSION_ANNOUNCEMENT_RE = /Session \d+ — 🟢 Online/;

/**
 * Returns true if the given pinned message is a stale session announcement
 * that the bot sent. Checks:
 *  - `from.is_bot === true` (sent by the bot itself, not the operator)
 *  - text matches the announcement pattern
 */
function isStaleBotAnnouncement(msg: Record<string, unknown>): boolean {
  const from = msg.from as Record<string, unknown> | undefined;
  if (!from || from.is_bot !== true) return false;
  const text = typeof msg.text === "string" ? msg.text : "";
  return SESSION_ANNOUNCEMENT_RE.test(text);
}

/**
 * On startup, scan for and unpin stale session announcement messages left
 * behind from a previous run that crashed (bypassing graceful shutdown).
 *
 * Strategy: call `getChat` to get the most-recently pinned message. If it
 * is a bot-sent session announcement, unpin it and repeat until the latest
 * pin is either absent or operator-owned.
 *
 * This is entirely best-effort — errors are swallowed and startup never blocks.
 */
export async function cleanupStalePins(): Promise<void> {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;

  const api = getApi();
  let cleaned = 0;

  // Loop: each `getChat` call returns the most recently pinned message.
  // After unpinning it, the next call returns the previous pin (if any).
  for (let i = 0; i < 50; i++) {
    let pinnedMsg: Record<string, unknown> | undefined;
    try {
      const chat = await api.getChat(chatId) as unknown as Record<string, unknown>;
      pinnedMsg = chat.pinned_message as Record<string, unknown> | undefined;
    } catch {
      // Can't reach Telegram or chat not found — stop silently
      break;
    }

    if (!pinnedMsg) break; // no more pins
    if (!isStaleBotAnnouncement(pinnedMsg)) break; // next pin is operator-owned — stop

    const msgId = pinnedMsg.message_id as number;
    try {
      await api.unpinChatMessage(chatId, msgId);
      cleaned++;
      process.stderr.write(`[startup] unpinned stale session announcement (msg ${msgId})\n`);
    } catch {
      // Unpin failed (already unpinned, no rights, etc.) — stop
      break;
    }
  }

  if (cleaned > 0) {
    process.stderr.write(`[startup] cleaned up ${cleaned} stale pin(s)\n`);
  }
}
