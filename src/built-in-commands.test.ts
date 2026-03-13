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
  resolveChat: vi.fn((): number | string => 123),
  isRecording: vi.fn((): boolean => false),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  recordedCount: vi.fn((): number => 0),
  getMaxUpdates: vi.fn((): number => 50),
  getSessionEntries: vi.fn((): unknown[] => []),
  clearRecording: vi.fn(),
  setAutoDump: vi.fn(),
  getAutoDumpThreshold: vi.fn((): number | null => null),
  sanitizeSessionEntries: vi.fn((): Promise<Record<string, unknown>[]> => Promise.resolve([])),
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
  resolveChat: mocks.resolveChat,
}));

vi.mock("./session-recording.js", () => ({
  isRecording: mocks.isRecording,
  startRecording: mocks.startRecording,
  stopRecording: mocks.stopRecording,
  recordedCount: mocks.recordedCount,
  getMaxUpdates: mocks.getMaxUpdates,
  getSessionEntries: mocks.getSessionEntries,
  clearRecording: mocks.clearRecording,
  setAutoDump: mocks.setAutoDump,
  getAutoDumpThreshold: mocks.getAutoDumpThreshold,
}));

vi.mock("./update-sanitizer.js", () => ({
  sanitizeSessionEntries: mocks.sanitizeSessionEntries,
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
      date: 0,
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
        date: 0,
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
    mocks.isRecording.mockReturnValue(false);
    mocks.recordedCount.mockReturnValue(0);
  });

  // -- BUILT_IN_COMMANDS constant ------------------------------------------

  it("exports /session command metadata", () => {
    expect(BUILT_IN_COMMANDS).toEqual([
      { command: "session", description: "Session recording controls" },
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

  // -- /session command ----------------------------------------------------

  it("handles /session command — sends panel", async () => {
    const result = await handleIfBuiltIn(cmdUpdate("/session"));
    expect(result).toBe(true);
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      123,
      expect.stringContaining("Session Recording"),
      expect.objectContaining({
        parse_mode: "Markdown",
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.any(Array),
        }),
      }),
    );
  });

  it("shows Start button when not recording", async () => {
    mocks.isRecording.mockReturnValue(false);
    await handleIfBuiltIn(cmdUpdate("/session"));
    const call = mocks.sendMessage.mock.calls[0];
    const keyboard = call[2].reply_markup.inline_keyboard;
    const buttons = keyboard.flat().map(
      (b: { callback_data: string }) => b.callback_data,
    );
    expect(buttons).toContain("session:start");
  });

  it("shows Dump/Stop buttons when recording", async () => {
    mocks.isRecording.mockReturnValue(true);
    mocks.recordedCount.mockReturnValue(5);
    await handleIfBuiltIn(cmdUpdate("/session"));
    const call = mocks.sendMessage.mock.calls[0];
    const keyboard = call[2].reply_markup.inline_keyboard;
    const buttons = keyboard.flat().map(
      (b: { callback_data: string }) => b.callback_data,
    );
    expect(buttons).toContain("session:dump");
    expect(buttons).toContain("session:stop");
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

    it("session:start starts recording and refreshes panel", async () => {
      const panelId = await createPanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "session:start"));
      expect(mocks.startRecording).toHaveBeenCalledWith(100);
      // Panel should be edited to refresh
      expect(mocks.editMessageText).toHaveBeenCalled();
    });

    it("session:stop stops and clears recording", async () => {
      const panelId = await createPanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "session:stop"));
      expect(mocks.stopRecording).toHaveBeenCalled();
      expect(mocks.clearRecording).toHaveBeenCalled();
    });

    it("session:dump dumps and deletes panel", async () => {
      const panelId = await createPanel();
      mocks.getSessionEntries.mockReturnValue([]);
      mocks.sanitizeSessionEntries.mockResolvedValue([]);
      await handleIfBuiltIn(callbackUpdate(panelId, "session:dump"));
      // Panel deleted
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, panelId);
      // Empty dump sends a message
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        123,
        expect.stringContaining("no updates captured"),
        expect.any(Object),
      );
    });
  });

  // -- sendSessionPrefsPrompt ----------------------------------------------

  describe("sendSessionPrefsPrompt", () => {
    it("sends prefs prompt once", async () => {
      await sendSessionPrefsPrompt();
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        123,
        expect.stringContaining("Session Start"),
        expect.objectContaining({ parse_mode: "Markdown" }),
      );
    });

    it("skips when resolveChat returns non-number", async () => {
      mocks.resolveChat.mockReturnValue("not set");
      await sendSessionPrefsPrompt();
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
  });

  // -- Prefs flow callbacks ------------------------------------------------

  describe("prefs flow", () => {
    async function createPrefsPanel(): Promise<number> {
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 300 });
      await sendSessionPrefsPrompt();
      return 300;
    }

    it("session:prefs:record advances to step 2", async () => {
      const panelId = await createPrefsPanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "session:prefs:record"));
      expect(mocks.editMessageText).toHaveBeenCalledWith(
        123,
        panelId,
        expect.stringContaining("auto-dump"),
        expect.any(Object),
      );
    });

    it("session:prefs:skip dismisses the panel", async () => {
      const panelId = await createPrefsPanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "session:prefs:skip"));
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, panelId);
    });

    it("session:auto:50 starts recording with auto-dump", async () => {
      const panelId = await createPrefsPanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "session:auto:50"));
      expect(mocks.startRecording).toHaveBeenCalledWith(100); // max(50*2, 100)
      expect(mocks.setAutoDump).toHaveBeenCalledWith(50, expect.any(Function));
    });

    it("session:auto:never starts recording without auto-dump", async () => {
      const panelId = await createPrefsPanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "session:auto:never"));
      expect(mocks.startRecording).toHaveBeenCalledWith(500);
      expect(mocks.setAutoDump).not.toHaveBeenCalled();
    });
  });
});
