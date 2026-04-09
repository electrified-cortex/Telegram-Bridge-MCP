import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode, type ToolHandler } from "./test-utils.js";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => true),
  isDelegationEnabled: vi.fn(() => false),
  getPendingApproval: vi.fn(() => undefined as { resolve: ReturnType<typeof vi.fn>; name: string; registeredAt: number } | undefined),
  clearPendingApproval: vi.fn(),
  getAvailableColors: vi.fn(() => ["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"] as string[]),
  getGovernorSid: vi.fn(() => 0),
  stderrWrite: vi.fn(),
}));

vi.mock("../session-manager.js", () => ({
  validateSession: mocks.validateSession,
  getAvailableColors: (...args: unknown[]) => mocks.getAvailableColors(...args),
  COLOR_PALETTE: ["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"],
  activeSessionCount: () => 0,
  getActiveSession: () => 0,
}));

vi.mock("../agent-approval.js", () => ({
  isDelegationEnabled: () => mocks.isDelegationEnabled(),
  getPendingApproval: (...args: unknown[]) => mocks.getPendingApproval(...(args as [string])),
  clearPendingApproval: (...args: unknown[]) => mocks.clearPendingApproval(...args),
}));

vi.mock("../routing-mode.js", () => ({
  getGovernorSid: () => mocks.getGovernorSid(),
}));

import { register } from "./approve_agent.js";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("approve_agent tool", () => {
  let call: ToolHandler;
  // Valid token: sid=1, pin=123456 → token=1_123_456
  const VALID_TOKEN = 1_123_456;
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
      const result = await call({ target_name: "Worker" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when token is invalid", async () => {
      mocks.validateSession.mockReturnValue(false);
      const result = await call({ token: 1_999_999, target_name: "Worker" });
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
      const result = await call({ token: VALID_TOKEN, target_name: "Worker" });
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
      const result = parseResult(await call({ token: VALID_TOKEN, target_name: "Worker", color: "🟩" }));
      expect(result.approved).toBe(true);
    });

    it("returns UNAUTHORIZED when caller is not the governor", async () => {
      mocks.getGovernorSid.mockReturnValue(99); // caller SID is 1, governor is 99
      const result = await call({ token: VALID_TOKEN, target_name: "Worker", color: "🟩" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("UNAUTHORIZED");
      const parsed = parseResult(result);
      expect(String(parsed.message)).toContain("GOVERNOR_ONLY");
    });

    it("allows approval when caller IS the governor", async () => {
      mocks.getGovernorSid.mockReturnValue(1); // caller SID is 1 == governor
      const result = parseResult(await call({ token: VALID_TOKEN, target_name: "Worker", color: "🟩" }));
      expect(result.approved).toBe(true);
    });
  });
  // -------------------------------------------------------------------------
  // NOT_PENDING
  // -------------------------------------------------------------------------

  describe("not pending", () => {
    it("returns UNKNOWN error containing NOT_PENDING for unknown target_name", async () => {
      mocks.getPendingApproval.mockReturnValue(undefined);
      const result = await call({ token: VALID_TOKEN, target_name: "Ghost" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("UNKNOWN");
      const parsed = parseResult(result);
      expect(String(parsed.message)).toContain("NOT_PENDING");
    });
  });

  // -------------------------------------------------------------------------
  // INVALID_COLOR
  // -------------------------------------------------------------------------

  describe("invalid color", () => {
    it("returns UNKNOWN error containing INVALID_COLOR for unrecognised color string", async () => {
      const result = await call({ token: VALID_TOKEN, target_name: "Worker", color: "🔴" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("UNKNOWN");
      const parsed = parseResult(result);
      expect(String(parsed.message)).toContain("INVALID_COLOR");
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

      await call({ token: VALID_TOKEN, target_name: "Worker", color: "🟩" });

      expect(callOrder).toEqual(["clear", "resolve"]);
    });

    it("resolves pending approval with approved: true and the specified color", async () => {
      await call({ token: VALID_TOKEN, target_name: "Worker", color: "🟩" });
      expect(mockResolve).toHaveBeenCalledWith({
        approved: true,
        color: "🟩",
        forceColor: true,
      });
    });

    it("calls clearPendingApproval with target_name", async () => {
      await call({ token: VALID_TOKEN, target_name: "Worker", color: "🟩" });
      expect(mocks.clearPendingApproval).toHaveBeenCalledWith("Worker");
    });

    it("returns approved: true with the assigned color in the result", async () => {
      const result = parseResult(await call({ token: VALID_TOKEN, target_name: "Worker", color: "🟩" }));
      expect(result.approved).toBe(true);
      expect(result.color).toBe("🟩");
      expect(result.target_name).toBe("Worker");
    });

    it("writes an audit log line to stderr", async () => {
      await call({ token: VALID_TOKEN, target_name: "Worker", color: "🟩" });
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
      const result = parseResult(await call({ token: VALID_TOKEN, target_name: "Worker" }));
      expect(result.color).toBe("🟧");
      expect(mockResolve).toHaveBeenCalledWith({
        approved: true,
        color: "🟧",
        forceColor: true,
      });
    });

    it("falls back to first palette color when getAvailableColors returns empty", async () => {
      mocks.getAvailableColors.mockReturnValue([]);
      const result = parseResult(await call({ token: VALID_TOKEN, target_name: "Worker" }));
      expect(result.color).toBe("🟦");
    });

    it("passes colorHint to getAvailableColors so an in-use hint is not selected directly", async () => {
      mocks.getPendingApproval.mockReturnValue({
        name: "Worker",
        resolve: mockResolve,
        registeredAt: Date.now(),
        colorHint: "🟩",
      });
      mocks.getAvailableColors.mockReturnValue(["🟧", "🟩"]);
      const result = parseResult(await call({ token: VALID_TOKEN, target_name: "Worker" }));
      expect(mocks.getAvailableColors).toHaveBeenCalledWith("🟩");
      expect(result.color).toBe("🟧");
    });

    it("does not use an in-use colorHint — defers to getAvailableColors result", async () => {
      // colorHint is 🟩 but 🟩 is in use, so getAvailableColors promotes another color first
      mocks.getPendingApproval.mockReturnValue({
        name: "Worker",
        resolve: mockResolve,
        registeredAt: Date.now(),
        colorHint: "🟩",
      });
      // Simulate 🟩 in-use: getAvailableColors returns available colors with 🟩 at the end
      mocks.getAvailableColors.mockReturnValue(["🟦", "🟧", "🟩"]);
      const result = parseResult(await call({ token: VALID_TOKEN, target_name: "Worker" }));
      expect(result.color).toBe("🟦");
    });

    it("passes undefined colorHint to getAvailableColors when pending has no hint", async () => {
      // pending.colorHint is undefined — getAvailableColors should still be called (with undefined)
      mocks.getPendingApproval.mockReturnValue({
        name: "Worker",
        resolve: mockResolve,
        registeredAt: Date.now(),
        // no colorHint property
      });
      mocks.getAvailableColors.mockReturnValue(["🟦", "🟧"]);
      const result = parseResult(await call({ token: VALID_TOKEN, target_name: "Worker" }));
      expect(mocks.getAvailableColors).toHaveBeenCalledWith(undefined);
      expect(result.color).toBe("🟦");
    });
  });
});
