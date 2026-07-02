import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError } from "../test-utils.js";
import { clearChildRegistry, getParent, registerChild } from "./child-registry.js";
import { runInSessionContext } from "../../session-context.js";
import { getTopic, resetTopicStateForTest } from "../../topic-state.js";
import {
  getSessionVoiceFor,
  getSessionSpeedFor,
  setSessionVoice,
  setSessionSpeed,
  resetVoiceStateForTest,
} from "../../voice-state.js";

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
    resetVoiceStateForTest();
    mocks.requireAuth.mockReturnValue(PARENT_SID);
    mocks.handleSessionStart.mockResolvedValue(makeStartSuccess());
    // Default: caller has no capability restriction (undefined = full)
    mocks.getSession.mockReturnValue(undefined);
  });

  // ── Topic validation (fail-fast) ──────────────────────────────────────────

  it("topic-missing: returns MISSING_PARAM error when topic is not provided", async () => {
    // TypeScript won't allow passing no topic, so cast to any to test runtime guard
    const result = await handleSpawnChild({ token: 1123456, topic: undefined as unknown as string });

    expect(isError(result)).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.code).toBe("MISSING_PARAM");
    expect((parsed.message as string).toLowerCase()).toContain("topic");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  it("topic-empty: returns MISSING_PARAM error when topic is empty string", async () => {
    const result = await handleSpawnChild({ token: 1123456, topic: "" });

    expect(isError(result)).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.code).toBe("MISSING_PARAM");
    expect((parsed.message as string).toLowerCase()).toContain("topic");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  it("topic-whitespace: returns MISSING_PARAM error when topic is whitespace-only", async () => {
    const result = await handleSpawnChild({ token: 1123456, topic: "   " });

    expect(isError(result)).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.code).toBe("MISSING_PARAM");
    expect((parsed.message as string).toLowerCase()).toContain("topic");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  it("topic-valid: non-blank topic creates child session successfully", async () => {
    const result = await handleSpawnChild({ token: 1123456, topic: "pref-rank" });

    expect(isError(result)).toBe(false);
    const parsed = parseResult(result);
    expect(parsed.token).toBe(CHILD_TOKEN);
    expect(parsed.sid).toBe(CHILD_SID);
  });

  it("topic-valid: child display label uses 'topic ①' format", async () => {
    await handleSpawnChild({ token: 1123456, topic: "pref-rank" });

    const topic = runInSessionContext(CHILD_SID, () => getTopic());
    expect(topic).toBe("pref-rank ①");
  });

  it("topic-valid: padded topic is trimmed before use in the chip label", async () => {
    await handleSpawnChild({ token: 1123456, topic: "  pref-rank  " });

    const topic = runInSessionContext(CHILD_SID, () => getTopic());
    expect(topic).toBe("pref-rank ①");
  });

  it("topic-valid: padded topic is trimmed before use in the session display name", async () => {
    const childSession: { name?: string } = {};
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === CHILD_SID) return childSession;
      return undefined;
    });

    // No parent session → inheritedName falls back to the (trimmed) topic.
    await handleSpawnChild({ token: 1123456, topic: "  pref-rank  " });

    expect(childSession.name).toBe("pref-rank ①");
  });

  // ── AC1: returns { token, sid, parent_sid } ────────────────────────────────

  it("AC1: returns { token, sid, parent_sid } on successful spawn", async () => {
    const result = parseResult(await handleSpawnChild({ token: 1123456, topic: "Helper" }));

    expect(result.token).toBe(CHILD_TOKEN);
    expect(result.sid).toBe(CHILD_SID);
    expect(result.parent_sid).toBe(PARENT_SID);
  });

  it("AC1: result includes a 'hint' field pointing the host to dequeue", async () => {
    const result = parseResult(await handleSpawnChild({ token: 1123456, topic: "Helper" }));

    expect(typeof result.hint).toBe("string");
    expect((result.hint as string).length).toBeGreaterThan(0);
  });

  it("AC1: registers the child SID as owned by the parent SID", async () => {
    await handleSpawnChild({ token: 1123456, topic: "Helper" });

    expect(getParent(CHILD_SID)).toBe(PARENT_SID);
  });

  it("AC1: sets parent_sid on the child session record", async () => {
    await handleSpawnChild({ token: 1123456, topic: "Helper" });

    expect(mocks.setSessionParentSid).toHaveBeenCalledWith(CHILD_SID, PARENT_SID);
  });

  it("AC1: sets child_capability 'gather' by default", async () => {
    await handleSpawnChild({ token: 1123456, topic: "Helper" });

    expect(mocks.setSessionCapability).toHaveBeenCalledWith(CHILD_SID, "gather");
  });

  it("AC1: respects explicit child_capability override", async () => {
    await handleSpawnChild({ token: 1123456, topic: "Helper", child_capability: "full" });

    expect(mocks.setSessionCapability).toHaveBeenCalledWith(CHILD_SID, "full");
  });

  it("AC1: calls handleSessionStart with inherited name, inherited color, and parentSid (color arg ignored)", async () => {
    // getSession returns undefined → inheritedName falls back to topic "Helper", inheritedColor = undefined
    await handleSpawnChild({ token: 1123456, topic: "Helper", color: "🟩" });

    expect(mocks.handleSessionStart).toHaveBeenCalledWith({ name: "Helper", color: undefined, parentSid: PARENT_SID });
  });

  it("AC1: calls handleSessionStart with parentSid when color is omitted", async () => {
    await handleSpawnChild({ token: 1123456, topic: "Helper" });

    expect(mocks.handleSessionStart).toHaveBeenCalledWith({ name: "Helper", color: undefined, parentSid: PARENT_SID });
  });

  it("AC1: result includes display_index field (gap-fill slot 1 on first spawn)", async () => {
    const result = parseResult(await handleSpawnChild({ token: 1123456, topic: "Helper" }));

    expect(result.display_index).toBe(1);
  });

  // ── AC1b: token mismatch returns UNAUTHORIZED ───────────────────────────

  it("AC1b: returns UNAUTHORIZED when token belongs to a different session than caller context", async () => {
    // requireAuth returns PARENT_SID (from token 1123456, sid=1)
    // but runInSessionContext sets caller to sid=99
    const result = await runInSessionContext(99, () =>
      handleSpawnChild({ token: 1123456, topic: "Helper" }),
    );

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  it("AC1b: allows spawn when token matches caller session (no mismatch)", async () => {
    // requireAuth returns PARENT_SID; context is also PARENT_SID → no UNAUTHORIZED
    const result = await runInSessionContext(PARENT_SID, () =>
      handleSpawnChild({ token: 1123456, topic: "Helper" }),
    );

    expect(isError(result)).toBe(false);
    expect(parseResult(result).token).toBe(CHILD_TOKEN);
  });

  it("AC1b: skips UNAUTHORIZED check when no caller context is set (unit-test safety)", async () => {
    // No runInSessionContext → getCallerSid returns 0 → skip check
    const result = await handleSpawnChild({ token: 1123456, topic: "Helper" });

    expect(isError(result)).toBe(false);
  });

  // ── Auth guard ───────────────────────────────────────────────────────────

  it("rejects when token is missing (AUTH_FAILED/SID_REQUIRED)", async () => {
    mocks.requireAuth.mockReturnValue({
      code: "SID_REQUIRED",
      message: "token is required",
    });

    const result = await handleSpawnChild({ token: undefined, topic: "Helper" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SID_REQUIRED");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  it("rejects with AUTH_FAILED when token is invalid", async () => {
    mocks.requireAuth.mockReturnValue({
      code: "AUTH_FAILED",
      message: "Invalid token",
    });

    const result = await handleSpawnChild({ token: 9999999, topic: "Helper" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("AUTH_FAILED");
  });

  // ── Propagates handleSessionStart errors ─────────────────────────────────

  it("propagates SESSION_DENIED from handleSessionStart", async () => {
    mocks.handleSessionStart.mockResolvedValue(makeStartError("SESSION_DENIED", "Operator denied"));

    const result = await handleSpawnChild({ token: 1123456, topic: "Helper" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SESSION_DENIED");
  });

  it("does not register child when handleSessionStart returns an error", async () => {
    mocks.handleSessionStart.mockResolvedValue(makeStartError("SESSION_DENIED", "denied"));

    await handleSpawnChild({ token: 1123456, topic: "Helper" });

    expect(getParent(CHILD_SID)).toBeUndefined();
  });

  it("propagates NAME_CONFLICT from handleSessionStart", async () => {
    mocks.handleSessionStart.mockResolvedValue(makeStartError("NAME_CONFLICT", "already exists"));

    const result = await handleSpawnChild({ token: 1123456, topic: "Helper" });

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

    await handleSpawnChild({ token: 1123456, topic: "Child1" });
    await handleSpawnChild({ token: 1123456, topic: "Child2" });

    expect(getParent(2)).toBe(PARENT_SID);
    expect(getParent(3)).toBe(PARENT_SID);
  });

  // ── AC7: capability gate — CAPABILITY_DENIED for non-full sessions ─────────

  it("AC7: returns CAPABILITY_DENIED when caller has gather capability", async () => {
    mocks.getSession.mockReturnValue({ sid: PARENT_SID, name: "Parent", child_capability: "gather" });

    const result = await handleSpawnChild({ token: 1123456, topic: "Helper" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("CAPABILITY_DENIED");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  it("AC7: returns CAPABILITY_DENIED when caller has read-only capability", async () => {
    mocks.getSession.mockReturnValue({ sid: PARENT_SID, name: "Parent", child_capability: "read-only" });

    const result = await handleSpawnChild({ token: 1123456, topic: "Helper" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("CAPABILITY_DENIED");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  it("AC7: allows spawn when caller has full capability", async () => {
    mocks.getSession.mockReturnValue({ sid: PARENT_SID, name: "Parent", child_capability: "full" });

    const result = await handleSpawnChild({ token: 1123456, topic: "Helper" });

    expect(isError(result)).toBe(false);
    expect(parseResult(result).token).toBe(CHILD_TOKEN);
  });

  it("AC7: allows spawn when caller has no explicit capability (undefined = full)", async () => {
    mocks.getSession.mockReturnValue({ sid: PARENT_SID, name: "Parent" }); // no child_capability

    const result = await handleSpawnChild({ token: 1123456, topic: "Helper" });

    expect(isError(result)).toBe(false);
  });

  it("AC7: allows spawn when session not found (no capability record)", async () => {
    mocks.getSession.mockReturnValue(undefined);

    const result = await handleSpawnChild({ token: 1123456, topic: "Helper" });

    expect(isError(result)).toBe(false);
  });

  // ── AC3: sets topic chip on child session ───────────────────────────────

  it("AC3: topic includes circle digit so messages render as **[Helper ①]**", async () => {
    await handleSpawnChild({ token: 1123456, topic: "Helper" });

    // getTopic in the child's session context should return "Helper ①" (slot 1)
    const topic = runInSessionContext(CHILD_SID, () => getTopic());
    expect(topic).toBe("Helper ①");
  });

  it("AC3: topic is keyed to the child SID, not the parent SID", async () => {
    await handleSpawnChild({ token: 1123456, topic: "Helper" });

    const childTopic = runInSessionContext(CHILD_SID, () => getTopic());
    const parentTopic = runInSessionContext(PARENT_SID, () => getTopic());
    expect(childTopic).toBe("Helper ①");
    expect(parentTopic).toBeNull();
  });

  // ── AC3a: SUB_SESSION_LIMIT for 10th spawn ─────────────────────────────

  it("AC3a: returns SUB_SESSION_LIMIT when 9 slots already occupied", async () => {
    // Pre-register 9 children to fill all slots
    for (let i = 1; i <= 9; i++) {
      registerChild(PARENT_SID, 100 + i);
    }

    const result = await handleSpawnChild({ token: 1123456, topic: "TooMany" });

    expect(isError(result)).toBe(true);
    const parsed = parseResult(result);
    expect(parsed.code).toBe("SUB_SESSION_LIMIT");
    expect(parsed.limit).toBe(9);
    expect(parsed.current).toBe(9);
    expect(parsed.parent_sid).toBe(PARENT_SID);
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  // ── AC7: recursive spawn gate ─────────────────────────────────────────

  it("AC7: returns CAPABILITY_DENIED when caller session is itself a child (parent_sid set)", async () => {
    mocks.getSession.mockReturnValue({ sid: PARENT_SID, name: "Parent", parent_sid: 5 });

    const result = await handleSpawnChild({ token: 1123456, topic: "Helper" });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("CAPABILITY_DENIED");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  // ── name_tag inheritance ───────────────────────────────────────────────────

  it("name_tag is inherited from parent to child session", async () => {
    const childSession: { name_tag?: string } = {};
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === PARENT_SID) return { sid: PARENT_SID, name: "Parent", name_tag: "Agent" };
      if (sid === CHILD_SID) return childSession;
      return undefined;
    });

    await handleSpawnChild({ token: 1123456, topic: "child" });

    expect(childSession.name_tag).toBe("Agent");
  });

  it("no crash when parent has no name_tag (child spawns successfully)", async () => {
    mocks.getSession.mockReturnValue({ sid: PARENT_SID, name: "Parent" }); // no name_tag field

    const result = await handleSpawnChild({ token: 1123456, topic: "child" });

    expect(isError(result)).toBe(false);
    expect(parseResult(result).token).toBe(CHILD_TOKEN);
  });

  it("regression: name and color are still inherited after name_tag change", async () => {
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === PARENT_SID) return { sid: PARENT_SID, name: "ParentName", color: "🔵", name_tag: "Agent" };
      return {};
    });

    await handleSpawnChild({ token: 1123456, topic: "child" });

    expect(mocks.handleSessionStart).toHaveBeenCalledWith({
      name: "ParentName",
      color: "🔵",
      parentSid: PARENT_SID,
    });
  });

  // ── Child name_tag auto-derived from parent (no name param accepted) ─────

  it("child nametag auto-derives from parent session registered name", async () => {
    const childSession: { name_tag?: string } = {};
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === PARENT_SID) return { sid: PARENT_SID, name: "Curator", name_tag: "CuratorTag" };
      if (sid === CHILD_SID) return childSession;
      return undefined;
    });

    // Only topic is passed — no name param
    await handleSpawnChild({ token: 1123456, topic: "Research" });

    expect(childSession.name_tag).toBe("CuratorTag");
  });

  // ── Display name includes slot index (session-list fix) ───────────────────

  it("subsession display name includes the circle-digit slot index", async () => {
    const childSession: { name?: string } = {};
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === CHILD_SID) return childSession;
      return undefined;
    });

    await handleSpawnChild({ token: 1123456, topic: "Helper" });

    // inheritedName falls back to "Helper" (no parent session); slot 1 → "①"
    expect(childSession.name).toBe("Helper ①");
  });

  it("display name uses inherited parent name when parent has a name", async () => {
    const childSession: { name?: string } = {};
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === PARENT_SID) return { sid: PARENT_SID, name: "Curator", color: "🔵" };
      if (sid === CHILD_SID) return childSession;
      return undefined;
    });

    await handleSpawnChild({ token: 1123456, topic: "Research" });

    // inheritedName comes from parent: "Curator"; slot 1 → "①"
    expect(childSession.name).toBe("Curator ①");
  });

  it("host (parent) session display name is unchanged after subsession spawn", async () => {
    const parentSession = { sid: PARENT_SID, name: "Curator", color: "🔵" };
    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === PARENT_SID) return parentSession;
      return {};
    });

    await handleSpawnChild({ token: 1123456, topic: "Research" });

    expect(parentSession.name).toBe("Curator");
  });

  it("display name for second subsession uses slot index 2", async () => {
    const child1Session: { name?: string } = {};
    const child2Session: { name?: string } = {};

    mocks.handleSessionStart
      .mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ token: 2_123_456, sid: 2, hint: "" }) }] })
      .mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ token: 3_123_456, sid: 3, hint: "" }) }] });

    mocks.getSession.mockImplementation((sid: number) => {
      if (sid === 2) return child1Session;
      if (sid === 3) return child2Session;
      return undefined;
    });

    await handleSpawnChild({ token: 1123456, topic: "First" });
    await handleSpawnChild({ token: 1123456, topic: "Second" });

    expect(child1Session.name).toBe("First ①");
    expect(child2Session.name).toBe("Second ②");
  });

  // ── AC4: Voice inheritance ─────────────────────────────────────────────────

  it("AC4: child inherits parent voice when parent has voice set", async () => {
    // Set parent voice in parent session context
    runInSessionContext(PARENT_SID, () => { setSessionVoice("nova"); });

    await handleSpawnChild({ token: 1123456, topic: "Research" });

    expect(getSessionVoiceFor(CHILD_SID)).toBe("nova");
  });

  it("AC4: child inherits parent voice_speed when parent has speed set", async () => {
    runInSessionContext(PARENT_SID, () => { setSessionVoice("alloy"); });
    runInSessionContext(PARENT_SID, () => { setSessionSpeed(1.25); });

    await handleSpawnChild({ token: 1123456, topic: "Research" });

    expect(getSessionSpeedFor(CHILD_SID)).toBe(1.25);
  });

  it("AC4: child has no voice when parent has no voice (null/default)", async () => {
    // Parent has no voice set — resetVoiceStateForTest in beforeEach ensures this

    await handleSpawnChild({ token: 1123456, topic: "Research" });

    expect(getSessionVoiceFor(CHILD_SID)).toBeNull();
  });

  it("AC4: child has no speed when parent has no speed set", async () => {
    await handleSpawnChild({ token: 1123456, topic: "Research" });

    expect(getSessionSpeedFor(CHILD_SID)).toBeNull();
  });

  it("AC4: voice inheritance is independent of name/color inheritance", async () => {
    mocks.getSession.mockReturnValue({ sid: PARENT_SID, name: "Curator", color: "🔵" });
    runInSessionContext(PARENT_SID, () => { setSessionVoice("echo"); });

    await handleSpawnChild({ token: 1123456, topic: "Research" });

    // voice copied
    expect(getSessionVoiceFor(CHILD_SID)).toBe("echo");
    // name/color still inherited correctly
    expect(mocks.handleSessionStart).toHaveBeenCalledWith(expect.objectContaining({
      name: "Curator",
      color: "🔵",
    }));
  });
});
