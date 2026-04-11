import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  setSessionDefault: vi.fn(),
  resetSessionDefault: vi.fn(),
  registerPreset: vi.fn(),
  getPreset: vi.fn(),
  getDefaultFrames: vi.fn(),
  listPresets: vi.fn(),
  listBuiltinPresets: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, resolveChat: () => 42 };
});

vi.mock("../animation-state.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    setSessionDefault: mocks.setSessionDefault,
    resetSessionDefault: mocks.resetSessionDefault,
    registerPreset: (...args: unknown[]) => mocks.registerPreset(...args),
    getPreset: (...args: unknown[]) => mocks.getPreset(...args),
    getDefaultFrames: (...args: unknown[]) => mocks.getDefaultFrames(...args),
    listPresets: (...args: unknown[]) => mocks.listPresets(...args),
    listBuiltinPresets: () => mocks.listBuiltinPresets(),
  };
});

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./set_default_animation.js";

describe("set_default_animation tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
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
    const result = await call({ token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.default_frames).toEqual(["a", "b"]);
    expect(data.session_presets).toEqual(["thinking"]);
    expect(data.builtin_presets).toEqual(["bounce", "dots", "working", "thinking", "loading"]);
  });

  it("sets session default frames", async () => {
    const result = await call({ frames: ["thinking.", "thinking..", "thinking..."], token: 1123456});
    expect(isError(result)).toBe(false);
    expect(mocks.setSessionDefault).toHaveBeenCalledWith(1, ["thinking.", "thinking..", "thinking..."]);
    const data = parseResult(result);
    expect(data.action).toBe("default_set");
  });

  it("registers a named preset", async () => {
    mocks.listPresets.mockReturnValue(["cool"]);
    const result = await call({ frames: ["✨", "💫"], name: "cool", token: 1123456});
    expect(isError(result)).toBe(false);
    expect(mocks.registerPreset).toHaveBeenCalledWith(1, "cool", ["✨", "💫"]);
    const data = parseResult(result);
    expect(data.action).toBe("preset_registered");
    expect(data.name).toBe("cool");
  });

  it("resets session default", async () => {
    const result = await call({ reset: true, token: 1123456});
    expect(isError(result)).toBe(false);
    expect(mocks.resetSessionDefault).toHaveBeenCalledOnce();
    const data = parseResult(result);
    expect(data.action).toBe("reset");
  });

  it("reset ignores frames and name", async () => {
    await call({ reset: true, frames: ["ignored"], name: "ignored", token: 1123456});
    expect(mocks.resetSessionDefault).toHaveBeenCalledOnce();
    expect(mocks.setSessionDefault).not.toHaveBeenCalled();
    expect(mocks.registerPreset).not.toHaveBeenCalled();
  });

  // 10-424 regression: set default by preset name
  it("sets session default from existing preset name (preset param, no frames)", async () => {
    const workingFrames = ["[   ]", "[=  ]", "[== ]", "[===]"];
    mocks.getPreset.mockReturnValue(workingFrames);
    mocks.listPresets.mockReturnValue(["working"]);
    const result = await call({ preset: "working", token: 1123456 });
    expect(isError(result)).toBe(false);
    expect(mocks.getPreset).toHaveBeenCalledWith(1, "working");
    expect(mocks.setSessionDefault).toHaveBeenCalledWith(1, workingFrames);
    const data = parseResult(result);
    expect(data.action).toBe("default_set");
    expect(data.preset).toBe("working");
  });

  it("returns error when preset name is unknown", async () => {
    mocks.getPreset.mockReturnValue(undefined);
    const result = await call({ preset: "nonexistent", token: 1123456 });
    expect(isError(result)).toBe(true);
    expect(mocks.setSessionDefault).not.toHaveBeenCalled();
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
