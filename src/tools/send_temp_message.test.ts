import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const apiMocks = vi.hoisted(() => ({ sendMessage: vi.fn() }));
const tempMocks = vi.hoisted(() => ({
  setPendingTemp: vi.fn(),
  clearPendingTemp: vi.fn().mockResolvedValue(undefined),
  hasPendingTemp: vi.fn().mockReturnValue(false),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return {
    ...actual,
    resolveChat: () => "49154463",
    getApi: () => apiMocks,
  };
});

vi.mock("../temp-message.js", () => tempMocks);

import { register } from "./send_temp_message.js";

describe("send_temp_message tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.sendMessage.mockResolvedValue({ message_id: 42 });
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("send_temp_message");
  });

  it("sends message and returns ok + ttl_seconds", async () => {
    const result = await call({ text: "Thinking…" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.ok).toBe(true);
    expect(data.ttl_seconds).toBe(30);
  });

  it("calls setPendingTemp with chat_id, message_id, and ttl", async () => {
    await call({ text: "Analyzing…", ttl_seconds: 60 });
    expect(tempMocks.setPendingTemp).toHaveBeenCalledWith("49154463", 42, 60);
  });

  it("uses default ttl of 30 when not specified", async () => {
    await call({ text: "Working…" });
    expect(tempMocks.setPendingTemp).toHaveBeenCalledWith("49154463", 42, 30);
  });

  it("returns EMPTY_MESSAGE for blank text", async () => {
    const result = await call({ text: "   " });
    expect(isError(result)).toBe(true);
  });

  it("returns error when sendMessage throws", async () => {
    apiMocks.sendMessage.mockRejectedValue(new Error("network error"));
    const result = await call({ text: "Thinking…" });
    expect(isError(result)).toBe(true);
  });

  it("passes the text as-is (no formatting applied)", async () => {
    await call({ text: "Processing **bold** text" });
    const [, sentText] = apiMocks.sendMessage.mock.calls[0];
    expect(sentText).toBe("Processing **bold** text");
  });
});
