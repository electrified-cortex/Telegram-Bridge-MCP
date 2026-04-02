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
  describe("identity omitted", () => {
    it("returns SID_REQUIRED when identity is undefined", () => {
      const result = requireAuth(undefined);
      expect(result).toMatchObject({
        code: "SID_REQUIRED",
        message: expect.stringContaining("identity [sid, pin] is required"),
      });
    });

    it("returns SID_REQUIRED when identity array is too short", () => {
      const result = requireAuth([1]);
      expect(result).toMatchObject({ code: "SID_REQUIRED" });
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

  describe("improved error diagnostics", () => {
    it("SID_REQUIRED message includes [sid, pin] example when identity is undefined", () => {
      const result = requireAuth(undefined);
      expect(result).toMatchObject({ code: "SID_REQUIRED" });
      expect((result as TelegramError).message).toContain("[sid, pin]");
      expect((result as TelegramError).message).toContain("Example:");
    });

    it("SID_REQUIRED message includes element count when identity has 1 element", () => {
      const result = requireAuth([7]);
      expect(result).toMatchObject({ code: "SID_REQUIRED" });
      expect((result as TelegramError).message).toContain("[sid, pin]");
      expect((result as TelegramError).message).toContain("missing pin");
    });

    it("SID_REQUIRED message describes empty array", () => {
      const result = requireAuth([]);
      expect(result).toMatchObject({ code: "SID_REQUIRED" });
      expect((result as TelegramError).message).toContain("empty array");
    });

    it("AUTH_FAILED mentions SID not found when session does not exist", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      sessionMocks.getSession.mockReturnValue(undefined);
      const result = requireAuth([42, 99999]);
      expect(result).toMatchObject({ code: "AUTH_FAILED" });
      expect((result as TelegramError).message).toContain("not found");
      expect((result as TelegramError).message).toContain("42");
    });

    it("AUTH_FAILED mentions PIN mismatch when session exists but pin is wrong", () => {
      sessionMocks.validateSession.mockReturnValue(false);
      sessionMocks.getSession.mockReturnValue({ pin: 12345 } as never);
      const result = requireAuth([1, 99999]);
      expect(result).toMatchObject({ code: "AUTH_FAILED" });
      expect((result as TelegramError).message).toContain("PIN mismatch");
      expect((result as TelegramError).message).toContain("1");
    });
  });
});

