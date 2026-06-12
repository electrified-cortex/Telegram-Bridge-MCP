/**
 * Integration tests for GET /sse?token=<num>
 *
 * Spins up a real Express server (random port) using createMcpExpressApp
 * with real session-manager state, no Telegram credentials needed.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "node:http";

// Mock only the modules that reach the Telegram bot API
vi.mock("./telegram.js", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, resolveChat: vi.fn().mockReturnValue(12345) };
});

import { attachSseRoute, notifySseSubscriber, cancelSseConnection } from "./sse-endpoint.js";
import { notifySession } from "./tools/notify.js";
import { resetActivityFileStateForTest } from "./tools/activity/file-state.js";
import { createSession, resetSessions, getDequeueDefault, setDequeueDefault } from "./session-manager.js";
import { createSessionQueue, getSessionQueue, resetSessionQueuesForTest } from "./session-queue.js";
import type { TimelineEvent } from "./message-store.js";

// ── Server helpers ────────────────────────────────────────────────────────────

function startServer(app: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    // Destroy open keep-alive / SSE connections so close() completes promptly.
    server.closeAllConnections?.();
    server.close(err => { if (err) reject(err); else resolve(); });
  });
}

/** Collect up to `count` SSE data lines within `timeoutMs`. Closes the stream when done.
 * Only collects `data:` prefixed lines. Comment lines (`: ...`) are silently dropped.
 * Use collectRawLines when you need to assert on comment lines such as `: keepalive`. */
async function collectSseLines(url: string, count: number, timeoutMs = 2000): Promise<string[]> {
  return collectRawLines(url, count, timeoutMs, (p) => p.startsWith("data:"));
}

/**
 * Collect up to `count` SSE lines matching `predicate` within `timeoutMs`.
 * When no predicate is supplied, all non-empty lines are collected (including
 * comment lines like `: keepalive` and `: connected`).
 */
async function collectRawLines(
  url: string,
  count: number,
  timeoutMs = 2000,
  predicate: (line: string) => boolean = (p) => p.trim().length > 0,
): Promise<string[]> {
  const lines: string[] = [];
  const ac = new AbortController();
  const timer = setTimeout(() => { ac.abort(); }, timeoutMs);

  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";

    try {
      while (lines.length < count) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n");
        for (const p of parts.slice(0, -1)) {
          if (predicate(p)) lines.push(p.trim());
        }
        buf = parts[parts.length - 1];
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e;
  } finally {
    clearTimeout(timer);
    ac.abort(); // ensure the underlying TCP connection closes
  }
  return lines;
}

// ── Test state ────────────────────────────────────────────────────────────────

describe("GET /sse", () => {
  let server: http.Server;
  let port: number;
  let token: number;
  let sid: number;

  beforeEach(async () => {
    resetSessions();
    const session = createSession("sse-test");
    sid = session.sid;
    token = sid * 1_000_000 + session.suffix;

    const { createMcpExpressApp } = await import("@modelcontextprotocol/sdk/server/express.js");
    const app = createMcpExpressApp({ host: "127.0.0.1" });
    attachSseRoute(app);
    ({ server, port } = await startServer(app));
  });

  afterEach(async () => {
    await closeServer(server);
    resetActivityFileStateForTest(); // clear gate entries + any armed re-notify timers
    resetSessionQueuesForTest();
    resetSessions();
  });

  it("returns 401 when token param is missing", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/sse`);
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("token is required");
  });

  it("returns 401 when token is non-numeric", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/sse?token=notanumber`);
    expect(res.status).toBe(401);
  });

  it("returns 401 for an unknown session token", async () => {
    const bogusToken = 9_999_999;
    const res = await fetch(`http://127.0.0.1:${port}/sse?token=${bogusToken}`);
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.error).toBe("AUTH_FAILED");
  });

  it("returns 200 with text/event-stream content-type for a valid token", async () => {
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/sse?token=${token}`, { signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    ac.abort();
  });

  it("delivers data: notify to an open SSE connection when notifySseSubscriber fires", async () => {
    const collectPromise = collectSseLines(`http://127.0.0.1:${port}/sse?token=${token}`, 1);

    // Give the connection time to register
    await new Promise(r => setTimeout(r, 60));

    notifySseSubscriber(sid);

    const lines = await collectPromise;
    expect(lines).toContain("data: notify");
  });

  it("does NOT deliver notify when notifySseSubscriber is called for a different sid", async () => {
    const collectPromise = collectSseLines(`http://127.0.0.1:${port}/sse?token=${token}`, 1, 350);

    await new Promise(r => setTimeout(r, 60));
    notifySseSubscriber(sid + 999); // wrong sid

    const lines = await collectPromise;
    expect(lines).toHaveLength(0);
  });

  // ── AC-10a / AC-10b: 90s max_wait cap ────────────────────────────────────

  describe("max_wait cap", () => {
    it("AC-10a: default > 90 → capped to 90 on connect, stays at 90 after close", async () => {
      // Server default is 300s — verify it's > 90 before connecting
      expect(getDequeueDefault(sid)).toBeGreaterThan(90);

      const ac = new AbortController();
      fetch(`http://127.0.0.1:${port}/sse?token=${token}`, { signal: ac.signal }).catch(() => {});

      // Wait for connection to register and cap to apply
      await new Promise(r => setTimeout(r, 80));
      expect(getDequeueDefault(sid)).toBe(90);

      // Close the SSE connection and wait for the close event to propagate
      ac.abort();
      await new Promise(r => setTimeout(r, 80));

      // Operator-directed: dequeueDefault stays at 90 once SSE sets it (no restore on close).
      expect(getDequeueDefault(sid)).toBe(90);
    });

    it("AC-10b: default ≤ 90 → unchanged on connect and close", async () => {
      setDequeueDefault(sid, 60); // explicitly set to ≤ 90
      expect(getDequeueDefault(sid)).toBe(60);

      const ac = new AbortController();
      fetch(`http://127.0.0.1:${port}/sse?token=${token}`, { signal: ac.signal }).catch(() => {});

      // Wait for connection to register
      await new Promise(r => setTimeout(r, 80));
      expect(getDequeueDefault(sid)).toBe(60); // unchanged

      // Close connection
      ac.abort();
      await new Promise(r => setTimeout(r, 80));
      expect(getDequeueDefault(sid)).toBe(60); // still unchanged
    });
  });

  // ── EC-1: re-arm race fix — immediate notify on connect with pending content ─
  describe("EC-1: immediate notify on connect when pending content exists", () => {
    it("emits data: notify immediately when session queue has pending user content at connect time", async () => {
      // Seed the session queue with a pending text message BEFORE the SSE
      // monitor connects — simulating the re-arm race where a message arrived
      // during the gap between monitors.
      createSessionQueue(sid);
      const pendingEvent: TimelineEvent = {
        id: 1,
        timestamp: new Date().toISOString(),
        event: "message",
        from: "user",
        content: { type: "text", text: "hello while disconnected" },
      };
      getSessionQueue(sid)!.enqueue(pendingEvent);

      // Connect; the handler should emit notify without waiting for a new enqueue.
      const lines = await collectSseLines(`http://127.0.0.1:${port}/sse?token=${token}`, 1);
      expect(lines).toContain("data: notify");
    });

    it("does NOT emit an immediate notify when session queue is empty at connect time", async () => {
      // No pending content — only the `: connected` comment is written; no notify.
      const lines = await collectSseLines(`http://127.0.0.1:${port}/sse?token=${token}`, 1, 250);
      expect(lines.filter(l => l === "data: notify")).toHaveLength(0);
    });
  });

  // ── Gate parity: SSE stream with NO activity file ────────────────────────
  // Regression guard for the bug where an SSE-only session (activity/listen,
  // no activity/file) received `: connected` but never a single `data: notify`,
  // because notifySession routed through notifyIfAllowed which declined any
  // session without an activity-file gate entry. These exercise the REAL
  // dispatch (notifySession → notifyIfAllowed → notifySseSubscriber) end to end,
  // not the mocked seam.
  describe("gate parity (no activity file registered)", () => {
    it("delivers data: notify on a real enqueue when only an SSE monitor exists", async () => {
      const collectPromise = collectSseLines(`http://127.0.0.1:${port}/sse?token=${token}`, 1);

      // Let the connection register (route calls registerSseMonitor).
      await new Promise(r => setTimeout(r, 60));

      notifySession(sid, "operator", false);

      const lines = await collectPromise;
      expect(lines).toContain("data: notify");
    });

    it("debounces a burst to exactly one notify (parity with the file monitor)", async () => {
      const collectPromise = collectSseLines(`http://127.0.0.1:${port}/sse?token=${token}`, 5, 350);

      await new Promise(r => setTimeout(r, 60));

      // Five enqueues with no dequeue between them → one outstanding notify.
      for (let i = 0; i < 5; i++) notifySession(sid, "operator", false);

      const lines = await collectPromise;
      expect(lines.filter(l => l === "data: notify")).toHaveLength(1);
    });
  });

  // ── EC-2: keepalive timer coverage ───────────────────────────────────────
  // Use targeted fake timers: fake only setInterval/clearInterval so the
  // real HTTP I/O (fetch, setTimeout in test helpers) keeps working.
  describe("EC-2: keepalive timer", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("(a) 30s tick writes ': keepalive' to the stream", async () => {
      // collectRawLines includes comment lines; keepalive is ': keepalive'.
      // The stream is opened AFTER fake timers are active so setInterval is intercepted.
      const collectPromise = collectRawLines(
        `http://127.0.0.1:${port}/sse?token=${token}`,
        1, // stop after the first matching line
        5000,
        (p) => p.trim() === ": keepalive",
      );

      // Give the HTTP connection time to register (real setTimeout still works).
      await new Promise(r => setTimeout(r, 80));

      // Advance fake clock past the 30s keepalive interval; the setInterval
      // callback fires synchronously, writes ': keepalive' to the socket.
      vi.advanceTimersByTime(30_001);

      const lines = await collectPromise;
      expect(lines).toContain(": keepalive");
    });

    it("(b) timer is cleared on req 'close' — no further writes after disconnect", async () => {
      // Collect keepalive lines via raw stream.
      const collectPromise = collectRawLines(
        `http://127.0.0.1:${port}/sse?token=${token}`,
        2, // try to collect 2; timeout will fire after 1 if timer is cleared
        3000,
        (p) => p.trim() === ": keepalive",
      );

      await new Promise(r => setTimeout(r, 80));

      // Advance 30s → first keepalive fires.
      vi.advanceTimersByTime(30_001);

      // Close the connection via cancelSseConnection, which calls res.end() and
      // removes sid from _connections. The req 'close' event fires shortly after.
      cancelSseConnection(sid);
      await new Promise(r => setTimeout(r, 80));

      // Advance another 30s — if the interval was cleared, no second keepalive fires.
      vi.advanceTimersByTime(30_001);

      // collectRawLines will time out waiting for the 2nd line since the timer is gone.
      const lines = await collectPromise;
      // Exactly one keepalive fired before the connection was closed.
      expect(lines).toHaveLength(1);
    });

    it("(c) write failure in keepalive cleans up _connections and gate", async () => {
      // Open a real connection so sid is registered in _connections.
      const ac = new AbortController();
      fetch(`http://127.0.0.1:${port}/sse?token=${token}`, { signal: ac.signal }).catch(() => {});

      // Give the connection time to register.
      await new Promise(r => setTimeout(r, 80));

      // Abort the client fetch — this triggers the TCP close on the server side,
      // setting res.writableEnded = true before the keepalive tick.
      ac.abort();
      await new Promise(r => setTimeout(r, 80));

      // Advance 30s — the keepalive tick fires. With writableEnded=true, the else
      // branch runs: clearInterval, _connections.delete(sid), unregisterSseMonitor.
      vi.advanceTimersByTime(30_001);

      // Allow the interval callback to propagate.
      await new Promise(r => setTimeout(r, 20));

      // After cleanup, notifySseSubscriber should be a no-op (sid gone from _connections).
      expect(() => { notifySseSubscriber(sid); }).not.toThrow();
    });
  });

  // ── EC-1: lightweight-content (direct_message) notify ───────────────────
  describe("EC-1: direct_message-only queue triggers connect notify", () => {
    it("fires data: notify when only direct_message content is pending at connect time", async () => {
      // direct_message events are lightweight and NOT in OPERATOR_MESSAGE_TYPES,
      // so hasPendingUserContent returns false for them. hasAnyPendingContent must
      // return true so the connect-notify fires, because /dequeue will drain the DM.
      createSessionQueue(sid);
      const dmEvent: TimelineEvent = {
        id: -1,
        timestamp: new Date().toISOString(),
        event: "direct_message",
        from: "bot",
        content: { type: "direct_message", text: "hello from peer" },
        sid: 0,
      };
      getSessionQueue(sid)!.enqueue(dmEvent);

      const lines = await collectSseLines(`http://127.0.0.1:${port}/sse?token=${token}`, 1);
      expect(lines).toContain("data: notify");
    });
  });

  // ── EC-1: full lifecycle race (connect→drain→disconnect→enqueue→reconnect) ─
  describe("EC-1: full lifecycle race", () => {
    it("reconnect after enqueue-during-gap emits immediate notify without extra enqueue", async () => {
      // Phase 1: connect and drain (consume the initial empty state).
      const ac1 = new AbortController();
      fetch(`http://127.0.0.1:${port}/sse?token=${token}`, { signal: ac1.signal }).catch(() => {});
      await new Promise(r => setTimeout(r, 80));

      // Phase 2: disconnect.
      ac1.abort();
      await new Promise(r => setTimeout(r, 80));

      // Phase 3: enqueue a message while disconnected (the race gap).
      createSessionQueue(sid);
      const gapEvent: TimelineEvent = {
        id: 42,
        timestamp: new Date().toISOString(),
        event: "message",
        from: "user",
        content: { type: "text", text: "message during gap" },
      };
      getSessionQueue(sid)!.enqueue(gapEvent);

      // Phase 4: reconnect — should get immediate notify (no additional enqueue needed).
      const lines = await collectSseLines(`http://127.0.0.1:${port}/sse?token=${token}`, 1, 500);
      expect(lines).toContain("data: notify");
    });
  });
});
