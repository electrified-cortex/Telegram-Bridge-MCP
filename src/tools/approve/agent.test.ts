import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode, type ToolHandler } from "../test-utils.js";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => true),
  isDelegationEnabled: vi.fn(() => false),
  getPendingApproval: vi.fn((..._args: unknown[]) => undefined as { resolve: ReturnType<typeof vi.fn>; name: string; registeredAt: number; colorHint?: string } | undefined),
  clearPendingApproval: vi.fn(),
  getAvailableColors: vi.fn((..._args: unknown[]) => ["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"] as string[]),
  getGovernorSid: vi.fn(() => 0),
  stderrWrite: vi.fn(),
}));

vi.mock("../../session-manager.js", () => ({
  validateSession: mocks.validateSession,
  getAvailableColors: (...args: unknown[]) => mocks.getAvailableColors(...args),
  COLOR_PALETTE: ["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"],
  activeSessionCount: () => 0,
  getActiveSession: () => 0,
}));

vi.mock("../../agent-approval.js", () => ({
  isDelegationEnabled: () => mocks.isDelegationEnabled(),
  getPendingApproval: (...args: unknown[]) => mocks.getPendingApproval(...(args as [string])),
  clearPendingApproval: (...args: unknown[]) => mocks.clearPendingApproval(...args),
}));

vi.mock("../../routing-mode.js", () => ({
  getGovernorSid: () => mocks.getGovernorSid(),
}));

import { register } from "./agent.js";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("approve_agent tool", () => {
  let call: ToolHandler;
  // Valid token: sid=1, suffix=123456 → token=1_123_456
  const VALID_TOKEN = 1_123_456;
  const VALID_TICKET = "abcdef1234567890abcdef1234567890";
  const mockResolve = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.isDelegationEnabled.mockReturnValue(true);
    mocks.getPendingApproval.mockReturnValue({
      name: "Worker",
      resolve: mockResolve,
      registeredAt: Date.now(),
    });
    mocks.getAvailableColors.mockReturnValue(["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"]);
    mocks.getGovernorSid.mockReturnValue(0);

    vi.spyOn(process.stderr, "write").mockImplementation(mocks.stderrWrite);

    const server = createMockServer();
    register(server);
    call = server.getHandler("approve_agent");
  });

  // -------------------------------------------------------------------------
  // Auth gate
  // -------------------------------------------------------------------------

  describe("authentication", () => {
    it("returns SID_REQUIRED when no token provided", async () => {
      const result = await call({ ticket: VALID_TICKET });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when token is invalid", async () => {
      mocks.validateSession.mockReturnValue(false);
      const result = await call({ token: 1_999_999, ticket: VALID_TICKET });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });
  });

  // -------------------------------------------------------------------------
  // DELEGATION_DISABLED
  // -------------------------------------------------------------------------

  describe("delegation disabled", () => {
    it("returns BLOCKED error containing DELEGATION_DISABLED when delegation is off", async () => {
      mocks.isDelegationEnabled.mockReturnValue(false);
      const result = await call({ token: VALID_TOKEN, ticket: VALID_TICKET });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("BLOCKED");
      const parsed = parseResult(result);
      expect(String(parsed.message)).toContain("DELEGATION_DISABLED");
    });
  });
  // -------------------------------------------------------------------------
  // Governor check
  // -------------------------------------------------------------------------

  describe("governor check", () => {
    it("allows approval when governor SID is 0 (no governor set)", async () => {
      mocks.getGovernorSid.mockReturnValue(0);
      const result = parseResult(await call({ token: VALID_TOKEN, ticket: VALID_TICKET, color: "🟩" }));
      expect(result.name).toBe("Worker");
    });

    it("returns UNAUTHORIZED_SENDER when caller is not the governor", async () => {
      mocks.getGovernorSid.mockReturnValue(99); // caller SID is 1, governor is 99
      const result = await call({ token: VALID_TOKEN, ticket: VALID_TICKET, color: "🟩" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("UNAUTHORIZED_SENDER");
      const parsed = parseResult(result);
      expect(String(parsed.message)).toContain("GOVERNOR_ONLY");
    });

    it("allows approval when caller IS the governor", async () => {
      mocks.getGovernorSid.mockReturnValue(1); // caller SID is 1 == governor
      const result = parseResult(await call({ token: VALID_TOKEN, ticket: VALID_TICKET, color: "🟩" }));
      expect(result.name).toBe("Worker");
    });
  });
  // -------------------------------------------------------------------------
  // NOT_PENDING
  // -------------------------------------------------------------------------

  describe("not pending", () => {
    it("returns NOT_PENDING error for unknown ticket", async () => {
      mocks.getPendingApproval.mockReturnValue(undefined);
      const result = await call({ token: VALID_TOKEN, ticket: "ghostticket00000000000000000000" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("NOT_PENDING");
      const parsed = parseResult(result);
      expect(String(parsed.message)).toContain("ghostticket00000000000000000000");
    });
  });

  // -------------------------------------------------------------------------
  // INVALID_COLOR
  // -------------------------------------------------------------------------

  describe("invalid color", () => {
    it("returns INVALID_COLOR error for unrecognised color string", async () => {
      const result = await call({ token: VALID_TOKEN, ticket: VALID_TICKET, color: "🔴" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("INVALID_COLOR");
      const parsed = parseResult(result);
      expect(String(parsed.message)).toContain("🔴");
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("happy path", () => {
    it("calls clearPendingApproval BEFORE pending.resolve", async () => {
      const callOrder: string[] = [];
      mocks.clearPendingApproval.mockImplementation(() => { callOrder.push("clear"); });
      mockResolve.mockImplementation(() => { callOrder.push("resolve"); });

      await call({ token: VALID_TOKEN, ticket: VALID_TICKET, color: "🟩" });

      expect(callOrder).toEqual(["clear", "resolve"]);
    });

    it("resolves pending approval with approved: true and the specified color", async () => {
      await call({ token: VALID_TOKEN, ticket: VALID_TICKET, color: "🟩" });
      expect(mockResolve).toHaveBeenCalledWith({
        approved: true,
        color: "🟩",
        forceColor: true,
      });
    });

    it("calls clearPendingApproval with the ticket", async () => {
      await call({ token: VALID_TOKEN, ticket: VALID_TICKET, color: "🟩" });
      expect(mocks.clearPendingApproval).toHaveBeenCalledWith(VALID_TICKET);
    });

    it("returns approved color and name from the pending entry", async () => {
      const result = parseResult(await call({ token: VALID_TOKEN, ticket: VALID_TICKET, color: "🟩" }));
      expect(result.color).toBe("🟩");
      expect(result.name).toBe("Worker");
    });

    it("writes an audit log line to stderr", async () => {
      await call({ token: VALID_TOKEN, ticket: VALID_TICKET, color: "🟩" });
      expect(mocks.stderrWrite).toHaveBeenCalledOnce();
      const logLine = String(mocks.stderrWrite.mock.calls[0][0]);
      expect(logLine).toContain("[agent-approval]");
      expect(logLine).toContain("name=Worker");
      expect(logLine).toContain("color=🟩");
    });
  });

  // -------------------------------------------------------------------------
  // Color fallback
  // -------------------------------------------------------------------------

  describe("color fallback", () => {
    it("uses the first available color when color is omitted", async () => {
      mocks.getAvailableColors.mockReturnValue(["🟧", "🟥"]);
      const result = parseResult(await call({ token: VALID_TOKEN, ticket: VALID_TICKET }));
      expect(result.color).toBe("🟧");
      expect(mockResolve).toHaveBeenCalledWith({
        approved: true,
        color: "🟧",
        forceColor: true,
      });
    });

    it("falls back to first palette color when getAvailableColors returns empty", async () => {
      mocks.getAvailableColors.mockReturnValue([]);
      const result = parseResult(await call({ token: VALID_TOKEN, ticket: VALID_TICKET }));
      expect(result.color).toBe("🟦");
    });

    it("uses colorHint directly when no explicit color is given", async () => {
      mocks.getPendingApproval.mockReturnValue({
        name: "Worker",
        resolve: mockResolve,
        registeredAt: Date.now(),
        colorHint: "🟩",
      });
      const result = parseResult(await call({ token: VALID_TOKEN, ticket: VALID_TICKET }));
      expect(result.color).toBe("🟩");
      expect(mocks.getAvailableColors).not.toHaveBeenCalled();
      expect(mockResolve).toHaveBeenCalledWith({ approved: true, color: "🟩", forceColor: true });
    });

    it("uses colorHint directly even if that color is already in use by another session", async () => {
      mocks.getPendingApproval.mockReturnValue({
        name: "Worker",
        resolve: mockResolve,
        registeredAt: Date.now(),
        colorHint: "🟩",
      });
      // Simulate 🟩 in-use — should NOT affect the resolved color
      mocks.getAvailableColors.mockReturnValue(["🟦", "🟧", "🟩"]);
      const result = parseResult(await call({ token: VALID_TOKEN, ticket: VALID_TICKET }));
      expect(result.color).toBe("🟩");
      expect(mocks.getAvailableColors).not.toHaveBeenCalled();
    });

    it("passes undefined colorHint to getAvailableColors when pending has no hint", async () => {
      // pending.colorHint is undefined — getAvailableColors should still be called (with no args)
      mocks.getPendingApproval.mockReturnValue({
        name: "Worker",
        resolve: mockResolve,
        registeredAt: Date.now(),
        // no colorHint property
      });
      mocks.getAvailableColors.mockReturnValue(["🟦", "🟧"]);
      const result = parseResult(await call({ token: VALID_TOKEN, ticket: VALID_TICKET }));
      expect(mocks.getAvailableColors).toHaveBeenCalledWith();
      expect(result.color).toBe("🟦");
    });

    it("allows two agents with the same colorHint to both get that color", async () => {
      // First approval: Worker 1 with colorHint yellow
      mocks.getPendingApproval.mockReturnValue({
        name: "Worker 1",
        resolve: mockResolve,
        registeredAt: Date.now(),
        colorHint: "🟨",
      });
      const result1 = parseResult(await call({ token: VALID_TOKEN, ticket: VALID_TICKET }));
      expect(result1.color).toBe("🟨");

      // Second approval: Worker 2 also with colorHint yellow
      const mockResolve2 = vi.fn();
      mocks.getPendingApproval.mockReturnValue({
        name: "Worker 2",
        resolve: mockResolve2,
        registeredAt: Date.now(),
        colorHint: "🟨",
      });
      const result2 = parseResult(await call({ token: VALID_TOKEN, ticket: VALID_TICKET }));
      expect(result2.color).toBe("🟨");
    });
  });
});
