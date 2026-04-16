import { getApi, resolveChat, sendServiceMessage } from "./telegram.js";
import { stopPoller, drainPendingUpdates, waitForPollerExit } from "./poller.js";
import { listSessions, getSessionAnnouncementMessage, markPlannedBounce } from "./session-manager.js";
import { deliverServiceMessage, notifySessionWaiters } from "./session-queue.js";
import { RESTART_GUIDANCE } from "./restart-guidance.js";
import { saveSessionState } from "./session-persistence.js";
import { getSessionLogMode } from "./config.js";
import { flushCurrentLog, isLoggingEnabled, rollLog } from "./local-log.js";

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
 * 2. [active sessions only] Wait for poll loop exit and drain pending updates
 * 4. [planned only] Save session state snapshot for fast restart
 * 5. Deliver a shutdown/bounce service message to every active session
 * 6. Wake up all blocked dequeue calls so agents receive it
 * 7. [active sessions only] Brief delay so MCP responses transmit through stdio
 * 8. Send operator notification
 * 9. Flush and roll local logs
 * 10. Clear command menus
 * 11. process.exit(0)
 *
 * @param planned - When true, saves session state and sends reconnect-aware message.
 */
export async function elegantShutdown(planned = false): Promise<never> {
  // Mark planned bounce early so the state file is updated before anything else
  if (planned) {
    markPlannedBounce();
  }

  stopPoller();

  // Snapshot sessions once so this shutdown run uses a consistent view.
  const sessions = listSessions();
  const hasActiveSessions = sessions.length > 0;

  if (hasActiveSessions) {
    // Finish in-flight transcriptions and drain last-mile updates.
    // Timeout: 10s so a hung transcription doesn't stall shutdown indefinitely.
    await Promise.race([
      waitForPollerExit(),
      new Promise<void>((r) => setTimeout(r, 10_000)),
    ]);
    await drainPendingUpdates();
  }

  // For planned restarts: persist session state before notifying agents
  if (planned) {
    try {
      await saveSessionState();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[shutdown] saveSessionState failed: ${msg}\n`);
    }
  }

  // Notify all active sessions via their DM queues
  const shutdownMsg = planned
    ? "⚡ Server bouncing for fast restart. Session state saved. " +
      RESTART_GUIDANCE
    : "⛔ Server shutting down. Your session will be invalidated on restart. " + RESTART_GUIDANCE;
  for (const s of sessions) {
    deliverServiceMessage(
      s.sid,
      shutdownMsg,
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

  if (hasActiveSessions) {
    // Give MCP stdio a moment to transmit responses.
    await new Promise<void>((r) => setTimeout(r, 2000));
  }

  // Operator-facing notification
  await sendServiceMessage("⛔️ Shutting down…").catch(() => {});

  // Flush buffered local-log writes before any roll/dump logic.
  if (isLoggingEnabled()) {
    try { await flushCurrentLog(); } catch { /* best effort */ }
  }

  // Session log dump hook (best-effort)
  if (_dumpHook) {
    try { await _dumpHook(); } catch { /* best effort */ }
  }

  // If session-log mode is disabled, still roll the local log file so shutdown
  // always archives the active log even without timeline dump mode enabled.
  if (getSessionLogMode() === null && isLoggingEnabled()) {
    try {
      const filename = rollLog();
      if (filename) {
        await sendServiceMessage(`📋 Log file created: \`${filename}\``).catch(() => {});
      }
    } catch { /* best effort */ }
  }

  // Clear command menus and exit
  await clearCommandsOnShutdown();
  process.exit(0);
}
