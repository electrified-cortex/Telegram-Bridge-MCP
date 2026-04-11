import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn((_token: number): number | string => 1),
  getIdleSessions: vi.fn(() => [] as Array<{ sid: number; name: string; color: string; createdAt: string; idle_since_ms: number }>),
  listSessions: vi.fn(() => [] as Array<{ sid: number; name: string; color: string; createdAt: string }>),
  getGovernorSid: vi.fn((): number => 0),
}));

vi.mock("../session-gate.js", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("../session-manager.js", () => ({
  getIdleSessions: mocks.getIdleSessions,
  listSessions: mocks.listSessions,
}));

vi.mock("../routing-mode.js", () => ({
  getGovernorSid: mocks.getGovernorSid,
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual };
});

import { handleSessionIdle } from "./session_idle.js";

describe("session/idle action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockReturnValue(1);
    mocks.getIdleSessions.mockReturnValue([]);
    mocks.listSessions.mockReturnValue([]);
    mocks.getGovernorSid.mockReturnValue(0);
  });

  it("returns auth error when token is invalid", () => {
    mocks.requireAuth.mockReturnValue({ code: "INVALID_TOKEN", message: "bad token" });
    const result = handleSessionIdle({ token: 0 });
    expect(isError(result)).toBe(true);
  });

  it("returns empty idle_sessions when no sessions are idle", () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Primary", color: "🟦", createdAt: "" },
    ]);
    const result = parseResult(handleSessionIdle({ token: 1000001 }));
    expect(result.idle_sessions).toEqual([]);
    expect(result.idle_count).toBe(0);
    expect(result.total_sessions).toBe(1);
  });

  it("returns idle sessions with duration and governor flag", () => {
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Overseer", color: "🟦", createdAt: "" },
      { sid: 2, name: "Worker", color: "🟩", createdAt: "" },
    ]);
    mocks.getIdleSessions.mockReturnValue([
      { sid: 2, name: "Worker", color: "🟩", createdAt: "", idle_since_ms: 30000 },
    ]);
    const result = parseResult(handleSessionIdle({ token: 1000001 }));
    expect(result.idle_count).toBe(1);
    expect(result.total_sessions).toBe(2);
    const idle = result.idle_sessions as Array<{ sid: number; is_governor: boolean; idle_since_ms: number }>;
    expect(idle[0].sid).toBe(2);
    expect(idle[0].is_governor).toBe(false);
    expect(idle[0].idle_since_ms).toBe(30000);
  });

  it("marks governor session as is_governor: true", () => {
    mocks.getGovernorSid.mockReturnValue(3);
    mocks.listSessions.mockReturnValue([{ sid: 3, name: "Curator", color: "🟪", createdAt: "" }]);
    mocks.getIdleSessions.mockReturnValue([
      { sid: 3, name: "Curator", color: "🟪", createdAt: "", idle_since_ms: 10000 },
    ]);
    const result = parseResult(handleSessionIdle({ token: 3000001 }));
    const idle = result.idle_sessions as Array<{ sid: number; is_governor: boolean }>;
    expect(idle[0].is_governor).toBe(true);
  });
});
