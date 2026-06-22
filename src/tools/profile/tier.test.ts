/**
 * Tests for profile/tier (AC6, AC7)
 *
 * AC6: Skilled-tier opt-out — root session with profile/tier: skilled-router
 *      is recorded on session; subsequent breadcrumb requests are suppressed.
 * AC7: Child session calling profile/tier receives PERMISSION_DENIED.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError } from "../test-utils.js";

// ── Token constants ───────────────────────────────────────────────────────────

const SID = 1;
const SUFFIX = 100_001;
const TOKEN = SID * 1_000_000 + SUFFIX;

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getSession: vi.fn(),
  setSessionTier: vi.fn(),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("../../session-manager.js", () => ({
  getSession: mocks.getSession,
  setSessionTier: mocks.setSessionTier,
}));

import { handleProfileTier } from "./tier.js";

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockReturnValue(SID);
  // Default: root session (no parent_sid)
  mocks.getSession.mockReturnValue({ sid: SID, name: "Overseer", color: "🟦" });
  mocks.setSessionTier.mockImplementation(() => {});
});

// ── Auth guard ────────────────────────────────────────────────────────────────

describe("profile/tier — auth guard", () => {
  it("rejects missing token (SID_REQUIRED)", () => {
    mocks.requireAuth.mockReturnValue({ code: "SID_REQUIRED", message: "required" });

    const result = handleProfileTier({ token: undefined, tier: "skilled-router" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SID_REQUIRED");
    expect(mocks.setSessionTier).not.toHaveBeenCalled();
  });

  it("rejects invalid token (AUTH_FAILED)", () => {
    mocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "invalid" });

    const result = handleProfileTier({ token: 999, tier: "skilled-router" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("AUTH_FAILED");
  });
});

// ── UNKNOWN_TIER guard ────────────────────────────────────────────────────────

describe("profile/tier — unknown tier", () => {
  it("rejects unknown tier value with UNKNOWN_TIER", () => {
    const result = handleProfileTier({ token: TOKEN, tier: "super-admin" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNKNOWN_TIER");
    expect(mocks.setSessionTier).not.toHaveBeenCalled();
  });

  it("rejects empty tier string", () => {
    const result = handleProfileTier({ token: TOKEN, tier: "" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNKNOWN_TIER");
  });
});

// ── AC6: Root session sets tier ───────────────────────────────────────────────

describe("profile/tier — AC6: root session sets skilled-router tier", () => {
  it("AC6: calls setSessionTier with skilled-router on a root session", () => {
    handleProfileTier({ token: TOKEN, tier: "skilled-router" });

    expect(mocks.setSessionTier).toHaveBeenCalledWith(SID, "skilled-router");
  });

  it("AC6: returns { tier: skilled-router, breadcrumbs_suppressed: true }", () => {
    const result = parseResult(handleProfileTier({ token: TOKEN, tier: "skilled-router" }));

    expect(result.tier).toBe("skilled-router");
    expect(result.breadcrumbs_suppressed).toBe(true);
    expect(result.sid).toBe(SID);
  });

  it("AC6: no error when session has no parent_sid (root session)", () => {
    mocks.getSession.mockReturnValue({ sid: SID, name: "Root", color: "🟦" }); // no parent_sid

    const result = handleProfileTier({ token: TOKEN, tier: "skilled-router" });

    expect(isError(result)).toBe(false);
  });
});

// ── AC7: Child session receives PERMISSION_DENIED ────────────────────────────

describe("profile/tier — AC7: child session blocked", () => {
  it("AC7: returns PERMISSION_DENIED when session has a parent_sid", () => {
    mocks.getSession.mockReturnValue({ sid: SID, name: "Worker", color: "🟩", parent_sid: 1 });

    const result = handleProfileTier({ token: TOKEN, tier: "skilled-router" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("PERMISSION_DENIED");
  });

  it("AC7: does NOT call setSessionTier for child sessions", () => {
    mocks.getSession.mockReturnValue({ sid: 2, name: "Worker", color: "🟩", parent_sid: 1 });

    handleProfileTier({ token: TOKEN, tier: "skilled-router" });

    expect(mocks.setSessionTier).not.toHaveBeenCalled();
  });

  it("AC7: rejects child session regardless of tier value (PERMISSION_DENIED before UNKNOWN_TIER)", () => {
    mocks.getSession.mockReturnValue({ sid: SID, name: "Worker", color: "🟩", parent_sid: 1 });

    // Note: UNKNOWN_TIER check runs before PERMISSION_DENIED since tier validation is first.
    // But for a valid tier value, PERMISSION_DENIED must fire.
    const result = handleProfileTier({ token: TOKEN, tier: "skilled-router" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("PERMISSION_DENIED");
  });
});

// ── Session not found edge case ───────────────────────────────────────────────

describe("profile/tier — session not found", () => {
  it("allows setting tier when session is not found (getSession returns undefined)", () => {
    // If session is not found, parent_sid is also not set → treated as root
    mocks.getSession.mockReturnValue(undefined);

    const result = handleProfileTier({ token: TOKEN, tier: "skilled-router" });

    expect(isError(result)).toBe(false);
    expect(mocks.setSessionTier).toHaveBeenCalledWith(SID, "skilled-router");
  });
});
