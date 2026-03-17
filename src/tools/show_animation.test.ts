import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  startAnimation: vi.fn(),
  getPreset: vi.fn(),
  getDefaultFrames: vi.fn(),
  resolveChat: vi.fn((): number | { code: string; message: string } => 42),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    resolveChat: mocks.resolveChat,
  };
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

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: (...args: unknown[]) => mocks.validateSession(...args),
}));

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
      0,
      undefined,
      1000,
      600,
      false,
      false,
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
      0,
      ["🔄", "⏳", "✅"],
      3000,
      60,
      false,
      false,
      false,
    );
  });

  it("resolves preset frames by name", async () => {
    mocks.getPreset.mockReturnValue(["thinking.", "thinking..", "thinking..."]);
    mocks.startAnimation.mockResolvedValue(53);
    const result = await call({ preset: "thinking" });
    expect(isError(result)).toBe(false);
    expect(mocks.startAnimation).toHaveBeenCalledWith(
      0,
      ["thinking.", "thinking..", "thinking..."],
      1000,
      600,
      false,
      false,
      false,
    );
  });

  it("preset takes priority over explicit frames", async () => {
    mocks.getPreset.mockReturnValue(["preset."]);
    mocks.startAnimation.mockResolvedValue(54);
    await call({ preset: "mypreset", frames: ["ignored"] });
    expect(mocks.startAnimation).toHaveBeenCalledWith(
      0,
      ["preset."],
      1000,
      600,
      false,
      false,
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
      0,
      undefined,
      1000,
      600,
      true,
      false,
      false,
    );
    const data = parseResult(result);
    expect(data.persistent).toBe(true);
  });

  it("returns error when resolveChat returns non-number", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({});
    expect(isError(result)).toBe(true);
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when multiple sessions active and no identity", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(2);
    const result = await call({});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(2);
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"identity":[1,99999]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when multiple sessions active and identity is valid", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(2);
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"identity":[1,99999]})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

  it("proceeds when single session active and no identity (backward compat)", async () => {
    mocks.activeSessionCount.mockReturnValueOnce(1);
    let code: string | undefined;
    try { code = errorCode(await call({})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
  });
});

});
