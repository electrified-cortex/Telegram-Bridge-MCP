/**
 * Spike: SSE notification endpoint — GET /sse?token=<num>
 *
 * Opens a server-sent events stream per session. Fires `data: kick\n\n`
 * whenever a new event is enqueued for that session, so agents running
 * `curl -N` as a Monitor tool command wake up without a shared filesystem.
 *
 * Auth: session token integer via ?token=N (same convention as /dequeue).
 * Spike only — the connection map is in-memory and not durable across restarts.
 */
import type { Request, Response, Express } from "express";
import { decodeToken } from "./tools/identity-schema.js";
import { validateSession, getDequeueDefault, setDequeueDefault } from "./session-manager.js";
import { DIGITS_ONLY } from "./utils/patterns.js";

/** sid → active SSE response */
const _connections = new Map<number, Response>();

/**
 * Fire `data: kick` to the open SSE connection for the given session, if any.
 * No-op when no connection is registered. No cooldown — the caller's dequeue
 * will be empty if there is nothing to read; extra notifications are harmless.
 */
export function notifySseSubscriber(sid: number): void {
  const res = _connections.get(sid);
  if (!res) return;
  try {
    res.write("data: kick\n\n");
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

    _connections.set(sid, res);
    process.stderr.write(`[sse] connection opened sid=${sid}\n`);

    const priorDefault = getDequeueDefault(sid);
    if (priorDefault > 90) {
      setDequeueDefault(sid, 90);
    }

    req.on("close", () => {
      if (_connections.get(sid) === res) {
        _connections.delete(sid);
        if (priorDefault > 90) {
          setDequeueDefault(sid, priorDefault);
        }
        process.stderr.write(`[sse] connection closed sid=${sid}\n`);
      }
    });
  });
}
