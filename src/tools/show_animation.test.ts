import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  startAnimation: vi.fn(),
  getPreset: vi.fn(),
  getDefaultFrames: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, resolveChat: () => 42 };
});

vi.mock("../animation-state.js", async (importActual) => {
  const actual = await importActual<typeof import("../animation-state.js")>();
  return {
    ...actual,
    startAnimation: mocks.startAnimation,
    getPreset: mocks.getPreset,
    getDefaultFrames: mocks.getDefaultFrames,
  };
});

import { register } from "./show_animation.js";

describe("show_animation tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDefaultFrames.mockReturnValue(["`...`", "`·..`"]);
    const server = createMockServer();
    register(server);
    call = server.getHandler("show_animation");
  });

  it("starts animation and returns message_id", async () => {
    mocks.startAnimation.mockResolvedValue(50);
    const result = await call({});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(50);
  });

  it("passes undefined frames when none specified (uses session default)", async () => {
    mocks.startAnimation.mockResolvedValue(51);
    await call({});
    expect(mocks.startAnimation).toHaveBeenCalledWith(
      undefined,
      1000,
      120,
      false,
    );
  });

  it("passes custom frames, interval, and timeout", async () => {
    mocks.startAnimation.mockResolvedValue(52);
    await call({
      frames: ["🔄", "⏳", "✅"],
      interval: 3000,
      timeout: 60,
    });
    expect(mocks.startAnimation).toHaveBeenCalledWith(
      ["🔄", "⏳", "✅"],
      3000,
      60,
      false,
    );
  });

  it("resolves preset frames by name", async () => {
    mocks.getPreset.mockReturnValue(["thinking.", "thinking..", "thinking..."]);
    mocks.startAnimation.mockResolvedValue(53);
    const result = await call({ preset: "thinking" });
    expect(isError(result)).toBe(false);
    expect(mocks.startAnimation).toHaveBeenCalledWith(
      ["thinking.", "thinking..", "thinking..."],
      1000,
      120,
      false,
    );
  });

  it("preset takes priority over explicit frames", async () => {
    mocks.getPreset.mockReturnValue(["preset."]);
    mocks.startAnimation.mockResolvedValue(54);
    await call({ preset: "mypreset", frames: ["ignored"] });
    expect(mocks.startAnimation).toHaveBeenCalledWith(
      ["preset."],
      1000,
      120,
      false,
    );
  });

  it("returns error for unknown preset", async () => {
    mocks.getPreset.mockReturnValue(undefined);
    const result = await call({ preset: "nonexistent" });
    expect(isError(result)).toBe(true);
  });

  it("returns error when startAnimation throws", async () => {
    mocks.startAnimation.mockRejectedValue(new Error("ALLOWED_USER_ID not configured"));
    const result = await call({});
    expect(isError(result)).toBe(true);
  });

  it("returns error when resolveChat fails", async () => {
    mocks.startAnimation.mockRejectedValue(new Error("Something went wrong"));
    const result = await call({ frames: ["⏳"] });
    expect(isError(result)).toBe(true);
  });

  it("passes persistent flag to startAnimation", async () => {
    mocks.startAnimation.mockResolvedValue(55);
    const result = await call({ persistent: true });
    expect(isError(result)).toBe(false);
    expect(mocks.startAnimation).toHaveBeenCalledWith(
      undefined,
      1000,
      120,
      true,
    );
    const data = parseResult(result);
    expect(data.persistent).toBe(true);
  });
});
