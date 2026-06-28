/**
 * Tests for GET /activity/listen/check endpoint.
 *
 * Covers:
 *   TC-CHK1. Missing token → 401
 *   TC-CHK2. Non-numeric token → 401
 *   TC-CHK3. Invalid/unknown session token → 401 AUTH_FAILED
 *   TC-CHK4. Valid token, SSE connection open → 200 { subscribed: true }   (AC3)
 *   TC-CHK5. Valid token, no SSE connection   → 200 { subscribed: false }  (AC4)
 *   TC-CHK6. HTTP integration — GET /activity/listen/check over real Express server
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "node:http";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const sessionManagerMocks = vi.hoisted(() => ({
  validateSession: vi.fn((_sid: number, _suffix: number): boolean => true),
}));

const sseEndpointMocks = vi.hoisted(() => ({
  hasSseConnection: vi.fn((_sid: number): boolean => false),
}));

vi.mock("./session-manager.js", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, validateSession: (sid: number, suffix: number) => sessionManagerMocks.validateSession(sid, suffix) };
});

vi.mock("./sse-endpoint.js", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, hasSseConnection: (sid: number) => sseEndpointMocks.hasSseConnection(sid) };
});

import { handleHttpActivityListenCheck, attachActivityListenCheckRoute, ERR_TOKEN_REQUIRED, ERR_INVALID_TOKEN, ERR_AUTH_FAILED } from "./activity-listen-check-endpoint.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

// SID=1, suffix=123456 → token = 1 * 1_000_000 + 123456 = 1_123_456
// decodeToken(1_123_456) → { sid: 1, suffix: 123456 }
const VALID_TOKEN = 1_123_456;

beforeEach(() => {
  vi.clearAllMocks();
  sessionManagerMocks.validateSession.mockReturnValue(true);
  sseEndpointMocks.hasSseConnection.mockReturnValue(false);
});

// ── Unit tests (handleHttpActivityListenCheck) ─────────────────────────────────

describe("TC-CHK1: missing token", () => {
  it("returns 401 when token is undefined", () => {
    const [status, body] = handleHttpActivityListenCheck(undefined);
    expect(status).toBe(401);
    expect((body).error).toBe(ERR_TOKEN_REQUIRED);
  });

  it("returns 401 when token is null", () => {
    const [status] = handleHttpActivityListenCheck(null);
    expect(status).toBe(401);
  });

  it("returns 401 when token is empty string", () => {
    const [status] = handleHttpActivityListenCheck("");
    expect(status).toBe(401);
  });
});

describe("TC-CHK2: non-numeric token", () => {
  it("returns 401 when token is non-numeric string", () => {
    const [status, body] = handleHttpActivityListenCheck("notanumber");
    expect(status).toBe(401);
    expect((body).error).toBe(ERR_INVALID_TOKEN);
  });

  it("returns 401 when token is zero", () => {
    const [status] = handleHttpActivityListenCheck("0");
    expect(status).toBe(401);
  });
});

describe("TC-CHK3: invalid session token", () => {
  it("returns 401 AUTH_FAILED when validateSession returns false", () => {
    sessionManagerMocks.validateSession.mockReturnValue(false);
    const [status, body] = handleHttpActivityListenCheck(VALID_TOKEN);
    expect(status).toBe(401);
    expect((body).error).toBe(ERR_AUTH_FAILED);
  });
});

describe("TC-CHK4: subscribed: true when SSE connection is open (AC3)", () => {
  it("returns 200 { subscribed: true } when hasSseConnection is true", () => {
    sseEndpointMocks.hasSseConnection.mockReturnValue(true);
    const [status, body] = handleHttpActivityListenCheck(VALID_TOKEN);
    expect(status).toBe(200);
    expect((body).subscribed).toBe(true);
  });

  it("returns 200 { subscribed: true } when token is given as digit string", () => {
    sseEndpointMocks.hasSseConnection.mockReturnValue(true);
    const [status, body] = handleHttpActivityListenCheck(String(VALID_TOKEN));
    expect(status).toBe(200);
    expect((body).subscribed).toBe(true);
  });
});

describe("TC-CHK5: subscribed: false when no SSE connection (AC4)", () => {
  it("returns 200 { subscribed: false } when hasSseConnection is false", () => {
    sseEndpointMocks.hasSseConnection.mockReturnValue(false);
    const [status, body] = handleHttpActivityListenCheck(VALID_TOKEN);
    expect(status).toBe(200);
    expect((body).subscribed).toBe(false);
  });
});

// ── Integration test (HTTP server) ────────────────────────────────────────────

describe("TC-CHK6: HTTP integration", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    const { createMcpExpressApp } = await import("@modelcontextprotocol/sdk/server/express.js");
    const app = createMcpExpressApp({ host: "127.0.0.1" });
    attachActivityListenCheckRoute(app);

    await new Promise<void>((resolve, reject) => {
      server = http.createServer(app);
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => { resolve(); });
    });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.closeAllConnections?.();
      server.close(err => { if (err) reject(err); else resolve(); });
    });
  });

  it("returns 401 when token query param is missing", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/activity/listen/check`);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe(ERR_TOKEN_REQUIRED);
  });

  it("returns 401 AUTH_FAILED for an unknown session token", async () => {
    sessionManagerMocks.validateSession.mockReturnValue(false);
    const res = await fetch(`http://127.0.0.1:${port}/activity/listen/check?token=9999999`);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe(ERR_AUTH_FAILED);
  });

  it("returns 200 { subscribed: false } when no SSE connection is open", async () => {
    sseEndpointMocks.hasSseConnection.mockReturnValue(false);
    const res = await fetch(`http://127.0.0.1:${port}/activity/listen/check?token=${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.subscribed).toBe(false);
  });

  it("returns 200 { subscribed: true } when SSE connection is open", async () => {
    sseEndpointMocks.hasSseConnection.mockReturnValue(true);
    const res = await fetch(`http://127.0.0.1:${port}/activity/listen/check?token=${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.subscribed).toBe(true);
  });
});
