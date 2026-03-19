import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn().mockReturnValue([]),
  renameSession: vi.fn(),
  validateSession: vi.fn().mockReturnValue(true),
}));

vi.mock("../session-manager.js", () => ({
  listSessions: (...args: unknown[]) => mocks.listSessions(...args),
  renameSession: (...args: unknown[]) => mocks.renameSession(...args),
  validateSession: (...args: unknown[]) => mocks.validateSession(...args),
}));

import { register } from "./rename_session.js";

describe("rename_session tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSessions.mockReturnValue([]);
    mocks.validateSession.mockReturnValue(true);
    mocks.renameSession.mockReturnValue({ old_name: "Primary", new_name: "Scout" });
    const server = createMockServer();
    register(server);
    call = server.getHandler("rename_session");
  });

  // =========================================================================
  // Success path
  // =========================================================================

  it("renames a session and returns sid, old_name, new_name", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);
    mocks.renameSession.mockReturnValue({ old_name: "Primary", new_name: "Scout" });

    const result = parseResult(await call({ identity: [1, 111111], new_name: "Scout" }));

    expect(result).toEqual({ sid: 1, old_name: "Primary", new_name: "Scout" });
    expect(mocks.renameSession).toHaveBeenCalledWith(1, "Scout");
  });

  it("trims whitespace from new_name before applying", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);
    mocks.renameSession.mockReturnValue({ old_name: "Primary", new_name: "Scout" });

    await call({ identity: [1, 111111], new_name: "  Scout  " });

    expect(mocks.renameSession).toHaveBeenCalledWith(1, "Scout");
  });

  it("allows rename to same name (no collision with own SID)", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);
    mocks.renameSession.mockReturnValue({ old_name: "Primary", new_name: "Primary" });

    const result = parseResult(await call({ identity: [1, 111111], new_name: "Primary" }));

    expect(result.new_name).toBe("Primary");
    expect(mocks.renameSession).toHaveBeenCalledWith(1, "Primary");
  });

  // =========================================================================
  // Auth failures
  // =========================================================================

  it("returns AUTH_FAILED when credentials are invalid", async () => {
    mocks.validateSession.mockReturnValue(false);

    const result = await call({ identity: [1, 999999], new_name: "Scout" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("AUTH_FAILED");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Name validation
  // =========================================================================

  it("rejects empty name → INVALID_NAME", async () => {
    const result = await call({ identity: [1, 111111], new_name: "" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only name → INVALID_NAME", async () => {
    const result = await call({ identity: [1, 111111], new_name: "   " });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  it("rejects name with symbols → INVALID_NAME", async () => {
    const result = await call({ identity: [1, 111111], new_name: "Scout!" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  it("rejects name with underscore → INVALID_NAME", async () => {
    const result = await call({ identity: [1, 111111], new_name: "Scout_2" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
  });

  it("rejects name with emoji → INVALID_NAME", async () => {
    const result = await call({ identity: [1, 111111], new_name: "Scout🤖" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
  });

  it("accepts alphanumeric name with spaces", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Old Name" }]);
    mocks.renameSession.mockReturnValue({ old_name: "Old Name", new_name: "Scout Alpha" });

    const result = parseResult(await call({ identity: [1, 111111], new_name: "Scout Alpha" }));

    expect(result.new_name).toBe("Scout Alpha");
  });

  // =========================================================================
  // Collision guard
  // =========================================================================

  it("rejects rename when new name is taken by another session → NAME_CONFLICT", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Primary" },
      { sid: 2, name: "Scout" },
    ]);

    const result = await call({ identity: [1, 111111], new_name: "Scout" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("NAME_CONFLICT");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  it("collision check is case-insensitive", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Primary" },
      { sid: 2, name: "scout" },
    ]);

    const result = await call({ identity: [1, 111111], new_name: "SCOUT" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("NAME_CONFLICT");
  });

  it("does not collide with own SID (rename to same name)", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);
    mocks.renameSession.mockReturnValue({ old_name: "Primary", new_name: "Primary" });

    const result = parseResult(await call({ identity: [1, 111111], new_name: "Primary" }));

    expect(result.new_name).toBe("Primary");
  });

  // =========================================================================
  // Session not found (edge case)
  // =========================================================================

  it("returns SESSION_NOT_FOUND if renameSession returns null", async () => {
    mocks.renameSession.mockReturnValue(null);

    const result = await call({ identity: [1, 111111], new_name: "NewName" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("SESSION_NOT_FOUND");
  });
});
