import { getApi, resolveChat, sendServiceMessage } from "./telegram.js";
import { stopPoller, drainPendingUpdates, waitForPollerExit } from "./poller.js";
import { listSessions, getSessionAnnouncementMessage } from "./session-manager.js";
import { deliverServiceMessage, notifySessionWaiters } from "./session-queue.js";
import { SERVICE_MESSAGES } from "./service-messages.js";
import { closeSessionById } from "./session-teardown.js";
import { getSessionLogMode } from "./config.js";
import { flushCurrentLog, isLoggingEnabled, rollLog } from "./local-log.js";

/** Hard-stop guard: force process exit if graceful shutdown stalls. */
const HARD_EXIT_TIMEOUT_MS = 20_000;

/** Prevent duplicate concurrent shutdown sequences. */
let _shutdownInProgress = false;

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
 * 4. Deliver a shutdown service message to every active session
 * 5. Wake up all blocked dequeue calls so agents receive it
 * 6. [active sessions only] Brief delay so MCP responses transmit through stdio
 * 7. Send operator notification
 * 8. Flush and roll local logs
 * 9. Clear command menus
 * 10. process.exit(0)
 */
export async function elegantShutdown(): Promise<never> {
  if (_shutdownInProgress) {
    process.stderr.write("[shutdown] already in progress — ignoring duplicate request\n");
    return new Promise<never>(() => {});
  }
  _shutdownInProgress = true;

  const hardExitTimer = setTimeout(() => {
    process.stderr.write(
      `[shutdown] hard-exit timeout (${HARD_EXIT_TIMEOUT_MS}ms) reached — forcing exit\n`,
    );
    process.exit(0);
  }, HARD_EXIT_TIMEOUT_MS);
  // Do not keep the process alive solely because of the watchdog timer.
  hardExitTimer.unref();

  try {
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

  // Notify all active sessions via their DM queues
  for (const s of sessions) {
    deliverServiceMessage(s.sid, SERVICE_MESSAGES.SHUTDOWN);
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
    // Give sessions time to handle the shutdown message and close themselves (up to 10s).
    const shutdownDeadline = Date.now() + 10_000;
    while (Date.now() < shutdownDeadline && listSessions().length > 0) {
      await new Promise<void>((r) => setTimeout(r, 500));
    }
    // Force-close any sessions that did not close themselves
    for (const s of listSessions()) {
      closeSessionById(s.sid);
    }
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
  } finally {
    _shutdownInProgress = false;
    clearTimeout(hardExitTimer);
  }
}
