import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireSid } from "./session-gate.js";

vi.mock("./session-manager.js", () => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
}));

import { activeSessionCount, getActiveSession } from "./session-manager.js";

const mocks = {
  activeSessionCount: vi.mocked(activeSessionCount),
  getActiveSession: vi.mocked(getActiveSession),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeSessionCount.mockReturnValue(0);
  mocks.getActiveSession.mockReturnValue(0);
});

describe("requireSid", () => {
  describe("single-session mode (activeSessionCount <= 1)", () => {
    it("returns getActiveSession() fallback when no sid given and 0 sessions", () => {
      mocks.activeSessionCount.mockReturnValue(0);
      mocks.getActiveSession.mockReturnValue(0);
      const result = requireSid(undefined);
      expect(result).toBe(0);
    });

    it("returns getActiveSession() fallback when no sid given and 1 session", () => {
      mocks.activeSessionCount.mockReturnValue(1);
      mocks.getActiveSession.mockReturnValue(42);
      const result = requireSid(undefined);
      expect(result).toBe(42);
    });

    it("returns provided sid directly when sid given and 0 sessions", () => {
      mocks.activeSessionCount.mockReturnValue(0);
      const result = requireSid(7);
      expect(typeof result).toBe("number");
      expect(result).toBe(7);
    });

    it("returns provided sid directly when sid given and 1 session", () => {
      mocks.activeSessionCount.mockReturnValue(1);
      const result = requireSid(42);
      expect(result).toBe(42);
    });
  });

  describe("multi-session mode (activeSessionCount > 1)", () => {
    beforeEach(() => {
      mocks.activeSessionCount.mockReturnValue(2);
    });

    it("returns SID_REQUIRED error when sid is omitted", () => {
      const result = requireSid(undefined);
      expect(typeof result).toBe("object");
      expect(result).toMatchObject({
        code: "SID_REQUIRED",
        message: expect.stringContaining("Multiple sessions are active"),
      });
    });

    it("includes active session count in the error message", () => {
      mocks.activeSessionCount.mockReturnValue(3);
      const result = requireSid(undefined);
      expect(typeof result).toBe("object");
      if (typeof result === "object") {
        expect(result.message).toContain("3");
      }
    });

    it("returns sid directly when sid is provided (no error)", () => {
      const result = requireSid(5);
      expect(result).toBe(5);
    });

    it("returns sid=1 directly when provided", () => {
      const result = requireSid(1);
      expect(result).toBe(1);
    });

    it("does NOT call getActiveSession when sid is provided", () => {
      requireSid(3);
      expect(mocks.getActiveSession).not.toHaveBeenCalled();
    });
  });

  describe("SID_REQUIRED code is a string literal", () => {
    it("has code SID_REQUIRED", () => {
      mocks.activeSessionCount.mockReturnValue(2);
      const result = requireSid(undefined);
      expect(typeof result).toBe("object");
      if (typeof result === "object") {
        expect(result.code).toBe("SID_REQUIRED");
      }
    });
  });
});
