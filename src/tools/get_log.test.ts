import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode, type ToolHandler } from "./test-utils.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  getLog: vi.fn((): string => ""),
  listLogs: vi.fn((): string[] => []),
}));

vi.mock("../local-log.js", () => ({
  getLog: mocks.getLog,
  listLogs: mocks.listLogs,
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

import { register } from "./get_log.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("get_log tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.listLogs.mockReturnValue([]);

    const server = createMockServer();
    register(server);
    call = server.getHandler("get_log");
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
  // List mode (no filename)
  // -------------------------------------------------------------------------

  describe("list mode", () => {
    it("returns list of log files when filename is omitted", async () => {
      mocks.listLogs.mockReturnValue(["2025-04-04T100000.json", "2025-04-05T143022.json"]);

      const result = parseResult(await call({ token: 1123456 }));
      expect(result.count).toBe(2);
      expect(result.log_files).toEqual(["2025-04-04T100000.json", "2025-04-05T143022.json"]);
    });

    it("returns empty list when no log files exist", async () => {
      mocks.listLogs.mockReturnValue([]);
      const result = parseResult(await call({ token: 1123456 }));
      expect(result.count).toBe(0);
      expect(result.log_files).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Read mode (filename provided)
  // -------------------------------------------------------------------------

  describe("read mode", () => {
    it("returns file content when filename is provided", async () => {
      const content = '{"events":[{"type":"message"}]}';
      mocks.getLog.mockReturnValue(content);

      const raw = await call({ token: 1123456, filename: "2025-04-05T143022.json" });
      const text = (raw as { content: { text: string }[] }).content[0].text;
      expect(text).toBe(content);
    });

    it("returns error response when file is not found", async () => {
      mocks.getLog.mockImplementation(() => { throw new Error("Log file not found: 2025-04-05T143022.json"); });

      const result = await call({ token: 1123456, filename: "2025-04-05T143022.json" });
      expect(isError(result)).toBe(true);
    });

    it("returns error response for invalid filename (path traversal)", async () => {
      mocks.getLog.mockImplementation(() => { throw new Error("Invalid log filename: ../../etc/passwd"); });

      const result = await call({ token: 1123456, filename: "../../etc/passwd" });
      expect(isError(result)).toBe(true);
    });
  });
});
