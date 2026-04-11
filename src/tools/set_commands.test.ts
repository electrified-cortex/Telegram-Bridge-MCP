import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";
import { GrammyError } from "grammy";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  setMyCommands: vi.fn(),
  resolveChat: vi.fn((): number | { code: string; message: string } => 42),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getApi: () => mocks, resolveChat: mocks.resolveChat };
});

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./set_commands.js";
import { BUILT_IN_COMMANDS } from "../built-in-commands.js";

const SAMPLE_COMMANDS = [
  { command: "cancel", description: "Stop the current task" },
  { command: "exit", description: "Exit the current workflow" },
];

/** Built-ins are always prepended; agent commands follow (de-duped). */
const MERGED = [...BUILT_IN_COMMANDS, ...SAMPLE_COMMANDS];

describe("set_commands tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("set_commands");
    mocks.setMyCommands.mockResolvedValue(true);
  });

  it("registers commands scoped to active chat (default scope)", async () => {
    const result = await call({ commands: SAMPLE_COMMANDS, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(data.count).toBe(MERGED.length);
    expect(data.scope).toBe("chat");
    expect(data.cleared).toBe(false);
    expect(mocks.setMyCommands).toHaveBeenCalledWith(MERGED, {
      scope: { type: "chat", chat_id: 42 },
    });
  });

  it("registers commands with explicit chat scope", async () => {
    const result = await call({ commands: SAMPLE_COMMANDS, scope: "chat", token: 1123456});
    expect(isError(result)).toBe(false);
    expect(mocks.setMyCommands).toHaveBeenCalledWith(MERGED, {
      scope: { type: "chat", chat_id: 42 },
    });
  });

  it("registers commands with default (global) scope", async () => {
    const result = await call({ commands: SAMPLE_COMMANDS, scope: "default", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.scope).toBe("default");
    expect(mocks.setMyCommands).toHaveBeenCalledWith(MERGED, {
      scope: { type: "default" },
    });
  });

  it("clears agent commands but keeps built-ins when empty array passed", async () => {
    const result = await call({ commands: [], token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(data.count).toBe(BUILT_IN_COMMANDS.length);
    expect(data.cleared).toBe(true);
    // Built-ins still remain
    expect(mocks.setMyCommands).toHaveBeenCalledWith([...BUILT_IN_COMMANDS], {
      scope: { type: "chat", chat_id: 42 },
    });
  });

  it("rejects a command with uppercase letters", async () => {
    await expect(
      call({ token: 1123456, commands: [{ command: "Cancel", description: "Stop" }] })
    ).rejects.toThrow();
    expect(mocks.setMyCommands).not.toHaveBeenCalled();
  });

  it("rejects a command with a leading slash", async () => {
    await expect(
      call({ token: 1123456, commands: [{ command: "/cancel", description: "Stop" }] })
    ).rejects.toThrow();
  });

  it("rejects a command with spaces", async () => {
    await expect(
      call({ token: 1123456, commands: [{ command: "my command", description: "Stop" }] })
    ).rejects.toThrow();
  });

  it("maps API errors to TelegramError", async () => {
    mocks.setMyCommands.mockRejectedValue(
      new GrammyError(
        "e",
        { ok: false, error_code: 400, description: "Bad Request: chat not found" },
        "setMyCommands",
        {},
      )
    );
    const result = await call({ commands: SAMPLE_COMMANDS, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CHAT_NOT_FOUND");
  });

  it("returns error when resolveChat fails for chat scope", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ commands: SAMPLE_COMMANDS, scope: "chat", token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
    expect(mocks.setMyCommands).not.toHaveBeenCalled();
  });

  it("does not include /primary when 2+ sessions active (bundled into /session)", async () => {
    mocks.activeSessionCount.mockReturnValue(2);
    const result = await call({ commands: SAMPLE_COMMANDS, token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    const calledWith = mocks.setMyCommands.mock.calls[0]?.[0] as Array<{ command: string }>;
    // /session now handles primary selection — /primary no longer added to menu
    expect(calledWith.map(c => c.command)).not.toContain("primary");
    expect(calledWith.map(c => c.command)).toContain("session");
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({"commands":[{"command":"x","description":"y"}]});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"commands":[{"command":"x","description":"y"}],"token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"commands":[{"command":"x","description":"y"}],"token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
