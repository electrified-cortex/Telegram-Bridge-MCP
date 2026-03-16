import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  setSessionDefault: vi.fn(),
  resetSessionDefault: vi.fn(),
  registerPreset: vi.fn(),
  getDefaultFrames: vi.fn(),
  listPresets: vi.fn(),
  listBuiltinPresets: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, resolveChat: () => 42 };
});

vi.mock("../animation-state.js", async (importActual) => {
  const actual = await importActual<typeof import("../animation-state.js")>();
  return {
    ...actual,
    setSessionDefault: mocks.setSessionDefault,
    resetSessionDefault: mocks.resetSessionDefault,
    registerPreset: mocks.registerPreset,
    getDefaultFrames: mocks.getDefaultFrames,
    listPresets: mocks.listPresets,
    listBuiltinPresets: mocks.listBuiltinPresets,
  };
});

import { register } from "./set_default_animation.js";

describe("set_default_animation tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDefaultFrames.mockReturnValue(["`...`", "`·..`"]);
    mocks.listPresets.mockReturnValue([]);
    mocks.listBuiltinPresets.mockReturnValue(["bounce", "dots", "working", "thinking", "loading"]);
    const server = createMockServer();
    register(server);
    call = server.getHandler("set_default_animation");
  });

  it("queries current state when called with no args", async () => {
    mocks.getDefaultFrames.mockReturnValue(["a", "b"]);
    mocks.listPresets.mockReturnValue(["thinking"]);
    const result = await call({});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.default_frames).toEqual(["a", "b"]);
    expect(data.session_presets).toEqual(["thinking"]);
    expect(data.builtin_presets).toEqual(["bounce", "dots", "working", "thinking", "loading"]);
  });

  it("sets session default frames", async () => {
    const result = await call({ frames: ["thinking.", "thinking..", "thinking..."] });
    expect(isError(result)).toBe(false);
    expect(mocks.setSessionDefault).toHaveBeenCalledWith(["thinking.", "thinking..", "thinking..."]);
    const data = parseResult(result);
    expect(data.action).toBe("default_set");
  });

  it("registers a named preset", async () => {
    mocks.listPresets.mockReturnValue(["cool"]);
    const result = await call({ frames: ["✨", "💫"], name: "cool" });
    expect(isError(result)).toBe(false);
    expect(mocks.registerPreset).toHaveBeenCalledWith("cool", ["✨", "💫"]);
    const data = parseResult(result);
    expect(data.action).toBe("preset_registered");
    expect(data.name).toBe("cool");
  });

  it("resets session default", async () => {
    const result = await call({ reset: true });
    expect(isError(result)).toBe(false);
    expect(mocks.resetSessionDefault).toHaveBeenCalledOnce();
    const data = parseResult(result);
    expect(data.action).toBe("reset");
  });

  it("reset ignores frames and name", async () => {
    await call({ reset: true, frames: ["ignored"], name: "ignored" });
    expect(mocks.resetSessionDefault).toHaveBeenCalledOnce();
    expect(mocks.setSessionDefault).not.toHaveBeenCalled();
    expect(mocks.registerPreset).not.toHaveBeenCalled();
  });
});
