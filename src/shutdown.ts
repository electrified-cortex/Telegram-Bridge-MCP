import { getApi, resolveChat, sendServiceMessage } from "./telegram.js";
import { stopPoller, drainPendingUpdates, waitForPollerExit } from "./poller.js";
import { listSessions, getSessionAnnouncementMessage } from "./session-manager.js";
import { deliverServiceMessage, notifySessionWaiters } from "./session-queue.js";
import { SERVICE_MESSAGES } from "./service-messages.js";
import { closeSessionById } from "./session-teardown.js";
import { getSessionLogMode } from "./config.js";
import { flushCurrentLog, isLoggingEnabled, rollLog } from "./local-log.js";

// ---------------------------------------------------------------------------
// Shutdown cause
// ---------------------------------------------------------------------------

/**
 * Who or what triggered the shutdown. Used in the operator-visible chat announcement.
 *
 * - `"operator"` — operator typed `/shutdown` in Telegram chat
 * - `"agent"`    — MCP `shutdown` tool was called by an agent
 *
 * Note: `"signal"` (OS SIGTERM/SIGINT) and `"crash"` (uncaught exception recovery)
 * are reserved for future wiring — the SIGINT/SIGTERM handler in `index.ts` currently
 * uses its own inline sequence and does not call `elegantShutdown`.
 */
export type ShutdownCause = "operator" | "agent";

/** When session count exceeds this, emit one summary line instead of one line per session. */
const SESSION_SUMMARY_THRESHOLD = 10;

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
// Chat-visible shutdown announcement helpers
// ---------------------------------------------------------------------------

function causeLabel(cause: ShutdownCause): string {
  switch (cause) {
    case "operator": return "operator /shutdown";
    case "agent":    return "agent shutdown tool";
  }
}

/**
 * Post the pre-shutdown announcement to the Telegram chat.
 * Never throws — errors are logged to stderr and ignored.
 */
export async function postShutdownAnnouncement(
  cause: ShutdownCause,
  sessionCount: number,
): Promise<void> {
  const who = causeLabel(cause);
  const sessionPart = sessionCount > 0
    ? `closing ${sessionCount} active session${sessionCount === 1 ? "" : "s"}, invalidating tokens`
    : "no active sessions";
  const text =
    `⛔ *Bridge shutting down*\n` +
    `Initiated by: ${who}\n` +
    `Action: ${sessionPart}\n` +
    `Next state: bridge offline until \`pnpm start\``;
  await sendServiceMessage(text).catch((err: unknown) => {
    process.stderr.write(`[shutdown] announcement failed (non-blocking): ${String(err)}\n`);
  });
}

/**
 * Post a single per-session closure line to the Telegram chat.
 * Never throws — errors are logged to stderr and ignored.
 */
export async function postSessionClosedLine(name: string, sid: number): Promise<void> {
  await sendServiceMessage(`↳ Session ${name} (SID ${sid}) closed`).catch((err: unknown) => {
    process.stderr.write(`[shutdown] session-closed line failed (non-blocking): ${String(err)}\n`);
  });
}

/**
 * Post a summary line when too many sessions are closing to list individually.
 * Never throws — errors are logged to stderr and ignored.
 */
export async function postSessionSummaryLine(count: number): Promise<void> {
  await sendServiceMessage(`↳ ${count} sessions closed`).catch((err: unknown) => {
    process.stderr.write(`[shutdown] session-summary line failed (non-blocking): ${String(err)}\n`);
  });
}

/**
 * Post the final "bridge offline" gravestone to the Telegram chat.
 * Never throws — errors are logged to stderr and ignored.
 */
export async function postGravestone(): Promise<void> {
  await sendServiceMessage("🪦 Bridge offline").catch((err: unknown) => {
    process.stderr.write(`[shutdown] gravestone failed (non-blocking): ${String(err)}\n`);
  });
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
 * 1.  Post a chat-visible pre-shutdown announcement (who/what/next-state)
 * 2.  Stop the poller (no new updates)
 * 3.  [active sessions only] Wait for poll loop exit and drain pending updates
 * 4.  Deliver a shutdown service_message to every active session (agent-facing)
 * 5.  Wake up all blocked dequeue calls so agents receive it
 * 6.  Unpin all session announcement messages
 * 7.  [active sessions only] Wait up to 10 s for sessions to self-close, then force-close
 *     — chat-visible line per session (or one summary when >10 sessions)
 * 8.  Post gravestone: "bridge offline" chat line
 * 9.  Send operator notification ("⛔️ Shutting down…") — existing behaviour preserved
 * 10. Flush and roll local logs
 * 11. Clear command menus
 * 12. process.exit(0)
 *
 * All Telegram chat calls (steps 1, 7, 8) are fire-and-forget: errors are
 * logged to stderr but never block the shutdown sequence.
 *
 * @param cause  Who triggered the shutdown. Defaults to `"agent"`.
 */
export async function elegantShutdown(cause: ShutdownCause = "agent"): Promise<never> {
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
  // Snapshot sessions once so this shutdown run uses a consistent view.
  const sessions = listSessions();
  const hasActiveSessions = sessions.length > 0;

  // Step 1: pre-shutdown chat announcement (before tearing anything down)
  await postShutdownAnnouncement(cause, sessions.length);

  stopPoller();

  if (hasActiveSessions) {
    // Finish in-flight transcriptions and drain last-mile updates.
    // Timeout: 10s so a hung transcription doesn't stall shutdown indefinitely.
    await Promise.race([
      waitForPollerExit(),
      new Promise<void>((r) => setTimeout(r, 10_000)),
    ]);
    await drainPendingUpdates();
  }

  // Step 4: Notify all active sessions via their DM queues (agent-facing service_message)
  for (const s of sessions) {
    deliverServiceMessage(s.sid, SERVICE_MESSAGES.SHUTDOWN);
  }
  // Step 5: Wake up any agents blocked in dequeue
  notifySessionWaiters();

  // Step 6: Unpin all session announcement messages (best-effort)
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

    // Step 7: Emit chat lines for closed sessions and force-close any that remain.
    const remaining = listSessions();
    const useSummary = sessions.length > SESSION_SUMMARY_THRESHOLD;

    // Determine which sessions self-closed gracefully (original snapshot minus remaining).
    const remainingSids = new Set(remaining.map(s => s.sid));
    const gracefullyClosed = sessions.filter(s => !remainingSids.has(s.sid));

    if (useSummary) {
      // Emit one summary line covering all sessions (self-closed + force-closed).
      await postSessionSummaryLine(sessions.length);
    } else {
      // Emit per-session lines: graceful closes first (as they happened), then force-closes.
      for (const s of gracefullyClosed) {
        await postSessionClosedLine(s.name, s.sid);
      }
    }

    for (const s of remaining) {
      closeSessionById(s.sid);
      if (!useSummary) {
        await postSessionClosedLine(s.name, s.sid);
      }
    }
  }

  // Step 8: Gravestone — bridge is now offline
  await postGravestone();

  // Step 9: Operator-facing notification (preserved from original behaviour)
  await sendServiceMessage("⛔️ Shutting down…").catch(() => {});

  // Step 10: Flush buffered local-log writes before any roll/dump logic.
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

  // Step 11: Clear command menus and exit
  await clearCommandsOnShutdown();
  process.exit(0);
  } finally {
    _shutdownInProgress = false;
    clearTimeout(hardExitTimer);
  }
}
