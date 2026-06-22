import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError } from "../test-utils.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const gateMocks = vi.hoisted(() => ({
  requireAuth: vi.fn((_token: number | undefined): number | { code: string; message: string } => 42),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: (token: number | undefined) => gateMocks.requireAuth(token),
}));

// Stateful mock for getNotifyDebounceMs / setNotifyDebounceMs
const _debounceStore = new Map<number, number>();

vi.mock("../../session-manager.js", () => ({
  getNotifyDebounceMs: (sid: number) => _debounceStore.get(sid) ?? 300_000,
  setNotifyDebounceMs: (sid: number, ms: number) => { _debounceStore.set(sid, ms); },
}));

vi.mock("../activity/file-state.js", () => ({
  NOTIFY_DEBOUNCE_MIN_MS: 1_000,
  NOTIFY_DEBOUNCE_MAX_MS: 3_600_000,
  NOTIFY_DEBOUNCE_MS: 300_000,
}));

// toResult / toError pass-through
vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return actual;
});

import { handleNotifyGate } from "./activity-notify-gate.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const TOKEN = 12345;
const SID = 42;
const DEFAULT_MS = 300_000;

beforeEach(() => {
  vi.clearAllMocks();
  _debounceStore.clear();
  gateMocks.requireAuth.mockReturnValue(SID);
});

describe("handleNotifyGate — GET (ms omitted)", () => {
  it("returns ok:true with current ms and default_ms when no ms provided", () => {
    const result = handleNotifyGate({ token: TOKEN });
    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.ms).toBe(DEFAULT_MS);
    expect(parsed.default_ms).toBe(DEFAULT_MS);
  });

  it("returns currently set ms if it was previously set", () => {
    _debounceStore.set(SID, 60_000);
    const result = handleNotifyGate({ token: TOKEN });
    const parsed = parseResult(result);
    expect(parsed.ms).toBe(60_000);
  });

  it("returns error when auth fails", () => {
    gateMocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "bad token" });
    const result = handleNotifyGate({ token: 0 });
    expect(isError(result)).toBe(true);
  });
});

describe("handleNotifyGate — SET (ms provided)", () => {
  it("sets notify gate ms and returns ok:true with previous value", () => {
    _debounceStore.set(SID, DEFAULT_MS);
    const result = handleNotifyGate({ token: TOKEN, ms: 60_000 });
    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.ms).toBe(60_000);
    expect(parsed.previous).toBe(DEFAULT_MS);
    expect(_debounceStore.get(SID)).toBe(60_000);
  });

  it("rejects ms below minimum (1000)", () => {
    const result = handleNotifyGate({ token: TOKEN, ms: 999 });
    expect(isError(result)).toBe(true);
  });

  it("rejects ms above maximum (3600000)", () => {
    const result = handleNotifyGate({ token: TOKEN, ms: 3_600_001 });
    expect(isError(result)).toBe(true);
  });

  it("accepts minimum boundary (1000 ms)", () => {
    const result = handleNotifyGate({ token: TOKEN, ms: 1_000 });
    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.ms).toBe(1_000);
  });

  it("accepts maximum boundary (3600000 ms)", () => {
    const result = handleNotifyGate({ token: TOKEN, ms: 3_600_000 });
    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.ms).toBe(3_600_000);
  });

  it("returns error when auth fails on SET", () => {
    gateMocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "bad token" });
    const result = handleNotifyGate({ token: 0, ms: 60_000 });
    expect(isError(result)).toBe(true);
  });
});
