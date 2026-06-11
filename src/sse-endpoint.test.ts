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

import { attachSseRoute, notifySseSubscriber } from "./sse-endpoint.js";
import { notifySession } from "./tools/notify.js";
import { resetActivityFileStateForTest } from "./tools/activity/file-state.js";
import { createSession, resetSessions, getDequeueDefault, setDequeueDefault } from "./session-manager.js";

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

/** Collect up to `count` SSE data lines within `timeoutMs`. Closes the stream when done. */
async function collectSseLines(url: string, count: number, timeoutMs = 2000): Promise<string[]> {
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
          if (p.startsWith("data:")) lines.push(p.trim());
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

  it("delivers data: kick to an open SSE connection when notifySseSubscriber fires", async () => {
    const collectPromise = collectSseLines(`http://127.0.0.1:${port}/sse?token=${token}`, 1);

    // Give the connection time to register
    await new Promise(r => setTimeout(r, 60));

    notifySseSubscriber(sid);

    const lines = await collectPromise;
    expect(lines).toContain("data: kick");
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
    it("AC-10a: default > 90 → capped to 90 on connect, restored on close", async () => {
      // Server default is 300s — verify it's > 90 before connecting
      expect(getDequeueDefault(sid)).toBeGreaterThan(90);
      const prior = getDequeueDefault(sid);

      const ac = new AbortController();
      fetch(`http://127.0.0.1:${port}/sse?token=${token}`, { signal: ac.signal }).catch(() => {});

      // Wait for connection to register and cap to apply
      await new Promise(r => setTimeout(r, 80));
      expect(getDequeueDefault(sid)).toBe(90);

      // Close the SSE connection and wait for the close event to propagate
      ac.abort();
      await new Promise(r => setTimeout(r, 80));

      // Prior default should be restored
      expect(getDequeueDefault(sid)).toBe(prior);
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

  // ── Gate parity: SSE stream with NO activity file ────────────────────────
  // Regression guard for the bug where an SSE-only session (activity/listen,
  // no activity/file) received `: connected` but never a single `data: kick`,
  // because notifySession routed through notifyIfAllowed which declined any
  // session without an activity-file gate entry. These exercise the REAL
  // dispatch (notifySession → notifyIfAllowed → notifySseSubscriber) end to end,
  // not the mocked seam.
  describe("gate parity (no activity file registered)", () => {
    it("delivers data: kick on a real enqueue when only an SSE monitor exists", async () => {
      const collectPromise = collectSseLines(`http://127.0.0.1:${port}/sse?token=${token}`, 1);

      // Let the connection register (route calls registerSseMonitor).
      await new Promise(r => setTimeout(r, 60));

      notifySession(sid, "operator", false);

      const lines = await collectPromise;
      expect(lines).toContain("data: kick");
    });

    it("debounces a burst to exactly one kick (parity with the file monitor)", async () => {
      const collectPromise = collectSseLines(`http://127.0.0.1:${port}/sse?token=${token}`, 5, 350);

      await new Promise(r => setTimeout(r, 60));

      // Five enqueues with no dequeue between them → one outstanding kick.
      for (let i = 0; i < 5; i++) notifySession(sid, "operator", false);

      const lines = await collectPromise;
      expect(lines.filter(l => l === "data: kick")).toHaveLength(1);
    });
  });
});
