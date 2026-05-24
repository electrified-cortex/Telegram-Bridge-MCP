import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "../test-utils.js";
import { testIdentityGate } from "../test-helpers/identity-gate.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  cancelAnimation: vi.fn(),
}));

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual };
});

vi.mock("../../animation-state.js", () => ({
  cancelAnimation: mocks.cancelAnimation,
}));

vi.mock("../../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./cancel.js";

describe("cancel_animation tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("cancel_animation");
  });

  it("cancels animation successfully", async () => {
    mocks.cancelAnimation.mockResolvedValue({});
    const result = await call({ token: 1123456 });
    expect(isError(result)).toBe(false);
  });

  it("returns cancelled:false when no animation is active", async () => {
    mocks.cancelAnimation.mockResolvedValue({ cancelled: false });
    const result = await call({ token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.cancelled).toBe(false);
  });

  it("passes text and parse_mode to cancelAnimation", async () => {
    mocks.cancelAnimation.mockResolvedValue({ cancelled: true, message_id: 10 });
    await call({ text: "Done!", parse_mode: "HTML", token: 1123456});
    expect(mocks.cancelAnimation).toHaveBeenCalledWith(1, "Done!", "HTML");
  });

  it("returns message_id when text replacement is provided", async () => {
    mocks.cancelAnimation.mockResolvedValue({ message_id: 10 });
    const result = await call({ text: "Complete", token: 1123456});
    const data = parseResult(result);
    expect(data.message_id).toBe(10);
  });

  it("uses default Markdown parse_mode when not specified", async () => {
    mocks.cancelAnimation.mockResolvedValue({ cancelled: true });
    await call({ text: "Result", token: 1123456});
    expect(mocks.cancelAnimation).toHaveBeenCalledWith(1, "Result", "Markdown");
  });

  it("calls cancelAnimation without text when text is omitted", async () => {
    mocks.cancelAnimation.mockResolvedValue({ cancelled: true });
    await call({ token: 1123456 });
    expect(mocks.cancelAnimation).toHaveBeenCalledWith(1, undefined, "Markdown");
  });

  it("returns error when cancelAnimation throws", async () => {
    mocks.cancelAnimation.mockRejectedValue(new Error("unexpected"));
    const result = await call({ token: 1123456 });
    expect(isError(result)).toBe(true);
  });

testIdentityGate((args) => call(args), mocks.validateSession);

});
