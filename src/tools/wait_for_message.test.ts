import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ getUpdates: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  const filterFn = (updates: any[]) => {
    return updates.filter((u: any) => {
      const chatId = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id;
      return chatId === undefined || String(chatId) === "42";
    });
  };
  return {
    ...actual,
    getApi: () => mocks,
    getOffset: () => 0,
    advanceOffset: vi.fn(),
    filterAllowedUpdates: filterFn,
    pollUntil: async (matcher: any, _timeout: number) => {
      const updates = await mocks.getUpdates();
      const allowed = filterFn(updates);
      const result = matcher(allowed);
      const missed = result !== undefined
        ? allowed.filter((u: any) => matcher([u]) === undefined)
        : [...allowed];
      return { match: result, missed };
    },
  };
});

vi.mock("../transcribe.js", () => ({
  transcribeVoice: vi.fn().mockResolvedValue("hello from voice"),
}));

import { register } from "./wait_for_message.js";

const makeUpdate = (chat_id: number, user_id: number, text: string) => ({
  update_id: 1,
  message: {
    message_id: 5,
    text,
    chat: { id: chat_id },
    from: { id: user_id, username: "user", first_name: "User" },
    date: 1000,
  },
});

describe("wait_for_message tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("wait_for_message");
  });

  it("returns message text when update arrives", async () => {
    mocks.getUpdates.mockResolvedValue([makeUpdate(42, 10, "hello")]);
    const result = await call({ timeout_seconds: 5 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.timed_out).toBe(false);
    expect(data.text).toBe("hello");
    expect(data.chat_id).toBeUndefined();
    expect(data.from).toBeUndefined();
  });

  it("returns timed_out when no message arrives", async () => {
    mocks.getUpdates.mockResolvedValue([]);
    const result = await call({ timeout_seconds: 1 });
    expect((parseResult(result) as any).timed_out).toBe(true);
  });

  it("filters by chat_id", async () => {
    mocks.getUpdates.mockResolvedValue([makeUpdate(999, 10, "hi")]);
    const result = await call({ timeout_seconds: 1 });
    expect((parseResult(result) as any).timed_out).toBe(true);
  });

  it("filters by user_id", async () => {
    mocks.getUpdates.mockResolvedValue([makeUpdate(42, 99, "hi")]);
    const result = await call({ timeout_seconds: 1, user_id: 10 });
    expect((parseResult(result) as any).timed_out).toBe(true);
  });

  it("ignores updates without text (e.g. photo messages)", async () => {
    mocks.getUpdates.mockResolvedValue([
      { update_id: 1, message: { message_id: 1, chat: { id: 42 }, from: { id: 10 }, date: 0 } },
    ]);
    const result = await call({ timeout_seconds: 1 });
    expect((parseResult(result) as any).timed_out).toBe(true);
  });
});
