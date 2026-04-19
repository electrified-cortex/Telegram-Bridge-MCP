import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode, type ToolHandler } from "./test-utils.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  enableLogging: vi.fn(),
  disableLogging: vi.fn(),
  isLoggingEnabled: vi.fn(() => false),
}));

vi.mock("../local-log.js", () => ({
  enableLogging: mocks.enableLogging,
  disableLogging: mocks.disableLogging,
  isLoggingEnabled: mocks.isLoggingEnabled,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => 0,
  getActiveSession: () => 0,
  validateSession: mocks.validateSession,
}));

import { register } from "./toggle_logging.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("toggle_logging tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.isLoggingEnabled.mockReturnValue(false);

    const server = createMockServer();
    register(server);
    call = server.getHandler("toggle_logging");
  });

  // -------------------------------------------------------------------------
  // Auth gate
  // -------------------------------------------------------------------------

  describe("auth gate", () => {
    it("returns SID_REQUIRED when no token provided", async () => {
      const result = await call({ enabled: true });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when token has wrong suffix", async () => {
      mocks.validateSession.mockReturnValueOnce(false);
      const result = await call({ enabled: true, token: 1099999 });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });
  });

  // -------------------------------------------------------------------------
  // Enable logging
  // -------------------------------------------------------------------------

  describe("enable logging", () => {
    it("calls enableLogging when enabled is true", async () => {
      mocks.isLoggingEnabled.mockReturnValue(true);
      await call({ enabled: true, token: 1123456 });
      expect(mocks.enableLogging).toHaveBeenCalledOnce();
      expect(mocks.disableLogging).not.toHaveBeenCalled();
    });

    it("returns logging_enabled: true after enabling", async () => {
      mocks.isLoggingEnabled.mockReturnValue(true);
      const result = parseResult(await call({ enabled: true, token: 1123456 }));
      expect(result.logging_enabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Disable logging
  // -------------------------------------------------------------------------

  describe("disable logging", () => {
    it("calls disableLogging when enabled is false", async () => {
      mocks.isLoggingEnabled.mockReturnValue(false);
      await call({ enabled: false, token: 1123456 });
      expect(mocks.disableLogging).toHaveBeenCalledOnce();
      expect(mocks.enableLogging).not.toHaveBeenCalled();
    });

    it("returns logging_enabled: false after disabling", async () => {
      mocks.isLoggingEnabled.mockReturnValue(false);
      const result = parseResult(await call({ enabled: false, token: 1123456 }));
      expect(result.logging_enabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // State reflection
  // -------------------------------------------------------------------------

  it("reflects post-toggle state from isLoggingEnabled, not the input parameter", async () => {
    // Call with enabled:true but mock isLoggingEnabled to return false (opposite of input).
    // If the tool echoes the input parameter instead of calling isLoggingEnabled(),
    // it would return true — this test would catch that bug.
    mocks.enableLogging.mockImplementation(() => {});
    mocks.isLoggingEnabled.mockReturnValue(false); // opposite of input
    const result = parseResult(await call({ enabled: true, token: 1123456 }));
    expect(result.logging_enabled).toBe(false); // must reflect what isLoggingEnabled() returned
  });
});
