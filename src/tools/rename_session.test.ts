import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, type ToolHandler } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn().mockReturnValue([]),
  renameSession: vi.fn(),
  setSessionColor: vi.fn(),
  validateSession: vi.fn().mockReturnValue(true),
  requestOperatorApproval: vi.fn().mockResolvedValue("approved"),
  getGovernorSid: vi.fn().mockReturnValue(0),
}));

vi.mock("../session-manager.js", () => ({
  listSessions: mocks.listSessions,
  renameSession: mocks.renameSession,
  setSessionColor: mocks.setSessionColor,
  validateSession: mocks.validateSession,
  COLOR_PALETTE: ["🟦", "🟩", "🟨", "🟧", "🟥", "🟪"],
}));

vi.mock("../built-in-commands.js", () => ({
  requestOperatorApproval: mocks.requestOperatorApproval,
}));

vi.mock("../routing-mode.js", () => ({
  getGovernorSid: () => mocks.getGovernorSid(),
}));

import { register } from "./rename_session.js";

describe("rename_session tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSessions.mockReturnValue([]);
    mocks.validateSession.mockReturnValue(true);
    mocks.renameSession.mockReturnValue({ old_name: "Primary", new_name: "Scout" });
    mocks.setSessionColor.mockReturnValue("🟦");
    mocks.requestOperatorApproval.mockResolvedValue("approved");
    mocks.getGovernorSid.mockReturnValue(0); // not governor by default
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

    const result = parseResult(await call({ token: 1111111, new_name: "Scout" }));

    expect(result).toEqual({ sid: 1, old_name: "Primary", new_name: "Scout" });
    expect(mocks.renameSession).toHaveBeenCalledWith(1, "Scout");
  });

  it("trims whitespace from new_name before applying", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);
    mocks.renameSession.mockReturnValue({ old_name: "Primary", new_name: "Scout" });

    await call({ token: 1111111, new_name: "  Scout  " });

    expect(mocks.renameSession).toHaveBeenCalledWith(1, "Scout");
  });

  it("allows rename to same name (no collision with own SID)", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);
    mocks.renameSession.mockReturnValue({ old_name: "Primary", new_name: "Primary" });

    const result = parseResult(await call({ token: 1111111, new_name: "Primary" }));

    expect(result.new_name).toBe("Primary");
    expect(mocks.renameSession).toHaveBeenCalledWith(1, "Primary");
  });

  // =========================================================================
  // Auth failures
  // =========================================================================

  it("returns AUTH_FAILED when credentials are invalid", async () => {
    mocks.validateSession.mockReturnValue(false);

    const result = await call({ token: 1999999, new_name: "Scout" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("AUTH_FAILED");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Name validation
  // =========================================================================

  it("rejects empty name → INVALID_NAME", async () => {
    const result = await call({ token: 1111111, new_name: "" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only name → INVALID_NAME", async () => {
    const result = await call({ token: 1111111, new_name: "   " });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  it("rejects name with symbols → INVALID_NAME", async () => {
    const result = await call({ token: 1111111, new_name: "Scout!" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  it("rejects name with underscore → INVALID_NAME", async () => {
    const result = await call({ token: 1111111, new_name: "Scout_2" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
  });

  it("rejects name with emoji → INVALID_NAME", async () => {
    const result = await call({ token: 1111111, new_name: "Scout🤖" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_NAME");
  });

  it("accepts alphanumeric name with spaces", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Old Name" }]);
    mocks.renameSession.mockReturnValue({ old_name: "Old Name", new_name: "Scout Alpha" });

    const result = parseResult(await call({ token: 1111111, new_name: "Scout Alpha" }));

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

    const result = await call({ token: 1111111, new_name: "Scout" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("NAME_CONFLICT");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  it("collision check is case-insensitive", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Primary" },
      { sid: 2, name: "scout" },
    ]);

    const result = await call({ token: 1111111, new_name: "SCOUT" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("NAME_CONFLICT");
  });

  it("does not collide with own SID (rename to same name)", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);
    mocks.renameSession.mockReturnValue({ old_name: "Primary", new_name: "Primary" });

    const result = parseResult(await call({ token: 1111111, new_name: "Primary" }));

    expect(result.new_name).toBe("Primary");
  });

  // =========================================================================
  // Session not found (edge case)
  // =========================================================================

  it("returns SESSION_NOT_FOUND if renameSession returns null", async () => {
    mocks.renameSession.mockReturnValue(null);

    const result = await call({ token: 1111111, new_name: "NewName" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("SESSION_NOT_FOUND");
  });

  // =========================================================================
  // Operator approval gate
  // =========================================================================

  it("requests operator approval before renaming", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);
    mocks.renameSession.mockReturnValue({ old_name: "Primary", new_name: "Scout" });

    await call({ token: 1111111, new_name: "Scout" });

    expect(mocks.requestOperatorApproval).toHaveBeenCalledOnce();
  });

  it("returns APPROVAL_DENIED when operator denies", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);
    mocks.requestOperatorApproval.mockResolvedValue("denied");

    const result = await call({ token: 1111111, new_name: "Scout" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("APPROVAL_DENIED");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  it("returns APPROVAL_TIMEOUT when operator does not respond", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);
    mocks.requestOperatorApproval.mockResolvedValue("timed_out");

    const result = await call({ token: 1111111, new_name: "Scout" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("APPROVAL_TIMEOUT");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  it("returns APPROVAL_DENIED when approval prompt fails to send", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);
    mocks.requestOperatorApproval.mockResolvedValue("send_failed");

    const result = await call({ token: 1111111, new_name: "Scout" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("APPROVAL_DENIED");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  it("does not request approval for invalid names (approval not reached)", async () => {
    const result = await call({ token: 1111111, new_name: "" });

    expect(isError(result)).toBe(true);
    expect(mocks.requestOperatorApproval).not.toHaveBeenCalled();
  });

  it("does not request approval when auth fails", async () => {
    mocks.validateSession.mockReturnValue(false);

    const result = await call({ token: 1999999, new_name: "Scout" });

    expect(isError(result)).toBe(true);
    expect(mocks.requestOperatorApproval).not.toHaveBeenCalled();
  });

  it("does not request approval when name collides", async () => {
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Primary" },
      { sid: 2, name: "Scout" },
    ]);

    const result = await call({ token: 1111111, new_name: "Scout" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("NAME_CONFLICT");
    expect(mocks.requestOperatorApproval).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Color param
  // =========================================================================

  it("applies color change when color is provided", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);
    mocks.renameSession.mockReturnValue({ old_name: "Primary", new_name: "Scout" });
    mocks.setSessionColor.mockReturnValue("🟦");

    const result = parseResult(await call({ token: 1111111, new_name: "Scout", color: "🟦" }));

    expect(mocks.setSessionColor).toHaveBeenCalledWith(1, "🟦");
    expect(result.color).toBe("🟦");
  });

  it("does not include color in result when color is not provided", async () => {
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);
    mocks.renameSession.mockReturnValue({ old_name: "Primary", new_name: "Scout" });

    const result = parseResult(await call({ token: 1111111, new_name: "Scout" }));

    expect(mocks.setSessionColor).not.toHaveBeenCalled();
    expect(result.color).toBeUndefined();
  });

  it("rejects invalid color → INVALID_COLOR", async () => {
    const result = await call({ token: 1111111, new_name: "Scout", color: "🔴" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_COLOR");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });

  it("rejects invalid color before validation/approval (early exit)", async () => {
    const result = await call({ token: 1111111, new_name: "Scout", color: "notacolor" });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("INVALID_COLOR");
    expect(mocks.requestOperatorApproval).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Governor targeting (target_sid)
  // =========================================================================

  it("governor can rename another session via target_sid", async () => {
    mocks.getGovernorSid.mockReturnValue(1); // caller sid=1 is governor
    mocks.listSessions.mockReturnValue([
      { sid: 1, name: "Governor" },
      { sid: 2, name: "Worker" },
    ]);
    mocks.renameSession.mockReturnValue({ old_name: "Worker", new_name: "Scout" });

    const result = parseResult(await call({ token: 1111111, new_name: "Scout", target_sid: 2 }));

    expect(mocks.renameSession).toHaveBeenCalledWith(2, "Scout");
    expect(result.sid).toBe(2);
    expect(result.new_name).toBe("Scout");
  });

  it("returns PERMISSION_DENIED when non-governor uses target_sid", async () => {
    mocks.getGovernorSid.mockReturnValue(5); // caller sid=1 is not governor
    mocks.listSessions.mockReturnValue([{ sid: 1, name: "Primary" }]);

    const result = await call({ token: 1111111, new_name: "Scout", target_sid: 2 });

    expect(isError(result)).toBe(true);
    expect(JSON.stringify(result)).toContain("PERMISSION_DENIED");
    expect(mocks.renameSession).not.toHaveBeenCalled();
  });
});
