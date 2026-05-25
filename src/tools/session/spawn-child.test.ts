import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError } from "../test-utils.js";
import { clearChildRegistry, getParent } from "./child-registry.js";
import { runInSessionContext } from "../../session-context.js";
import { getTopic, resetTopicStateForTest } from "../../topic-state.js";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  handleSessionStart: vi.fn(),
  setSessionParentSid: vi.fn(),
  setSessionCapability: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("./start.js", () => ({
  handleSessionStart: mocks.handleSessionStart,
}));

vi.mock("../../session-manager.js", () => ({
  setSessionParentSid: mocks.setSessionParentSid,
  setSessionCapability: mocks.setSessionCapability,
  getActiveSession: () => 0,
  getSession: mocks.getSession,
}));

// Keep toError real — we want actual MCP error shape in assertions
import { handleSpawnChild } from "./spawn-child.js";

const PARENT_SID = 1;
const CHILD_SID = 2;
const CHILD_TOKEN = CHILD_SID * 1_000_000 + 123456;

function makeStartSuccess(token = CHILD_TOKEN, sid = CHILD_SID) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ token, sid, hint: "drain now" }) }],
  };
}

function makeStartError(code = "SESSION_DENIED", message = "denied") {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ code, message }) }],
  };
}

describe("session/spawn-child", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChildRegistry();
    resetTopicStateForTest();
    mocks.requireAuth.mockReturnValue(PARENT_SID);
    mocks.handleSessionStart.mockResolvedValue(makeStartSuccess());
    // Default: caller has no capability restriction (undefined = full)
    mocks.getSession.mockReturnValue(undefined);
  });

  // ── AC1: returns { token, sid, parent_sid } ────────────────────────────────

  it("AC1: returns { token, sid, parent_sid } on successful spawn", async () => {
    const result = parseResult(await handleSpawnChild({ token: 1123456, name: "Helper" }));

    expect(result.token).toBe(CHILD_TOKEN);
    expect(result.sid).toBe(CHILD_SID);
    expect(result.parent_sid).toBe(PARENT_SID);
  });

  it("AC1: result includes a 'hint' field pointing the host to dequeue", async () => {
    const result = parseResult(await handleSpawnChild({ token: 1123456, name: "Helper" }));

    expect(typeof result.hint).toBe("string");
    expect((result.hint as string).length).toBeGreaterThan(0);
  });

  it("AC1: registers the child SID as owned by the parent SID", async () => {
    await handleSpawnChild({ token: 1123456, name: "Helper" });

    expect(getParent(CHILD_SID)).toBe(PARENT_SID);
  });

  it("AC1: sets parent_sid on the child session record", async () => {
    await handleSpawnChild({ token: 1123456, name: "Helper" });

    expect(mocks.setSessionParentSid).toHaveBeenCalledWith(CHILD_SID, PARENT_SID);
  });

  it("AC1: sets child_capability 'gather' by default", async () => {
    await handleSpawnChild({ token: 1123456, name: "Helper" });

    expect(mocks.setSessionCapability).toHaveBeenCalledWith(CHILD_SID, "gather");
  });

  it("AC1: respects explicit child_capability override", async () => {
    await handleSpawnChild({ token: 1123456, name: "Helper", child_capability: "full" });

    expect(mocks.setSessionCapability).toHaveBeenCalledWith(CHILD_SID, "full");
  });

  it("AC1: calls handleSessionStart with provided name and color", async () => {
    await handleSpawnChild({ token: 1123456, name: "Helper", color: "🟩" });

    expect(mocks.handleSessionStart).toHaveBeenCalledWith({ name: "Helper", color: "🟩" });
  });

  it("AC1: calls handleSessionStart with name only when color is omitted", async () => {
    await handleSpawnChild({ token: 1123456, name: "Helper" });

    expect(mocks.handleSessionStart).toHaveBeenCalledWith({ name: "Helper", color: undefined });
  });

  // ── AC1b: token mismatch returns UNAUTHORIZED ───────────────────────────

  it("AC1b: returns UNAUTHORIZED when token belongs to a different session than caller context", async () => {
    // requireAuth returns PARENT_SID (from token 1123456, sid=1)
    // but runInSessionContext sets caller to sid=99
    const result = await runInSessionContext(99, () =>
      handleSpawnChild({ token: 1123456, name: "Helper" }),
    );

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  it("AC1b: allows spawn when token matches caller session (no mismatch)", async () => {
    // requireAuth returns PARENT_SID; context is also PARENT_SID → no UNAUTHORIZED
    const result = await runInSessionContext(PARENT_SID, () =>
      handleSpawnChild({ token: 1123456, name: "Helper" }),
    );

    expect(isError(result)).toBe(false);
    expect(parseResult(result).token).toBe(CHILD_TOKEN);
  });

  it("AC1b: skips UNAUTHORIZED check when no caller context is set (unit-test safety)", async () => {
    // No runInSessionContext → getCallerSid returns 0 → skip check
    const result = await handleSpawnChild({ token: 1123456, name: "Helper" });

    expect(isError(result)).toBe(false);
  });

  // ── Auth guard ───────────────────────────────────────────────────────────

  it("rejects when token is missing (AUTH_FAILED/SID_REQUIRED)", async () => {
    mocks.requireAuth.mockReturnValue({
      code: "SID_REQUIRED",
      message: "token is required",
    });

    const result = await handleSpawnChild({ token: undefined, name: "Helper" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SID_REQUIRED");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  it("rejects with AUTH_FAILED when token is invalid", async () => {
    mocks.requireAuth.mockReturnValue({
      code: "AUTH_FAILED",
      message: "Invalid token",
    });

    const result = await handleSpawnChild({ token: 9999999, name: "Helper" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("AUTH_FAILED");
  });

  // ── Propagates handleSessionStart errors ─────────────────────────────────

  it("propagates SESSION_DENIED from handleSessionStart", async () => {
    mocks.handleSessionStart.mockResolvedValue(makeStartError("SESSION_DENIED", "Operator denied"));

    const result = await handleSpawnChild({ token: 1123456, name: "Helper" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SESSION_DENIED");
  });

  it("does not register child when handleSessionStart returns an error", async () => {
    mocks.handleSessionStart.mockResolvedValue(makeStartError("SESSION_DENIED", "denied"));

    await handleSpawnChild({ token: 1123456, name: "Helper" });

    expect(getParent(CHILD_SID)).toBeUndefined();
  });

  it("propagates NAME_CONFLICT from handleSessionStart", async () => {
    mocks.handleSessionStart.mockResolvedValue(makeStartError("NAME_CONFLICT", "already exists"));

    const result = await handleSpawnChild({ token: 1123456, name: "Helper" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("NAME_CONFLICT");
  });

  // ── Multiple children tracking ───────────────────────────────────────────

  it("registers multiple children for the same parent", async () => {
    const child1Token = 2_123_456;
    const child2Token = 3_456_789;

    mocks.handleSessionStart
      .mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ token: child1Token, sid: 2, hint: "" }) }] })
      .mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ token: child2Token, sid: 3, hint: "" }) }] });

    await handleSpawnChild({ token: 1123456, name: "Child1" });
    await handleSpawnChild({ token: 1123456, name: "Child2" });

    expect(getParent(2)).toBe(PARENT_SID);
    expect(getParent(3)).toBe(PARENT_SID);
  });

  // ── AC7: capability gate — CAPABILITY_DENIED for non-full sessions ─────────

  it("AC7: returns CAPABILITY_DENIED when caller has gather capability", async () => {
    mocks.getSession.mockReturnValue({ sid: PARENT_SID, name: "Parent", child_capability: "gather" });

    const result = await handleSpawnChild({ token: 1123456, name: "Helper" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("CAPABILITY_DENIED");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  it("AC7: returns CAPABILITY_DENIED when caller has read-only capability", async () => {
    mocks.getSession.mockReturnValue({ sid: PARENT_SID, name: "Parent", child_capability: "read-only" });

    const result = await handleSpawnChild({ token: 1123456, name: "Helper" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("CAPABILITY_DENIED");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  it("AC7: allows spawn when caller has full capability", async () => {
    mocks.getSession.mockReturnValue({ sid: PARENT_SID, name: "Parent", child_capability: "full" });

    const result = await handleSpawnChild({ token: 1123456, name: "Helper" });

    expect(isError(result)).toBe(false);
    expect(parseResult(result).token).toBe(CHILD_TOKEN);
  });

  it("AC7: allows spawn when caller has no explicit capability (undefined = full)", async () => {
    mocks.getSession.mockReturnValue({ sid: PARENT_SID, name: "Parent" }); // no child_capability

    const result = await handleSpawnChild({ token: 1123456, name: "Helper" });

    expect(isError(result)).toBe(false);
  });

  it("AC7: allows spawn when session not found (no capability record)", async () => {
    mocks.getSession.mockReturnValue(undefined);

    const result = await handleSpawnChild({ token: 1123456, name: "Helper" });

    expect(isError(result)).toBe(false);
  });

  // ── AC3: sets topic label on child session ───────────────────────────────

  it("AC3: sets topic to the child's name so outbound messages are prefixed with [Helper]", async () => {
    await handleSpawnChild({ token: 1123456, name: "Helper" });

    // getTopic in the child's session context should return "Helper"
    const topic = runInSessionContext(CHILD_SID, () => getTopic());
    expect(topic).toBe("Helper");
  });

  it("AC3: topic is keyed to the child SID, not the parent SID", async () => {
    await handleSpawnChild({ token: 1123456, name: "Helper" });

    const childTopic = runInSessionContext(CHILD_SID, () => getTopic());
    const parentTopic = runInSessionContext(PARENT_SID, () => getTopic());
    expect(childTopic).toBe("Helper");
    expect(parentTopic).toBeNull();
  });
});
