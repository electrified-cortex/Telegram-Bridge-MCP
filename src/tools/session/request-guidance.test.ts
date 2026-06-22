/**
 * Tests for session/request-guidance (AC1–AC3, AC5, AC6, AC8, AC9)
 *
 * AC1: Three new service-message templates exist (tested in service-messages.test.ts)
 * AC2: session/request-guidance routes to R1+R2 enqueue for unskilled host (first call only)
 * AC3: R1 and R2 enqueued as a pair in same DQ batch
 * AC5: Breadcrumbs delivered EXACTLY ONCE per SID within the bridge process lifetime
 * AC6: Skilled-tier opt-out: profile/tier: skilled-router → no breadcrumbs
 * AC8: bridge_authoritative: true on R1/R2 deliveries
 * AC9: Default tier = unskilled; new hosts get breadcrumbs on first request
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError } from "../test-utils.js";

// ── Token constants ───────────────────────────────────────────────────────────

const SID = 1;
const SUFFIX = 123_456;
const TOKEN = SID * 1_000_000 + SUFFIX; // 1_123_456

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getSession: vi.fn(),
  getSessionTier: vi.fn(),
  deliverServiceMessage: vi.fn(),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("../../session-manager.js", () => ({
  getSession: mocks.getSession,
  getSessionTier: mocks.getSessionTier,
}));

vi.mock("../../session-queue.js", () => ({
  deliverServiceMessage: mocks.deliverServiceMessage,
}));

import { handleRequestGuidance, _resetGuidanceDeliveredForTest } from "./request-guidance.js";
import { SERVICE_MESSAGES } from "../../service-messages.js";

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  _resetGuidanceDeliveredForTest();

  // Default: valid auth, unskilled session, flag not yet set
  mocks.requireAuth.mockReturnValue(SID);
  mocks.getSession.mockReturnValue({ sid: SID, name: "Orchestrator", color: "🟦" });
  mocks.getSessionTier.mockReturnValue(undefined); // unskilled by default (AC9)
  mocks.deliverServiceMessage.mockReturnValue(true);
});

// ── Auth guard ────────────────────────────────────────────────────────────────

describe("session/request-guidance — auth guard", () => {
  it("rejects when token is missing (SID_REQUIRED)", () => {
    mocks.requireAuth.mockReturnValue({ code: "SID_REQUIRED", message: "token required" });

    const result = handleRequestGuidance({ token: undefined, guidance_type: "subsession-routing" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SID_REQUIRED");
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("rejects with AUTH_FAILED on invalid token", () => {
    mocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "invalid" });

    const result = handleRequestGuidance({ token: 9999999, guidance_type: "subsession-routing" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("AUTH_FAILED");
  });
});

// ── UNKNOWN_GUIDANCE_TYPE guard ───────────────────────────────────────────────

describe("session/request-guidance — unknown guidance_type", () => {
  it("rejects unknown guidance_type with UNKNOWN_GUIDANCE_TYPE", () => {
    const result = handleRequestGuidance({ token: TOKEN, guidance_type: "unknown-type" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNKNOWN_GUIDANCE_TYPE");
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });
});

// ── AC2: R1+R2 delivery for unskilled host (first call) ───────────────────────

describe("session/request-guidance — AC2: unskilled host first call", () => {
  it("AC2: delivers R1 (host role) to the session", () => {
    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });

    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      SID,
      SERVICE_MESSAGES.ONBOARDING_SUBSESSION_HOST_ROLE,
      { bridge_authoritative: true },
    );
  });

  it("AC2: delivers R2 (spawn breadcrumb) to the session", () => {
    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });

    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      SID,
      SERVICE_MESSAGES.ONBOARDING_SUBSESSION_SPAWN_BREADCRUMB,
      { bridge_authoritative: true },
    );
  });

  it("AC3: R1 and R2 are both delivered (same batch — two consecutive lightweight messages)", () => {
    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });

    // Both must be called, in order R1 then R2
    const calls = mocks.deliverServiceMessage.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toBe(SERVICE_MESSAGES.ONBOARDING_SUBSESSION_HOST_ROLE);
    expect(calls[1][1]).toBe(SERVICE_MESSAGES.ONBOARDING_SUBSESSION_SPAWN_BREADCRUMB);
  });

  it("returns { acknowledged: true, guidance_type, delivered: true }", () => {
    const result = parseResult(handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" }));

    expect(result.acknowledged).toBe(true);
    expect(result.guidance_type).toBe("subsession-routing");
    expect(result.delivered).toBe(true);
  });
});

// ── AC5: Exactly-once delivery (in-process memory) ───────────────────────────

describe("session/request-guidance — AC5: exactly-once delivery", () => {
  it("AC5: does NOT re-deliver on a second call with the same session name", () => {
    // First call — delivers
    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });
    mocks.deliverServiceMessage.mockClear();

    // Second call — must NOT deliver
    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("AC5: returns { acknowledged: true, already_delivered: true } on the second call", () => {
    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });

    const result = parseResult(handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" }));

    expect(result.acknowledged).toBe(true);
    expect(result.already_delivered).toBe(true);
    expect(result.delivered).toBeUndefined();
  });

  it("AC5: keyed by SID — same SID with a different session name does NOT re-deliver", () => {
    // First delivery for SID=1
    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });

    // Change the session name but keep the same SID — must NOT re-deliver
    mocks.getSession.mockReturnValue({ sid: SID, name: "OtherAgent", color: "🟩" });
    mocks.deliverServiceMessage.mockClear();

    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("AC5: keyed by SID — different SID gets its own first delivery", () => {
    const SID2 = 2;
    // First delivery for SID=1
    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });
    mocks.deliverServiceMessage.mockClear();

    // Different SID — must deliver independently (same name is fine)
    mocks.requireAuth.mockReturnValue(SID2);
    mocks.getSessionTier.mockReturnValue(undefined);
    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });

    expect(mocks.deliverServiceMessage).toHaveBeenCalledTimes(2);
  });
});

// ── AC6: Skilled-tier opt-out ─────────────────────────────────────────────────

describe("session/request-guidance — AC6: skilled-router suppression", () => {
  beforeEach(() => {
    mocks.getSessionTier.mockReturnValue("skilled-router");
  });

  it("AC6: delivers NO breadcrumbs when tier is skilled-router", () => {
    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("AC6: does NOT check in-process guidance flag for skilled-router sessions", () => {
    // Skilled-router sessions bypass the flag entirely; deliver is never attempted
    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });

    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("AC6: returns { acknowledged: true, tier: skilled-router } for skilled hosts", () => {
    const result = parseResult(handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" }));

    expect(result.acknowledged).toBe(true);
    expect(result.tier).toBe("skilled-router");
    expect(result.delivered).toBeUndefined();
  });
});

// ── AC8: bridge_authoritative on deliveries ───────────────────────────────────

describe("session/request-guidance — AC8: bridge_authoritative", () => {
  it("AC8: R1 delivery includes bridge_authoritative: true in details", () => {
    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });

    const r1Call = mocks.deliverServiceMessage.mock.calls.find(
      c => c[1] === SERVICE_MESSAGES.ONBOARDING_SUBSESSION_HOST_ROLE,
    );
    expect(r1Call?.[2]).toMatchObject({ bridge_authoritative: true });
  });

  it("AC8: R2 delivery includes bridge_authoritative: true in details", () => {
    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });

    const r2Call = mocks.deliverServiceMessage.mock.calls.find(
      c => c[1] === SERVICE_MESSAGES.ONBOARDING_SUBSESSION_SPAWN_BREADCRUMB,
    );
    expect(r2Call?.[2]).toMatchObject({ bridge_authoritative: true });
  });
});

// ── AC9: Default tier = unskilled ────────────────────────────────────────────

describe("session/request-guidance — AC9: default tier is unskilled", () => {
  it("AC9: new session with no tier gets breadcrumbs on first request", () => {
    mocks.getSessionTier.mockReturnValue(undefined); // no tier set

    handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" });

    expect(mocks.deliverServiceMessage).toHaveBeenCalledTimes(2);
  });

  it("AC9: only tier=undefined (unskilled) triggers breadcrumb delivery", () => {
    mocks.getSessionTier.mockReturnValue(undefined);

    const result = parseResult(handleRequestGuidance({ token: TOKEN, guidance_type: "subsession-routing" }));
    expect(result.delivered).toBe(true);
  });
});
