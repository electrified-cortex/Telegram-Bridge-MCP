/**
 * Unit tests for the POST /event REST endpoint handler.
 *
 * Tests exercise handlePostEvent() directly (no HTTP server required)
 * to cover: valid requests, invalid token, missing/invalid kind, details
 * validation, actor_sid defaulting, and fan-out counting.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn((..._args: unknown[]): boolean => true),
  listSessions: vi.fn((): Array<{ sid: number; name: string; color: string; createdAt: string }> => []),
  getSession: vi.fn((_sid?: unknown): { sid: number; name: string; color: string; createdAt: string } | undefined => undefined),
  deliverServiceMessage: vi.fn((_sid: unknown, _text?: unknown, _kind?: unknown, _details?: unknown): boolean => true),
  getGovernorSid: vi.fn((): number => 0),
  handleShowAnimation: vi.fn(),
  handleCancelAnimation: vi.fn(),
  setHasCompacted: vi.fn((_sid: number): void => {}),
  handleSessionStopped: vi.fn((_sid: number): { noOp: boolean } => ({ noOp: false })),
  getActivityFile: vi.fn((_sid: number): { filePath: string } | undefined => undefined),
}));

vi.mock("./session-manager.js", () => ({
  validateSession: (sid: number, suffix: number) => mocks.validateSession(sid, suffix),
  listSessions: () => mocks.listSessions(),
  getSession: (sid: unknown) => mocks.getSession(sid),
  setHasCompacted: (sid: number) => { mocks.setHasCompacted(sid); },
}));

vi.mock("./session-queue.js", () => ({
  deliverServiceMessage: (sid: number, text?: string, kind?: string, details?: Record<string, unknown>) =>
    mocks.deliverServiceMessage(sid, text, kind, details),
}));

vi.mock("./routing-mode.js", () => ({
  getGovernorSid: () => mocks.getGovernorSid(),
}));

vi.mock("./tools/animation/show.js", () => ({
  handleShowAnimation: (...args: unknown[]) => mocks.handleShowAnimation(...args),
}));

vi.mock("./tools/animation/cancel.js", () => ({
  handleCancelAnimation: (...args: unknown[]) => mocks.handleCancelAnimation(...args),
}));

vi.mock("./tools/activity/file-state.js", () => ({
  handleSessionStopped: (sid: number) => mocks.handleSessionStopped(sid),
  getActivityFile: (sid: number) => mocks.getActivityFile(sid),
}));

// Silence the NDJSON write — we don't test fire-and-forget I/O
vi.mock("fs/promises", () => ({
  appendFile: vi.fn(() => Promise.resolve()),
}));

vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
}));

import { handlePostEvent } from "./event-endpoint.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Token: sid=1, suffix=123456 → token = 1_123_456
const VALID_TOKEN = 1_123_456;

function makeSession(sid: number, name = "TestAgent") {
  return { sid, name, color: "🟦", createdAt: new Date().toISOString() };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /event handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.listSessions.mockReturnValue([makeSession(1)]);
    mocks.getSession.mockReturnValue(makeSession(1));
    mocks.deliverServiceMessage.mockReturnValue(true);
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.handleShowAnimation.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mocks.handleCancelAnimation.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mocks.handleSessionStopped.mockReturnValue({ noOp: false });
    mocks.getActivityFile.mockReturnValue(undefined);
  });

  // ── 401: missing / invalid token ──────────────────────────────────────────

  it("returns 401 when token is absent from query and body", () => {
    const [status, body] = handlePostEvent(undefined, { kind: "startup" });
    expect(status).toBe(401);
    expect((body as { ok: boolean }).ok).toBe(false);
  });

  it("returns 401 when token is non-numeric string", () => {
    const [status] = handlePostEvent("notanumber", { kind: "startup" });
    expect(status).toBe(401);
  });

  it("returns 401 when validateSession fails (AUTH_FAILED)", () => {
    mocks.validateSession.mockReturnValue(false);
    const [status, body] = handlePostEvent(String(VALID_TOKEN), { kind: "startup" });
    expect(status).toBe(401);
    expect((body as { error: string }).error).toBe("AUTH_FAILED");
  });

  // ── 400: missing / empty kind ─────────────────────────────────────────────

  it("returns 400 when kind is missing", () => {
    const [status, body] = handlePostEvent(String(VALID_TOKEN), {});
    expect(status).toBe(400);
    expect((body as { ok: boolean }).ok).toBe(false);
  });

  it("returns 400 when kind is empty string", () => {
    const [status] = handlePostEvent(String(VALID_TOKEN), { kind: "" });
    expect(status).toBe(400);
  });

  it("returns 400 when kind is not a string", () => {
    const [status, body] = handlePostEvent(String(VALID_TOKEN), { kind: 42 });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe("kind must be a string");
  });

  // ── 400: invalid details ──────────────────────────────────────────────────

  it("returns 400 when details contains a token field", () => {
    const [status, body] = handlePostEvent(String(VALID_TOKEN), {
      kind: "startup",
      details: { token: "secret" },
    });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toMatch(/token/);
  });

  it("returns 400 when details is not a plain object (array)", () => {
    const [status] = handlePostEvent(String(VALID_TOKEN), {
      kind: "startup",
      details: [1, 2, 3],
    });
    expect(status).toBe(400);
  });

  it("returns 400 when details is not a plain object (string)", () => {
    const [status] = handlePostEvent(String(VALID_TOKEN), {
      kind: "startup",
      details: "not-an-object",
    });
    expect(status).toBe(400);
  });

  // ── 200: success ──────────────────────────────────────────────────────────

  it("returns 200 with fanout count; actor_sid defaults to caller SID", () => {
    mocks.listSessions.mockReturnValue([makeSession(1), makeSession(2)]);
    mocks.deliverServiceMessage.mockReturnValue(true);

    const [status, body] = handlePostEvent(String(VALID_TOKEN), { kind: "startup" });
    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    expect((body as { fanout: number }).fanout).toBe(2);
  });

  it("returns 200 with explicit actor_sid, uses that actor's name", () => {
    mocks.getSession.mockImplementation((s: unknown) =>
      (s as number) === 3 ? makeSession(3, "Overseer") : makeSession(1),
    );

    const [status, body] = handlePostEvent(String(VALID_TOKEN), {
      kind: "compacting",
      actor_sid: 3,
    });
    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    // deliverServiceMessage should have been called with the actor's name
    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      expect.any(Number),
      "[event] Overseer: compacting",
      "agent_event",
      expect.objectContaining({ actor: "Overseer", actor_sid: 3 }),
    );
  });

  it("returns 400 for unknown kind", () => {
    const [status, body] = handlePostEvent(String(VALID_TOKEN), {
      kind: "some_new_custom_event",
    });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe("unknown kind");
  });

  it("fanout count reflects only delivered sessions (deliverServiceMessage returns false)", () => {
    mocks.listSessions.mockReturnValue([makeSession(1), makeSession(2), makeSession(3)]);
    // Only session 2 has a queue (others return false)
    mocks.deliverServiceMessage.mockImplementation(
      (sid: unknown) => (sid as number) === 2,
    );

    const [status, body] = handlePostEvent(String(VALID_TOKEN), { kind: "startup" });
    expect(status).toBe(200);
    expect((body as { fanout: number }).fanout).toBe(1);
  });

  it("triggers animation when actor is governor and kind is compacting", () => {
    mocks.getGovernorSid.mockReturnValue(1); // sid=1 is the governor
    // VALID_TOKEN decodes to sid=1, so resolvedActorSid defaults to 1

    const [status] = handlePostEvent(String(VALID_TOKEN), { kind: "compacting" });
    expect(status).toBe(200);
    expect(mocks.handleShowAnimation).toHaveBeenCalledWith(
      expect.objectContaining({ preset: "compacting" }),
    );
  });

  it("returns 400 for unknown kind even when actor is governor", () => {
    mocks.getGovernorSid.mockReturnValue(1);

    const [status] = handlePostEvent(String(VALID_TOKEN), { kind: "unknown_kind" });
    expect(status).toBe(400);
    expect(mocks.handleShowAnimation).not.toHaveBeenCalled();
  });

  it("triggers animation cancel + recovering animation when actor is governor and kind is compacted", async () => {
    mocks.getGovernorSid.mockReturnValue(1);

    const [status] = handlePostEvent(String(VALID_TOKEN), { kind: "compacted" });
    expect(status).toBe(200);
    expect(mocks.handleCancelAnimation).toHaveBeenCalledWith(
      expect.objectContaining({ token: VALID_TOKEN }),
    );
    await Promise.resolve(); // flush .finally() microtask
    expect(mocks.handleShowAnimation).toHaveBeenCalledWith(
      expect.objectContaining({ preset: "recovering", timeout: 60 }),
    );
  });

  it("calls setHasCompacted with the governor sid when kind is compacted", () => {
    mocks.getGovernorSid.mockReturnValue(1);

    handlePostEvent(String(VALID_TOKEN), { kind: "compacted" });
    expect(mocks.setHasCompacted).toHaveBeenCalledWith(1);
  });

  it("does not call setHasCompacted for non-compacted kinds", () => {
    mocks.getGovernorSid.mockReturnValue(1);

    handlePostEvent(String(VALID_TOKEN), { kind: "compacting" });
    expect(mocks.setHasCompacted).not.toHaveBeenCalled();
  });

  // ── stopped kind ─────────────────────────────────────────────────────────

  it("returns 200 and calls handleSessionStopped with caller SID when kind is stopped and file is active", () => {
    mocks.handleSessionStopped.mockReturnValue({ noOp: false });
    const [status, body] = handlePostEvent(String(VALID_TOKEN), { kind: "stopped" });
    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    // VALID_TOKEN decodes to sid=1
    expect(mocks.handleSessionStopped).toHaveBeenCalledWith(1);
  });

  it("returns 200 with hint: no-op when kind is stopped and no activity file is registered", () => {
    mocks.handleSessionStopped.mockReturnValue({ noOp: true });
    const [status, body] = handlePostEvent(String(VALID_TOKEN), { kind: "stopped" });
    expect(status).toBe(200);
    expect((body as { ok: boolean; hint?: string }).ok).toBe(true);
    expect((body as { hint?: string }).hint).toBe("no-op");
  });

  it("returns 401 for invalid token on stopped kind", () => {
    mocks.validateSession.mockReturnValue(false);
    const [status] = handlePostEvent(String(VALID_TOKEN), { kind: "stopped" });
    expect(status).toBe(401);
    expect(mocks.handleSessionStopped).not.toHaveBeenCalled();
  });

  it("does not trigger governor animation when kind is stopped", () => {
    mocks.getGovernorSid.mockReturnValue(1); // caller is governor
    handlePostEvent(String(VALID_TOKEN), { kind: "stopped" });
    expect(mocks.handleShowAnimation).not.toHaveBeenCalled();
  });
});

// ── post_compact_monitor_recovery tests ───────────────────────────────────────

// VALID_TOKEN decodes to sid=1; helper for filtering recovery-specific calls
function recoveryDeliveryCalls() {
  return mocks.deliverServiceMessage.mock.calls.filter(
    (call) => call[2] === "post_compact_monitor_recovery",
  );
}

describe("POST /event handler — post_compact_monitor_recovery hint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.listSessions.mockReturnValue([]);
    mocks.getSession.mockReturnValue(makeSession(1));
    mocks.deliverServiceMessage.mockReturnValue(true);
    mocks.getGovernorSid.mockReturnValue(0);
    mocks.handleShowAnimation.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mocks.handleCancelAnimation.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mocks.handleSessionStopped.mockReturnValue({ noOp: false });
    mocks.getActivityFile.mockReturnValue(undefined);
  });

  it("delivers post_compact_monitor_recovery to the actor session when compacting and activity file is registered", () => {
    const filePath = "/tmp/agent-activity.txt";
    mocks.getActivityFile.mockReturnValue({ filePath });

    const [status, body] = handlePostEvent(String(VALID_TOKEN), { kind: "compacting" });

    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);

    const calls = recoveryDeliveryCalls();
    expect(calls).toHaveLength(1);
    // VALID_TOKEN decodes to sid=1 — that is the target
    expect(calls[0][0]).toBe(1);
    expect(calls[0][2]).toBe("post_compact_monitor_recovery");
    expect(String(calls[0][1])).toContain(filePath);
  });

  it("does not deliver post_compact_monitor_recovery when no activity file is registered", () => {
    mocks.getActivityFile.mockReturnValue(undefined);

    handlePostEvent(String(VALID_TOKEN), { kind: "compacting" });

    expect(recoveryDeliveryCalls()).toHaveLength(0);
  });

  it("delivers the recovery message exactly once per compacting event", () => {
    mocks.getActivityFile.mockReturnValue({ filePath: "/tmp/once.txt" });

    handlePostEvent(String(VALID_TOKEN), { kind: "compacting" });

    expect(recoveryDeliveryCalls()).toHaveLength(1);
  });

  it("delivers once even when multiple sessions are in the fan-out", () => {
    mocks.listSessions.mockReturnValue([makeSession(1), makeSession(2), makeSession(3)]);
    mocks.getActivityFile.mockReturnValue({ filePath: "/tmp/multi.txt" });

    handlePostEvent(String(VALID_TOKEN), { kind: "compacting" });

    // Fan-out delivers "agent_event" to all sessions; recovery goes only to the actor
    expect(recoveryDeliveryCalls()).toHaveLength(1);
  });

  it("does not deliver post_compact_monitor_recovery for 'compacted' events", () => {
    mocks.getActivityFile.mockReturnValue({ filePath: "/tmp/activity.txt" });

    handlePostEvent(String(VALID_TOKEN), { kind: "compacted" });

    expect(recoveryDeliveryCalls()).toHaveLength(0);
  });

  it("does not deliver post_compact_monitor_recovery for 'startup' events", () => {
    mocks.getActivityFile.mockReturnValue({ filePath: "/tmp/activity.txt" });

    handlePostEvent(String(VALID_TOKEN), { kind: "startup" });

    expect(recoveryDeliveryCalls()).toHaveLength(0);
  });

  it("does not deliver post_compact_monitor_recovery for 'stopped' events", () => {
    mocks.getActivityFile.mockReturnValue({ filePath: "/tmp/activity.txt" });
    mocks.handleSessionStopped.mockReturnValue({ noOp: false });

    handlePostEvent(String(VALID_TOKEN), { kind: "stopped" });

    expect(recoveryDeliveryCalls()).toHaveLength(0);
  });
});
