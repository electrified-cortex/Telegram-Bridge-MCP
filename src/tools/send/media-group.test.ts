/**
 * Tests for handleSendMediaGroup (send(type: "album")).
 *
 * AC:
 * - 2–10 items → sends album; returns all message_ids
 * - 1 item → ALBUM_TOO_FEW (hint to use send_file)
 * - 0 items → schema rejects (min: 2); if bypassed → ALBUM_EMPTY
 * - >10 items → ALBUM_TOO_MANY
 * - photo+video mix → allowed (visual group)
 * - document-only → allowed
 * - audio-only → allowed
 * - mixed types (photo+document, etc.) → MEDIA_GROUP_TYPE_MIX
 * - per-item resolveMediaSource errors → propagated
 * - per-item caption validated via validateCaption
 * - showTyping called before send
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn((_sid: number, _suffix: number) => false),
  getActiveSession: vi.fn(() => 0),
  sendMediaGroup: vi.fn(),
  resolveMediaSource: vi.fn(),
  validateCaption: vi.fn((_c: string): { code: string; message: string } | null => null),
  showTyping: vi.fn(),
}));

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      sendMediaGroup: mocks.sendMediaGroup,
    }),
    resolveChat: () => 42,
    resolveMediaSource: mocks.resolveMediaSource,
    validateCaption: mocks.validateCaption,
  };
});

vi.mock("../../typing-state.js", () => ({
  showTyping: mocks.showTyping,
}));

vi.mock("../../session-manager.js", () => ({
  validateSession: mocks.validateSession,
  getActiveSession: () => mocks.getActiveSession(),
  activeSessionCount: () => 0,
}));

import { handleSendMediaGroup } from "./media-group.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN = 1123456; // sid=1, suffix=123456

function makeMsg(id: number) {
  return { message_id: id };
}

function parseResult(r: unknown): Record<string, unknown> {
  return (r as { content: [{ text: string }] }).content[0].text
    ? JSON.parse((r as { content: [{ text: string }] }).content[0].text)
    : (r as { result: Record<string, unknown> }).result;
}

function isError(r: unknown): boolean {
  return !!(r as { isError?: boolean }).isError;
}

function errorCode(r: unknown): string | undefined {
  const parsed = parseResult(r);
  return parsed?.code as string | undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleSendMediaGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.showTyping.mockResolvedValue(true);
    mocks.resolveMediaSource.mockReturnValue({ source: "/safe/file.jpg" });
    mocks.validateCaption.mockReturnValue(null);
    mocks.sendMediaGroup.mockResolvedValue([makeMsg(10), makeMsg(11)]);
  });

  // ── AC: happy path — 2 photos ─────────────────────────────────────────────

  it("sends 2 photos as album and returns message_ids", async () => {
    mocks.sendMediaGroup.mockResolvedValue([makeMsg(10), makeMsg(11)]);
    const result = await handleSendMediaGroup({
      files: [
        { file: "/img/a.jpg" },
        { file: "/img/b.jpg" },
      ],
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_ids).toEqual([10, 11]);
    expect(mocks.sendMediaGroup).toHaveBeenCalledOnce();
  });

  it("returns all message_ids for 10-item album", async () => {
    const msgs = Array.from({ length: 10 }, (_, i) => makeMsg(i + 1));
    mocks.sendMediaGroup.mockResolvedValue(msgs);
    const result = await handleSendMediaGroup({
      files: Array.from({ length: 10 }, (_, i) => ({ file: `/img/img${i}.jpg` })),
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect((data.message_ids as number[]).length).toBe(10);
  });

  // ── AC: count errors ──────────────────────────────────────────────────────

  it("returns ALBUM_TOO_FEW for 1 item", async () => {
    const result = await handleSendMediaGroup({
      files: [{ file: "/img/a.jpg" }],
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ALBUM_TOO_FEW");
  });

  it("returns ALBUM_EMPTY for 0 items", async () => {
    const result = await handleSendMediaGroup({
      files: [],
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ALBUM_EMPTY");
  });

  it("returns ALBUM_TOO_MANY for 11 items", async () => {
    const result = await handleSendMediaGroup({
      files: Array.from({ length: 11 }, (_, i) => ({ file: `/img/img${i}.jpg` })),
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("ALBUM_TOO_MANY");
  });

  // ── AC: type homogeneity ──────────────────────────────────────────────────

  it("allows photo+video mix (visual group)", async () => {
    mocks.sendMediaGroup.mockResolvedValue([makeMsg(1), makeMsg(2)]);
    mocks.resolveMediaSource
      .mockReturnValueOnce({ source: "/img/a.jpg" })
      .mockReturnValueOnce({ source: "/vid/b.mp4" });
    const result = await handleSendMediaGroup({
      files: [
        { file: "/img/a.jpg", type: "photo" },
        { file: "/vid/b.mp4", type: "video" },
      ],
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    expect(mocks.sendMediaGroup).toHaveBeenCalledOnce();
    const [, mediaArray] = mocks.sendMediaGroup.mock.calls[0];
    expect(mediaArray[0].type).toBe("photo");
    expect(mediaArray[1].type).toBe("video");
  });

  it("allows document-only album", async () => {
    mocks.sendMediaGroup.mockResolvedValue([makeMsg(1), makeMsg(2)]);
    const result = await handleSendMediaGroup({
      files: [
        { file: "/docs/a.pdf", type: "document" },
        { file: "/docs/b.pdf", type: "document" },
      ],
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
  });

  it("allows audio-only album", async () => {
    mocks.sendMediaGroup.mockResolvedValue([makeMsg(1), makeMsg(2)]);
    const result = await handleSendMediaGroup({
      files: [
        { file: "/audio/a.mp3", type: "audio" },
        { file: "/audio/b.mp3", type: "audio" },
      ],
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
  });

  it("returns MEDIA_GROUP_TYPE_MIX for photo+document mix", async () => {
    const result = await handleSendMediaGroup({
      files: [
        { file: "/img/a.jpg", type: "photo" },
        { file: "/docs/b.pdf", type: "document" },
      ],
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MEDIA_GROUP_TYPE_MIX");
  });

  it("returns MEDIA_GROUP_TYPE_MIX for audio+video mix", async () => {
    const result = await handleSendMediaGroup({
      files: [
        { file: "/audio/a.mp3", type: "audio" },
        { file: "/vid/b.mp4", type: "video" },
      ],
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MEDIA_GROUP_TYPE_MIX");
  });

  it("returns MEDIA_GROUP_TYPE_MIX for document+audio mix", async () => {
    const result = await handleSendMediaGroup({
      files: [
        { file: "/docs/a.pdf", type: "document" },
        { file: "/audio/b.mp3", type: "audio" },
      ],
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MEDIA_GROUP_TYPE_MIX");
  });

  // ── AC: auto-type detection ───────────────────────────────────────────────

  it("auto-detects .jpg as photo", async () => {
    mocks.sendMediaGroup.mockResolvedValue([makeMsg(1), makeMsg(2)]);
    await handleSendMediaGroup({
      files: [{ file: "/img/a.jpg" }, { file: "/img/b.png" }],
      token: TOKEN,
    });
    const [, media] = mocks.sendMediaGroup.mock.calls[0];
    expect(media[0].type).toBe("photo");
    expect(media[1].type).toBe("photo");
  });

  it("auto-detects .mp4 as video and .jpg as photo (visual mix OK)", async () => {
    mocks.sendMediaGroup.mockResolvedValue([makeMsg(1), makeMsg(2)]);
    mocks.resolveMediaSource
      .mockReturnValueOnce({ source: "/img/a.jpg" })
      .mockReturnValueOnce({ source: "/vid/b.mp4" });
    const result = await handleSendMediaGroup({
      files: [{ file: "/img/a.jpg" }, { file: "/vid/b.mp4" }],
      token: TOKEN,
    });
    expect(isError(result)).toBe(false);
    const [, media] = mocks.sendMediaGroup.mock.calls[0];
    expect(media[0].type).toBe("photo");
    expect(media[1].type).toBe("video");
  });

  // ── AC: per-item resolveMediaSource guard ─────────────────────────────────

  it("propagates resolveMediaSource error for an item", async () => {
    mocks.resolveMediaSource
      .mockReturnValueOnce({ source: "/safe/a.jpg" })
      .mockReturnValueOnce({ code: "FORBIDDEN_PATH", message: "path not allowed" });
    const result = await handleSendMediaGroup({
      files: [
        { file: "/safe/a.jpg", type: "photo" },
        { file: "http://evil.com/b.jpg", type: "photo" },
      ],
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(mocks.sendMediaGroup).not.toHaveBeenCalled();
  });

  // ── AC: per-item caption validation ──────────────────────────────────────

  it("propagates validateCaption error for a captioned item", async () => {
    mocks.validateCaption.mockReturnValueOnce({
      code: "CAPTION_TOO_LONG",
      message: "caption exceeds 1024 chars",
    });
    const result = await handleSendMediaGroup({
      files: [
        { file: "/img/a.jpg", type: "photo", caption: "x".repeat(1025) },
        { file: "/img/b.jpg", type: "photo" },
      ],
      token: TOKEN,
    });
    expect(isError(result)).toBe(true);
    expect(mocks.sendMediaGroup).not.toHaveBeenCalled();
  });

  it("passes per-item captions to the media group", async () => {
    mocks.sendMediaGroup.mockResolvedValue([makeMsg(1), makeMsg(2)]);
    await handleSendMediaGroup({
      files: [
        { file: "/img/a.jpg", type: "photo", caption: "Caption A" },
        { file: "/img/b.jpg", type: "photo", caption: "Caption B" },
      ],
      token: TOKEN,
    });
    const [, media] = mocks.sendMediaGroup.mock.calls[0];
    expect(media[0].caption).toBe("Caption A");
    expect(media[1].caption).toBe("Caption B");
  });

  // ── AC: showTyping called ─────────────────────────────────────────────────

  it("calls showTyping before sendMediaGroup", async () => {
    mocks.sendMediaGroup.mockResolvedValue([makeMsg(1), makeMsg(2)]);
    await handleSendMediaGroup({
      files: [{ file: "/img/a.jpg" }, { file: "/img/b.jpg" }],
      token: TOKEN,
    });
    const typingCallOrder = mocks.showTyping.mock.invocationCallOrder[0];
    const sendCallOrder = mocks.sendMediaGroup.mock.invocationCallOrder[0];
    expect(typingCallOrder).toBeLessThan(sendCallOrder);
  });

  // ── AC: CDN warning in result ─────────────────────────────────────────────

  it("includes CDN warning in result", async () => {
    mocks.sendMediaGroup.mockResolvedValue([makeMsg(1), makeMsg(2)]);
    const result = await handleSendMediaGroup({
      files: [{ file: "/img/a.jpg" }, { file: "/img/b.jpg" }],
      token: TOKEN,
    });
    const data = parseResult(result);
    expect(typeof data.warning).toBe("string");
    expect((data.warning as string).length).toBeGreaterThan(0);
  });

  // ── AC: sendMediaGroup receives correct structure ─────────────────────────

  it("passes correct chatId and media array to sendMediaGroup", async () => {
    mocks.sendMediaGroup.mockResolvedValue([makeMsg(1), makeMsg(2)]);
    mocks.resolveMediaSource.mockReturnValue({ source: "/safe/img.jpg" });
    await handleSendMediaGroup({
      files: [
        { file: "/img/a.jpg", type: "photo" },
        { file: "/img/b.jpg", type: "photo" },
      ],
      token: TOKEN,
    });
    expect(mocks.sendMediaGroup).toHaveBeenCalledWith(
      42,
      [
        { type: "photo", media: "/safe/img.jpg", caption: undefined },
        { type: "photo", media: "/safe/img.jpg", caption: undefined },
      ],
    );
  });
});
