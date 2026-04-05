import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must come before imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  cancelTyping: vi.fn(),
  typingGeneration: vi.fn().mockReturnValue(0),
  cancelTypingIfSameGeneration: vi.fn(),
  clearPendingTemp: vi.fn(),
  recordOutgoing: vi.fn(),
  getCallerSid: vi.fn(() => 0),
  activeSessionCount: vi.fn(() => 1),
  getSession: vi.fn((_sid: number) => undefined as { name: string; color?: string } | undefined),
}));

vi.mock("./typing-state.js", () => ({
  cancelTyping: mocks.cancelTyping,
  typingGeneration: mocks.typingGeneration,
  cancelTypingIfSameGeneration: mocks.cancelTypingIfSameGeneration,
}));

vi.mock("./temp-message.js", () => ({
  clearPendingTemp: mocks.clearPendingTemp,
}));

vi.mock("./message-store.js", () => ({
  recordOutgoing: mocks.recordOutgoing,
}));

vi.mock("./session-context.js", () => ({
  getCallerSid: () => mocks.getCallerSid(),
}));

vi.mock("./session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getSession: (sid: number) => mocks.getSession(sid),
}));

import {
  createOutboundProxy,
  registerSendInterceptor,
  clearSendInterceptor,
  bypassProxy,
  notifyBeforeFileSend,
  notifyAfterFileSend,
  resetOutboundProxyForTest,
  type SendInterceptor,
} from "./outbound-proxy.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal fake Api with spies for the methods we proxy. */
function fakeApi() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    sendPhoto: vi.fn().mockResolvedValue({ message_id: 2 }),
    sendVideo: vi.fn().mockResolvedValue({ message_id: 3 }),
    sendAudio: vi.fn().mockResolvedValue({ message_id: 4 }),
    sendDocument: vi.fn().mockResolvedValue({ message_id: 5 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    getChat: vi.fn().mockResolvedValue({ id: 42 }),
    someProperty: "not-a-function",
  };
}

type FakeApi = ReturnType<typeof fakeApi>;

/** Typed accessor — avoids `as any` throughout tests. */
function proxy(raw: FakeApi) {
  return createOutboundProxy(raw as unknown as Parameters<typeof createOutboundProxy>[0]);
}

/** Builds a no-op interceptor with spies on each method. */
function spyInterceptor(
  overrides?: Partial<SendInterceptor>,
): SendInterceptor {
  return {
    beforeTextSend: vi.fn().mockResolvedValue({ intercepted: false }),
    beforeFileSend: vi.fn().mockResolvedValue(undefined),
    afterFileSend: vi.fn().mockResolvedValue(undefined),
    onEdit: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("outbound-proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOutboundProxyForTest();
    // Default: single-session (no header)
    mocks.activeSessionCount.mockReturnValue(1);
    mocks.getCallerSid.mockReturnValue(0);
    mocks.getSession.mockReturnValue(undefined);
  });

  // -----------------------------------------------------------------------
  // sendMessage — text path
  // -----------------------------------------------------------------------

  describe("sendMessage", () => {
    it("calls cross-cutting concerns on every send", async () => {
      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "hi", {});

      expect(mocks.cancelTypingIfSameGeneration).toHaveBeenCalledOnce();
      expect(mocks.clearPendingTemp).toHaveBeenCalledOnce();
    });

    it("records outgoing message with text", async () => {
      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "hello");

      expect(mocks.recordOutgoing).toHaveBeenCalledWith(
        1, "text", "hello",
      );
    });

    it("strips _rawText from opts and uses it for recording", async () => {
      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "escaped\\_text", {
        parse_mode: "MarkdownV2",
        _rawText: "original text",
      });

      // _rawText should not reach the real API
      const passedOpts = raw.sendMessage.mock.calls[0][2] as
        Record<string, unknown>;
      expect(passedOpts._rawText).toBeUndefined();
      expect(passedOpts.parse_mode).toBe("MarkdownV2");

      // Recording should use the raw text
      expect(mocks.recordOutgoing).toHaveBeenCalledWith(
        1, "text", "original text",
      );
    });

    it("delegates to interceptor.beforeTextSend when registered", async () => {
      const interceptor = spyInterceptor({
        beforeTextSend: vi.fn().mockResolvedValue({
          intercepted: true,
          message_id: 99,
        }),
      });
      registerSendInterceptor(1, interceptor);
      mocks.getCallerSid.mockReturnValue(1);

      const raw = fakeApi();
      const p = proxy(raw);
      const result = await (p as unknown as FakeApi).sendMessage(
        42, "promoted", {},
      );

      // Real sendMessage should NOT have been called
      expect(raw.sendMessage).not.toHaveBeenCalled();
      // Should record with the intercepted message_id
      expect(mocks.recordOutgoing).toHaveBeenCalledWith(
        99, "text", "promoted",
      );
      // Return value should carry the intercepted id
      expect(result).toEqual({ message_id: 99 });
    });

    it("falls through when interceptor returns not-intercepted", async () => {
      const interceptor = spyInterceptor();
      registerSendInterceptor(1, interceptor);
      mocks.getCallerSid.mockReturnValue(1);

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "normal", {});

      expect(raw.sendMessage).toHaveBeenCalled();
      expect(mocks.recordOutgoing).toHaveBeenCalledWith(
        1, "text", "normal",
      );
    });
  });

  // -----------------------------------------------------------------------
  // File sends — photo/video/audio/document
  // -----------------------------------------------------------------------

  describe("file sends", () => {
    it.each([
      ["sendPhoto", 2, "photo"],
      ["sendVideo", 3, "video"],
      ["sendAudio", 4, "audio"],
      ["sendDocument", 5, "document"],
    ] as const)("%s triggers cross-cutting concerns and records", async (method, msgId, contentType) => {
      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method](
        42, "file-input", {},
      );

      expect(mocks.cancelTypingIfSameGeneration).toHaveBeenCalledOnce();
      expect(mocks.clearPendingTemp).toHaveBeenCalledOnce();
      expect(mocks.recordOutgoing).toHaveBeenCalledWith(
        msgId, contentType, undefined, undefined, undefined,
      );
    });

    it("records caption from opts for file sends", async () => {
      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendPhoto(
        42, "photo-input", { caption: "My caption" },
      );

      expect(mocks.recordOutgoing).toHaveBeenCalledWith(
        2, "photo", undefined, "My caption", undefined,
      );
    });

    it("calls interceptor.beforeFileSend and afterFileSend", async () => {
      const interceptor = spyInterceptor();
      registerSendInterceptor(1, interceptor);
      mocks.getCallerSid.mockReturnValue(1);

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendPhoto(42, "photo-input", {});

      expect(interceptor.beforeFileSend).toHaveBeenCalledOnce();
      expect(interceptor.afterFileSend).toHaveBeenCalledOnce();
    });

    it("calls afterFileSend even when the API call throws", async () => {
      const interceptor = spyInterceptor();
      registerSendInterceptor(1, interceptor);
      mocks.getCallerSid.mockReturnValue(1);

      const raw = fakeApi();
      raw.sendPhoto.mockRejectedValueOnce(new Error("network error"));
      const p = proxy(raw);

      await expect(
        (p as unknown as FakeApi).sendPhoto(42, "photo-input", {}),
      ).rejects.toThrow("network error");

      expect(interceptor.beforeFileSend).toHaveBeenCalledOnce();
      expect(interceptor.afterFileSend).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // editMessageText
  // -----------------------------------------------------------------------

  describe("editMessageText", () => {
    it("cancels typing and calls interceptor.onEdit", async () => {
      const interceptor = spyInterceptor();
      registerSendInterceptor(1, interceptor);
      mocks.getCallerSid.mockReturnValue(1);

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).editMessageText(
        42, 10, "updated",
      );

      expect(mocks.cancelTypingIfSameGeneration).toHaveBeenCalledOnce();
      expect(raw.editMessageText).toHaveBeenCalled();
      expect(interceptor.onEdit).toHaveBeenCalledOnce();
    });

    it("does not call onEdit when no interceptor is registered", async () => {
      const raw = fakeApi();
      const p = proxy(raw);
      // Should not throw even with no interceptor
      await (p as unknown as FakeApi).editMessageText(
        42, 10, "updated",
      );

      expect(raw.editMessageText).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Bypass
  // -----------------------------------------------------------------------

  describe("bypassProxy", () => {
    it("skips all proxy logic during the callback", async () => {
      const raw = fakeApi();
      const p = proxy(raw);
      const result = await bypassProxy(() =>
        (p as unknown as FakeApi).sendMessage(42, "bypass")
      );

      // Cross-cutting concerns should NOT fire
      expect(mocks.cancelTypingIfSameGeneration).not.toHaveBeenCalled();
      expect(mocks.clearPendingTemp).not.toHaveBeenCalled();
      expect(mocks.recordOutgoing).not.toHaveBeenCalled();

      // Real API should still be called
      expect(raw.sendMessage).toHaveBeenCalledWith(42, "bypass", undefined);
      expect((result as { message_id: number }).message_id).toBe(1);
    });

    it("resets the bypass flag even if the callback throws", async () => {
      const raw = fakeApi();
      const p = proxy(raw);

      await expect(
        bypassProxy(() => Promise.reject(new Error("boom"))),
      ).rejects.toThrow("boom");

      // After error, proxy should work normally again
      await (p as unknown as FakeApi).sendMessage(42, "after");
      expect(mocks.cancelTypingIfSameGeneration).toHaveBeenCalledOnce();
    });

    it("does not affect concurrent non-bypassed contexts", async () => {
      // Simulate: bypassProxy is active in one async context,
      // while notifyAfterFileSend runs in another context concurrently.
      mocks.getCallerSid.mockReturnValue(1);

      let outsideBypassCalled = false;

      await Promise.all([
        // Context A: bypassed
        bypassProxy(async () => {
          // Simulate an in-flight API call
          await new Promise(resolve => setTimeout(resolve, 10));
        }),
        // Context B: NOT bypassed — should fire hooks normally
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          await notifyAfterFileSend(99, "voice", "test", undefined);
          outsideBypassCalled = true;
        })(),
      ]);

      // Context B should have recorded the outgoing message
      expect(outsideBypassCalled).toBe(true);
      expect(mocks.recordOutgoing).toHaveBeenCalledWith(99, "voice", "test", undefined);
    });
  });

  // -----------------------------------------------------------------------
  // Pass-through
  // -----------------------------------------------------------------------

  describe("pass-through", () => {
    it("returns non-function properties directly", () => {
      const raw = fakeApi();
      const p = proxy(raw);
      expect((p as unknown as FakeApi).someProperty).toBe(
        "not-a-function",
      );
    });

    it("passes unrecognized methods through without wrapping", async () => {
      const raw = fakeApi();
      const p = proxy(raw);
      const result = await (p as unknown as FakeApi).getChat(42);

      expect(raw.getChat).toHaveBeenCalledWith(42);
      expect(result).toEqual({ id: 42 });
      // Cross-cutting should not fire for unknown methods
      expect(mocks.cancelTypingIfSameGeneration).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // notifyBeforeFileSend / notifyAfterFileSend (voice-send helpers)
  // -----------------------------------------------------------------------

  describe("notifyBeforeFileSend / notifyAfterFileSend", () => {
    it("fires cross-cutting + interceptor hooks", async () => {
      const interceptor = spyInterceptor();
      registerSendInterceptor(1, interceptor);
      mocks.getCallerSid.mockReturnValue(1);

      await notifyBeforeFileSend();
      expect(mocks.clearPendingTemp).toHaveBeenCalledOnce();
      expect(interceptor.beforeFileSend).toHaveBeenCalledOnce();
      // cancelTyping deferred to notifyAfterFileSend
      expect(mocks.cancelTypingIfSameGeneration).not.toHaveBeenCalled();

      await notifyAfterFileSend(50, "voice", "hello", undefined);
      expect(mocks.cancelTypingIfSameGeneration).toHaveBeenCalledOnce();
      expect(mocks.recordOutgoing).toHaveBeenCalledWith(
        50, "voice", "hello", undefined,
      );
      expect(interceptor.afterFileSend).toHaveBeenCalledOnce();
    });

    it("skips everything when bypassing", async () => {
      const interceptor = spyInterceptor();
      registerSendInterceptor(1, interceptor);
      mocks.getCallerSid.mockReturnValue(1);

      await bypassProxy(async () => {
        await notifyBeforeFileSend();
        await notifyAfterFileSend(50, "voice");
      });

      expect(mocks.cancelTypingIfSameGeneration).not.toHaveBeenCalled();
      expect(interceptor.beforeFileSend).not.toHaveBeenCalled();
      expect(mocks.recordOutgoing).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Interceptor registration
  // -----------------------------------------------------------------------

  describe("interceptor registration", () => {
    it("clearSendInterceptor removes the active interceptor", async () => {
      const interceptor = spyInterceptor({
        beforeTextSend: vi.fn().mockResolvedValue({
          intercepted: true,
          message_id: 99,
        }),
      });
      registerSendInterceptor(1, interceptor);
      mocks.getCallerSid.mockReturnValue(1);
      clearSendInterceptor();

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "no intercept");

      // Should go directly to real API now
      expect(raw.sendMessage).toHaveBeenCalled();
      expect(interceptor.beforeTextSend).not.toHaveBeenCalled();
    });

    it("registerSendInterceptor replaces old interceptor", async () => {
      const first = spyInterceptor();
      const second = spyInterceptor();
      registerSendInterceptor(1, first);
      registerSendInterceptor(1, second);
      mocks.getCallerSid.mockReturnValue(1);

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "uses second");

      expect(first.beforeTextSend).not.toHaveBeenCalled();
      expect(second.beforeTextSend).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Session header injection
  // -----------------------------------------------------------------------

  describe("session header", () => {
    it("prepends 🤖 Name header in multi-session mode (sendMessage)", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Scout" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "Hello world");

      const [, sentText, sentOpts] = raw.sendMessage.mock.calls[0] as [number, string, Record<string, unknown> | undefined];
      expect(sentText).toBe("🤖 `Scout`\nHello world");
      expect(sentOpts?.parse_mode).toBe("Markdown");
    });

    it("omits header in single-session mode (sendMessage)", async () => {
      mocks.activeSessionCount.mockReturnValue(1);

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "Hello world");

      const [, sentText] = raw.sendMessage.mock.calls[0] as [number, string, unknown];
      expect(sentText).toBe("Hello world");
    });

    it("escapes MarkdownV2 special chars in name (sendMessage)", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(2);
      mocks.getSession.mockReturnValue({ name: "Scout_2" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(
        42, "content", { parse_mode: "MarkdownV2" },
      );

      const [, sentText] = raw.sendMessage.mock.calls[0] as [number, string, unknown];
      expect(sentText).toMatch(/🤖 `Scout\\_2`\n/);
    });

    it("uses HTML code tags in name when parse_mode is HTML (sendMessage)", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(2);
      mocks.getSession.mockReturnValue({ name: "Scout<2>" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(
        42, "content", { parse_mode: "HTML" },
      );

      const [, sentText] = raw.sendMessage.mock.calls[0] as [number, string, unknown];
      expect(sentText).toBe("🤖 <code>Scout&lt;2&gt;</code>\ncontent");
    });

    it("does not override existing parse_mode when header is injected", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Scout" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(
        42, "content", { parse_mode: "HTML" },
      );

      const [, , sentOpts] = raw.sendMessage.mock.calls[0] as [number, string, Record<string, unknown>];
      expect(sentOpts.parse_mode).toBe("HTML");
    });

    it("prepends header to _rawText in multi-session mode", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Scout" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(
        42, "encoded text", { _rawText: "original text" },
      );

      const [, , recordedText] = mocks.recordOutgoing.mock.calls[0] as [number, string, string];
      expect(recordedText).toBe("🤖 Scout\noriginal text");
    });

    it("uses 'Session N' as fallback when session has no name", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(3);
      mocks.getSession.mockReturnValue({ name: "" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "text");

      const [, sentText, sentOpts] = raw.sendMessage.mock.calls[0] as [number, string, Record<string, unknown> | undefined];
      expect(sentText).toBe("🤖 `Session 3`\ntext");
      expect(sentOpts?.parse_mode).toBe("Markdown");
    });

    it("prepends formatted header (backtick code) to file caption in multi-session mode (sendPhoto)", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Scout" });

      const raw = fakeApi();
      raw.sendPhoto.mockResolvedValue({ message_id: 10, photo: [{ file_id: "f1" }] });
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendPhoto(
        42, "file_id_123", { caption: "A photo caption" },
      );

      const [, , opts] = raw.sendPhoto.mock.calls[0] as [number, string, { caption: string; parse_mode?: string }];
      expect(opts.caption).toBe("🤖 `Scout`\nA photo caption");
      expect(opts.parse_mode).toBe("Markdown");
    });

    it("auto-injects parse_mode Markdown into caption when header added and none set", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Scout" });

      const raw = fakeApi();
      raw.sendPhoto.mockResolvedValue({ message_id: 10, photo: [{ file_id: "f1" }] });
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendPhoto(
        42, "file_id_123", { caption: "My caption" },
      );

      const [, , opts] = raw.sendPhoto.mock.calls[0] as [number, string, Record<string, unknown>];
      expect(opts.parse_mode).toBe("Markdown");
    });

    it("uses HTML code tags in caption header and preserves parse_mode HTML (sendPhoto)", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Scout" });

      const raw = fakeApi();
      raw.sendPhoto.mockResolvedValue({ message_id: 10, photo: [{ file_id: "f1" }] });
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendPhoto(
        42, "file_id_123", { caption: "My caption", parse_mode: "HTML" },
      );

      const [, , opts] = raw.sendPhoto.mock.calls[0] as [number, string, { caption: string; parse_mode: string }];
      expect(opts.caption).toBe("🤖 <code>Scout</code>\nMy caption");
      expect(opts.parse_mode).toBe("HTML");
    });

    it("omits caption header when no caption provided (sendPhoto)", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Scout" });

      const raw = fakeApi();
      raw.sendPhoto.mockResolvedValue({ message_id: 10, photo: [{ file_id: "f1" }] });
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendPhoto(42, "file_id_123", {});

      expect(raw.sendPhoto).toHaveBeenCalled();
      // No caption in opts means nothing was injected
      const [, , opts] = raw.sendPhoto.mock.calls[0] as [number, string, Record<string, unknown>];
      expect(opts.caption).toBeUndefined();
    });

    it("prepends header in editMessageText in multi-session mode", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Scout" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).editMessageText(42, 10, "edited content");

      const [, , editedText, editOpts] = raw.editMessageText.mock.calls[0] as [number, number, string, Record<string, unknown> | undefined];
      expect(editedText).toBe("🤖 `Scout`\nedited content");
      expect(editOpts?.parse_mode).toBe("Markdown");
    });

    it("uses HTML code tags in editMessageText when parse_mode is HTML", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Scout" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).editMessageText(
        42, 10, "edited content", { parse_mode: "HTML" },
      );

      const [, , editedText] = raw.editMessageText.mock.calls[0] as [number, number, string];
      expect(editedText).toBe("🤖 <code>Scout</code>\nedited content");
    });

    it("omits header in editMessageText in single-session mode", async () => {
      mocks.activeSessionCount.mockReturnValue(1);

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).editMessageText(42, 10, "edited content");

      const [, , editedText] = raw.editMessageText.mock.calls[0] as [number, number, string];
      expect(editedText).toBe("edited content");
    });

    it("prepends color square before 🤖 when session has a color", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Scout", color: "🟦" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "Hello");

      const [, sentText] = raw.sendMessage.mock.calls[0] as [number, string, unknown];
      expect(sentText).toBe("🟦 🤖 `Scout`\nHello");
    });

    it("omits color prefix when session has no color", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Scout" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "Hello");

      const [, sentText] = raw.sendMessage.mock.calls[0] as [number, string, unknown];
      expect(sentText).toBe("🤖 `Scout`\nHello");
    });

    it("_skipHeader suppresses nametag injection in multi-session mode", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Scout" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "✅ Complete", {
        reply_to_message_id: 99,
        _skipHeader: true,
      });

      const [, sentText, sentOpts] = raw.sendMessage.mock.calls[0] as [number, string, Record<string, unknown>];
      expect(sentText).toBe("✅ Complete");
      expect(sentOpts.parse_mode).toBeUndefined();
    });

    it("_skipHeader is stripped before the real API call", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Scout" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "✅ Complete", {
        reply_to_message_id: 99,
        _skipHeader: true,
      });

      const [, , sentOpts] = raw.sendMessage.mock.calls[0] as [number, string, Record<string, unknown>];
      expect(sentOpts._skipHeader).toBeUndefined();
      expect(sentOpts.reply_to_message_id).toBe(99);
    });

    it("_skipHeader suppresses nametag injection in editMessageText", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Worker 1" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).editMessageText(42, 10, "System panel", {
        parse_mode: "Markdown",
        _skipHeader: true,
      });

      const [, , editedText, editOpts] = raw.editMessageText.mock.calls[0] as [number, number, string, Record<string, unknown> | undefined];
      expect(editedText).toBe("System panel");
      expect(editOpts?._skipHeader).toBeUndefined();
      expect(editOpts?.parse_mode).toBe("Markdown");
    });

    it("_skipHeader is stripped from editMessageText opts before the real API call", async () => {
      mocks.activeSessionCount.mockReturnValue(2);
      mocks.getCallerSid.mockReturnValue(1);
      mocks.getSession.mockReturnValue({ name: "Worker 1" });

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).editMessageText(42, 10, "Panel text", {
        parse_mode: "Markdown",
        _skipHeader: true,
        reply_markup: { inline_keyboard: [] },
      });

      const [, , , sentOpts] = raw.editMessageText.mock.calls[0] as [number, number, string, Record<string, unknown>];
      expect(sentOpts._skipHeader).toBeUndefined();
      expect(sentOpts.reply_markup).toBeDefined();
    });
  });
});
