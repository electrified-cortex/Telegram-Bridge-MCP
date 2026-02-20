import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ sendPhoto: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks };
});

import { register } from "./send_photo.js";

describe("send_photo tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("send_photo");
  });

  it("sends a photo and returns message_id", async () => {
    mocks.sendPhoto.mockResolvedValue({ message_id: 3, chat: { id: 1 }, date: 0 });
    const result = await call({ chat_id: "1", photo: "https://example.com/img.jpg" });
    expect(isError(result)).toBe(false);
    expect((parseResult(result) as any).message_id).toBe(3);
  });

  it("validates caption length pre-send", async () => {
    const result = await call({
      chat_id: "1",
      photo: "https://example.com/img.jpg",
      caption: "c".repeat(1025),
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CAPTION_TOO_LONG");
    expect(mocks.sendPhoto).not.toHaveBeenCalled();
  });

  it("passes caption and parse_mode to API", async () => {
    mocks.sendPhoto.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({ chat_id: "1", photo: "https://x.com/p.jpg", caption: "cap", parse_mode: "HTML" });
    const [, , opts] = mocks.sendPhoto.mock.calls[0];
    expect(opts.caption).toBe("cap");
    expect(opts.parse_mode).toBe("HTML");
  });
});
