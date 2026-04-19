import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode, type ToolHandler } from "./test-utils.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  deleteLog: vi.fn(),
  clearTraceLog: vi.fn(),
}));

vi.mock("../local-log.js", () => ({
  deleteLog: mocks.deleteLog,
}));

vi.mock("../trace-log.js", () => ({
  clearTraceLog: mocks.clearTraceLog,
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

import { register } from "./delete_log.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("delete_log tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.deleteLog.mockImplementation(() => undefined);

    const server = createMockServer();
    register(server);
    call = server.getHandler("delete_log");
  });

  // -------------------------------------------------------------------------
  // Auth gate
  // -------------------------------------------------------------------------

  describe("auth gate", () => {
    it("returns SID_REQUIRED when no token provided", async () => {
      const result = await call({ filename: "2025-04-05T143022.json" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when token has wrong suffix", async () => {
      mocks.validateSession.mockReturnValueOnce(false);
      const result = await call({ token: 1099999, filename: "2025-04-05T143022.json" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });

    it("proceeds when identity is valid", async () => {
      mocks.validateSession.mockReturnValueOnce(true);
      let code: string | undefined;
      try { code = errorCode(await call({ token: 1099999, filename: "2025-04-05T143022.json" })); } catch { /* gate passed */ }
      expect(code).not.toBe("SID_REQUIRED");
      expect(code).not.toBe("AUTH_FAILED");
    });
  });

  // -------------------------------------------------------------------------
  // Success path
  // -------------------------------------------------------------------------

  it("returns deleted: true on success", async () => {
    const result = parseResult(await call({ token: 1123456, filename: "2025-04-05T143022.json" }));
    expect(result.deleted).toBe(true);
    expect(result.filename).toBe("2025-04-05T143022.json");
  });

  it("calls deleteLog with the provided filename", async () => {
    await call({ token: 1123456, filename: "2025-04-05T143022.json" });
    expect(mocks.deleteLog).toHaveBeenCalledWith("2025-04-05T143022.json");
  });

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------

  it("returns error response when file is not found", async () => {
    mocks.deleteLog.mockImplementation(() => { throw new Error("Log file not found: 2025-04-05T143022.json"); });

    const result = await call({ token: 1123456, filename: "2025-04-05T143022.json" });
    expect(isError(result)).toBe(true);
  });

  it("returns error response for invalid filename (path traversal)", async () => {
    mocks.deleteLog.mockImplementation(() => { throw new Error("Invalid log filename: ../../etc/passwd"); });

    const result = await call({ token: 1123456, filename: "../../etc/passwd" });
    expect(isError(result)).toBe(true);
  });

  it("does not call deleteLog when auth fails", async () => {
    mocks.validateSession.mockReturnValue(false);
    await call({ token: 1099999, filename: "2025-04-05T143022.json" });
    expect(mocks.deleteLog).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Trace buffer clear — filename: "trace"
  // -------------------------------------------------------------------------

  describe("trace buffer clear", () => {
    it("calls clearTraceLog and returns deleted: true when filename is 'trace'", async () => {
      const result = parseResult(await call({ token: 1123456, filename: "trace" }));
      expect(result.deleted).toBe(true);
      expect(result.filename).toBe("trace");
      expect(mocks.clearTraceLog).toHaveBeenCalledOnce();
    });

    it("does not call deleteLog when filename is 'trace'", async () => {
      await call({ token: 1123456, filename: "trace" });
      expect(mocks.deleteLog).not.toHaveBeenCalled();
    });

    it("includes a note field explaining trace clear", async () => {
      const result = parseResult(await call({ token: 1123456, filename: "trace" }));
      expect(typeof result.note).toBe("string");
    });
  });
});
