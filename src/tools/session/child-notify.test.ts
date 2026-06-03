import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError } from "../test-utils.js";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getSession: vi.fn(),
  deliverChildNotifyEvent: vi.fn(),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("../../session-manager.js", () => ({
  getSession: mocks.getSession,
}));

vi.mock("../../session-queue.js", () => ({
  deliverChildNotifyEvent: mocks.deliverChildNotifyEvent,
}));

import { handleChildNotify } from "./child-notify.js";

const PARENT_SID = 1;
const CHILD_SID = 2;
const CHILD_TOKEN = 2_123_456;

describe("child/notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockReturnValue(CHILD_SID);
    // Default: child session with parent_sid set
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === CHILD_SID) return { sid: CHILD_SID, name: "Worker", color: "🟩", parent_sid: PARENT_SID };
      if (sid === PARENT_SID) return { sid: PARENT_SID, name: "Host", color: "🟦" };
      return undefined;
    });
    mocks.deliverChildNotifyEvent.mockReturnValue(true);
  });

  // ── AC1: basic delivery ─────────────────────────────────────────────────

  it("AC1: returns { notified: true, parent_sid } on success", () => {
    const result = parseResult(
      handleChildNotify({ token: CHILD_TOKEN, event_type: "thread/routed", payload: { thread_sid: 5, topic_label: "billing" } }),
    );

    expect(result.notified).toBe(true);
    expect(result.parent_sid).toBe(PARENT_SID);
  });

  it("AC1: calls deliverChildNotifyEvent with correct arguments", () => {
    const payload = { thread_sid: 5, topic_label: "billing" };
    handleChildNotify({ token: CHILD_TOKEN, event_type: "thread/routed", payload });

    expect(mocks.deliverChildNotifyEvent).toHaveBeenCalledWith(
      PARENT_SID,
      CHILD_SID,
      "thread/routed",
      payload,
    );
  });

  it("AC1: delivers without payload when payload is omitted", () => {
    handleChildNotify({ token: CHILD_TOKEN, event_type: "thread/resolved" });

    expect(mocks.deliverChildNotifyEvent).toHaveBeenCalledWith(
      PARENT_SID,
      CHILD_SID,
      "thread/resolved",
      undefined,
    );
  });

  // ── AC2: root session returns UNAUTHORIZED ──────────────────────────────

  it("AC2: root session (no parent_sid) returns UNAUTHORIZED", () => {
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Root", color: "🟦" }); // no parent_sid

    const result = handleChildNotify({ token: CHILD_TOKEN, event_type: "test/event" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
    expect(mocks.deliverChildNotifyEvent).not.toHaveBeenCalled();
  });

  // ── AC3: read-only capability allowed (tested via capability gate in action.ts, not here) ──

  // ── AC4: INVALID_PAYLOAD ────────────────────────────────────────────────

  it("AC4: circular payload returns INVALID_PAYLOAD", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    const result = handleChildNotify({ token: CHILD_TOKEN, event_type: "test/event", payload: circular });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("INVALID_PAYLOAD");
    expect(mocks.deliverChildNotifyEvent).not.toHaveBeenCalled();
  });

  // ── AC5: INVALID_EVENT_TYPE ─────────────────────────────────────────────

  it("AC5: event_type with spaces returns INVALID_EVENT_TYPE", () => {
    const result = handleChildNotify({ token: CHILD_TOKEN, event_type: "bad event" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("INVALID_EVENT_TYPE");
    expect(mocks.deliverChildNotifyEvent).not.toHaveBeenCalled();
  });

  it("AC5: event_type with special chars returns INVALID_EVENT_TYPE", () => {
    const result = handleChildNotify({ token: CHILD_TOKEN, event_type: "thread@routed" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("INVALID_EVENT_TYPE");
  });

  it("AC5: event_type over 64 chars returns INVALID_EVENT_TYPE", () => {
    const result = handleChildNotify({ token: CHILD_TOKEN, event_type: "a".repeat(65) });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("INVALID_EVENT_TYPE");
  });

  it("AC5: valid event_type with slashes and underscores passes", () => {
    const result = handleChildNotify({ token: CHILD_TOKEN, event_type: "thread/routed_v2" });

    expect(isError(result)).toBe(false);
    expect(parseResult(result).notified).toBe(true);
  });

  // ── PARENT_SESSION_NOT_FOUND ────────────────────────────────────────────

  it("returns PARENT_SESSION_NOT_FOUND when parent session was revoked", () => {
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === CHILD_SID) return { sid: CHILD_SID, name: "Worker", color: "🟩", parent_sid: PARENT_SID };
      return undefined; // parent gone
    });

    const result = handleChildNotify({ token: CHILD_TOKEN, event_type: "test/event" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("PARENT_SESSION_NOT_FOUND");
    expect(mocks.deliverChildNotifyEvent).not.toHaveBeenCalled();
  });

  it("returns PARENT_SESSION_NOT_FOUND when queue is not active (deliverChildNotifyEvent returns false)", () => {
    mocks.deliverChildNotifyEvent.mockReturnValue(false);

    const result = handleChildNotify({ token: CHILD_TOKEN, event_type: "test/event" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("PARENT_SESSION_NOT_FOUND");
  });

  // ── Auth guard ───────────────────────────────────────────────────────────

  it("returns SID_REQUIRED when token is missing", () => {
    mocks.requireAuth.mockReturnValue({ code: "SID_REQUIRED", message: "token is required" });

    const result = handleChildNotify({ token: undefined, event_type: "test/event" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SID_REQUIRED");
    expect(mocks.deliverChildNotifyEvent).not.toHaveBeenCalled();
  });

  // ── AC7: no session lifecycle side effects (deliverChildNotifyEvent is pure queue inject) ──

  it("AC7: does not call any session lifecycle functions", () => {
    handleChildNotify({ token: CHILD_TOKEN, event_type: "thread/resolved" });

    // Only deliverChildNotifyEvent is called — no spawning, no routing, no governor election
    expect(mocks.deliverChildNotifyEvent).toHaveBeenCalledOnce();
  });
});
