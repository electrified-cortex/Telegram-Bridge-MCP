/**
 * Unit tests for activity/listen and activity/listen/cancel handlers.
 *
 * Covers:
 *   TC1. activity/listen — HTTP mode active → returns SSE URL, filtered command, and guidance fields;
 *        does NOT include ok: true (AC1); delivers ACTIVITY_LISTEN_SETUP service message (AC2)
 *   TC1b. activity/listen — BRIDGE_ADVERTISE_HOST → host substituted in SSE URL (10-3083)
 *   TC2. activity/listen — HTTP mode not active → HTTP_MODE_REQUIRED error
 *   TC3. activity/listen — auth failure → AUTH_FAILED error
 *   TC4. activity/listen/cancel — connection open → ok:true, connection cancelled
 *   TC5. activity/listen/cancel — no connection open → ok:true (idempotent)
 *   TC6. activity/listen/cancel — auth failure → AUTH_FAILED error
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const gateMocks = vi.hoisted(() => ({
  requireAuth: vi.fn((_token: number | undefined): number | { code: string; message: string } => 1),
}));

const httpModeMocks = vi.hoisted(() => ({
  getSseBaseUrl: vi.fn((): string | null => "http://127.0.0.1:3099"),
}));

const sseEndpointMocks = vi.hoisted(() => ({
  cancelSseConnection: vi.fn((_sid: number): void => {}),
  scheduleArmReminder: vi.fn((_sid: number, _command: string): void => {}),
}));

const sessionQueueMocks = vi.hoisted(() => ({
  deliverServiceMessage: vi.fn((..._args: unknown[]): boolean => true),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: (token: number | undefined) => gateMocks.requireAuth(token),
}));

vi.mock("../../http-mode.js", () => ({
  getSseBaseUrl: () => httpModeMocks.getSseBaseUrl(),
}));

vi.mock("../../sse-endpoint.js", () => ({
  cancelSseConnection: (sid: number) => { sseEndpointMocks.cancelSseConnection(sid); },
  scheduleArmReminder: (sid: number, command: string) => { sseEndpointMocks.scheduleArmReminder(sid, command); },
}));

vi.mock("../../session-queue.js", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, deliverServiceMessage: (...args: unknown[]) => sessionQueueMocks.deliverServiceMessage(...args) };
});

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
  sseEndpointMocks.scheduleArmReminder.mockReturnValue(undefined);
  sessionQueueMocks.deliverServiceMessage.mockReturnValue(true);
});

// ── TC1: activity/listen — HTTP mode active ───────────────────────────────────

describe("TC1: activity/listen — HTTP mode active", () => {
  it("returns filtered command and guidance fields without ok:true (AC1)", () => {
    const result = handleActivityListen({ token: TOKEN });
    expect(isError(result as { isError?: boolean })).toBe(false);
    const body = parseResult(result);
    // AC1: ok field must NOT be present
    expect(body.ok).toBeUndefined();
    expect(typeof body.sse_url).toBe("string");
    expect((body.sse_url as string)).toContain(`/sse?token=${TOKEN}`);
    // command must use the filtered script, NOT raw curl -N
    expect(body.command).toBe(`bash sse-monitor.sh '${body.sse_url as string}'`);
    expect(body.monitor_type).toBe("sse");
    expect(typeof body.heartbeat_warning).toBe("string");
    expect(body.arm_with).toBe("Monitor tool, persistent: true");
    expect(typeof body.download_url).toBe("string");
    expect((body.download_url as string)).toContain("/tools/sse-monitor.sh");
    // arm reminder must be scheduled
    expect(sseEndpointMocks.scheduleArmReminder).toHaveBeenCalledWith(SID, body.command);
  });

  it("delivers ACTIVITY_LISTEN_SETUP service message breadcrumb (AC2)", () => {
    const result = handleActivityListen({ token: TOKEN });
    const body = parseResult(result);
    // AC2: setup breadcrumb must be delivered as a service message in chat
    expect(sessionQueueMocks.deliverServiceMessage).toHaveBeenCalledOnce();
    const [calledSid, calledText, calledEventType] = sessionQueueMocks.deliverServiceMessage.mock.calls[0] as [number, string, string];
    expect(calledSid).toBe(SID);
    expect(calledEventType).toBe("activity_listen_setup");
    // The message must reference the concrete arm command and download URL
    expect(calledText).toContain(body.command as string);
    expect(calledText).toContain(body.download_url as string);
  });

  it("builds URL from base URL returned by getSseBaseUrl", () => {
    httpModeMocks.getSseBaseUrl.mockReturnValue("http://192.168.1.10:5000");
    const result = handleActivityListen({ token: TOKEN });
    const body = parseResult(result);
    expect(body.sse_url).toBe(`http://192.168.1.10:5000/sse?token=${TOKEN}`);
    expect(body.download_url).toBe(`http://192.168.1.10:5000/tools/sse-monitor.sh`);
  });
});

// ── TC1b: activity/listen — BRIDGE_ADVERTISE_HOST substitution ──────────────

describe("TC1b: activity/listen — BRIDGE_ADVERTISE_HOST substitution (10-3083)", () => {
  afterEach(() => {
    delete process.env.BRIDGE_ADVERTISE_HOST;
  });

  it("replaces 0.0.0.0 host with BRIDGE_ADVERTISE_HOST when set", () => {
    httpModeMocks.getSseBaseUrl.mockReturnValue("http://0.0.0.0:3099");
    process.env.BRIDGE_ADVERTISE_HOST = "127.0.0.1";
    const result = handleActivityListen({ token: TOKEN });
    const body = parseResult(result);
    expect(body.sse_url).toBe(`http://127.0.0.1:3099/sse?token=${TOKEN}`);
    expect(body.download_url).toBe(`http://127.0.0.1:3099/tools/sse-monitor.sh`);
    expect((body.command as string)).toContain("127.0.0.1");
    expect((body.command as string)).not.toContain("0.0.0.0");
  });

  it("uses BRIDGE_ADVERTISE_HOST=bridge for container deployments", () => {
    httpModeMocks.getSseBaseUrl.mockReturnValue("http://0.0.0.0:3099");
    process.env.BRIDGE_ADVERTISE_HOST = "bridge";
    const result = handleActivityListen({ token: TOKEN });
    const body = parseResult(result);
    expect(body.sse_url).toBe(`http://bridge:3099/sse?token=${TOKEN}`);
    expect(body.download_url).toBe(`http://bridge:3099/tools/sse-monitor.sh`);
  });

  it("preserves existing behavior when BRIDGE_ADVERTISE_HOST is unset", () => {
    httpModeMocks.getSseBaseUrl.mockReturnValue("http://0.0.0.0:3099");
    // No BRIDGE_ADVERTISE_HOST set
    const result = handleActivityListen({ token: TOKEN });
    const body = parseResult(result);
    expect(body.sse_url).toBe(`http://0.0.0.0:3099/sse?token=${TOKEN}`);
  });

  it("ignores empty BRIDGE_ADVERTISE_HOST (backward compat)", () => {
    httpModeMocks.getSseBaseUrl.mockReturnValue("http://0.0.0.0:3099");
    process.env.BRIDGE_ADVERTISE_HOST = "";
    const result = handleActivityListen({ token: TOKEN });
    const body = parseResult(result);
    expect(body.sse_url).toBe(`http://0.0.0.0:3099/sse?token=${TOKEN}`);
  });

  it("applies substitution to any host, not just 0.0.0.0", () => {
    httpModeMocks.getSseBaseUrl.mockReturnValue("http://192.168.1.10:5000");
    process.env.BRIDGE_ADVERTISE_HOST = "myhost";
    const result = handleActivityListen({ token: TOKEN });
    const body = parseResult(result);
    expect(body.sse_url).toBe(`http://myhost:5000/sse?token=${TOKEN}`);
    expect(body.download_url).toBe(`http://myhost:5000/tools/sse-monitor.sh`);
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

