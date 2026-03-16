import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  cancelAnimation: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual };
});

vi.mock("../animation-state.js", () => ({
  cancelAnimation: mocks.cancelAnimation,
}));

import { register } from "./cancel_animation.js";

describe("cancel_animation tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server);
    call = server.getHandler("cancel_animation");
  });

  it("cancels animation and returns cancelled:true", async () => {
    mocks.cancelAnimation.mockResolvedValue({ cancelled: true });
    const result = await call({});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.cancelled).toBe(true);
  });

  it("returns cancelled:false when no animation is active", async () => {
    mocks.cancelAnimation.mockResolvedValue({ cancelled: false });
    const result = await call({});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.cancelled).toBe(false);
  });

  it("passes text and parse_mode to cancelAnimation", async () => {
    mocks.cancelAnimation.mockResolvedValue({ cancelled: true, message_id: 10 });
    await call({ text: "Done!", parse_mode: "HTML" });
    expect(mocks.cancelAnimation).toHaveBeenCalledWith("Done!", "HTML");
  });

  it("returns message_id when text replacement is provided", async () => {
    mocks.cancelAnimation.mockResolvedValue({ cancelled: true, message_id: 10 });
    const result = await call({ text: "Complete" });
    const data = parseResult(result);
    expect(data.cancelled).toBe(true);
    expect(data.message_id).toBe(10);
  });

  it("uses default Markdown parse_mode when not specified", async () => {
    mocks.cancelAnimation.mockResolvedValue({ cancelled: true });
    await call({ text: "Result" });
    expect(mocks.cancelAnimation).toHaveBeenCalledWith("Result", "Markdown");
  });

  it("calls cancelAnimation without text when text is omitted", async () => {
    mocks.cancelAnimation.mockResolvedValue({ cancelled: true });
    await call({});
    expect(mocks.cancelAnimation).toHaveBeenCalledWith(undefined, "Markdown");
  });

  it("returns error when cancelAnimation throws", async () => {
    mocks.cancelAnimation.mockRejectedValue(new Error("unexpected"));
    const result = await call({});
    expect(isError(result)).toBe(true);
  });
});
