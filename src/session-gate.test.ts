import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAuth } from "./session-gate.js";

const sessionMocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
}));

vi.mock("./session-manager.js", () => ({
  activeSessionCount: () => sessionMocks.activeSessionCount(),
  getActiveSession: () => sessionMocks.getActiveSession(),
  validateSession: (sid: number, pin: number) => sessionMocks.validateSession(sid, pin),
}));

beforeEach(() => {
  vi.clearAllMocks();
  sessionMocks.activeSessionCount.mockReturnValue(0);
  sessionMocks.getActiveSession.mockReturnValue(0);
  sessionMocks.validateSession.mockReturnValue(false);
});

describe("requireAuth", () => {
  describe("single-session mode (activeSessionCount <= 1)", () => {
    it("returns getActiveSession() when identity omitted and 0 sessions", () => {
      sessionMocks.activeSessionCount.mockReturnValue(0);
      sessionMocks.getActiveSession.mockReturnValue(0);
      expect(requireAuth(undefined)).toBe(0);
    });

    it("returns getActiveSession() when identity omitted and 1 session", () => {
      sessionMocks.activeSessionCount.mockReturnValue(1);
      sessionMocks.getActiveSession.mockReturnValue(42);
      expect(requireAuth(undefined)).toBe(42);
    });

    it("returns getActiveSession() even when identity is provided (single-session)", () => {
      sessionMocks.activeSessionCount.mockReturnValue(1);
      sessionMocks.getActiveSession.mockReturnValue(7);
      // In single-session mode the identity is ignored; just return getActiveSession()
      expect(requireAuth([99, 12345])).toBe(7);
    });

    it("does not call validateSession in single-session mode", () => {
      sessionMocks.activeSessionCount.mockReturnValue(1);
      requireAuth([1, 9999]);
      expect(sessionMocks.validateSession).not.toHaveBeenCalled();
    });
  });

  describe("multi-session mode (activeSessionCount > 1)", () => {
    beforeEach(() => {
      sessionMocks.activeSessionCount.mockReturnValue(2);
    });

    it("returns SID_REQUIRED when identity is omitted", () => {
      const result = requireAuth(undefined);
      expect(result).toMatchObject({
        code: "SID_REQUIRED",
        message: expect.stringContaining("Multiple sessions are active"),
      });
    });

    it("includes active session count in SID_REQUIRED message", () => {
      sessionMocks.activeSessionCount.mockReturnValue(3);
      const result = requireAuth(undefined);
      expect(typeof result).toBe("object");
      if (typeof result === "object") expect(result.message).toContain("3");
    });

    it("returns AUTH_FAILED when validateSession returns false", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      const result = requireAuth([1, 99999]);
      expect(result).toMatchObject({ code: "AUTH_FAILED" });
    });

    it("calls validateSession with correct sid and pin", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      requireAuth([5, 80914]);
      expect(sessionMocks.validateSession).toHaveBeenCalledWith(5, 80914);
    });

    it("returns sid when validateSession returns true", () => {
      sessionMocks.validateSession.mockReturnValue(true);
      const result = requireAuth([3, 12345]);
      expect(result).toBe(3);
    });

    it("does not call getActiveSession when identity is provided", () => {
      sessionMocks.validateSession.mockReturnValue(true);
      requireAuth([2, 55555]);
      expect(sessionMocks.getActiveSession).not.toHaveBeenCalled();
    });
  });
});
