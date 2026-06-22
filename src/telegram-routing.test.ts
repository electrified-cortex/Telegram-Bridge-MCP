/**
 * Unit tests for routeOutboundMessage (10-3016).
 *
 * Tests the routing layer that wires the v8 rich-messages pipeline behind
 * the RICH_MESSAGES feature gate. Does NOT perform live Telegram sends.
 *
 * Strategy:
 * - Rich path (sendRichMessageDirect) → `fetch` stubbed via vi.stubGlobal
 * - Existing path (getApi().sendMessage) → fake proxied API installed via
 *   installOutboundProxy so Grammy never makes real HTTP calls
 * - Outbound-proxy hooks (buildHeader, notify*) → vi.mock
 * - resolveParseMode (markdown.ts) → vi.mock
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Api } from "grammy";

// ---------------------------------------------------------------------------
// Hoisted mocks — must come before module imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  buildHeader: vi.fn(),
  notifyBeforeFileSend: vi.fn(),
  notifyAfterFileSend: vi.fn(),
  resolveParseMode: vi.fn(),
}));

// Mock outbound-proxy so the dynamic import inside routeOutboundMessage
// returns controlled stubs (no real proxy logic or session-manager access).
vi.mock("./outbound-proxy.js", () => ({
  buildHeader: mocks.buildHeader,
  notifyBeforeFileSend: mocks.notifyBeforeFileSend,
  notifyAfterFileSend: mocks.notifyAfterFileSend,
  // Keep other exports as no-ops so any accidental import doesn't crash.
  createOutboundProxy: (api: Api) => api,
  registerSendInterceptor: vi.fn(),
  clearSendInterceptor: vi.fn(),
  fireTempReactionRestore: vi.fn(),
  clearAllTempReactions: vi.fn(),
  resetOutboundProxyForTest: vi.fn(),
  bypassProxy: (_fn: () => unknown) => _fn(),
  registerOnceOnSend: vi.fn(),
  clearOnceOnSend: vi.fn(),
  notifyAfterTextSend: vi.fn(),
}));

// Mock markdown so resolveParseMode is controllable and markdownToV2 is a
// simple deterministic transform.
vi.mock("./markdown.js", () => ({
  resolveParseMode: mocks.resolveParseMode,
  markdownToV2: (t: string) => `${t}_v2`,
  escapeV2: (t: string) => t,
  escapeHtml: (t: string) => t,
}));

import {
  routeOutboundMessage,
  setRichMessagesEnabledForTest,
  resetApi,
  installOutboundProxy,
  sendVoiceDirect,
} from "./telegram.js";

// ---------------------------------------------------------------------------
// Fake proxied API — used by the existing send path in routeOutboundMessage
// ---------------------------------------------------------------------------

const fakeSendMessage = vi.fn();
const fakeApi = { sendMessage: fakeSendMessage } as unknown as Api;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

function makeFetchMock(
  richOk: boolean,
  richMsgId: number | null,
  richErrCode?: number,
  richDesc?: string,
) {
  return vi.fn().mockImplementation((url: string, _init?: RequestInit) => {
    if (url.includes("sendRichMessage")) {
      const body = richOk
        ? { ok: true, result: { message_id: richMsgId } }
        : { ok: false, error_code: richErrCode ?? 400, description: richDesc ?? "error" };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    // Grammy path — should not be called via fetch in these tests because
    // we install a fake proxied API (fakeApi). Returning a sentinel so any
    // accidental Grammy call produces a recognisable failure.
    return Promise.resolve(new Response(JSON.stringify({ ok: false, error_code: 500, description: "unexpected fetch to sendMessage in test" }), { status: 200 }));
  });
}

beforeEach(() => {
  process.env.BOT_TOKEN = "test_routing_token";
  // Clear cached Grammy Api instances so installOutboundProxy can set up fresh.
  resetApi();
  // Install a fake proxied API — getApi() returns this; no real HTTP happens.
  installOutboundProxy(() => fakeApi);
  fakeSendMessage.mockResolvedValue({ message_id: 99, chat: { id: 1 }, date: 0 });

  // Default: no session header (single-session mode)
  mocks.buildHeader.mockReturnValue({ plain: "", formatted: "" });
  mocks.notifyBeforeFileSend.mockResolvedValue(undefined);
  mocks.notifyAfterFileSend.mockResolvedValue(undefined);
  // resolveParseMode: Markdown→V2, others pass-through
  mocks.resolveParseMode.mockImplementation((text: string, mode?: string) => ({
    text: mode === "Markdown" ? `${text}_v2` : text,
    parse_mode: mode === "Markdown" ? "MarkdownV2" : (mode ?? undefined),
  }));
});

afterEach(() => {
  delete process.env.BOT_TOKEN;
  setRichMessagesEnabledForTest(false);
  resetApi();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Flag OFF — all traffic must use the existing send path
// ---------------------------------------------------------------------------

describe("RICH_MESSAGES=false (default)", () => {
  beforeEach(() => {
    setRichMessagesEnabledForTest(false);
  });

  it("sends via existing path (sendMessage) and does NOT call sendRichMessage", async () => {
    const fetchMock = makeFetchMock(true, 42);
    vi.stubGlobal("fetch", fetchMock);

    const result = await routeOutboundMessage(123, "hello **world**", { parse_mode: "Markdown" });

    // Uses the fake proxied API — message_id from fakeSendMessage
    expect(result.message_id).toBe(99);
    expect(fakeSendMessage).toHaveBeenCalledOnce();

    // sendRichMessage fetch should NOT have been called
    const calledUrls = fetchMock.mock.calls.map((args: unknown[]) => args[0] as string);
    expect(calledUrls.some((u) => u.includes("sendRichMessage"))).toBe(false);
  });

  it("applies resolveParseMode for Markdown text on existing path", async () => {
    vi.stubGlobal("fetch", makeFetchMock(true, 42));
    await routeOutboundMessage(123, "# Heading", { parse_mode: "Markdown" });
    expect(mocks.resolveParseMode).toHaveBeenCalledWith("# Heading", "Markdown");
  });

  it("passes parse_mode: MarkdownV2 to existing path without transformation", async () => {
    vi.stubGlobal("fetch", makeFetchMock(true, 42));
    const result = await routeOutboundMessage(123, "text", { parse_mode: "MarkdownV2" });
    expect(result.message_id).toBe(99);
    expect(mocks.resolveParseMode).toHaveBeenCalledWith("text", "MarkdownV2");
  });

  it("passes parse_mode: HTML to existing path without transformation", async () => {
    vi.stubGlobal("fetch", makeFetchMock(true, 42));
    const result = await routeOutboundMessage(123, "<b>text</b>", { parse_mode: "HTML" });
    expect(result.message_id).toBe(99);
    expect(mocks.resolveParseMode).toHaveBeenCalledWith("<b>text</b>", "HTML");
  });

  it("does NOT call notifyBeforeFileSend on existing path (flag off)", async () => {
    vi.stubGlobal("fetch", makeFetchMock(true, 42));
    await routeOutboundMessage(123, "hello", { parse_mode: "Markdown" });
    expect(mocks.notifyBeforeFileSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Flag ON — Markdown and undefined parse_mode → rich path
// ---------------------------------------------------------------------------

describe("RICH_MESSAGES=true", () => {
  beforeEach(() => {
    setRichMessagesEnabledForTest(true);
  });

  it("routes parse_mode: Markdown to sendRichMessage", async () => {
    const fetchMock = makeFetchMock(true, 42);
    vi.stubGlobal("fetch", fetchMock);

    const result = await routeOutboundMessage(123, "**bold**", { parse_mode: "Markdown" });

    expect(result.message_id).toBe(42); // rich path result
    expect(fakeSendMessage).not.toHaveBeenCalled(); // existing path NOT taken

    const calledUrls = fetchMock.mock.calls.map((args: unknown[]) => args[0] as string);
    expect(calledUrls.some((u) => u.includes("sendRichMessage"))).toBe(true);
  });

  it("routes undefined parse_mode to sendRichMessage", async () => {
    const fetchMock = makeFetchMock(true, 42);
    vi.stubGlobal("fetch", fetchMock);

    const result = await routeOutboundMessage(123, "plain text");

    expect(result.message_id).toBe(42);
    expect(fakeSendMessage).not.toHaveBeenCalled();

    const calledUrls = fetchMock.mock.calls.map((args: unknown[]) => args[0] as string);
    expect(calledUrls.some((u) => u.includes("sendRichMessage"))).toBe(true);
  });

  it("bypasses rich path for parse_mode: MarkdownV2 → existing path", async () => {
    vi.stubGlobal("fetch", makeFetchMock(true, 42));

    const result = await routeOutboundMessage(123, "v2 text", { parse_mode: "MarkdownV2" });
    expect(result.message_id).toBe(99); // existing path via fakeApi
    expect(fakeSendMessage).toHaveBeenCalledOnce();
  });

  it("bypasses rich path for parse_mode: HTML → existing path", async () => {
    vi.stubGlobal("fetch", makeFetchMock(true, 42));

    const result = await routeOutboundMessage(123, "<b>text</b>", { parse_mode: "HTML" });
    expect(result.message_id).toBe(99); // existing path
    expect(fakeSendMessage).toHaveBeenCalledOnce();
  });

  it("fires notifyBeforeFileSend and notifyAfterFileSend on rich path", async () => {
    vi.stubGlobal("fetch", makeFetchMock(true, 42));

    await routeOutboundMessage(123, "hello", { parse_mode: "Markdown" });

    expect(mocks.notifyBeforeFileSend).toHaveBeenCalledOnce();
    expect(mocks.notifyAfterFileSend).toHaveBeenCalledWith(42, "text", "hello");
  });

  it("passes _rawText to notifyAfterFileSend when provided", async () => {
    vi.stubGlobal("fetch", makeFetchMock(true, 42));

    await routeOutboundMessage(123, "converted text", {
      parse_mode: "Markdown",
      _rawText: "original text",
    });

    expect(mocks.notifyAfterFileSend).toHaveBeenCalledWith(42, "text", "original text");
  });

  it("sends { markdown: text } in the request body", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("sendRichMessage")) {
        capturedBody = JSON.parse((init?.body ?? "{}") as string) as Record<string, unknown>;
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 42 } })));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    }));

    await routeOutboundMessage(123, "hello world", { parse_mode: "Markdown" });

    expect(capturedBody).not.toBeNull();
    const richMsg = (capturedBody as unknown as { rich_message?: { markdown?: string } })?.rich_message;
    expect(richMsg?.markdown).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// Graceful fallback on RICH_MESSAGE_UNSUPPORTED
// ---------------------------------------------------------------------------

describe("RICH_MESSAGES=true — graceful fallback", () => {
  beforeEach(() => {
    setRichMessagesEnabledForTest(true);
  });

  it("falls back to existing path when RICH_MESSAGE_UNSUPPORTED — callers do not see the error", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(false, null, 400, "rich message not supported"),
    );

    // Must NOT throw — callers get the fallback result transparently
    const result = await routeOutboundMessage(123, "hello", { parse_mode: "Markdown" });

    expect(result.message_id).toBe(99); // fallback via fakeApi
    expect(fakeSendMessage).toHaveBeenCalledOnce();
  });

  it("falls back on any rich path error (non-UNSUPPORTED)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(false, null, 500, "Internal Server Error"),
    );

    const result = await routeOutboundMessage(123, "hello", { parse_mode: "Markdown" });
    expect(result.message_id).toBe(99); // fallback
    expect(fakeSendMessage).toHaveBeenCalledOnce();
  });

  it("fallback applies resolveParseMode to convert Markdown to V2", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(false, null, 400, "rich message not supported"),
    );

    await routeOutboundMessage(123, "hello", { parse_mode: "Markdown" });

    // resolveParseMode must be called to convert Markdown → MarkdownV2 on fallback
    expect(mocks.resolveParseMode).toHaveBeenCalledWith("hello", "Markdown");
  });

  it("does NOT call notifyAfterFileSend when rich path fails", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(false, null, 400, "rich message not supported"),
    );

    await routeOutboundMessage(123, "hello", { parse_mode: "Markdown" });

    // notifyBeforeFileSend was fired before the attempt; notifyAfterFileSend not fired
    expect(mocks.notifyBeforeFileSend).toHaveBeenCalledOnce();
    expect(mocks.notifyAfterFileSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Session header injection on rich path
// ---------------------------------------------------------------------------

describe("session header injection (rich path)", () => {
  beforeEach(() => {
    setRichMessagesEnabledForTest(true);
  });

  it("prepends `name_tag` as inline-code Markdown when header is present", async () => {
    mocks.buildHeader.mockReturnValue({ plain: "🔴 Alice\n", formatted: "`🔴 Alice`\n" });

    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("sendRichMessage")) {
        capturedBody = JSON.parse((init?.body ?? "{}") as string) as Record<string, unknown>;
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 42 } })));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    }));

    await routeOutboundMessage(123, "hello world", { parse_mode: "Markdown" });

    const richMsg = (capturedBody as unknown as { rich_message?: { markdown?: string } })?.rich_message;
    expect(richMsg?.markdown).toBe("`🔴 Alice`\nhello world");
  });

  it("omits header when single session (buildHeader returns empty plain)", async () => {
    mocks.buildHeader.mockReturnValue({ plain: "", formatted: "" });

    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("sendRichMessage")) {
        capturedBody = JSON.parse((init?.body ?? "{}") as string) as Record<string, unknown>;
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 42 } })));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    }));

    await routeOutboundMessage(123, "hello world", { parse_mode: "Markdown" });

    const richMsg = (capturedBody as unknown as { rich_message?: { markdown?: string } })?.rich_message;
    expect(richMsg?.markdown).toBe("hello world"); // no header prepended
  });

  it("respects _skipHeader flag — omits header even when buildHeader returns a value", async () => {
    mocks.buildHeader.mockReturnValue({ plain: "🔴 Alice\n", formatted: "`🔴 Alice`\n" });

    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("sendRichMessage")) {
        capturedBody = JSON.parse((init?.body ?? "{}") as string) as Record<string, unknown>;
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 42 } })));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 99 } })));
    }));

    await routeOutboundMessage(123, "hello world", {
      parse_mode: "Markdown",
      _skipHeader: true,
    });

    const richMsg = (capturedBody as unknown as { rich_message?: { markdown?: string } })?.rich_message;
    expect(richMsg?.markdown).toBe("hello world"); // header suppressed
  });
});

// ---------------------------------------------------------------------------
// AC5 — non-text sends (voice/file) are unaffected by RICH_MESSAGES flag
// ---------------------------------------------------------------------------

describe("non-text sends unaffected by RICH_MESSAGES flag (AC5)", () => {
  beforeEach(() => {
    setRichMessagesEnabledForTest(true);
  });

  it("sendVoiceDirect sends to sendVoice endpoint — not sendRichMessage — when RICH_MESSAGES=true", async () => {
    const fetchedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        fetchedUrls.push(url);
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: { message_id: 77 } })),
        );
      }),
    );

    const result = await sendVoiceDirect(123, "AgABCDEF_fake_file_id", {});

    expect(result.message_id).toBe(77);
    // Must call sendVoice — not the rich-message endpoint
    expect(fetchedUrls.some((u) => u.includes("sendVoice"))).toBe(true);
    expect(fetchedUrls.some((u) => u.includes("sendRichMessage"))).toBe(false);
    // Grammy sendMessage path must not be touched
    expect(fakeSendMessage).not.toHaveBeenCalled();
  });

  it("sendVoiceDirect with a caption still bypasses sendRichMessage when RICH_MESSAGES=true", async () => {
    const fetchedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        fetchedUrls.push(url);
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: { message_id: 88 } })),
        );
      }),
    );

    const result = await sendVoiceDirect(123, "AgABCDEF_fake_file_id", {
      caption: "Voice caption",
      parse_mode: "Markdown",
    });

    expect(result.message_id).toBe(88);
    expect(fetchedUrls.some((u) => u.includes("sendVoice"))).toBe(true);
    expect(fetchedUrls.some((u) => u.includes("sendRichMessage"))).toBe(false);
  });
});
