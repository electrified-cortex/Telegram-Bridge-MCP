import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setMyCommands: vi.fn(),
  resolveChat: vi.fn((): number | string => 123),
}));

vi.mock("./telegram.js", () => ({
  getApi: () => ({ setMyCommands: mocks.setMyCommands }),
  resolveChat: mocks.resolveChat,
}));

import { clearCommandsOnShutdown } from "./shutdown.js";

describe("shutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setMyCommands.mockResolvedValue(true);
  });

  it("clears chat-scoped and default-scoped commands", async () => {
    await clearCommandsOnShutdown();
    expect(mocks.setMyCommands).toHaveBeenCalledTimes(2);
    expect(mocks.setMyCommands).toHaveBeenCalledWith(
      [],
      { scope: { type: "chat", chat_id: 123 } },
    );
    expect(mocks.setMyCommands).toHaveBeenCalledWith(
      [],
      { scope: { type: "default" } },
    );
  });

  it("still clears default scope when chat scope fails", async () => {
    mocks.setMyCommands
      .mockRejectedValueOnce(new Error("no permission"))
      .mockResolvedValueOnce(true);
    await clearCommandsOnShutdown();
    expect(mocks.setMyCommands).toHaveBeenCalledTimes(2);
  });

  it("swallows errors for both scopes", async () => {
    mocks.setMyCommands.mockRejectedValue(new Error("fail"));
    await expect(clearCommandsOnShutdown()).resolves.toBeUndefined();
  });

  it("skips chat scope when resolveChat returns non-number", async () => {
    mocks.resolveChat.mockReturnValue("not configured");
    await clearCommandsOnShutdown();
    // Only default scope call
    expect(mocks.setMyCommands).toHaveBeenCalledTimes(1);
    expect(mocks.setMyCommands).toHaveBeenCalledWith(
      [],
      { scope: { type: "default" } },
    );
  });
});
