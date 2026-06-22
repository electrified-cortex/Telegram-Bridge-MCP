import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError } from "../test-utils.js";
import { registerChild, clearChildRegistry } from "./child-registry.js";

const PARENT_SID = 1;
const PARENT_TOKEN = 1_123_456;
const CHILD_SID = 2;
const CHILD_SUFFIX = 234_567;
const CHILD_TOKEN = CHILD_SID * 1_000_000 + CHILD_SUFFIX; // = 2_234_567

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getSession: vi.fn(),
  closeSessionById: vi.fn(),
  deliverServiceMessage: vi.fn(),
  // R3 guard functions (new)
  getSessionTier: vi.fn(),
  isR3GuidanceDelivered: vi.fn(),
  markR3GuidanceDelivered: vi.fn(),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("../../session-manager.js", () => ({
  getSession: mocks.getSession,
  getSessionTier: mocks.getSessionTier,
  isR3GuidanceDelivered: mocks.isR3GuidanceDelivered,
  markR3GuidanceDelivered: mocks.markR3GuidanceDelivered,
}));

vi.mock("../../session-teardown.js", () => ({
  closeSessionById: mocks.closeSessionById,
}));

vi.mock("../../session-queue.js", () => ({
  deliverServiceMessage: mocks.deliverServiceMessage,
}));

import { handleRevokeChild } from "./revoke-child.js";

describe("session/revoke-child", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChildRegistry();
    mocks.requireAuth.mockReturnValue(PARENT_SID);
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩", parent_sid: PARENT_SID });
    mocks.closeSessionById.mockReturnValue({ closed: true, sid: CHILD_SID, name: "Helper" });
    mocks.deliverServiceMessage.mockReturnValue(true);
    registerChild(PARENT_SID, CHILD_SID);
    // R3 guard defaults: suppress R3 so existing tests are not affected by new behavior
    mocks.getSessionTier.mockReturnValue(undefined); // unskilled
    mocks.isR3GuidanceDelivered.mockReturnValue(true); // already delivered → R3 suppressed
    mocks.markR3GuidanceDelivered.mockImplementation(() => {});
  });

  // ── AC2: closes the child and returns success ────────────────────────────

  it("AC2: closes the child session and returns { closed: true, sid }", () => {
    const result = parseResult(handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN }));

    expect(result.closed).toBe(true);
    expect(result.sid).toBe(CHILD_SID);
    expect(mocks.closeSessionById).toHaveBeenCalledWith(CHILD_SID);
  });

  it("AC2: unregisters the child from the registry after closing", () => {
    handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    // Subsequent revoke attempt: session gone → SESSION_NOT_FOUND before PERMISSION_DENIED
    mocks.getSession.mockReturnValue(undefined);
    const result = handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SESSION_NOT_FOUND");
  });

  // ── Auth guard ───────────────────────────────────────────────────────────

  it("rejects when token is missing (SID_REQUIRED)", () => {
    mocks.requireAuth.mockReturnValue({ code: "SID_REQUIRED", message: "token is required" });

    const result = handleRevokeChild({ token: undefined, child_token: CHILD_TOKEN });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SID_REQUIRED");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  it("rejects with AUTH_FAILED when token is invalid", () => {
    mocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "Invalid token" });

    const result = handleRevokeChild({ token: 9999999, child_token: CHILD_TOKEN });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("AUTH_FAILED");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  // ── SESSION_NOT_FOUND guard ──────────────────────────────────────────────

  it("returns SESSION_NOT_FOUND when child session does not exist", () => {
    mocks.getSession.mockReturnValue(undefined);

    const result = handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SESSION_NOT_FOUND");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  // ── UNAUTHORIZED guard ────────────────────────────────────────────────────

  it("rejects with UNAUTHORIZED when the child was not spawned by the calling parent", () => {
    clearChildRegistry();
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩", parent_sid: 5 });

    const result = handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  it("rejects with UNAUTHORIZED when child_token has no registered parent and no parent_sid", () => {
    clearChildRegistry();
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩" }); // no parent_sid

    const result = handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  it("uses parent_sid from session record when available (v0.2 primary check)", () => {
    clearChildRegistry(); // no registry entry — must rely on parent_sid only
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩", parent_sid: PARENT_SID });

    const result = parseResult(handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN }));

    expect(result.closed).toBe(true);
    expect(mocks.closeSessionById).toHaveBeenCalledWith(CHILD_SID);
  });

  it("returns UNAUTHORIZED via parent_sid mismatch even when registry is absent", () => {
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩", parent_sid: 99 });
    clearChildRegistry();

    const result = handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  // ── AC5b: self-revocation ─────────────────────────────────────────────────

  it("AC5b: child self-revocation succeeds when callerSid equals resolved childSid", () => {
    // Sub-agent calls with its own token: requireAuth(child_token) → childSid
    mocks.requireAuth.mockReturnValue(CHILD_SID);

    const result = parseResult(handleRevokeChild({ token: CHILD_TOKEN, child_token: CHILD_TOKEN }));

    expect(result.closed).toBe(true);
    expect(mocks.closeSessionById).toHaveBeenCalledWith(CHILD_SID);
  });

  it("AC5b: self-revocation works even when callerSid !== registeredParent", () => {
    const OTHER_PARENT = 99;
    mocks.requireAuth.mockReturnValue(CHILD_SID);
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩", parent_sid: OTHER_PARENT });

    const result = parseResult(handleRevokeChild({ token: CHILD_TOKEN, child_token: CHILD_TOKEN }));

    expect(result.closed).toBe(true);
  });

  // ── AC5c: CHILD_SESSION_RESOLVED fired to parent ──────────────────────────

  it("AC5c: fires CHILD_SESSION_RESOLVED to parent on parent-initiated revocation", () => {
    mocks.getSession.mockReturnValue({
      sid: CHILD_SID, name: "Helper", color: "🟩", parent_sid: PARENT_SID, exit_status: "resolved",
    });

    handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      PARENT_SID,
      expect.stringContaining("Helper"),
      "child_session_resolved",
      expect.objectContaining({ child_sid: CHILD_SID, exit_status: "resolved" }),
    );
  });

  it("AC5c: fires CHILD_SESSION_RESOLVED to parent on child self-revocation", () => {
    mocks.requireAuth.mockReturnValue(CHILD_SID);
    mocks.getSession.mockReturnValue({
      sid: CHILD_SID, name: "Helper", color: "🟩", parent_sid: PARENT_SID, exit_status: "filed task X",
    });

    handleRevokeChild({ token: CHILD_TOKEN, child_token: CHILD_TOKEN });

    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      PARENT_SID,
      expect.stringContaining("filed task X"),
      "child_session_resolved",
      expect.objectContaining({ child_sid: CHILD_SID, exit_status: "filed task X" }),
    );
  });

  it("AC5c: CHILD_SESSION_RESOLVED uses empty string when no exit_status was emitted", () => {
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩", parent_sid: PARENT_SID });

    handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      PARENT_SID,
      expect.any(String),
      "child_session_resolved",
      expect.objectContaining({ exit_status: "" }),
    );
  });

  // ── AC5d: parent revocation still works ──────────────────────────────────

  it("AC5d: parent revocation via registeredParent check still works (no regression)", () => {
    const result = parseResult(handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN }));

    expect(result.closed).toBe(true);
    expect(mocks.closeSessionById).toHaveBeenCalledWith(CHILD_SID);
  });

  // ── Does not call closeSessionById on guard failure ──────────────────────

  it("never calls closeSessionById when auth fails", () => {
    mocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "bad token" });

    handleRevokeChild({ token: 9999999, child_token: CHILD_TOKEN });

    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  it("never calls closeSessionById when caller is not the parent or child", () => {
    clearChildRegistry();
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩", parent_sid: 5 });

    handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    expect(mocks.closeSessionById).not.toHaveBeenCalled();
  });

  // ── closeSessionById result is propagated ────────────────────────────────

  it("propagates { closed: false } when closeSessionById returns false (already closed race)", () => {
    mocks.closeSessionById.mockReturnValue({ closed: false, sid: CHILD_SID });

    const result = parseResult(handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN }));

    expect(result.closed).toBe(false);
    expect(result.sid).toBe(CHILD_SID);
  });
});

// ── AC4: R3 (ONBOARDING_SUBSESSION_RESOLVE_BREADCRUMB) delivery ───────────────

describe("session/revoke-child — AC4: R3 breadcrumb on first terminal signal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChildRegistry();
    registerChild(PARENT_SID, CHILD_SID);
    mocks.requireAuth.mockReturnValue(PARENT_SID);
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩", parent_sid: PARENT_SID });
    mocks.closeSessionById.mockReturnValue({ closed: true, sid: CHILD_SID, name: "Helper" });
    mocks.deliverServiceMessage.mockReturnValue(true);
    // R3 NOT yet delivered for parent (first terminal signal)
    mocks.getSessionTier.mockReturnValue(undefined); // unskilled
    mocks.isR3GuidanceDelivered.mockReturnValue(false); // not yet delivered
    mocks.markR3GuidanceDelivered.mockImplementation(() => {});
  });

  it("AC4: fires R3 to parent on first terminal signal (unskilled host)", () => {
    handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      PARENT_SID,
      expect.stringContaining("Helper"),
      "onboarding_subsession_resolve_breadcrumb",
      expect.objectContaining({ child_sid: CHILD_SID, child_name: "Helper", bridge_authoritative: true }),
    );
  });

  it("AC4: marks R3 as delivered after firing", () => {
    handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    expect(mocks.markR3GuidanceDelivered).toHaveBeenCalledWith(PARENT_SID);
  });

  it("AC4: does NOT fire R3 when parent is skilled-router", () => {
    mocks.getSessionTier.mockReturnValue("skilled-router");

    handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    const r3Calls = mocks.deliverServiceMessage.mock.calls.filter(
      c => c[2] === "onboarding_subsession_resolve_breadcrumb",
    );
    expect(r3Calls).toHaveLength(0);
    expect(mocks.markR3GuidanceDelivered).not.toHaveBeenCalled();
  });

  it("AC4: does NOT fire R3 when R3 was already delivered to parent", () => {
    mocks.isR3GuidanceDelivered.mockReturnValue(true); // already done

    handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    const r3Calls = mocks.deliverServiceMessage.mock.calls.filter(
      c => c[2] === "onboarding_subsession_resolve_breadcrumb",
    );
    expect(r3Calls).toHaveLength(0);
    expect(mocks.markR3GuidanceDelivered).not.toHaveBeenCalled();
  });

  it("AC4: R3 fires on self-revocation too (child calls revoke with own token)", () => {
    mocks.requireAuth.mockReturnValue(CHILD_SID);

    handleRevokeChild({ token: CHILD_TOKEN, child_token: CHILD_TOKEN });

    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      PARENT_SID,
      expect.any(String),
      "onboarding_subsession_resolve_breadcrumb",
      expect.objectContaining({ bridge_authoritative: true }),
    );
  });

  it("AC4: R3 is not fired when no registeredParent (no parent_sid, no registry)", () => {
    clearChildRegistry();
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩" }); // no parent_sid

    handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    const r3Calls = mocks.deliverServiceMessage.mock.calls.filter(
      c => c[2] === "onboarding_subsession_resolve_breadcrumb",
    );
    expect(r3Calls).toHaveLength(0);
  });

  it("AC8: R3 delivery includes bridge_authoritative: true in details", () => {
    handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    const r3Call = mocks.deliverServiceMessage.mock.calls.find(
      c => c[2] === "onboarding_subsession_resolve_breadcrumb",
    );
    expect(r3Call?.[3]).toMatchObject({ bridge_authoritative: true });
  });

  it("AC4: R3 text references the child session name", () => {
    handleRevokeChild({ token: PARENT_TOKEN, child_token: CHILD_TOKEN });

    const r3Call = mocks.deliverServiceMessage.mock.calls.find(
      c => c[2] === "onboarding_subsession_resolve_breadcrumb",
    );
    expect(typeof r3Call?.[1]).toBe("string");
    expect(r3Call?.[1]).toContain("Helper");
  });
});
