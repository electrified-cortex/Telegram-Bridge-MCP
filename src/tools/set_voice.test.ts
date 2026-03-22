import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  getSessionVoice: vi.fn<() => string | null>(),
  setSessionVoice: vi.fn(),
  clearSessionVoice: vi.fn(),
  getSessionSpeed: vi.fn<() => number | null>(),
  setSessionSpeed: vi.fn(),
  clearSessionSpeed: vi.fn(),
}));

vi.mock("../voice-state.js", () => ({
  getSessionVoice: mocks.getSessionVoice,
  setSessionVoice: mocks.setSessionVoice,
  clearSessionVoice: mocks.clearSessionVoice,
  getSessionSpeed: mocks.getSessionSpeed,
  setSessionSpeed: mocks.setSessionSpeed,
  clearSessionSpeed: mocks.clearSessionSpeed,
}));

vi.mock("../session-manager.js", () => ({
  validateSession: mocks.validateSession,
}));

import { register } from "./set_voice.js";

describe("set_voice tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.getSessionVoice.mockReturnValue(null);
    mocks.getSessionSpeed.mockReturnValue(null);
    const server = createMockServer();
    register(server);
    call = server.getHandler("set_voice");
  });

  it("sets a voice and returns { voice, previous, set: true }", async () => {
    mocks.getSessionVoice.mockReturnValueOnce(null).mockReturnValueOnce("alloy");
    const result = await call({ voice: "alloy", identity: [1, 123456] });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.set).toBe(true);
    expect(data.voice).toBe("alloy");
    expect(data.previous).toBeNull();
    expect(mocks.setSessionVoice).toHaveBeenCalledWith("alloy");
  });

  it("replaces an existing voice", async () => {
    mocks.getSessionVoice.mockReturnValueOnce("echo").mockReturnValueOnce("nova");
    const result = await call({ voice: "nova", identity: [1, 123456] });
    const data = parseResult(result);
    expect(data.previous).toBe("echo");
    expect(data.voice).toBe("nova");
  });

  it("clears voice when empty string passed", async () => {
    mocks.getSessionVoice.mockReturnValueOnce("fable");
    const result = await call({ voice: "", identity: [1, 123456] });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.cleared).toBe(true);
    expect(data.voice).toBeNull();
    expect(data.previous).toBe("fable");
    expect(mocks.clearSessionVoice).toHaveBeenCalledOnce();
    expect(mocks.setSessionVoice).not.toHaveBeenCalled();
  });

  it("clears voice when whitespace-only string passed", async () => {
    mocks.getSessionVoice.mockReturnValueOnce("shimmer");
    const result = await call({ voice: "   ", identity: [1, 123456] });
    const data = parseResult(result);
    expect(data.cleared).toBe(true);
    expect(mocks.clearSessionVoice).toHaveBeenCalledOnce();
  });

  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call({ voice: "alloy" });
      expect(isError(result)).toBe(true);
      const data = parseResult(result);
      expect(data.code).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when identity has wrong pin", async () => {
      mocks.validateSession.mockReturnValue(false);
      const result = await call({ voice: "alloy", identity: [1, 999999] });
      expect(isError(result)).toBe(true);
      const data = parseResult(result);
      expect(data.code).toBe("AUTH_FAILED");
    });
  });
});
