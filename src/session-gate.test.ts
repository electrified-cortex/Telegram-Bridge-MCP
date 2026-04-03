import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAuth } from "./session-gate.js";
import type { TelegramError } from "./telegram.js";

const sessionMocks = vi.hoisted(() => ({
  validateSession: vi.fn((_sid: number, _pin: number) => false),
  getSession: vi.fn((_sid: number) => undefined as { pin: number } | undefined),
}));

vi.mock("./session-manager.js", () => ({
  validateSession: (sid: number, pin: number) => sessionMocks.validateSession(sid, pin),
  getSession: (sid: number) => sessionMocks.getSession(sid),
}));

beforeEach(() => {
  vi.clearAllMocks();
  sessionMocks.validateSession.mockReturnValue(false);
  sessionMocks.getSession.mockReturnValue(undefined);
});

describe("requireAuth", () => {
  describe("token omitted", () => {
    it("returns SID_REQUIRED when token is undefined", () => {
      const result = requireAuth(undefined);
      expect(result).toMatchObject({
        code: "SID_REQUIRED",
        message: expect.stringContaining("token is required"),
      });
    });

    it("always returns SID_REQUIRED regardless of session count", () => {
      const result = requireAuth(undefined);
      expect(typeof result).toBe("object");
      if (typeof result === "object") {
        expect((result as { code: string }).code).toBe("SID_REQUIRED");
      }
    });
  });

  describe("token provided", () => {
    it("returns AUTH_FAILED for invalid credentials", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      const token = 1 * 1_000_000 + 99999;
      const result = requireAuth(token);
      expect(result).toMatchObject({ code: "AUTH_FAILED" });
    });

    it("calls validateSession with correct sid and pin decoded from token", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      const token = 5 * 1_000_000 + 80914;
      requireAuth(token);
      expect(sessionMocks.validateSession).toHaveBeenCalledWith(5, 80914);
    });

    it("returns sid when validateSession returns true", () => {
      sessionMocks.validateSession.mockReturnValue(true);
      const token = 3 * 1_000_000 + 12345;
      const result = requireAuth(token);
      expect(result).toBe(3);
    });

    it("returns AUTH_FAILED when validateSession returns false", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      const token = 1 * 1_000_000 + 99999;
      const result = requireAuth(token);
      expect(result).toMatchObject({ code: "AUTH_FAILED" });
    });
  });

  describe("improved error diagnostics", () => {
    it("SID_REQUIRED message mentions token when token is undefined", () => {
      const result = requireAuth(undefined);
      expect(result).toMatchObject({ code: "SID_REQUIRED" });
      expect((result as TelegramError).message).toContain("token");
    });

    it("returns AUTH_FAILED without throwing when getSession throws TypeError", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      sessionMocks.getSession.mockImplementation(() => {
        throw new TypeError("getSession is not a function");
      });
      const token = 5 * 1_000_000 + 99999;
      const result = requireAuth(token);
      expect(result).toMatchObject({ code: "AUTH_FAILED" });
    });

    it("AUTH_FAILED mentions SID not found when session does not exist", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      sessionMocks.getSession.mockReturnValue(undefined);
      const token = 42 * 1_000_000 + 99999;
      const result = requireAuth(token);
      expect(result).toMatchObject({ code: "AUTH_FAILED" });
      expect((result as TelegramError).message).toContain("not found");
      expect((result as TelegramError).message).toContain("42");
    });

    it("AUTH_FAILED mentions PIN mismatch when session exists but pin is wrong", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      sessionMocks.getSession.mockReturnValue({ pin: 12345 });
      const token = 1 * 1_000_000 + 99999;
      const result = requireAuth(token);
      expect(result).toMatchObject({ code: "AUTH_FAILED" });
      expect((result as TelegramError).message).toContain("PIN mismatch");
      expect((result as TelegramError).message).toContain("1");
    });
  });
});
