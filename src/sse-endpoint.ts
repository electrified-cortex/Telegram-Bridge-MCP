/**
 * Spike: SSE notification endpoint — GET /sse?token=<num>
 *
 * Opens a server-sent events stream per session. Fires `data: notify\n\n`
 * whenever a new event is enqueued for that session, so agents running
 * `curl -N` as a Monitor tool command wake up without a shared filesystem.
 *
 * Auth: session token integer via ?token=N (same convention as /dequeue).
 * Spike only — the connection map is in-memory and not durable across restarts.
 */
import type { Request, Response, Express } from "express";
import { decodeToken } from "./tools/identity-schema.js";
import { validateSession, getDequeueDefault, setDequeueDefault } from "./session-manager.js";
import { registerSseMonitor, unregisterSseMonitor, resetNotifyGateState } from "./tools/activity/file-state.js";
import { hasAnyPendingContent } from "./session-queue.js";
import { DIGITS_ONLY } from "./utils/patterns.js";

/** sid → active SSE response */
const _connections = new Map<number, Response>();

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
  unregisterSseMonitor(sid);
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
    // Bring this SSE stream under the shared notify gate so it is debounced /
    // re-notified exactly like an activity-file monitor (and so notifications reach
    // it at all when no activity file is registered).
    registerSseMonitor(sid);
    // Clear any stale lockout from the prior connection so the fresh connection
    // starts with an unblocked gate (F-3: stale lockout on reconnect).
    resetNotifyGateState(sid);
    process.stderr.write(`[sse] connection opened sid=${sid}\n`);

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
          unregisterSseMonitor(sid);
        }
      } else {
        // Socket is already closed — Node.js res.write() after writableEnded returns
        // false silently (no throw), so the catch above never fires. Clean up here
        // rather than waiting for req 'close' to fire (half-open socket guard).
        clearInterval(keepaliveTimer);
        _connections.delete(sid);
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
        unregisterSseMonitor(sid);
        // dequeueDefault stays at 90 — operator-directed: once SSE sets it, it stays.
        process.stderr.write(`[sse] connection closed sid=${sid}\n`);
      }
    });
  });
}
