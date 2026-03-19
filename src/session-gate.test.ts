import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAuth } from "./session-gate.js";

const sessionMocks = vi.hoisted(() => ({
  validateSession: vi.fn((_sid: number, _pin: number) => false),
}));

vi.mock("./session-manager.js", () => ({
  validateSession: (sid: number, pin: number) => sessionMocks.validateSession(sid, pin),
}));

beforeEach(() => {
  vi.clearAllMocks();
  sessionMocks.validateSession.mockReturnValue(false);
});

describe("requireAuth", () => {
  describe("identity omitted", () => {
    it("returns SID_REQUIRED when identity is undefined", () => {
      const result = requireAuth(undefined);
      expect(result).toMatchObject({
        code: "SID_REQUIRED",
        message: expect.stringContaining("identity [sid, pin] is required"),
      });
    });

    it("always returns SID_REQUIRED regardless of session count", () => {
      // No session count check — identity is always required
      const result = requireAuth(undefined);
      expect(typeof result).toBe("object");
      if (typeof result === "object") {
        expect((result as { code: string }).code).toBe("SID_REQUIRED");
      }
    });
  });

  describe("identity provided", () => {
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

    it("returns AUTH_FAILED when validateSession returns false", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      const result = requireAuth([1, 99999]);
      expect(result).toMatchObject({ code: "AUTH_FAILED" });
    });
  });
});

