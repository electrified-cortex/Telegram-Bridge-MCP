import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock() calls.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  validateSession: vi.fn<(sid: number, suffix: number) => boolean>(),
  listSessions: vi.fn<() => import("../session-manager.js").SessionInfo[]>(),
  getSession: vi.fn<(sid: number) => import("../session-manager.js").Session | undefined>(),
  getGovernorSid: vi.fn<() => number>(),
  requireAuth: vi.fn<(token: number | undefined) => number | { code: string; message: string }>(),
  toResult: vi.fn((v: unknown) => v),
  toError: vi.fn((v: unknown) => v),
}));

vi.mock("../session-manager.js", () => ({
  validateSession: (...args: Parameters<typeof mocks.validateSession>) => mocks.validateSession(...args),
  listSessions: () => mocks.listSessions(),
  getSession: (sid: number) => mocks.getSession(sid),
}));

vi.mock("../routing-mode.js", () => ({
  getGovernorSid: () => mocks.getGovernorSid(),
}));

vi.mock("../session-gate.js", () => ({
  requireAuth: (token: number | undefined) => mocks.requireAuth(token),
}));

vi.mock("../telegram.js", () => ({
  toResult: (v: unknown) => mocks.toResult(v),
  toError: (v: unknown) => mocks.toError(v),
}));

import { handleSessionStatus } from "./session/status.js";
import type { SessionInfo, Session } from "../session-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode a token the same way the real implementation expects: sid * 1_000_000 + suffix */
function makeToken(sid: number, suffix = 1): number {
  return sid * 1_000_000 + suffix;
}

function makeSessionInfo(sid: number): SessionInfo {
  return {
    sid,
    name: `Session ${sid}`,
    color: "🟦",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  };
}

function makeSession(sid: number): Session {
  return {
    sid,
    suffix: 1,
    name: `Session ${sid}`,
    color: "🟦",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    lastPollAt: Date.now() - 5_000,
    healthy: true,
    connectionToken: "test-token",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleSessionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: toResult/toError are pass-through
    mocks.toResult.mockImplementation((v: unknown) => v);
    mocks.toError.mockImplementation((v: unknown) => v);
  });

  describe("Governor visibility — caller IS the governor", () => {
    it("returns all active sessions", () => {
      const governorSid = 1;
      const otherSid = 2;
      const token = makeToken(governorSid);

      // requireAuth returns the caller's SID
      mocks.requireAuth.mockReturnValue(governorSid);
      // caller is governor
      mocks.getGovernorSid.mockReturnValue(governorSid);

      const infos = [makeSessionInfo(governorSid), makeSessionInfo(otherSid)];
      mocks.listSessions.mockReturnValue(infos);
      mocks.getSession.mockImplementation((sid) => makeSession(sid));

      const result = handleSessionStatus({ token }) as { sessions: { sid: number }[] };

      expect(result).toHaveProperty("sessions");
      const sids = result.sessions.map(s => s.sid);
      expect(sids).toContain(governorSid);
      expect(sids).toContain(otherSid);
      expect(result.sessions).toHaveLength(2);
    });
  });

  describe("Non-governor scoping — caller is NOT the governor", () => {
    it("returns only the caller's own session", () => {
      const callerSid = 2;
      const governorSid = 1;
      const token = makeToken(callerSid);

      mocks.requireAuth.mockReturnValue(callerSid);
      mocks.getGovernorSid.mockReturnValue(governorSid);

      const infos = [makeSessionInfo(governorSid), makeSessionInfo(callerSid)];
      mocks.listSessions.mockReturnValue(infos);
      mocks.getSession.mockImplementation((sid) => makeSession(sid));

      const result = handleSessionStatus({ token }) as { sessions: { sid: number }[] };

      expect(result).toHaveProperty("sessions");
      const sids = result.sessions.map(s => s.sid);
      expect(sids).not.toContain(governorSid);
      expect(sids).toContain(callerSid);
      expect(result.sessions).toHaveLength(1);
    });
  });

  describe("Null-elision — session disappears between listSessions() and getSession()", () => {
    it("filters out entries where getSession returns undefined", () => {
      const governorSid = 1;
      const vanishingSid = 2;
      const token = makeToken(governorSid);

      mocks.requireAuth.mockReturnValue(governorSid);
      mocks.getGovernorSid.mockReturnValue(governorSid);

      const infos = [makeSessionInfo(governorSid), makeSessionInfo(vanishingSid)];
      mocks.listSessions.mockReturnValue(infos);

      // governorSid resolves normally; vanishingSid has disappeared
      mocks.getSession.mockImplementation((sid) => {
        if (sid === vanishingSid) return undefined;
        return makeSession(sid);
      });

      const result = handleSessionStatus({ token }) as { sessions: { sid: number }[] };

      expect(result).toHaveProperty("sessions");
      const sids = result.sessions.map(s => s.sid);
      expect(sids).toContain(governorSid);
      expect(sids).not.toContain(vanishingSid);
      expect(result.sessions).toHaveLength(1);
    });
  });
});
