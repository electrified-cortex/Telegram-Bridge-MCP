import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode, type ToolHandler } from "./test-utils.js";

// Authenticated response shape
interface AuthenticatedResult {
  sessions: Array<{ sid: number; name: string; color: string; createdAt: string }>;
  active_sid: number;
}

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getActiveSession: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("../session-manager.js", () => ({
  listSessions: mocks.listSessions,
  getActiveSession: mocks.getActiveSession,
}));

vi.mock("../session-gate.js", () => ({
  requireAuth: mocks.requireAuth,
}));

import { register } from "./list_sessions.js";

// A valid encoded token for sid=1, pin=123456: 1 * 1_000_000 + 123456 = 1_123_456
const VALID_TOKEN = 1_123_456;

describe("list_sessions tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSessions.mockReturnValue([]);
    mocks.getActiveSession.mockReturnValue(0);
    mocks.requireAuth.mockReturnValue(1); // default: auth succeeds, returns sid=1
    const server = createMockServer();
    register(server);
    call = server.getHandler("list_sessions");
  });

  // ── No token path ─────────────────────────────────────────

  describe("no token provided", () => {
    it("returns SID_REQUIRED error when token is omitted", async () => {
      mocks.requireAuth.mockReturnValue({ code: "SID_REQUIRED", message: "token is required." });
      const result = await call({});
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });
  });

  // ── Authenticated path ─────────────────────────────────────

  describe("authenticated (with valid token)", () => {
    it("returns full session details and active_sid", async () => {
      mocks.listSessions.mockReturnValue([
        { sid: 1, name: "alpha", color: "🟦", createdAt: "2026-01-01T00:00:00.000Z" },
        { sid: 2, name: "beta", color: "🟩", createdAt: "2026-01-01T00:01:00.000Z" },
      ]);
      mocks.getActiveSession.mockReturnValue(2);
      mocks.requireAuth.mockReturnValue(1); // auth succeeds

      const result = parseResult<AuthenticatedResult>(await call({ token: VALID_TOKEN }));

      expect(result.active_sid).toBe(2);
      expect(result.sessions).toHaveLength(2);
      expect(result.sessions[0]).toEqual({
        sid: 1,
        name: "alpha",
        color: "🟦",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      expect(result.sessions[1].sid).toBe(2);
    });

    it("returns empty sessions array and active_sid 0 when authenticated but no sessions exist", async () => {
      mocks.listSessions.mockReturnValue([]);
      mocks.getActiveSession.mockReturnValue(0);
      mocks.requireAuth.mockReturnValue(1);

      const result = parseResult<AuthenticatedResult>(await call({ token: VALID_TOKEN }));
      expect(result).toEqual({ sessions: [], active_sid: 0 });
    });

    it("returns active_sid 0 when authenticated and no session is currently active", async () => {
      mocks.listSessions.mockReturnValue([
        { sid: 1, name: "", color: "🟦", createdAt: "2026-01-01T00:00:00.000Z" },
      ]);
      mocks.getActiveSession.mockReturnValue(0);
      mocks.requireAuth.mockReturnValue(1);

      const result = parseResult<AuthenticatedResult>(await call({ token: VALID_TOKEN }));
      expect(result.active_sid).toBe(0);
    });

    it("calls requireAuth with the provided token", async () => {
      mocks.requireAuth.mockReturnValue(1);
      await call({ token: VALID_TOKEN });
      expect(mocks.requireAuth).toHaveBeenCalledWith(VALID_TOKEN);
    });
  });

  // ── Auth failure path ──────────────────────────────────────

  describe("invalid token", () => {
    it("returns AUTH_FAILED error when token is invalid", async () => {
      mocks.requireAuth.mockReturnValue({
        code: "AUTH_FAILED",
        message: "Invalid token. Call session_start to get a fresh token.",
      });
      const result = await call({ token: 9_999_999 });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });
  });
});
