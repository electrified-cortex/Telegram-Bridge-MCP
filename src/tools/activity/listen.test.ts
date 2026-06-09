/**
 * Unit tests for activity/listen and activity/listen/cancel handlers.
 *
 * Covers:
 *   TC1. activity/listen — HTTP mode active → returns ok:true with sse_url and command
 *   TC2. activity/listen — HTTP mode not active → HTTP_MODE_REQUIRED error
 *   TC3. activity/listen — auth failure → AUTH_FAILED error
 *   TC4. activity/listen/cancel — connection open → ok:true, connection cancelled
 *   TC5. activity/listen/cancel — no connection open → ok:true (idempotent)
 *   TC6. activity/listen/cancel — auth failure → AUTH_FAILED error
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const gateMocks = vi.hoisted(() => ({
  requireAuth: vi.fn((_token: number | undefined): number | { code: string; message: string } => 1),
}));

const httpModeMocks = vi.hoisted(() => ({
  getSseBaseUrl: vi.fn((): string | null => "http://127.0.0.1:3099"),
}));

const sseEndpointMocks = vi.hoisted(() => ({
  cancelSseConnection: vi.fn((_sid: number): void => {}),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: (token: number | undefined) => gateMocks.requireAuth(token),
}));

vi.mock("../../http-mode.js", () => ({
  getSseBaseUrl: () => httpModeMocks.getSseBaseUrl(),
}));

vi.mock("../../sse-endpoint.js", () => ({
  cancelSseConnection: (sid: number) => { sseEndpointMocks.cancelSseConnection(sid); },
}));

import { handleActivityListen } from "./listen.js";
import { handleActivityListenCancel } from "./cancel-listen.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SID = 42;
const TOKEN = 42_123456;
const AUTH_ERROR = { code: "AUTH_FAILED", message: "Invalid token." };

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function isError(result: { isError?: boolean }) {
  return result.isError === true;
}

// ── Reset between tests ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  gateMocks.requireAuth.mockReturnValue(SID);
  httpModeMocks.getSseBaseUrl.mockReturnValue("http://127.0.0.1:3099");
  sseEndpointMocks.cancelSseConnection.mockReturnValue(undefined);
});

// ── TC1: activity/listen — HTTP mode active ───────────────────────────────────

describe("TC1: activity/listen — HTTP mode active", () => {
  it("returns ok:true with sse_url and command", () => {
    const result = handleActivityListen({ token: TOKEN });
    expect(isError(result as { isError?: boolean })).toBe(false);
    const body = parseResult(result);
    expect(body.ok).toBe(true);
    expect(typeof body.sse_url).toBe("string");
    expect((body.sse_url as string)).toContain(`/sse?token=${TOKEN}`);
    expect(body.command).toBe(`curl -N '${body.sse_url as string}'`);
  });

  it("builds URL from base URL returned by getSseBaseUrl", () => {
    httpModeMocks.getSseBaseUrl.mockReturnValue("http://192.168.1.10:5000");
    const result = handleActivityListen({ token: TOKEN });
    const body = parseResult(result);
    expect(body.sse_url).toBe(`http://192.168.1.10:5000/sse?token=${TOKEN}`);
  });
});

// ── TC2: activity/listen — HTTP mode not active ───────────────────────────────

describe("TC2: activity/listen — HTTP mode not active", () => {
  it("returns HTTP_MODE_REQUIRED error", () => {
    httpModeMocks.getSseBaseUrl.mockReturnValue(null);
    const result = handleActivityListen({ token: TOKEN });
    expect(isError(result as { isError?: boolean })).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("HTTP_MODE_REQUIRED");
  });
});

// ── TC3: activity/listen — auth failure ──────────────────────────────────────

describe("TC3: activity/listen — auth failure", () => {
  it("returns AUTH_FAILED error", () => {
    gateMocks.requireAuth.mockReturnValue(AUTH_ERROR);
    const result = handleActivityListen({ token: 99999 });
    expect(isError(result as { isError?: boolean })).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("AUTH_FAILED");
  });
});

// ── TC4: activity/listen/cancel — connection open ────────────────────────────

describe("TC4: activity/listen/cancel — connection open", () => {
  it("returns ok:true and calls cancelSseConnection with the sid", () => {
    const result = handleActivityListenCancel({ token: TOKEN });
    expect(isError(result as { isError?: boolean })).toBe(false);
    const body = parseResult(result);
    expect(body.ok).toBe(true);
    expect(sseEndpointMocks.cancelSseConnection).toHaveBeenCalledWith(SID);
  });
});

// ── TC5: activity/listen/cancel — no connection open (idempotent) ─────────────

describe("TC5: activity/listen/cancel — idempotent when no connection open", () => {
  it("returns ok:true even when cancelSseConnection is a no-op", () => {
    // cancelSseConnection is already a no-op mock by default
    const result = handleActivityListenCancel({ token: TOKEN });
    expect(isError(result as { isError?: boolean })).toBe(false);
    const body = parseResult(result);
    expect(body.ok).toBe(true);
    expect(sseEndpointMocks.cancelSseConnection).toHaveBeenCalledTimes(1);
  });
});

// ── TC6: activity/listen/cancel — auth failure ───────────────────────────────

describe("TC6: activity/listen/cancel — auth failure", () => {
  it("returns AUTH_FAILED error and does not call cancelSseConnection", () => {
    gateMocks.requireAuth.mockReturnValue(AUTH_ERROR);
    const result = handleActivityListenCancel({ token: 99999 });
    expect(isError(result as { isError?: boolean })).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("AUTH_FAILED");
    expect(sseEndpointMocks.cancelSseConnection).not.toHaveBeenCalled();
  });
});
