import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode, type ToolHandler } from "./test-utils.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  rollLog: vi.fn((): string | null => null),
  sendServiceMessage: vi.fn(() => Promise.resolve()),
  resolveChat: vi.fn(() => 1001),
}));

vi.mock("../local-log.js", () => ({
  rollLog: mocks.rollLog,
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    sendServiceMessage: mocks.sendServiceMessage,
    resolveChat: mocks.resolveChat,
  };
});

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => 0,
  getActiveSession: () => 0,
  validateSession: mocks.validateSession,
}));

import { register } from "./roll_log.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("roll_log tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.rollLog.mockReturnValue(null);
    mocks.sendServiceMessage.mockResolvedValue(undefined);

    const server = createMockServer();
    register(server);
    call = server.getHandler("roll_log");
  });

  // -------------------------------------------------------------------------
  // Auth gate
  // -------------------------------------------------------------------------

  describe("auth gate", () => {
    it("returns SID_REQUIRED when no token provided", async () => {
      const result = await call({});
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when token has wrong PIN", async () => {
      mocks.validateSession.mockReturnValueOnce(false);
      const result = await call({ token: 1099999 });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });

    it("proceeds when identity is valid", async () => {
      mocks.validateSession.mockReturnValueOnce(true);
      let code: string | undefined;
      try { code = errorCode(await call({ token: 1099999 })); } catch { /* gate passed */ }
      expect(code).not.toBe("SID_REQUIRED");
      expect(code).not.toBe("AUTH_FAILED");
    });
  });

  // -------------------------------------------------------------------------
  // Roll on empty buffer
  // -------------------------------------------------------------------------

  it("returns rolled: false when buffer is empty", async () => {
    mocks.rollLog.mockReturnValue(null);
    const result = parseResult(await call({ token: 1123456 }));
    expect(result.rolled).toBe(false);
    expect(result.message).toBeDefined();
  });

  it("does not call sendServiceMessage when buffer is empty", async () => {
    mocks.rollLog.mockReturnValue(null);
    await call({ token: 1123456 });
    await Promise.resolve();
    expect(mocks.sendServiceMessage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Roll with events
  // -------------------------------------------------------------------------

  it("returns rolled: true and filename when events exist", async () => {
    mocks.rollLog.mockReturnValue("2025-04-05T143022.json");
    const result = parseResult(await call({ token: 1123456 }));
    expect(result.rolled).toBe(true);
    expect(result.filename).toBe("2025-04-05T143022.json");
  });

  it("rollLog() is invoked on every authenticated call", async () => {
    await call({ token: 1123456 });
    expect(mocks.rollLog).toHaveBeenCalledOnce();
  });

  it("emits service notification with archived filename after successful roll", async () => {
    mocks.rollLog.mockReturnValue("2025-04-05T143022.json");
    await call({ token: 1123456 });
    await Promise.resolve();
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("2025-04-05T143022.json"),
    );
  });
});
