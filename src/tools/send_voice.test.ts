import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ sendVoiceDirect: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, sendVoiceDirect: mocks.sendVoiceDirect, resolveChat: () => "1" };
});

import { register } from "./send_voice.js";

describe("send_voice tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("send_voice");
  });

  it("sends a voice URL and returns message_id", async () => {
    mocks.sendVoiceDirect.mockResolvedValue({ message_id: 8, voice: { file_id: "fid", mime_type: "audio/ogg", file_size: 1000, duration: 2 } });
    const result = await call({ voice: "https://example.com/msg.ogg" });
    expect(isError(result)).toBe(false);
    expect((parseResult(result) as any).message_id).toBe(8);
  });

  it("validates caption length pre-send", async () => {
    const result = await call({
      voice: "https://example.com/msg.ogg",
      caption: "c".repeat(1025),
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CAPTION_TOO_LONG");
    expect(mocks.sendVoiceDirect).not.toHaveBeenCalled();
  });

  it("passes caption and parse_mode to API", async () => {
    mocks.sendVoiceDirect.mockResolvedValue({ message_id: 2 });
    await call({ voice: "https://x.com/v.ogg", caption: "cap", parse_mode: "HTML" });
    const [, , opts] = mocks.sendVoiceDirect.mock.calls[0];
    expect(opts.caption).toBe("cap");
    expect(opts.parse_mode).toBe("HTML");
  });

  it("passes duration to API", async () => {
    mocks.sendVoiceDirect.mockResolvedValue({ message_id: 3 });
    await call({ voice: "https://x.com/v.ogg", duration: 15 });
    const [, , opts] = mocks.sendVoiceDirect.mock.calls[0];
    expect(opts.duration).toBe(15);
  });

  it("maps CHAT_NOT_FOUND from GrammyError", async () => {
    const { GrammyError } = await import("grammy");
    mocks.sendVoiceDirect.mockRejectedValue(
      new GrammyError("e", { ok: false, error_code: 400, description: "Bad Request: chat not found" }, "sendVoice", {})
    );
    const result = await call({ voice: "https://x.com/v.ogg" });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CHAT_NOT_FOUND");
  });
});
