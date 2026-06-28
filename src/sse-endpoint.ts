/**
 * SSE notification endpoint — GET /sse?token=<num>
 *
 * Opens a server-sent events stream per session. Fires `data: notify\n\n`
 * whenever a new event is enqueued for that session, so agents running
 * the filtered sse-monitor.sh script (via Monitor tool) wake up without a
 * shared filesystem.
 *
 * Auth: session token integer via ?token=N (same convention as /dequeue).
 * Connection map is in-memory and not durable across restarts.
 *
 * Also serves GET /tools/sse-monitor.sh (read-only) so participants without
 * a repo checkout can download the filtered monitor script.
 */
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type { Request, Response, Express } from "express";
import { decodeToken } from "./tools/identity-schema.js";
import { validateSession, getDequeueDefault, setDequeueDefault } from "./session-manager.js";
import { registerSseMonitor, unregisterSseMonitor, resetNotifyGateState } from "./tools/activity/file-state.js";
import { resetDequeuePatternNudgeForSession } from "./tools/dequeue.js";
import { hasAnyPendingContent, deliverServiceMessage } from "./session-queue.js";
import { SERVICE_MESSAGES } from "./service-messages.js";
import { DIGITS_ONLY } from "./utils/patterns.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Absolute path to tools/sse-monitor.sh relative to this compiled file (src → repo root). */
const _sseMonitorPath = resolve(__dirname, "..", "tools", "sse-monitor.sh");

/** sid → active SSE response */
const _connections = new Map<number, Response>();

/**
 * Tracks which sids have already received the ONBOARDING_PARTICIPATING message.
 * Fires once per session, not per reconnect — monitors auto-reconnect on network
 * drops/restarts/post-compaction, so without this guard the message would spam
 * every time the SSE stream re-opens.
 * Cleared on cancelSseConnection (genuine teardown) so a truly new participation
 * re-confirms after a real session end.
 */
const _onboardingParticipatingFired = new Set<number>();

/**
 * sid → pending arm-reminder timer handle.
 *
 * Seeded by scheduleArmReminder() when activity/listen returns a subscription
 * URL. Cancelled when the SSE connection actually opens. If it fires (~45 s),
 * a gentle ONBOARDING_ARM_REMINDER service message is delivered once.
 */
const _armReminderTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Arm-reminder delay (ms). One reminder, then silence. */
const ARM_REMINDER_DELAY_MS = 45_000;

/**
 * Schedule a one-shot arm reminder for the given session.
 *
 * Call this immediately after returning the activity/listen response. If the
 * participant arms the Monitor tool within ARM_REMINDER_DELAY_MS, the SSE
 * connection open cancels the timer before it fires (no message sent). If they
 * don't, one gentle reminder is delivered.
 *
 * Idempotent: re-calling resets the timer (each listen call gets one window).
 */
export function scheduleArmReminder(sid: number, command: string): void {
  // Cancel any existing timer for this sid
  const existing = _armReminderTimers.get(sid);
  if (existing !== undefined) {
    clearTimeout(existing);
  }

  const handle = setTimeout(() => {
    _armReminderTimers.delete(sid);
    // Only fire if the SSE connection is still NOT open
    if (!_connections.has(sid)) {
      deliverServiceMessage(
        sid,
        SERVICE_MESSAGES.ONBOARDING_ARM_REMINDER.text(command),
        SERVICE_MESSAGES.ONBOARDING_ARM_REMINDER.eventType,
      );
    }
  }, ARM_REMINDER_DELAY_MS);

  _armReminderTimers.set(sid, handle);
}

/**
 * Returns true when an open SSE connection is registered for the given session.
 * Used by health-check endpoints to distinguish "no SSE armed" from a write error.
 */
export function hasSseConnection(sid: number): boolean {
  return _connections.has(sid);
}

/**
 * Fire `data: notify` to the open SSE connection for the given session, if any.
 * No-op when no connection is registered. No cooldown — the caller's dequeue
 * will be empty if there is nothing to read; extra notifications are harmless.
 */
export function notifySseSubscriber(sid: number): void {
  const res = _connections.get(sid);
  if (!res) return;
  try {
    res.write("data: notify\n\n");
  } catch {
    _connections.delete(sid);
    // Emit fail-hard exit signal before dropping — agent wakes immediately
    try { res.write("data: MONITOR_EXIT reason=subscription_closed_unexpectedly action=re-arm\n\n"); } catch {}
    unregisterSseMonitor(sid);
  }
}

/**
 * Close the open SSE connection for the given session.
 * Sends `data: cancelled` before closing so the client can exit cleanly.
 * Idempotent — no-op when no connection is registered.
 */
export function cancelSseConnection(sid: number): void {
  const res = _connections.get(sid);
  _connections.delete(sid);
  // Deleting from _connections above makes the req-close guard a no-op, so drop
  // this stream's gate membership here instead.
  // Pass expected=true — this is an intentional cancel, not an unexpected drop.
  unregisterSseMonitor(sid, true);
  // Cancel any pending arm-reminder for this sid — session is being torn down so
  // the reminder must not fire after the session is gone.
  const reminderTimer = _armReminderTimers.get(sid);
  if (reminderTimer !== undefined) {
    clearTimeout(reminderTimer);
    _armReminderTimers.delete(sid);
  }
  // Clear the once-per-session participation guard so a genuinely new connection
  // after a real teardown re-sends the confirmation.
  _onboardingParticipatingFired.delete(sid);
  if (!res) return;
  try {
    res.write("data: cancelled\n\n");
    res.end();
  } catch {
    // ignore — connection may have already closed
  }
  process.stderr.write(`[sse] connection cancelled sid=${sid}\n`);
}

export function attachSseRoute(app: Express): void {
  // ── GET /tools/sse-monitor.sh — serve the filtered SSE monitor script ──────
  // Read-only, no auth required. Allows participants without a repo checkout to
  // download the heartbeat-filtering wrapper before arming the Monitor tool.
  app.get("/tools/sse-monitor.sh", (_req: Request, res: Response) => {
    try {
      const contents = readFileSync(_sseMonitorPath, "utf-8");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="sse-monitor.sh"');
      res.status(200).send(contents);
    } catch {
      res.status(503).json({ ok: false, error: "sse-monitor.sh not available on this server" });
    }
  });

  app.get("/sse", (req: Request, res: Response) => {
    const rawToken = req.query.token;
    if (!rawToken || typeof rawToken !== "string" || !DIGITS_ONLY.test(rawToken)) {
      res.status(401).json({ ok: false, error: "token is required" });
      return;
    }
    const tokenNum = parseInt(rawToken, 10);
    if (!Number.isInteger(tokenNum) || tokenNum <= 0) {
      res.status(401).json({ ok: false, error: "invalid token" });
      return;
    }

    const { sid, suffix } = decodeToken(tokenNum);
    if (!validateSession(sid, suffix)) {
      res.status(401).json({ ok: false, error: "AUTH_FAILED" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");

    // _connections.set before the EC-1 notify check is intentional: the post-check
    // window is safe because Node.js is single-threaded — no await between .set
    // and the hasPendingContent check, so no concurrent enqueue can slip in.
    _connections.set(sid, res);
    // Cancel any pending arm-reminder for this sid — participant has connected.
    const pendingReminder = _armReminderTimers.get(sid);
    if (pendingReminder !== undefined) {
      clearTimeout(pendingReminder);
      _armReminderTimers.delete(sid);
    }
    // Bring this SSE stream under the shared notify gate so it is debounced /
    // re-notified exactly like an activity-file monitor (and so notifications reach
    // it at all when no activity file is registered).
    registerSseMonitor(sid);
    // Re-arm the dequeue-pattern nudge — fresh subscription means the agent
    // may need to be reminded again if the bad polling pattern recurs (10-3028).
    resetDequeuePatternNudgeForSession(sid);
    // Clear any stale debounce from the prior connection so the fresh connection
    // starts with an unblocked gate (F-3: stale debounce on reconnect).
    resetNotifyGateState(sid);
    process.stderr.write(`[sse] connection opened sid=${sid}\n`);

    // Onboarding handshake — fires once per session, not per reconnect. Monitors
    // auto-reconnect on network drops/restarts/post-compaction; without the guard
    // this message would re-fire on every reconnect and spam the participant.
    // Uses source "service" + inflightAtEnqueue=false so it is enqueued and
    // notified immediately. The SSE stream itself is up at this point, so the
    // agent will see this on its first dequeue.
    if (!_onboardingParticipatingFired.has(sid)) {
      _onboardingParticipatingFired.add(sid);
      deliverServiceMessage(sid, SERVICE_MESSAGES.ONBOARDING_PARTICIPATING);
    }

    // EC-1: re-arm race fix — if messages arrived during the gap between the
    // prior monitor exiting and this connection registering, the enqueue-time
    // notifySseSubscriber was a no-op (no connection registered). Notify the
    // freshly-connected monitor immediately so a subsequent /dequeue would drain
    // at least one item. Uses hasAnyPendingContent (not hasPendingUserContent) so
    // lightweight-only queues (direct_message, callback, etc.) also trigger a notify.
    // DELIBERATE gate bypass: this notify goes directly to the wire without going
    // through notifyIfAllowed so it always fires on connect; the gate arms on the
    // first post-connect inbound event instead.
    // NOTE: keepaliveTimer is assigned after this block; early-return here is safe
    // because no timer has been set yet and there is nothing to clean up.
    if (hasAnyPendingContent(sid)) {
      try {
        res.write("data: notify\n\n");
      } catch {
        _connections.delete(sid);
        // Emit fail-hard exit signal before dropping — agent wakes immediately
        try { res.write("data: MONITOR_EXIT reason=subscription_closed_unexpectedly action=re-arm\n\n"); } catch {}
        unregisterSseMonitor(sid);
        return;
      }
    }

    // EC-2: keepalive — periodic SSE comment pings prevent half-open TCP sockets
    // from silently buffering writes. Mirrors the guard pattern in index.ts:213-217.
    const keepaliveTimer = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        try {
          res.write(": keepalive\n\n");
        } catch {
          clearInterval(keepaliveTimer);
          _connections.delete(sid);
          // Emit fail-hard exit signal before dropping — agent wakes immediately
          try { res.write("data: MONITOR_EXIT reason=subscription_closed_unexpectedly action=re-arm\n\n"); } catch {}
          unregisterSseMonitor(sid);
        }
      } else {
        // Socket is already closed — Node.js res.write() after writableEnded returns
        // false silently (no throw), so the catch above never fires. Clean up here
        // rather than waiting for req 'close' to fire (half-open socket guard).
        clearInterval(keepaliveTimer);
        _connections.delete(sid);
        // Emit fail-hard exit signal before dropping — agent wakes immediately
        try { res.write("data: MONITOR_EXIT reason=subscription_closed_unexpectedly action=re-arm\n\n"); } catch {}
        unregisterSseMonitor(sid);
      }
    }, 30_000);

    if (getDequeueDefault(sid) > 90) {
      setDequeueDefault(sid, 90);
    }

    req.on("close", () => {
      // clearInterval is unconditional — this response's timer must always be
      // cleared regardless of whether a newer connection has replaced this one
      // in _connections (the identity guard below governs _connections cleanup).
      clearInterval(keepaliveTimer);
      if (_connections.get(sid) === res) {
        _connections.delete(sid);
        // Emit fail-hard exit signal before dropping — agent wakes immediately
        try { res.write("data: MONITOR_EXIT reason=subscription_closed_unexpectedly action=re-arm\n\n"); } catch {}
        unregisterSseMonitor(sid);
        // dequeueDefault stays at 90 — operator-directed: once SSE sets it, it stays.
        process.stderr.write(`[sse] connection closed sid=${sid}\n`);
      }
    });
  });
}
