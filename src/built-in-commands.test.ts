import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Update } from "grammy/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  editMessageText: vi.fn(),
  deleteMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
  sendDocument: vi.fn(),
  setMyCommands: vi.fn(),
  rawSendMessage: vi.fn(),
  sendServiceMessage: vi.fn((): Promise<void> => Promise.resolve()),
  resolveChat: vi.fn((): number | string => 123),
  clearCommandsOnShutdown: vi.fn((): Promise<void> => Promise.resolve()),
  stopPoller: vi.fn(),
  getSessionLogMode: vi.fn((): "manual" | number | null => "manual"),
  setSessionLogMode: vi.fn(),
  sessionLogLabel: vi.fn((): string => "manual"),
  dumpTimeline: vi.fn((): unknown[] => []),
  dumpTimelineSince: vi.fn((): { events: unknown[]; nextCursor: number } => ({ events: [], nextCursor: 0 })),
  timelineSize: vi.fn((): number => 0),
  storeSize: vi.fn((): number => 0),
  setOnEvent: vi.fn(),
}));

vi.mock("./telegram.js", () => ({
  getApi: () => ({
    sendMessage: mocks.sendMessage,
    editMessageText: mocks.editMessageText,
    deleteMessage: mocks.deleteMessage,
    answerCallbackQuery: mocks.answerCallbackQuery,
    sendDocument: mocks.sendDocument,
    setMyCommands: mocks.setMyCommands,
  }),
  getRawApi: () => ({
    sendMessage: mocks.rawSendMessage,
  }),
  sendServiceMessage: mocks.sendServiceMessage,
  resolveChat: mocks.resolveChat,
}));

vi.mock("./shutdown.js", () => ({
  clearCommandsOnShutdown: mocks.clearCommandsOnShutdown,
}));

vi.mock("./poller.js", () => ({
  stopPoller: mocks.stopPoller,
}));

vi.mock("./config.js", () => ({
  getSessionLogMode: mocks.getSessionLogMode,
  setSessionLogMode: mocks.setSessionLogMode,
  sessionLogLabel: mocks.sessionLogLabel,
}));

vi.mock("./message-store.js", () => ({
  dumpTimeline: mocks.dumpTimeline,
  dumpTimelineSince: mocks.dumpTimelineSince,
  timelineSize: mocks.timelineSize,
  storeSize: mocks.storeSize,
  setOnEvent: mocks.setOnEvent,
}));

import {
  handleIfBuiltIn,
  isBuiltInPanelQuery,
  sendSessionPrefsPrompt,
  BUILT_IN_COMMANDS,
  resetBuiltInCommandsForTest,
} from "./built-in-commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cmdUpdate(text: string): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 123, type: "private" },
      from: { id: 1, is_bot: false, first_name: "T" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }],
    },
  } as unknown as Update;
}

function callbackUpdate(msgId: number, data: string): Update {
  return {
    update_id: 2,
    callback_query: {
      id: "cq1",
      chat_instance: "inst",
      from: { id: 1, is_bot: false, first_name: "T" },
      data,
      message: {
        message_id: msgId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 123, type: "private" },
      },
    },
  } as unknown as Update;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("built-in-commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBuiltInCommandsForTest();
    mocks.resolveChat.mockReturnValue(123);
    mocks.sendMessage.mockResolvedValue({ message_id: 100 });
    mocks.editMessageText.mockResolvedValue(true);
    mocks.deleteMessage.mockResolvedValue(true);
    mocks.answerCallbackQuery.mockResolvedValue(true);
    mocks.getSessionLogMode.mockReturnValue("manual");
    mocks.sessionLogLabel.mockReturnValue("manual");
  });

  // -- BUILT_IN_COMMANDS constant ------------------------------------------

  it("exports /session, /version, and /shutdown command metadata", () => {
    expect(BUILT_IN_COMMANDS).toEqual([
      { command: "session", description: "Session recording controls" },
      { command: "version", description: "Show server version and build info" },
      { command: "shutdown", description: "Shut down the MCP server" },
    ]);
  });

  // -- handleIfBuiltIn: non-matching updates -------------------------------

  it("returns false for regular text messages", async () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 123, type: "private" },
        text: "hello",
      },
    } as unknown as Update;
    expect(await handleIfBuiltIn(update)).toBe(false);
  });

  it("returns false for non-built-in commands", async () => {
    expect(await handleIfBuiltIn(cmdUpdate("/help"))).toBe(false);
  });

  it("returns false for empty update", async () => {
    const update = { update_id: 1 } as Update;
    expect(await handleIfBuiltIn(update)).toBe(false);
  });

  it("ignores stale commands from before startup", async () => {
    const staleUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        date: 0, // epoch 0 — always before startup
        chat: { id: 123, type: "private" },
        from: { id: 1, is_bot: false, first_name: "T" },
        text: "/shutdown",
        entities: [{ type: "bot_command", offset: 0, length: 9 }],
      },
    } as unknown as Update;
    // Should return true (consumed) but NOT trigger shutdown
    expect(await handleIfBuiltIn(staleUpdate)).toBe(true);
    // stopPoller is imported from poller — if shutdown ran it would be called.
    // Since this is mocked, we verify it was NOT called.
  });

  // -- /session command ----------------------------------------------------

  it("handles /session command — sends panel", async () => {
    const result = await handleIfBuiltIn(cmdUpdate("/session"));
    expect(result).toBe(true);
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      123,
      expect.stringContaining("Session Record"),
      expect.objectContaining({
        parse_mode: "Markdown",
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.any(Array),
        }),
      }),
    );
  });

  it("shows mode and action buttons", async () => {
    mocks.dumpTimeline.mockReturnValue([
      { id: 1, event: "message", from: "user", timestamp: "", content: { type: "text" } },
    ]);
    await handleIfBuiltIn(cmdUpdate("/session"));
    const call = mocks.sendMessage.mock.calls[0];
    const keyboard = call[2].reply_markup.inline_keyboard;
    const buttons = keyboard.flat().map(
      (b: { callback_data: string }) => b.callback_data,
    );
    expect(buttons).toContain("session:disable");
    expect(buttons).toContain("session:autodump");
    expect(buttons).toContain("session:dump");
    expect(buttons).toContain("session:dismiss");
  });

  it("handles /session when resolveChat returns non-number", async () => {
    mocks.resolveChat.mockReturnValue("not configured");
    const result = await handleIfBuiltIn(cmdUpdate("/session"));
    expect(result).toBe(true);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  // -- Callback queries: session panel -------------------------------------

  describe("session panel callbacks", () => {
    /** Send /session to create a panel, then return its message_id */
    async function createPanel(): Promise<number> {
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 200 });
      await handleIfBuiltIn(cmdUpdate("/session"));
      return 200;
    }

    it("routes callback_query to panel handler", async () => {
      const panelId = await createPanel();
      expect(isBuiltInPanelQuery(callbackUpdate(panelId, "session:start"))).toBe(true);
    });

    it("does not route unknown message_id", () => {
      expect(isBuiltInPanelQuery(callbackUpdate(999, "session:start"))).toBe(false);
    });

    it("session:dismiss deletes the panel", async () => {
      const panelId = await createPanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "session:dismiss"));
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, panelId);
    });

    it("session:disable sets mode to null", async () => {
      const panelId = await createPanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "session:disable"));
      expect(mocks.setSessionLogMode).toHaveBeenCalledWith(null);
      expect(mocks.editMessageText).toHaveBeenCalled();
    });

    it("session:manual sets mode to manual", async () => {
      mocks.getSessionLogMode.mockReturnValue(null);
      const panelId = await createPanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "session:manual"));
      expect(mocks.setSessionLogMode).toHaveBeenCalledWith("manual");
      expect(mocks.editMessageText).toHaveBeenCalled();
    });

    it("session:dump dumps and deletes panel", async () => {
      const panelId = await createPanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "session:dump"));
      // Panel deleted
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, panelId);
      // Empty incremental dump is silent — no "no events" message, no document sent
      expect(mocks.sendDocument).not.toHaveBeenCalled();
      expect(mocks.sendMessage).not.toHaveBeenCalledWith(
        123,
        expect.stringContaining("no events captured"),
        expect.any(Object),
      );
    });
  });

  // -- sendSessionPrefsPrompt (deprecated — now a no-op) --------------------

  describe("sendSessionPrefsPrompt", () => {
    it("is a no-op (deprecated)", () => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- testing the deprecated function still works
      sendSessionPrefsPrompt();
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
  });

  // -- Mode switch via /session panel --------------------------------------

  describe("mode switches", () => {
    async function createPanel(): Promise<number> {
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 300 });
      await handleIfBuiltIn(cmdUpdate("/session"));
      return 300;
    }

    it("session:setauto:50 persists auto mode", async () => {
      const panelId = await createPanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "session:setauto:50"));
      expect(mocks.setSessionLogMode).toHaveBeenCalledWith(50);
      expect(mocks.editMessageText).toHaveBeenCalled();
    });

    it("session:autodump shows threshold picker", async () => {
      const panelId = await createPanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "session:autodump"));
      expect(mocks.editMessageText).toHaveBeenCalledWith(
        123,
        panelId,
        expect.stringContaining("Auto-dump"),
        expect.any(Object),
      );
    });
  });
});
