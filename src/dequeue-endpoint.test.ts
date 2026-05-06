/**
 * Unit tests for the GET|POST /dequeue REST endpoint handler.
 *
 * Tests exercise handleHttpDequeue() directly (no HTTP server required)
 * to cover: valid requests, auth failures, invalid max_wait values, and
 * the session_closed passthrough from runDrainLoop.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  decodeToken: vi.fn((_token: number): { sid: number; suffix: number } => ({ sid: 1, suffix: 123456 })),
  validateSession: vi.fn((_sid: number, _suffix: number): boolean => true),
  getDequeueDefault: vi.fn((_sid: number): number => 300),
  runDrainLoop: vi.fn(
    async (_sid: number, _timeout: number, _signal: AbortSignal, _responseFormat?: "default" | "compact"): Promise<Record<string, unknown>> =>
      Promise.resolve({ updates: [], empty: true, pending: 0 }),
  ),
}));

vi.mock("./tools/identity-schema.js", () => ({
  decodeToken: (token: number) => mocks.decodeToken(token),
}));

vi.mock("./session-manager.js", () => ({
  validateSession: (sid: number, suffix: number) => mocks.validateSession(sid, suffix),
  getDequeueDefault: (sid: number) => mocks.getDequeueDefault(sid),
}));

vi.mock("./tools/dequeue.js", () => ({
  runDrainLoop: (sid: number, timeout: number, signal: AbortSignal, responseFormat?: "default" | "compact") =>
    mocks.runDrainLoop(sid, timeout, signal, responseFormat),
}));

import { handleHttpDequeue } from "./dequeue-endpoint.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Token: sid=1, suffix=123456 → token = 1_123_456
const VALID_TOKEN = "1123456";
const VALID_TOKEN_NUM = 1_123_456;

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET|POST /dequeue handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decodeToken.mockReturnValue({ sid: 1, suffix: 123456 });
    mocks.validateSession.mockReturnValue(true);
    mocks.getDequeueDefault.mockReturnValue(300);
    mocks.runDrainLoop.mockResolvedValue({ updates: [], empty: true, pending: 0 });
  });

  // ── 401: missing / invalid token ──────────────────────────────────────────

  it("returns 401 when token is absent from query and body", async () => {
    const [status, body] = await handleHttpDequeue(undefined, {}, makeSignal());
    expect(status).toBe(401);
    expect((body as { ok: boolean }).ok).toBe(false);
    expect((body as { error: string }).error).toBe("token is required");
  });

  it("returns 401 when token is empty string", async () => {
    const [status, body] = await handleHttpDequeue("", {}, makeSignal());
    expect(status).toBe(401);
    expect((body as { ok: boolean }).ok).toBe(false);
  });

  it("returns 401 when token is non-numeric string", async () => {
    const [status] = await handleHttpDequeue("notanumber", {}, makeSignal());
    expect(status).toBe(401);
  });

  it("returns 401 when validateSession fails (AUTH_FAILED)", async () => {
    mocks.validateSession.mockReturnValue(false);
    const [status, body] = await handleHttpDequeue(VALID_TOKEN, {}, makeSignal());
    expect(status).toBe(401);
    expect((body as { error: string }).error).toBe("AUTH_FAILED");
  });

  it("uses body token when query token is absent", async () => {
    const [status] = await handleHttpDequeue(undefined, { token: VALID_TOKEN_NUM }, makeSignal());
    expect(status).toBe(200);
    expect(mocks.decodeToken).toHaveBeenCalledWith(VALID_TOKEN_NUM);
  });

  it("query token takes precedence over body token", async () => {
    mocks.decodeToken.mockImplementation((token: number) => {
      if (token === VALID_TOKEN_NUM) return { sid: 1, suffix: 123456 };
      return { sid: 99, suffix: 0 };
    });
    const [status] = await handleHttpDequeue(VALID_TOKEN, { token: 99_000_000 }, makeSignal());
    expect(status).toBe(200);
    // Decoded with query token (VALID_TOKEN_NUM = 1_123_456), not body token
    expect(mocks.decodeToken).toHaveBeenCalledWith(VALID_TOKEN_NUM);
  });

  // ── 400: invalid max_wait ─────────────────────────────────────────────────

  it("returns 400 when max_wait is a non-numeric string", async () => {
    const [status, body] = await handleHttpDequeue(VALID_TOKEN, { max_wait: "abc" }, makeSignal());
    expect(status).toBe(400);
    expect((body as { error: string }).error).toContain("max_wait");
  });

  it("returns 400 when max_wait is negative", async () => {
    const [status] = await handleHttpDequeue(VALID_TOKEN, { max_wait: -1 }, makeSignal());
    expect(status).toBe(400);
  });

  it("returns 400 when max_wait exceeds 300", async () => {
    const [status, body] = await handleHttpDequeue(VALID_TOKEN, { max_wait: 301 }, makeSignal());
    expect(status).toBe(400);
    expect((body as { error: string }).error).toContain("max_wait");
  });

  it("returns 400 when max_wait is a non-integer float", async () => {
    const [status] = await handleHttpDequeue(VALID_TOKEN, { max_wait: 1.5 }, makeSignal());
    expect(status).toBe(400);
  });

  // ── 200: valid token + updates ────────────────────────────────────────────

  it("returns 200 with updates array when runDrainLoop returns updates", async () => {
    mocks.runDrainLoop.mockResolvedValue({
      updates: [{ id: 1, event: "message", from: "user", content: { type: "text", text: "hello" }, routing: "ambiguous" }],
    });
    const [status, body] = await handleHttpDequeue(VALID_TOKEN, {}, makeSignal());
    expect(status).toBe(200);
    const updates = (body as { updates: unknown[] }).updates;
    expect(Array.isArray(updates)).toBe(true);
    expect(updates).toHaveLength(1);
  });

  it("returns 200 with empty payload on instant poll (max_wait: 0)", async () => {
    mocks.runDrainLoop.mockResolvedValue({ empty: true, pending: 0 });
    const [status, body] = await handleHttpDequeue(VALID_TOKEN, { max_wait: 0 }, makeSignal());
    expect(status).toBe(200);
    expect((body as { empty: boolean }).empty).toBe(true);
    expect((body as { pending: number }).pending).toBe(0);
    // runDrainLoop called with timeout=0
    expect(mocks.runDrainLoop).toHaveBeenCalledWith(1, 0, expect.any(Object), undefined);
  });

  it("uses session default timeout when max_wait is omitted", async () => {
    mocks.getDequeueDefault.mockReturnValue(120);
    mocks.runDrainLoop.mockResolvedValue({ timed_out: true });
    await handleHttpDequeue(VALID_TOKEN, {}, makeSignal());
    expect(mocks.runDrainLoop).toHaveBeenCalledWith(1, 120, expect.any(Object), undefined);
  });

  it("accepts max_wait as numeric string from query (e.g. GET ?max_wait=30)", async () => {
    mocks.runDrainLoop.mockResolvedValue({ timed_out: true });
    const [status] = await handleHttpDequeue(VALID_TOKEN, { max_wait: "30" }, makeSignal());
    expect(status).toBe(200);
    expect(mocks.runDrainLoop).toHaveBeenCalledWith(1, 30, expect.any(Object), undefined);
  });

  // ── session_closed passthrough ────────────────────────────────────────────

  it("returns 200 with session_closed payload when session has ended", async () => {
    mocks.runDrainLoop.mockResolvedValue({
      error: "session_closed",
      message: "Session 1 has ended. Call action(type: 'session/start', ...) to open a new session if needed.",
    });
    const [status, body] = await handleHttpDequeue(VALID_TOKEN, {}, makeSignal());
    expect(status).toBe(200);
    expect((body as { error: string }).error).toBe("session_closed");
    expect(typeof (body as { message: string }).message).toBe("string");
  });

  // ── numeric token in body ─────────────────────────────────────────────────

  it("accepts token as integer number in body", async () => {
    const [status] = await handleHttpDequeue(undefined, { token: VALID_TOKEN_NUM }, makeSignal());
    expect(status).toBe(200);
  });

  it("passes the AbortSignal through to runDrainLoop", async () => {
    const controller = new AbortController();
    await handleHttpDequeue(VALID_TOKEN, {}, controller.signal);
    expect(mocks.runDrainLoop).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      controller.signal,
      undefined,
    );
  });
});
