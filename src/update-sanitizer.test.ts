import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Update } from "grammy/types";

const mocks = vi.hoisted(() => ({
  transcribeWithIndicator: vi.fn(),
}));

vi.mock("./transcribe.js", () => ({
  transcribeWithIndicator: mocks.transcribeWithIndicator,
}));

import {
  sanitizeUpdate,
  sanitizeUpdates,
  sanitizeSessionEntry,
  sanitizeSessionEntries,
} from "./update-sanitizer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msgUpdate(overrides: Record<string, unknown>): Update {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 0,
      chat: { id: 1, type: "private" },
      from: { id: 1, is_bot: false, first_name: "Test" },
      ...overrides,
    },
  } as unknown as Update;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("update-sanitizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -- Text message --------------------------------------------------------

  it("sanitizes text message", async () => {
    const result = await sanitizeUpdate(msgUpdate({ text: "hello" }));
    expect(result).toEqual({
      type: "message",
      content_type: "text",
      message_id: 10,
      reply_to_message_id: undefined,
      text: "hello",
    });
  });

  it("includes reply_to_message_id when present", async () => {
    const result = await sanitizeUpdate(
      msgUpdate({
        text: "reply",
        reply_to_message: { message_id: 5 },
      }),
    );
    expect(result.reply_to_message_id).toBe(5);
  });

  // -- Voice message -------------------------------------------------------

  it("sanitizes voice message with transcription", async () => {
    mocks.transcribeWithIndicator.mockResolvedValue("transcribed text");
    const result = await sanitizeUpdate(
      msgUpdate({ voice: { file_id: "voice123", duration: 5 } }),
    );
    expect(result).toMatchObject({
      type: "message",
      content_type: "voice",
      text: "transcribed text",
      file_id: "voice123",
      voice: true,
    });
    expect(mocks.transcribeWithIndicator).toHaveBeenCalledWith(
      "voice123",
      10,
    );
  });

  it("handles transcription failure gracefully", async () => {
    mocks.transcribeWithIndicator.mockRejectedValue(
      new Error("API down"),
    );
    const result = await sanitizeUpdate(
      msgUpdate({ voice: { file_id: "v1", duration: 1 } }),
    );
    expect(result.text).toBe("[transcription failed: API down]");
  });

  // -- Document ------------------------------------------------------------

  it("sanitizes document message", async () => {
    const result = await sanitizeUpdate(
      msgUpdate({
        document: {
          file_id: "doc1",
          file_unique_id: "uniq1",
          file_name: "test.pdf",
          mime_type: "application/pdf",
          file_size: 1024,
        },
        caption: "Here is a file",
      }),
    );
    expect(result).toMatchObject({
      type: "message",
      content_type: "document",
      file_id: "doc1",
      file_name: "test.pdf",
      mime_type: "application/pdf",
      caption: "Here is a file",
    });
  });

  // -- Photo ---------------------------------------------------------------

  it("sanitizes photo — picks largest", async () => {
    const result = await sanitizeUpdate(
      msgUpdate({
        photo: [
          { file_id: "sm", file_unique_id: "s1", width: 90, height: 90 },
          {
            file_id: "lg",
            file_unique_id: "l1",
            width: 800,
            height: 600,
            file_size: 50000,
          },
        ],
        caption: "A photo",
      }),
    );
    expect(result).toMatchObject({
      type: "message",
      content_type: "photo",
      file_id: "lg",
      width: 800,
      height: 600,
      caption: "A photo",
    });
  });

  // -- Audio ---------------------------------------------------------------

  it("sanitizes audio message", async () => {
    const result = await sanitizeUpdate(
      msgUpdate({
        audio: {
          file_id: "aud1",
          file_unique_id: "au1",
          title: "Song",
          performer: "Artist",
          duration: 180,
          mime_type: "audio/mpeg",
          file_size: 3000000,
        },
        caption: "Listen",
      }),
    );
    expect(result).toMatchObject({
      type: "message",
      content_type: "audio",
      file_id: "aud1",
      title: "Song",
      performer: "Artist",
    });
  });

  // -- Video ---------------------------------------------------------------

  it("sanitizes video message", async () => {
    const result = await sanitizeUpdate(
      msgUpdate({
        video: {
          file_id: "vid1",
          file_unique_id: "vu1",
          width: 1920,
          height: 1080,
          duration: 30,
          mime_type: "video/mp4",
          file_size: 5000000,
        },
      }),
    );
    expect(result).toMatchObject({
      type: "message",
      content_type: "video",
      file_id: "vid1",
      width: 1920,
      height: 1080,
    });
  });

  // -- Animation (GIF) -----------------------------------------------------

  it("sanitizes animation message", async () => {
    const result = await sanitizeUpdate(
      msgUpdate({
        animation: {
          file_id: "gif1",
          file_unique_id: "g1",
          file_name: "funny.gif",
          duration: 3,
          mime_type: "video/mp4",
        },
      }),
    );
    expect(result).toMatchObject({
      type: "message",
      content_type: "animation",
      file_id: "gif1",
      file_name: "funny.gif",
    });
  });

  // -- Sticker -------------------------------------------------------------

  it("sanitizes sticker message", async () => {
    const result = await sanitizeUpdate(
      msgUpdate({
        sticker: {
          file_id: "stk1",
          file_unique_id: "s1",
          type: "regular",
          width: 512,
          height: 512,
          is_animated: false,
          is_video: false,
          emoji: "😀",
          set_name: "MySet",
        },
      }),
    );
    expect(result).toMatchObject({
      type: "message",
      content_type: "sticker",
      emoji: "😀",
      set_name: "MySet",
    });
  });

  // -- Contact -------------------------------------------------------------

  it("sanitizes contact message", async () => {
    const result = await sanitizeUpdate(
      msgUpdate({
        contact: {
          phone_number: "+1234567890",
          first_name: "John",
          last_name: "Doe",
        },
      }),
    );
    expect(result).toMatchObject({
      type: "message",
      content_type: "contact",
      phone_number: "+1234567890",
      first_name: "John",
    });
  });

  // -- Location ------------------------------------------------------------

  it("sanitizes location message", async () => {
    const result = await sanitizeUpdate(
      msgUpdate({
        location: { latitude: 40.7128, longitude: -74.006 },
      }),
    );
    expect(result).toMatchObject({
      type: "message",
      content_type: "location",
      latitude: 40.7128,
      longitude: -74.006,
    });
  });

  // -- Poll ----------------------------------------------------------------

  it("sanitizes poll message", async () => {
    const result = await sanitizeUpdate(
      msgUpdate({
        poll: {
          id: "p1",
          question: "Color?",
          options: [{ text: "Red" }, { text: "Blue" }],
          total_voter_count: 0,
          is_closed: false,
          is_anonymous: true,
          type: "regular",
          allows_multiple_answers: false,
        },
      }),
    );
    expect(result).toMatchObject({
      type: "message",
      content_type: "poll",
      question: "Color?",
      options: ["Red", "Blue"],
    });
  });

  // -- Unknown message type ------------------------------------------------

  it("returns unknown for unrecognized message content", async () => {
    const result = await sanitizeUpdate(
      msgUpdate({ game: { title: "Snake" } }),
    );
    expect(result.type).toBe("message");
    expect(result.content_type).toBe("unknown");
    expect(result.content_keys).toContain("game");
  });

  // -- Callback query ------------------------------------------------------

  it("sanitizes callback_query", async () => {
    const update: Update = {
      update_id: 2,
      callback_query: {
        id: "cq42",
        chat_instance: "inst",
        from: { id: 1, is_bot: false, first_name: "T" },
        data: "option_a",
        message: {
          message_id: 20,
          date: 0,
          chat: { id: 1, type: "private" },
        },
      },
    } as unknown as Update;
    const result = await sanitizeUpdate(update);
    expect(result).toEqual({
      type: "callback_query",
      callback_query_id: "cq42",
      data: "option_a",
      message_id: 20,
    });
  });

  // -- Message reaction ----------------------------------------------------

  it("sanitizes message_reaction — exposes only user id (PII)", async () => {
    const update: Update = {
      update_id: 3,
      message_reaction: {
        chat: { id: 1, type: "private" },
        message_id: 30,
        date: 0,
        user: {
          id: 999,
          is_bot: false,
          first_name: "Alice",
          username: "alice",
        },
        new_reaction: [{ type: "emoji", emoji: "👍" }],
        old_reaction: [{ type: "emoji", emoji: "❤" }],
      },
    } as unknown as Update;
    const result = await sanitizeUpdate(update);
    expect(result).toMatchObject({
      type: "message_reaction",
      message_id: 30,
      user: { id: 999 },
      emoji_added: ["👍"],
      emoji_removed: ["❤"],
    });
    // Must NOT leak first_name or username
    expect(result.user).not.toHaveProperty("first_name");
    expect(result.user).not.toHaveProperty("username");
  });

  it("handles reaction without user", async () => {
    const update: Update = {
      update_id: 4,
      message_reaction: {
        chat: { id: 1, type: "private" },
        message_id: 31,
        date: 0,
        new_reaction: [],
        old_reaction: [],
      },
    } as unknown as Update;
    const result = await sanitizeUpdate(update);
    expect(result.user).toBeUndefined();
  });

  // -- Other update type ---------------------------------------------------

  it("returns { type: other } for unrecognized update", async () => {
    const update = { update_id: 5 } as Update;
    const result = await sanitizeUpdate(update);
    expect(result).toEqual({ type: "other" });
  });

  // -- Batch helpers -------------------------------------------------------

  it("sanitizeUpdates processes multiple updates", async () => {
    const updates = [
      msgUpdate({ text: "a" }),
      msgUpdate({ text: "b" }),
    ];
    const results = await sanitizeUpdates(updates);
    expect(results).toHaveLength(2);
    expect(results[0].text).toBe("a");
    expect(results[1].text).toBe("b");
  });

  // -- Session entry helpers -----------------------------------------------

  it("sanitizeSessionEntry — user entry", async () => {
    const entry = {
      direction: "user" as const,
      update: msgUpdate({ text: "hi" }),
    };
    const result = await sanitizeSessionEntry(entry);
    expect(result.from).toBe("user");
    expect(result.text).toBe("hi");
  });

  it("sanitizeSessionEntry — bot entry", async () => {
    const entry = {
      direction: "bot" as const,
      timestamp: "2025-01-01T00:00:00Z",
      message_id: 42,
      content_type: "text",
      text: "response",
    };
    const result = await sanitizeSessionEntry(entry);
    expect(result).toMatchObject({
      from: "bot",
      message_id: 42,
      content_type: "text",
      text: "response",
    });
    // direction field should be stripped
    expect(result).not.toHaveProperty("direction");
  });

  it("sanitizeSessionEntries batch", async () => {
    const entries = [
      { direction: "user" as const, update: msgUpdate({ text: "q" }) },
      {
        direction: "bot" as const,
        timestamp: "now",
        message_id: 1,
        content_type: "text",
        text: "a",
      },
    ];
    const results = await sanitizeSessionEntries(entries);
    expect(results).toHaveLength(2);
    expect(results[0].from).toBe("user");
    expect(results[1].from).toBe("bot");
  });
});
