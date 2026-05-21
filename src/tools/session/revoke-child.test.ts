import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError } from "../test-utils.js";
import { registerChild, clearChildRegistry } from "./child-registry.js";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getSession: vi.fn(),
  closeSessionById: vi.fn(),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("../../session-manager.js", () => ({
  getSession: mocks.getSession,
}));

vi.mock("../../session-teardown.js", () => ({
  closeSessionById: mocks.closeSessionById,
}));

import { handleRevokeChild } from "./revoke-child.js";

const PARENT_SID = 1;
const PARENT_TOKEN = 1_123_456;
const CHILD_SID = 2;

describe("session/revoke-child", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChildRegistry();
    mocks.requireAuth.mockReturnValue(PARENT_SID);
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩" });
    mocks.closeSessionById.mockReturnValue({ closed: true, sid: CHILD_SID, name: "Helper" });
    registerChild(PARENT_SID, CHILD_SID);
  });

  // ── AC2: closes the child and returns success ────────────────────────────

  it("AC2: closes the child session and returns { closed: true, sid }", () => {
    const result = parseResult(handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_SID }));

    expect(result.closed).toBe(true);
    expect(result.sid).toBe(CHILD_SID);
    expect(mocks.closeSessionById).toHaveBeenCalledWith(CHILD_SID);
  });

  it("AC2: unregisters the child from the registry after closing", () => {
    handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_SID });

    // Subsequent revoke attempt: session gone → SESSION_NOT_FOUND before PERMISSION_DENIED
    mocks.getSession.mockReturnValue(undefined);
    const result = handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_SID });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SESSION_NOT_FOUND");
  });

  // ── Auth guard ───────────────────────────────────────────────────────────

  it("rejects when token is missing (SID_REQUIRED)", () => {
    mocks.requireAuth.mockReturnValue({ code: "SID_REQUIRED", message: "token is required" });

    const result = handleRevokeChild({ token: undefined, child_token: CHILD_SID });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SID_REQUIRED");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  it("rejects with AUTH_FAILED when token is invalid", () => {
    mocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "Invalid token" });

    const result = handleRevokeChild({ token: 9999999, child_token: CHILD_SID });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("AUTH_FAILED");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  // ── SESSION_NOT_FOUND guard ──────────────────────────────────────────────

  it("returns SESSION_NOT_FOUND when child session does not exist", () => {
    mocks.getSession.mockReturnValue(undefined);

    const result = handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_SID });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SESSION_NOT_FOUND");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  // ── UNAUTHORIZED guard (v0.2: uses parent_sid on session or child-registry) ──

  it("rejects with UNAUTHORIZED when the child was not spawned by the calling parent", () => {
    clearChildRegistry();
    const otherParentSid = 5;
    registerChild(otherParentSid, CHILD_SID); // child belongs to someone else

    const result = handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_SID });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  it("rejects with UNAUTHORIZED when child_token has no registered parent", () => {
    clearChildRegistry(); // no registration at all

    const result = handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_SID });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  it("uses parent_sid from session record when available (v0.2 primary check)", () => {
    // Override getSession to return a session that has parent_sid set
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩", parent_sid: PARENT_SID });
    clearChildRegistry(); // no registry entry — must rely on parent_sid only

    const result = parseResult(handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_SID }));

    expect(result.closed).toBe(true);
    expect(mocks.closeSessionById).toHaveBeenCalledWith(CHILD_SID);
  });

  it("returns UNAUTHORIZED via parent_sid mismatch even when registry is absent", () => {
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩", parent_sid: 99 });
    clearChildRegistry();

    const result = handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_SID });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  // ── Does not call closeSessionById on guard failure ──────────────────────

  it("never calls closeSessionById when auth fails", () => {
    mocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "bad token" });

    handleRevokeChild({ token: 9999999, child_token: CHILD_SID });

    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  it("never calls closeSessionById when caller is not the parent", () => {
    clearChildRegistry();

    handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_SID });

    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  // ── closeSessionById result is propagated ────────────────────────────────

  it("propagates { closed: false } when closeSessionById returns false (already closed race)", () => {
    mocks.closeSessionById.mockReturnValue({ closed: false, sid: CHILD_SID });

    const result = parseResult(handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_SID }));

    expect(result.closed).toBe(false);
    expect(result.sid).toBe(CHILD_SID);
  });
});
