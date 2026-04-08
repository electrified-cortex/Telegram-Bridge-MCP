import { getApi, resolveChat, sendServiceMessage } from "./telegram.js";
import { stopPoller, drainPendingUpdates, waitForPollerExit } from "./poller.js";
import { listSessions, getSessionAnnouncementMessage } from "./session-manager.js";
import { deliverServiceMessage, notifySessionWaiters } from "./session-queue.js";
import { RESTART_GUIDANCE } from "./restart-guidance.js";

/**
 * Clears all registered slash-command menus on shutdown.
 * Clears both the active chat scope and the global default scope.
 * Errors are silently swallowed — cleanup is best-effort.
 */
export async function clearCommandsOnShutdown(): Promise<void> {
  const api = getApi();
  const chatId = resolveChat();
  if (typeof chatId === "number") {
    try {
      await api.setMyCommands([], { scope: { type: "chat", chat_id: chatId } });
    } catch { /* ignore — already cleared or bot lacks permission */ }
  }
  try {
    await api.setMyCommands([], { scope: { type: "default" } });
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Elegant shutdown sequence
// ---------------------------------------------------------------------------

/** Optional hook for session-log dump — set by built-in-commands at startup. */
let _dumpHook: (() => Promise<void>) | null = null;

/** Register the session-log dump function (avoids circular import). */
export function setShutdownDumpHook(hook: () => Promise<void>): void {
  _dumpHook = hook;
}

/**
 * Graceful shutdown: flush all session queues, notify agents, then exit.
 *
 * 1. Stop the poller (no new updates)
 * 2. Wait for the poll loop to finish (in-flight transcriptions)
 * 3. Drain last-mile pending updates
 * 4. Deliver a shutdown service message to every active session
 * 5. Wake up all blocked dequeue calls so agents receive it
 * 6. Brief delay so MCP responses transmit through stdio
 * 7. Send operator notification
 * 8. Dump session log (if enabled)
 * 9. Clear command menus
 * 10. process.exit(0)
 */
export async function elegantShutdown(): Promise<never> {
  stopPoller();

  // Finish in-flight transcriptions and drain last-mile updates
  // Timeout: 10s so a hung transcription doesn't stall shutdown indefinitely.
  await Promise.race([
    waitForPollerExit(),
    new Promise<void>((r) => setTimeout(r, 10_000)),
  ]);
  await drainPendingUpdates();

  // Notify all active sessions via their DM queues
  const sessions = listSessions();
  for (const s of sessions) {
    deliverServiceMessage(
      s.sid,
      "⛔ Server shutting down. Your session will be invalidated on restart. " + RESTART_GUIDANCE,
      "shutdown",
    );
  }
  // Wake up any agents blocked in dequeue
  notifySessionWaiters();

  // Unpin all session announcement messages (best-effort)
  const chatId = resolveChat();
  if (typeof chatId === "number") {
    const api = getApi();
    await Promise.allSettled(
      sessions
        .map(s => getSessionAnnouncementMessage(s.sid))
        .filter((id): id is number => id !== undefined)
        .map(id => api.unpinChatMessage(chatId, id)),
    );
  }

  // Give MCP stdio a moment to transmit responses
  await new Promise<void>((r) => setTimeout(r, 2000));

  // Operator-facing notification
  await sendServiceMessage("⛔️ Shutting down…").catch(() => {});

  // Session log dump (best-effort)
  if (_dumpHook) {
    try { await _dumpHook(); } catch { /* best effort */ }
  }

  // Clear command menus and exit
  await clearCommandsOnShutdown();
  process.exit(0);
}
