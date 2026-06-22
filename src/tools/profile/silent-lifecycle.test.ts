import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError } from "../test-utils.js";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn((_token: number | undefined): number | { code: string; message: string } => 42),
  getSession: vi.fn<() => Record<string, unknown> | undefined>(),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: (token: number | undefined) => mocks.requireAuth(token),
}));

vi.mock("../../session-manager.js", () => ({
  getSession: (_sid: number) => mocks.getSession(),
}));

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return actual;
});

import { handleSilentLifecycle } from "./silent-lifecycle.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const TOKEN = 12345;
const SID = 42;

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockReturnValue(SID);
  mocks.getSession.mockReturnValue({ sid: SID, name: "TestBot" });
});

// ── GET tests ──────────────────────────────────────────────────────────────────

describe("handleSilentLifecycle — GET (enabled omitted)", () => {
  it("returns ok:true with enabled:false and default:false when not set on session", () => {
    mocks.getSession.mockReturnValue({ sid: SID, name: "TestBot" }); // no silent_lifecycle field
    const result = handleSilentLifecycle({ token: TOKEN });
    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.enabled).toBe(false);
    expect(parsed.default).toBe(false);
  });

  it("returns enabled:true when silent_lifecycle is true on session", () => {
    mocks.getSession.mockReturnValue({ sid: SID, name: "TestBot", silent_lifecycle: true });
    const result = handleSilentLifecycle({ token: TOKEN });
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.enabled).toBe(true);
  });

  it("returns enabled:false when silent_lifecycle is false on session", () => {
    mocks.getSession.mockReturnValue({ sid: SID, name: "TestBot", silent_lifecycle: false });
    const result = handleSilentLifecycle({ token: TOKEN });
    const parsed = parseResult(result);
    expect(parsed.enabled).toBe(false);
  });

  it("returns error when auth fails", () => {
    mocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "bad token" });
    const result = handleSilentLifecycle({ token: 0 });
    expect(isError(result)).toBe(true);
  });
});

// ── SET tests ──────────────────────────────────────────────────────────────────

describe("handleSilentLifecycle — SET (enabled provided)", () => {
  it("sets enabled:true and returns ok:true with previous:false", () => {
    const session: Record<string, unknown> = { sid: SID, name: "TestBot", silent_lifecycle: false };
    mocks.getSession.mockReturnValue(session);
    const result = handleSilentLifecycle({ token: TOKEN, enabled: true });
    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.enabled).toBe(true);
    expect(parsed.previous).toBe(false);
    expect(session.silent_lifecycle).toBe(true); // mutated in place
  });

  it("sets enabled:false and returns previous:true (toggle off)", () => {
    const session: Record<string, unknown> = { sid: SID, name: "TestBot", silent_lifecycle: true };
    mocks.getSession.mockReturnValue(session);
    const result = handleSilentLifecycle({ token: TOKEN, enabled: false });
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.enabled).toBe(false);
    expect(parsed.previous).toBe(true);
    expect(session.silent_lifecycle).toBe(false);
  });

  it("previous defaults to false when session has no silent_lifecycle field", () => {
    const session: Record<string, unknown> = { sid: SID, name: "TestBot" };
    mocks.getSession.mockReturnValue(session);
    const result = handleSilentLifecycle({ token: TOKEN, enabled: true });
    const parsed = parseResult(result);
    expect(parsed.previous).toBe(false);
    expect(parsed.enabled).toBe(true);
    expect(session.silent_lifecycle).toBe(true);
  });

  it("returns error when auth fails on SET", () => {
    mocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "bad token" });
    const result = handleSilentLifecycle({ token: 0, enabled: true });
    expect(isError(result)).toBe(true);
  });
});

// ── Round-trip test ────────────────────────────────────────────────────────────

describe("handleSilentLifecycle — round-trip", () => {
  it("GET after SET returns the newly set value", () => {
    const session: Record<string, unknown> = { sid: SID, name: "TestBot", silent_lifecycle: false };
    mocks.getSession.mockReturnValue(session);

    // SET to true
    handleSilentLifecycle({ token: TOKEN, enabled: true });
    expect(session.silent_lifecycle).toBe(true);

    // GET → should return enabled:true
    const result = handleSilentLifecycle({ token: TOKEN });
    const parsed = parseResult(result);
    expect(parsed.enabled).toBe(true);
  });

  it("double-toggle returns to original state", () => {
    const session: Record<string, unknown> = { sid: SID, name: "TestBot", silent_lifecycle: false };
    mocks.getSession.mockReturnValue(session);

    handleSilentLifecycle({ token: TOKEN, enabled: true });
    handleSilentLifecycle({ token: TOKEN, enabled: false });
    const result = handleSilentLifecycle({ token: TOKEN });
    const parsed = parseResult(result);
    expect(parsed.enabled).toBe(false);
  });
});
