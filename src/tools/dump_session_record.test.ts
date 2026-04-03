import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, isError, errorCode } from "./test-utils.js";

// ── dump_session_record (V3 — sends JSON file to Telegram) ──────────────

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  dumpTimeline: vi.fn(() => [] as Array<Record<string, unknown>>),
  timelineSize: vi.fn(() => 0),
  storeSize: vi.fn(() => 0),
  sendDocument: vi.fn(),
  editMessageCaption: vi.fn(),
  getSessionLogMode: vi.fn((): "manual" | number | null => "manual"),
}));

vi.mock("../message-store.js", () => ({
  dumpTimeline: mocks.dumpTimeline,
  timelineSize: mocks.timelineSize,
  storeSize: mocks.storeSize,
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({ sendDocument: mocks.sendDocument, editMessageCaption: mocks.editMessageCaption }),
    resolveChat: () => 42,
  };
});

vi.mock("../config.js", () => ({
  getSessionLogMode: mocks.getSessionLogMode,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register as registerDump } from "./dump_session_record.js";

describe("dump_session_record tool (V3)", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  const getText = (result: unknown) =>
    (result as { content: { text: string }[] }).content[0].text;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.dumpTimeline.mockReturnValue([]);
    mocks.timelineSize.mockReturnValue(0);
    mocks.storeSize.mockReturnValue(0);
    mocks.sendDocument.mockResolvedValue({ message_id: 1 });
    mocks.editMessageCaption.mockResolvedValue({});
    mocks.getSessionLogMode.mockReturnValue("manual");
    const server = createMockServer();
    registerDump(server);
    call = server.getHandler("dump_session_record");
  });

  it("returns disabled message when session log is off", async () => {
    mocks.getSessionLogMode.mockReturnValue(null);
    const text = getText(await call({ token: 1123456 }));
    expect(text).toContain("disabled");
  });

  it("returns 'no events' when timeline is empty", async () => {
    const text = getText(await call({ token: 1123456 }));
    expect(text).toContain("No events captured");
  });

  it("sends JSON document to Telegram on non-empty timeline", async () => {
    const events = [
      { id: 1, event: "message", content: { type: "text", text: "hi" } },
      { id: 2, event: "message", content: { type: "text", text: "hello" } },
    ];
    mocks.dumpTimeline.mockReturnValue(events);
    mocks.timelineSize.mockReturnValue(2);
    mocks.storeSize.mockReturnValue(2);
    mocks.sendDocument.mockResolvedValue({
      message_id: 99,
      document: { file_id: "abc123" },
    });

    const data = JSON.parse(getText(await call({ token: 1123456 })));
    expect(data.message_id).toBe(99);
    expect(data.event_count).toBe(2);
    expect(data.file_id).toBe("abc123");
    expect(mocks.sendDocument).toHaveBeenCalledOnce();
    expect(mocks.sendDocument).toHaveBeenCalledWith(
      42,
      expect.anything(),
      expect.objectContaining({ caption: expect.stringContaining("2 events") }),
    );
    expect(mocks.editMessageCaption).toHaveBeenCalledWith(
      42,
      99,
      expect.objectContaining({
        caption: expect.stringContaining("File ID: `abc123`"),
        parse_mode: "Markdown",
      }),
    );
  });

  it("respects limit parameter", async () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1, event: "message", content: { type: "text", text: `msg${i}` },
    }));
    mocks.dumpTimeline.mockReturnValue(events);
    mocks.timelineSize.mockReturnValue(5);

    const data = JSON.parse(getText(await call({ limit: 2, token: 1123456})));
    expect(data.event_count).toBe(2);
    expect(mocks.sendDocument).toHaveBeenCalledOnce();
  });

  it("does not call sendDocument when timeline is empty", async () => {
    await call({ token: 1123456 });
    expect(mocks.sendDocument).not.toHaveBeenCalled();
  });

  it("does not error with default params", async () => {
    const result = await call({ token: 1123456 });
    expect(isError(result)).toBe(false);
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong pin", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
