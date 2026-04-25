/**
 * Integration tests for POST /event.
 *
 * NO vi.mock for validateSession or handlePostEvent.
 * The real session-manager and event-endpoint modules are exercised
 * through their actual module resolution chains.
 *
 * Only mocked:
 *   - appendFile / mkdirSync      — avoids real filesystem I/O
 *   - deliverServiceMessage       — avoids real session-queue state
 *   - getGovernorSid              — controls governor identity per test
 *   - startAnimation              — avoids real Telegram bot API calls
 *   - cancelAnimation             — avoids real animation state
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "node:http";

// ── Module-level mocks (I/O surface only) ────────────────────────────────────

vi.mock("fs/promises", () => ({
  appendFile: vi.fn(() => Promise.resolve()),
}));

vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
}));

vi.mock("./session-queue.js", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, deliverServiceMessage: vi.fn().mockReturnValue(true) };
});

vi.mock("./routing-mode.js", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, getGovernorSid: vi.fn().mockReturnValue(0) };
});

vi.mock("./animation-state.js", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    startAnimation: vi.fn().mockResolvedValue(undefined),
    cancelAnimation: vi.fn().mockResolvedValue({ cancelled: true }),
  };
});

vi.mock("./telegram.js", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, resolveChat: vi.fn().mockReturnValue(12345) };
});

// ── Imports (real modules for session + event endpoint) ───────────────────────

import { attachEventRoute } from "./event-endpoint.js";
import { createSession, resetSessions } from "./session-manager.js";
import { deliverServiceMessage } from "./session-queue.js";
import { getGovernorSid } from "./routing-mode.js";
import { startAnimation, cancelAnimation } from "./animation-state.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function startServer(app: Parameters<typeof http.createServer>[0]): Promise<{ server: http.Server; port: number }> {
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
  return new Promise((resolve, reject) =>
    server.close((err) => { if (err) reject(err); else resolve(); }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /event — integration", () => {
  let server: http.Server;
  let port: number;
  let token: number;

  beforeEach(async () => {
    vi.clearAllMocks();

    resetSessions();

    const { sid, suffix } = createSession("integration-test");
    token = sid * 1_000_000 + suffix;

    const { createMcpExpressApp } = await import("@modelcontextprotocol/sdk/server/express.js");
    const app = createMcpExpressApp({ host: "127.0.0.1" });
    attachEventRoute(app);

    ({ server, port } = await startServer(app));
  });

  afterEach(async () => {
    await closeServer(server);
    resetSessions();
  });

  it("fans out event to all active sessions via real handler chain", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, kind: "startup" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; fanout: number };
    expect(body.ok).toBe(true);
    expect(typeof body.fanout).toBe("number");
    expect(deliverServiceMessage).toHaveBeenCalled();
  });

  it("rejects invalid token with 401 via real session store", async () => {
    const bogusToken = 9_999_999;
    const res = await fetch(`http://127.0.0.1:${port}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: bogusToken, kind: "startup" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
    expect(deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("rejects unknown kind with 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, kind: "not_a_real_kind" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("unknown kind");
    expect(deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("accepts token via ?token= query param", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/event?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "compacting" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("triggers show animation when actor is governor and kind is compacting", async () => {
    // Make this session the governor
    const { sid } = createSession("governor-test");
    const govToken = sid * 1_000_000 + 1; // won't validate — use real token below
    void govToken;

    // Directly set governor to the token's SID (SID 1 from createSession above)
    vi.mocked(getGovernorSid).mockReturnValue(sid);

    // Create a new session so the token's SID == governorSid
    resetSessions();
    const { sid: gSid, suffix: gSuffix } = createSession("gov");
    const govValidToken = gSid * 1_000_000 + gSuffix;
    vi.mocked(getGovernorSid).mockReturnValue(gSid);

    const res = await fetch(`http://127.0.0.1:${port}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: govValidToken, kind: "compacting" }),
    });

    expect(res.status).toBe(200);
    expect(startAnimation).toHaveBeenCalled();
  });

  it("triggers cancel animation when actor is governor and kind is compacted", async () => {
    resetSessions();
    const { sid, suffix } = createSession("gov");
    const govToken = sid * 1_000_000 + suffix;
    vi.mocked(getGovernorSid).mockReturnValue(sid);

    const res = await fetch(`http://127.0.0.1:${port}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: govToken, kind: "compacted" }),
    });

    expect(res.status).toBe(200);
    expect(cancelAnimation).toHaveBeenCalled();
    expect(startAnimation).not.toHaveBeenCalled();
  });
});
