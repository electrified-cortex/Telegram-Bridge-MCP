import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode, type ToolHandler } from "./test-utils.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  listLogs: vi.fn((): string[] => []),
  getCurrentLogFilename: vi.fn((): string | null => null),
  isLoggingEnabled: vi.fn((): boolean => true),
}));

vi.mock("../local-log.js", () => ({
  listLogs: mocks.listLogs,
  getCurrentLogFilename: mocks.getCurrentLogFilename,
  isLoggingEnabled: mocks.isLoggingEnabled,
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual };
});

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => 0,
  getActiveSession: () => 0,
  validateSession: mocks.validateSession,
}));

import { register } from "./list_logs.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("list_logs tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.listLogs.mockReturnValue([]);
    mocks.getCurrentLogFilename.mockReturnValue(null);
    mocks.isLoggingEnabled.mockReturnValue(true);

    const server = createMockServer();
    register(server);
    call = server.getHandler("list_logs");
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
  // Result shape
  // -------------------------------------------------------------------------

  it("returns empty archived_logs when no log files exist", async () => {
    mocks.listLogs.mockReturnValue([]);
    mocks.getCurrentLogFilename.mockReturnValue(null);
    const result = parseResult(await call({ token: 1123456 }));
    expect(result).toMatchObject({
      archived_logs: [],
      archived_count: 0,
      current_log: null,
    });
  });

  it("returns archived log filenames sorted oldest-first", async () => {
    mocks.listLogs.mockReturnValue([
      "2025-04-04T100000.json",
      "2025-04-05T143022.json",
    ]);
    const result = parseResult(await call({ token: 1123456 }));
    expect(result).toMatchObject({
      archived_logs: ["2025-04-04T100000.json", "2025-04-05T143022.json"],
      archived_count: 2,
    });
  });

  it("returns the current active log filename", async () => {
    mocks.getCurrentLogFilename.mockReturnValue("2025-04-05T160000.json");
    const result = parseResult(await call({ token: 1123456 }));
    expect(result).toMatchObject({ current_log: "2025-04-05T160000.json" });
  });

  it("returns logging_enabled: true when logging is on", async () => {
    mocks.isLoggingEnabled.mockReturnValue(true);
    const result = parseResult(await call({ token: 1123456 }));
    expect(result).toMatchObject({ logging_enabled: true });
  });

  it("returns logging_enabled: false when logging is off", async () => {
    mocks.isLoggingEnabled.mockReturnValue(false);
    const result = parseResult(await call({ token: 1123456 }));
    expect(result).toMatchObject({ logging_enabled: false });
  });

  it("returns all four fields in the response", async () => {
    mocks.listLogs.mockReturnValue(["2025-04-05T143022.json"]);
    mocks.getCurrentLogFilename.mockReturnValue("2025-04-05T160000.json");
    mocks.isLoggingEnabled.mockReturnValue(true);
    const result = parseResult(await call({ token: 1123456 }));
    expect(result).toHaveProperty("logging_enabled");
    expect(result).toHaveProperty("current_log");
    expect(result).toHaveProperty("archived_logs");
    expect(result).toHaveProperty("archived_count");
  });
});
