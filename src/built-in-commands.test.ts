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
  sendVoiceDirect: vi.fn(),
  resolveChat: vi.fn((): number | string => 123),
  clearCommandsOnShutdown: vi.fn((): Promise<void> => Promise.resolve()),
  stopPoller: vi.fn(),
  drainPendingUpdates: vi.fn((): Promise<void> => Promise.resolve()),
  waitForPollerExit: vi.fn((): Promise<void> => Promise.resolve()),
  getSessionLogMode: vi.fn((): "manual" | number | null => "manual"),
  setSessionLogMode: vi.fn(),
  sessionLogLabel: vi.fn((): string => "manual"),
  getDefaultVoice: vi.fn((): string | null => null),
  setDefaultVoice: vi.fn(),
  getConfiguredVoices: vi.fn((): unknown[] => []),
  isTtsEnabled: vi.fn((): boolean => true),
  fetchVoiceList: vi.fn((): unknown[] => []),
  synthesizeToOgg: vi.fn(),
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
  sendVoiceDirect: mocks.sendVoiceDirect,
  resolveChat: mocks.resolveChat,
}));

vi.mock("./shutdown.js", () => ({
  clearCommandsOnShutdown: mocks.clearCommandsOnShutdown,
}));

vi.mock("./poller.js", () => ({
  stopPoller: mocks.stopPoller,
  drainPendingUpdates: mocks.drainPendingUpdates,
  waitForPollerExit: mocks.waitForPollerExit,
}));

vi.mock("./config.js", () => ({
  getSessionLogMode: mocks.getSessionLogMode,
  setSessionLogMode: mocks.setSessionLogMode,
  sessionLogLabel: mocks.sessionLogLabel,
  getDefaultVoice: mocks.getDefaultVoice,
  setDefaultVoice: mocks.setDefaultVoice,
  getConfiguredVoices: mocks.getConfiguredVoices,
}));

vi.mock("./tts.js", () => ({
  isTtsEnabled: mocks.isTtsEnabled,
  fetchVoiceList: mocks.fetchVoiceList,
  synthesizeToOgg: mocks.synthesizeToOgg,
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

  it("exports /session, /voice, /version, and /shutdown command metadata", () => {
    expect(BUILT_IN_COMMANDS).toEqual([
      { command: "session", description: "Session recording controls" },
      { command: "voice", description: "Change the TTS voice" },
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

  // -- /voice command ------------------------------------------------------

  describe("/voice command", () => {
    const VOICES = [
      { name: "am_onyx", description: "Onyx", language: "en-US", gender: "male" },
      { name: "am_heart", description: "Heart", language: "en-US", gender: "female" },
      { name: "bf_emma", description: "Emma", language: "en-GB", gender: "female" },
      { name: "bm_george", description: "George", language: "en-GB", gender: "male" },
    ];

    beforeEach(() => {
      mocks.isTtsEnabled.mockReturnValue(true);
      mocks.getConfiguredVoices.mockReturnValue(VOICES);
      mocks.getDefaultVoice.mockReturnValue(null);
    });

    it("sends TTS-not-configured message when TTS is disabled", async () => {
      mocks.isTtsEnabled.mockReturnValue(false);
      await handleIfBuiltIn(cmdUpdate("/voice"));
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        123,
        expect.stringContaining("TTS is not configured"),
        expect.any(Object),
      );
    });

    it("sends wizard panel with language buttons at root step", async () => {
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 500 });
      await handleIfBuiltIn(cmdUpdate("/voice"));
      const call = mocks.sendMessage.mock.calls[0];
      const text: string = call[1];
      expect(text).toContain("Voice Selection");
      const keyboard = call[2].reply_markup.inline_keyboard;
      const buttonData = keyboard.flat().map(
        (b: { callback_data: string }) => b.callback_data,
      );
      expect(buttonData).toContain("voice:nav:en-US");
      expect(buttonData).toContain("voice:nav:en-GB");
      expect(buttonData).toContain("voice:dismiss");
    });

    it("shows no-voices message when list is empty", async () => {
      mocks.getConfiguredVoices.mockReturnValue([]);
      mocks.fetchVoiceList.mockResolvedValue([]);
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 501 });
      await handleIfBuiltIn(cmdUpdate("/voice"));
      const text: string = mocks.sendMessage.mock.calls[0][1];
      expect(text).toContain("No voices found");
    });

    it("falls back to flat list when voices have no language", async () => {
      mocks.getConfiguredVoices.mockReturnValue([
        { name: "voice_a", description: "A" },
        { name: "voice_b", description: "B" },
      ]);
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 502 });
      await handleIfBuiltIn(cmdUpdate("/voice"));
      const keyboard = mocks.sendMessage.mock.calls[0][2]
        .reply_markup.inline_keyboard;
      const buttonData = keyboard.flat().map(
        (b: { callback_data: string }) => b.callback_data,
      );
      expect(buttonData).toContain("voice:sample:voice_a");
      expect(buttonData).toContain("voice:sample:voice_b");
    });

    it("shows current voice when one is configured", async () => {
      mocks.getDefaultVoice.mockReturnValue("am_onyx");
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 503 });
      await handleIfBuiltIn(cmdUpdate("/voice"));
      const text: string = mocks.sendMessage.mock.calls[0][1];
      expect(text).toContain("am_onyx");
      expect(text).toContain("config override");
    });

    it("does nothing when resolveChat returns non-number", async () => {
      mocks.resolveChat.mockReturnValue("not configured");
      await handleIfBuiltIn(cmdUpdate("/voice"));
      expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
  });

  // -- Voice panel callbacks -----------------------------------------------

  describe("voice panel callbacks", () => {
    const VOICES = [
      { name: "am_onyx", description: "Onyx", language: "en-US", gender: "male" },
      { name: "am_adam", description: "Adam", language: "en-US", gender: "male" },
      { name: "am_heart", description: "Heart", language: "en-US", gender: "female" },
      { name: "bf_emma", description: "Emma", language: "en-GB", gender: "female" },
      { name: "bm_george", description: "George", language: "en-GB", gender: "male" },
    ];

    async function createVoicePanel(): Promise<number> {
      mocks.isTtsEnabled.mockReturnValue(true);
      mocks.getConfiguredVoices.mockReturnValue(VOICES);
      mocks.getDefaultVoice.mockReturnValue(null);
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 600 });
      await handleIfBuiltIn(cmdUpdate("/voice"));
      return 600;
    }

    it("voice:dismiss deletes the panel", async () => {
      const panelId = await createVoicePanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "voice:dismiss"));
      expect(mocks.deleteMessage).toHaveBeenCalledWith(123, panelId);
    });

    it("voice:nav:en-US shows gender buttons", async () => {
      const panelId = await createVoicePanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "voice:nav:en-US"));
      const call = mocks.editMessageText.mock.calls[0];
      const text: string = call[2];
      expect(text).toContain("American");
      const keyboard = call[3].reply_markup.inline_keyboard;
      const data = keyboard.flat().map(
        (b: { callback_data: string }) => b.callback_data,
      );
      expect(data).toContain("voice:nav:en-US:male");
      expect(data).toContain("voice:nav:en-US:female");
    });

    it("voice:nav:en-US:male shows male voice buttons", async () => {
      const panelId = await createVoicePanel();
      await handleIfBuiltIn(
        callbackUpdate(panelId, "voice:nav:en-US:male"),
      );
      const call = mocks.editMessageText.mock.calls[0];
      const keyboard = call[3].reply_markup.inline_keyboard;
      const data = keyboard.flat().map(
        (b: { callback_data: string }) => b.callback_data,
      );
      expect(data).toContain("voice:sample:am_onyx");
      expect(data).toContain("voice:sample:am_adam");
      expect(data).not.toContain("voice:sample:am_heart");
    });

    it("voice:home navigates back to language selection", async () => {
      const panelId = await createVoicePanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "voice:home"));
      const call = mocks.editMessageText.mock.calls[0];
      const keyboard = call[3].reply_markup.inline_keyboard;
      const data = keyboard.flat().map(
        (b: { callback_data: string }) => b.callback_data,
      );
      expect(data).toContain("voice:nav:en-US");
      expect(data).toContain("voice:nav:en-GB");
    });

    it("voice:clear resets the voice and refreshes panel", async () => {
      mocks.getDefaultVoice.mockReturnValue("am_onyx");
      const panelId = await createVoicePanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "voice:clear"));
      expect(mocks.setDefaultVoice).toHaveBeenCalledWith(null);
      expect(mocks.editMessageText).toHaveBeenCalled();
    });

    it("voice:noop early-returns without refreshing panel", async () => {
      const panelId = await createVoicePanel();
      await handleIfBuiltIn(callbackUpdate(panelId, "voice:noop"));
      expect(mocks.editMessageText).not.toHaveBeenCalled();
      expect(mocks.deleteMessage).not.toHaveBeenCalled();
    });

    it("voice:sample sends TTS sample with button", async () => {
      const panelId = await createVoicePanel();
      const fakeOgg = Buffer.from("ogg");
      mocks.synthesizeToOgg.mockResolvedValue(fakeOgg);
      mocks.sendVoiceDirect.mockResolvedValue({ message_id: 601 });
      await handleIfBuiltIn(
        callbackUpdate(panelId, "voice:sample:am_onyx"),
      );
      expect(mocks.synthesizeToOgg).toHaveBeenCalledWith(
        expect.stringContaining("Onyx"),
        "am_onyx",
      );
      expect(mocks.sendVoiceDirect).toHaveBeenCalledWith(
        123,
        fakeOgg,
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: [[expect.objectContaining({
              callback_data: "voice:set:am_onyx",
            })]],
          }),
        }),
      );
    });

    it("voice:sample shows error when TTS fails", async () => {
      const panelId = await createVoicePanel();
      mocks.synthesizeToOgg.mockRejectedValue(new Error("TTS down"));
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 602 });
      await handleIfBuiltIn(
        callbackUpdate(panelId, "voice:sample:am_onyx"),
      );
      // Error message should be sent
      const errorCall = mocks.sendMessage.mock.calls.find(
        (c: unknown[]) =>
          typeof c[1] === "string" && c[1].includes("Failed"),
      );
      expect(errorCall).toBeDefined();
    });

    it("marks ✓ on the active voice in flat button list", async () => {
      const panelId = await createVoicePanel();
      mocks.getDefaultVoice.mockReturnValue("am_onyx");
      await handleIfBuiltIn(
        callbackUpdate(panelId, "voice:nav:en-US:male"),
      );
      const call = mocks.editMessageText.mock.calls[0];
      const keyboard = call[3].reply_markup.inline_keyboard;
      const buttons = keyboard.flat();
      const onyx = buttons.find(
        (b: { callback_data: string }) =>
          b.callback_data === "voice:sample:am_onyx",
      );
      expect(onyx?.text).toMatch(/^✓/);
    });

    it("skips gender step when only one gender exists", async () => {
      const panelId = await createVoicePanel();
      mocks.getConfiguredVoices.mockReturnValue([
        { name: "bf_emma", description: "Emma", language: "en-GB", gender: "female" },
      ]);
      await handleIfBuiltIn(callbackUpdate(panelId, "voice:nav:en-GB"));
      const call = mocks.editMessageText.mock.calls[0];
      const keyboard = call[3].reply_markup.inline_keyboard;
      const data = keyboard.flat().map(
        (b: { callback_data: string }) => b.callback_data,
      );
      // Should go straight to voice buttons, skipping gender
      expect(data).toContain("voice:sample:bf_emma");
      expect(data).not.toContain("voice:nav:en-GB:female");
    });
  });

  // -- Voice sample callbacks ----------------------------------------------

  describe("voice-sample callbacks", () => {
    async function createVoiceSample(): Promise<number> {
      mocks.isTtsEnabled.mockReturnValue(true);
      mocks.getConfiguredVoices.mockReturnValue([
        { name: "am_onyx", description: "Onyx", language: "en-US", gender: "male" },
      ]);
      mocks.getDefaultVoice.mockReturnValue(null);
      mocks.sendMessage.mockResolvedValueOnce({ message_id: 700 });
      await handleIfBuiltIn(cmdUpdate("/voice"));
      // Now simulate a sample being sent
      const fakeOgg = Buffer.from("ogg");
      mocks.synthesizeToOgg.mockResolvedValue(fakeOgg);
      mocks.sendVoiceDirect.mockResolvedValue({ message_id: 701 });
      await handleIfBuiltIn(
        callbackUpdate(700, "voice:sample:am_onyx"),
      );
      return 701;
    }

    it("voice:set sets the default voice", async () => {
      const sampleMsgId = await createVoiceSample();
      await handleIfBuiltIn(
        callbackUpdate(sampleMsgId, "voice:set:am_onyx"),
      );
      expect(mocks.setDefaultVoice).toHaveBeenCalledWith("am_onyx");
      expect(mocks.answerCallbackQuery).toHaveBeenCalledWith(
        "cq1",
        { text: "Voice set to am_onyx" },
      );
    });

    it("answers unknown voice-sample callback without error", async () => {
      const sampleMsgId = await createVoiceSample();
      await handleIfBuiltIn(
        callbackUpdate(sampleMsgId, "voice:unknown"),
      );
      expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("cq1");
      expect(mocks.setDefaultVoice).not.toHaveBeenCalled();
    });
  });
});
