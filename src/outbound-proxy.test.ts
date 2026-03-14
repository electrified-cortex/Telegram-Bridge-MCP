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
      registerSendInterceptor(interceptor);

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
      registerSendInterceptor(interceptor);

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
        msgId, contentType, undefined, undefined,
      );
    });

    it("records caption from opts for file sends", async () => {
      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendPhoto(
        42, "photo-input", { caption: "My caption" },
      );

      expect(mocks.recordOutgoing).toHaveBeenCalledWith(
        2, "photo", undefined, "My caption",
      );
    });

    it("calls interceptor.beforeFileSend and afterFileSend", async () => {
      const interceptor = spyInterceptor();
      registerSendInterceptor(interceptor);

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendPhoto(42, "photo-input", {});

      expect(interceptor.beforeFileSend).toHaveBeenCalledOnce();
      expect(interceptor.afterFileSend).toHaveBeenCalledOnce();
    });

    it("calls afterFileSend even when the API call throws", async () => {
      const interceptor = spyInterceptor();
      registerSendInterceptor(interceptor);

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
      registerSendInterceptor(interceptor);

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
      registerSendInterceptor(interceptor);

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
      registerSendInterceptor(interceptor);

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
      registerSendInterceptor(interceptor);
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
      registerSendInterceptor(first);
      registerSendInterceptor(second);

      const raw = fakeApi();
      const p = proxy(raw);
      await (p as unknown as FakeApi).sendMessage(42, "uses second");

      expect(first.beforeTextSend).not.toHaveBeenCalled();
      expect(second.beforeTextSend).toHaveBeenCalled();
    });
  });
});
