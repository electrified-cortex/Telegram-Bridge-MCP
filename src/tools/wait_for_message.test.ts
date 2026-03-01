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
  transcribeWithIndicator: vi.fn().mockResolvedValue("hello from voice"),
}));

import { register } from "./wait_for_message.js";

const makeTextUpdate = (chat_id: number, user_id: number, text: string) => ({
  update_id: 1,
  message: {
    message_id: 5,
    text,
    chat: { id: chat_id },
    from: { id: user_id, username: "user", first_name: "User" },
    date: 1000,
  },
});

const makeDocumentUpdate = (chat_id: number, user_id: number) => ({
  update_id: 1,
  message: {
    message_id: 6,
    document: { file_id: "doc123", file_unique_id: "uniq1", file_name: "report.pdf", mime_type: "application/pdf", file_size: 5000 },
    caption: "Here is the report",
    chat: { id: chat_id },
    from: { id: user_id, username: "user", first_name: "User" },
    date: 1000,
  },
});

const makePhotoUpdate = (chat_id: number, user_id: number) => ({
  update_id: 1,
  message: {
    message_id: 7,
    photo: [
      { file_id: "small", file_unique_id: "s1", width: 100, height: 100, file_size: 1000 },
      { file_id: "large", file_unique_id: "l1", width: 800, height: 600, file_size: 50000 },
    ],
    caption: "A photo",
    chat: { id: chat_id },
    from: { id: user_id, username: "user", first_name: "User" },
    date: 1000,
  },
});

const makeUnknownUpdate = (chat_id: number, user_id: number) => ({
  update_id: 1,
  message: {
    message_id: 8,
    some_future_field: { data: "???" },
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

  it("returns text message with type=text", async () => {
    mocks.getUpdates.mockResolvedValue([makeTextUpdate(42, 10, "hello")]);
    const result = await call({ timeout_seconds: 5 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.timed_out).toBe(false);
    expect(data.type).toBe("text");
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
    mocks.getUpdates.mockResolvedValue([makeTextUpdate(999, 10, "hi")]);
    const result = await call({ timeout_seconds: 1 });
    expect((parseResult(result) as any).timed_out).toBe(true);
  });

  it("filters by user_id", async () => {
    mocks.getUpdates.mockResolvedValue([makeTextUpdate(42, 99, "hi")]);
    const result = await call({ timeout_seconds: 1, user_id: 10 });
    expect((parseResult(result) as any).timed_out).toBe(true);
  });

  it("returns document message with type=document", async () => {
    mocks.getUpdates.mockResolvedValue([makeDocumentUpdate(42, 10)]);
    const result = await call({ timeout_seconds: 5 });
    const data = parseResult(result) as any;
    expect(data.timed_out).toBe(false);
    expect(data.type).toBe("document");
    expect(data.file_id).toBe("doc123");
    expect(data.file_name).toBe("report.pdf");
    expect(data.mime_type).toBe("application/pdf");
    expect(data.caption).toBe("Here is the report");
  });

  it("returns photo message with type=photo and largest size", async () => {
    mocks.getUpdates.mockResolvedValue([makePhotoUpdate(42, 10)]);
    const result = await call({ timeout_seconds: 5 });
    const data = parseResult(result) as any;
    expect(data.timed_out).toBe(false);
    expect(data.type).toBe("photo");
    expect(data.file_id).toBe("large");
    expect(data.width).toBe(800);
    expect(data.caption).toBe("A photo");
  });

  it("returns unknown type with note", async () => {
    mocks.getUpdates.mockResolvedValue([makeUnknownUpdate(42, 10)]);
    const result = await call({ timeout_seconds: 5 });
    const data = parseResult(result) as any;
    expect(data.timed_out).toBe(false);
    expect(data.type).toBe("unknown");
    expect(data.note).toContain("What would you like me to do with it");
  });

  it("returns voice message with type=voice and transcribed text", async () => {
    mocks.getUpdates.mockResolvedValue([{
      update_id: 1,
      message: {
        message_id: 9,
        voice: { file_id: "voice123", file_unique_id: "v1", duration: 5 },
        chat: { id: 42 },
        from: { id: 10 },
        date: 1000,
      },
    }]);
    const result = await call({ timeout_seconds: 5 });
    const data = parseResult(result) as any;
    expect(data.timed_out).toBe(false);
    expect(data.type).toBe("voice");
    expect(data.text).toBe("hello from voice");
    expect(data.voice).toBe(true);
  });

  it("non-matching updates (e.g. reactions) are buffered, not dropped", async () => {
    // reaction arrives in the same batch as the message — the reaction should
    // not be silently dropped; it goes to the update buffer instead.
    const reactionUpdate = {
      update_id: 2,
      message_reaction: {
        message_id: 50,
        user: { id: 10, first_name: "Alice", username: "alice" },
        new_reaction: [{ type: "emoji", emoji: "👍" }],
        old_reaction: [],
      },
    };
    mocks.getUpdates.mockResolvedValue([
      reactionUpdate,
      makeTextUpdate(42, 10, "hello"),
    ]);
    const result = await call({ timeout_seconds: 5 });
    const data = parseResult(result) as any;
    expect(data.timed_out).toBe(false);
    expect(data.text).toBe("hello");
    // reactions are no longer inlined — they are buffered for later consumption
    expect(data.reactions).toBeUndefined();
  });
});
