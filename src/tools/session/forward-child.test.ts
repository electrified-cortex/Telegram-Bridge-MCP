import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError } from "../test-utils.js";
import { registerChild, clearChildRegistry } from "./child-registry.js";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getSession: vi.fn(),
  deliverServiceMessage: vi.fn(),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("../../session-manager.js", () => ({
  getSession: mocks.getSession,
}));

vi.mock("../../session-queue.js", () => ({
  deliverServiceMessage: mocks.deliverServiceMessage,
}));

import { handleChildForward } from "./forward-child.js";

const PARENT_SID = 1;
const PARENT_TOKEN = 1_123_456;
const CHILD_SID = 2;

describe("child/forward", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChildRegistry();
    mocks.requireAuth.mockReturnValue(PARENT_SID);
    mocks.getSession.mockReturnValue({ sid: CHILD_SID, name: "Helper", color: "🟩" });
    mocks.deliverServiceMessage.mockReturnValue(true);
    registerChild(PARENT_SID, CHILD_SID);
  });

  // ── AC3b / AC3c: basic forward and UNAUTHORIZED ─────────────────────────

  it("AC3b: returns { forwarded: true, child_sid } on success", async () => {
    const result = parseResult(
      await handleChildForward({ token: PARENT_TOKEN, child_sid: CHILD_SID, message: "hello" }),
    );

    expect(result.forwarded).toBe(true);
    expect(result.child_sid).toBe(CHILD_SID);
  });

  it("AC3b: calls deliverServiceMessage with 'parent_forward' event type", async () => {
    await handleChildForward({ token: PARENT_TOKEN, child_sid: CHILD_SID, message: "hello" });

    expect(mocks.deliverServiceMessage).toHaveBeenCalledWith(
      CHILD_SID,
      "hello",
      "parent_forward",
      { from_sid: PARENT_SID },
    );
  });

  // ── AC3c: non-parent caller returns UNAUTHORIZED ─────────────────────────

  it("AC3c: returns UNAUTHORIZED when caller is not the parent", async () => {
    clearChildRegistry();
    registerChild(99, CHILD_SID); // child belongs to someone else

    const result = await handleChildForward({
      token: PARENT_TOKEN,
      child_sid: CHILD_SID,
      message: "sneaky",
    });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("AC3c: returns UNAUTHORIZED when child has no registered parent", async () => {
    clearChildRegistry();

    const result = await handleChildForward({
      token: PARENT_TOKEN,
      child_sid: CHILD_SID,
      message: "sneaky",
    });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("AC3c: uses parent_sid from session record when available", async () => {
    // Session has parent_sid pointing to a different parent
    mocks.getSession.mockReturnValue({
      sid: CHILD_SID, name: "Helper", color: "🟩", parent_sid: 99,
    });
    clearChildRegistry();

    const result = await handleChildForward({
      token: PARENT_TOKEN,
      child_sid: CHILD_SID,
      message: "sneaky",
    });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
  });

  // ── Auth guard ───────────────────────────────────────────────────────────

  it("returns SID_REQUIRED when token is missing", async () => {
    mocks.requireAuth.mockReturnValue({ code: "SID_REQUIRED", message: "token is required" });

    const result = await handleChildForward({
      token: undefined,
      child_sid: CHILD_SID,
      message: "hello",
    });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SID_REQUIRED");
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  // ── SESSION_NOT_FOUND guard ──────────────────────────────────────────────

  it("returns SESSION_NOT_FOUND when child session does not exist", async () => {
    mocks.getSession.mockReturnValue(undefined);

    const result = await handleChildForward({
      token: PARENT_TOKEN,
      child_sid: CHILD_SID,
      message: "hello",
    });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SESSION_NOT_FOUND");
    expect(mocks.deliverServiceMessage).not.toHaveBeenCalled();
  });

  it("returns SESSION_NOT_FOUND when queue is not active (deliverServiceMessage returns false)", async () => {
    mocks.deliverServiceMessage.mockReturnValue(false);

    const result = await handleChildForward({
      token: PARENT_TOKEN,
      child_sid: CHILD_SID,
      message: "hello",
    });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SESSION_NOT_FOUND");
  });
});
