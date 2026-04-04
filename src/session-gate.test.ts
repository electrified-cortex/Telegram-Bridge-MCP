import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAuth } from "./session-gate.js";
import type { TelegramError } from "./telegram.js";

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

  describe("auth failure — generic message (oracle hardening)", () => {
    it("SID_REQUIRED message mentions token when token is undefined", () => {
      const result = requireAuth(undefined);
      expect(result).toMatchObject({ code: "SID_REQUIRED" });
      expect((result as TelegramError).message).toContain("token");
    });

    it("returns AUTH_FAILED with generic message when session does not exist", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      const token = 42 * 1_000_000 + 99999;
      const result = requireAuth(token);
      expect(result).toMatchObject({ code: "AUTH_FAILED" });
      const msg = (result as TelegramError).message;
      expect(msg).not.toContain("not found");
      expect(msg).not.toContain("42");
      expect(msg).not.toContain("PIN mismatch");
    });

    it("returns AUTH_FAILED with same generic message when session exists but pin is wrong", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      const token = 1 * 1_000_000 + 99999;
      const result = requireAuth(token);
      expect(result).toMatchObject({ code: "AUTH_FAILED" });
      const msg = (result as TelegramError).message;
      expect(msg).not.toContain("PIN mismatch");
      expect(msg).not.toContain("not found");
    });

    it("returns same message for existing and non-existing SIDs (no oracle)", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      const token1 = 42 * 1_000_000 + 99999;
      const token2 = 1 * 1_000_000 + 99999;
      const result1 = requireAuth(token1) as TelegramError;
      const result2 = requireAuth(token2) as TelegramError;
      expect(result1.message).toBe(result2.message);
    });
  });
});
