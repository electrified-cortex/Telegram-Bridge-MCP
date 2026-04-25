import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode, type ToolHandler } from "./test-utils.js";

// ─────────────────────────────────────────────────────────────────────────────
// 10-422: error guidance — integration tests
//
// Tests that error responses include actionable `hint` fields. Where fuzzy
// matching logic lives in non-exported helpers, the action tool is used since
// its `type` field is z.string() (not z.enum), so invalid paths reach the
// handler and exercise the fuzzy matching code.
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  // send.ts dependencies
  resolveChat: vi.fn((): number => 42),
  validateText: vi.fn((): null => null),
  isTtsEnabled: vi.fn((): boolean => true),
  stripForTts: vi.fn((t: string) => t),
  synthesizeToOgg: vi.fn(),
  applyTopicToText: vi.fn((t: string) => t),
  getTopic: vi.fn((): string | null => null),
  showTyping: vi.fn(),
  cancelTyping: vi.fn(),
  getSessionVoice: vi.fn((): string | null => null),
  getSessionSpeed: vi.fn((): number | null => null),
  splitMessage: vi.fn((t: string) => [t]),
  markdownToV2: vi.fn((t: string) => t),
  sendMessage: vi.fn(),
  sendVoiceDirect: vi.fn(),
  // shared auth
  requireAuth: vi.fn<() => number | { code: string; message: string }>(),
  getGovernorSid: vi.fn<() => number>(),
  // action-registry
  registerAction: vi.fn(),
  resolveAction: vi.fn<() => undefined | { handler: ReturnType<typeof vi.fn>; meta: { governor?: boolean } }>(),
  listCategories: vi.fn<() => string[]>(),
  listSubPaths: vi.fn<() => string[]>(),
  clearRegistry: vi.fn(),
  // action handler stubs
  handleSetVoice: vi.fn(),
  handleListSessions: vi.fn(),
  handleCloseSession: vi.fn(),
  handleSessionStart: vi.fn(),
  handleSessionReconnect: vi.fn(),
  handleRenameSession: vi.fn(),
  handleEditMessage: vi.fn(),
  handleDeleteMessage: vi.fn(),
  handlePinMessage: vi.fn(),
  handleSetReaction: vi.fn(),
  handleAnswerCallbackQuery: vi.fn(),
  handleRouteMessage: vi.fn(),
  handleSetTopic: vi.fn(),
  handleSaveProfile: vi.fn(),
  handleLoadProfile: vi.fn(),
  handleImportProfile: vi.fn(),
  handleSetReminder: vi.fn(),
  handleCancelReminder: vi.fn(),
  handleListReminders: vi.fn(),
  handleSetDequeueDefault: vi.fn(),
  handleSetDefaultAnimation: vi.fn(),
  handleToggleLogging: vi.fn(),
  handleGetChatHistory: vi.fn(),
  handleGetChat: vi.fn(),
  handleGetMessage: vi.fn(),
  handleGetLog: vi.fn(),
  handleListLogs: vi.fn(),
  handleRollLog: vi.fn(),
  handleDeleteLog: vi.fn(),
  handleGetDebugLog: vi.fn(),
  handleGetTraceLog: vi.fn(),
  handleCancelAnimation: vi.fn(),
  handleShowTyping: vi.fn(),
  handleApproveAgent: vi.fn(),
  handleShutdown: vi.fn(),
  handleNotifyShutdownWarning: vi.fn(),
  handleSessionRestore: vi.fn(),
  handleSessionBounce: vi.fn(),
  handleTranscribeVoice: vi.fn(),
  handleDownloadFile: vi.fn(),
  handleUpdateChecklist: vi.fn(),
  handleUpdateProgress: vi.fn(),
}));

// ─── telegram ────────────────────────────────────────────────────────────────
vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({ sendMessage: mocks.sendMessage }),
    resolveChat: () => mocks.resolveChat(),
    validateText: (t: string) => mocks.validateText(t),
    sendVoiceDirect: (...args: unknown[]) => mocks.sendVoiceDirect(...args),
    splitMessage: (t: string) => mocks.splitMessage(t),
    callApi: (fn: () => unknown) => fn(),
  };
});
vi.mock("../markdown.js", () => ({ markdownToV2: (t: string) => mocks.markdownToV2(t) }));
vi.mock("../topic-state.js", () => ({
  applyTopicToText: (t: string, mode?: string) => mocks.applyTopicToText(t, mode),
  getTopic: () => mocks.getTopic(),
}));
vi.mock("../tts.js", () => ({
  isTtsEnabled: () => mocks.isTtsEnabled(),
  stripForTts: (t: string) => mocks.stripForTts(t),
  synthesizeToOgg: (...args: unknown[]) => mocks.synthesizeToOgg(...args),
}));
vi.mock("../typing-state.js", () => ({
  showTyping: (...args: unknown[]) => mocks.showTyping(...args),
  cancelTyping: () => mocks.cancelTyping(),
}));
vi.mock("../voice-state.js", () => ({
  getSessionVoice: () => mocks.getSessionVoice(),
  getSessionSpeed: () => mocks.getSessionSpeed(),
}));
vi.mock("../config.js", () => ({ getDefaultVoice: () => undefined }));
vi.mock("../session-gate.js", () => ({ requireAuth: (token: number) => mocks.requireAuth(token) }));
vi.mock("../routing-mode.js", () => ({ getGovernorSid: () => mocks.getGovernorSid() }));
vi.mock("../action-registry.js", () => ({
  registerAction: mocks.registerAction,
  resolveAction: mocks.resolveAction,
  listCategories: mocks.listCategories,
  listSubPaths: mocks.listSubPaths,
  clearRegistry: mocks.clearRegistry,
  toActionHandler: (fn: unknown) => fn,
}));

// ─── action handler stubs ────────────────────────────────────────────────────
vi.mock("./set_voice.js", () => ({ handleSetVoice: mocks.handleSetVoice, register: vi.fn() }));
vi.mock("./list_sessions.js", () => ({ handleListSessions: mocks.handleListSessions, register: vi.fn() }));
vi.mock("./close_session.js", () => ({ handleCloseSession: mocks.handleCloseSession, register: vi.fn() }));
vi.mock("./session_start.js", () => ({ handleSessionStart: mocks.handleSessionStart, handleSessionReconnect: mocks.handleSessionReconnect, register: vi.fn() }));
vi.mock("./rename_session.js", () => ({ handleRenameSession: mocks.handleRenameSession, register: vi.fn() }));
vi.mock("./edit_message.js", () => ({ handleEditMessage: mocks.handleEditMessage, register: vi.fn() }));
vi.mock("./delete_message.js", () => ({ handleDeleteMessage: mocks.handleDeleteMessage, register: vi.fn() }));
vi.mock("./pin_message.js", () => ({ handlePinMessage: mocks.handlePinMessage, register: vi.fn() }));
vi.mock("./set_reaction.js", () => ({ handleSetReaction: mocks.handleSetReaction, register: vi.fn() }));
vi.mock("./answer_callback_query.js", () => ({ handleAnswerCallbackQuery: mocks.handleAnswerCallbackQuery, register: vi.fn() }));
vi.mock("./route_message.js", () => ({ handleRouteMessage: mocks.handleRouteMessage, register: vi.fn() }));
vi.mock("./set_topic.js", () => ({ handleSetTopic: mocks.handleSetTopic, register: vi.fn() }));
vi.mock("./save_profile.js", () => ({ handleSaveProfile: mocks.handleSaveProfile, register: vi.fn() }));
vi.mock("./load_profile.js", () => ({ handleLoadProfile: mocks.handleLoadProfile, register: vi.fn() }));
vi.mock("./import_profile.js", () => ({ handleImportProfile: mocks.handleImportProfile, register: vi.fn() }));
vi.mock("./set_reminder.js", () => ({ handleSetReminder: mocks.handleSetReminder, register: vi.fn() }));
vi.mock("./cancel_reminder.js", () => ({ handleCancelReminder: mocks.handleCancelReminder, register: vi.fn() }));
vi.mock("./list_reminders.js", () => ({ handleListReminders: mocks.handleListReminders, register: vi.fn() }));
vi.mock("./set_dequeue_default.js", () => ({ handleSetDequeueDefault: mocks.handleSetDequeueDefault, register: vi.fn() }));
vi.mock("./set_default_animation.js", () => ({ handleSetDefaultAnimation: mocks.handleSetDefaultAnimation, register: vi.fn() }));
vi.mock("./toggle_logging.js", () => ({ handleToggleLogging: mocks.handleToggleLogging, register: vi.fn() }));
vi.mock("./get_chat_history.js", () => ({ handleGetChatHistory: mocks.handleGetChatHistory, register: vi.fn() }));
vi.mock("./get_chat.js", () => ({ handleGetChat: mocks.handleGetChat, register: vi.fn() }));
vi.mock("./get_message.js", () => ({ handleGetMessage: mocks.handleGetMessage, register: vi.fn() }));
vi.mock("./get_log.js", () => ({ handleGetLog: mocks.handleGetLog, register: vi.fn() }));
vi.mock("./list_logs.js", () => ({ handleListLogs: mocks.handleListLogs, register: vi.fn() }));
vi.mock("./roll_log.js", () => ({ handleRollLog: mocks.handleRollLog, register: vi.fn() }));
vi.mock("./delete_log.js", () => ({ handleDeleteLog: mocks.handleDeleteLog, register: vi.fn() }));
vi.mock("./get_debug_log.js", () => ({ handleGetDebugLog: mocks.handleGetDebugLog, handleGetTraceLog: mocks.handleGetTraceLog, register: vi.fn() }));
vi.mock("./cancel_animation.js", () => ({ handleCancelAnimation: mocks.handleCancelAnimation, register: vi.fn() }));
vi.mock("./show_typing.js", () => ({ handleShowTyping: mocks.handleShowTyping, register: vi.fn() }));
vi.mock("./approve_agent.js", () => ({ handleApproveAgent: mocks.handleApproveAgent, register: vi.fn() }));
vi.mock("./shutdown.js", () => ({ handleShutdown: mocks.handleShutdown, register: vi.fn() }));
vi.mock("./notify_shutdown_warning.js", () => ({ handleNotifyShutdownWarning: mocks.handleNotifyShutdownWarning, register: vi.fn() }));
vi.mock("./transcribe_voice.js", () => ({ handleTranscribeVoice: mocks.handleTranscribeVoice, register: vi.fn() }));
vi.mock("./download_file.js", () => ({ handleDownloadFile: mocks.handleDownloadFile, register: vi.fn() }));
vi.mock("./send_new_checklist.js", () => ({
  handleSendNewChecklist: vi.fn(),
  handleUpdateChecklist: mocks.handleUpdateChecklist,
  register: vi.fn(),
}));
vi.mock("./update_progress.js", () => ({ handleUpdateProgress: mocks.handleUpdateProgress, register: vi.fn() }));

// ─── send.ts sub-handler stubs ───────────────────────────────────────────────
vi.mock("./send_file.js", () => ({ handleSendFile: vi.fn() }));
vi.mock("./notify.js", () => ({ handleNotify: vi.fn() }));
vi.mock("./send_choice.js", () => ({ handleSendChoice: vi.fn() }));
vi.mock("./send_direct_message.js", () => ({ handleSendDirectMessage: vi.fn() }));
vi.mock("./append_text.js", () => ({ handleAppendText: vi.fn() }));
vi.mock("./show_animation.js", () => ({ handleShowAnimation: vi.fn() }));
vi.mock("./send_new_progress.js", () => ({ handleSendNewProgress: vi.fn() }));
vi.mock("./ask.js", () => ({ handleAsk: vi.fn() }));
vi.mock("./choose.js", () => ({ handleChoose: vi.fn() }));
vi.mock("./confirm.js", () => ({ handleConfirm: vi.fn() }));

import { register as registerSend } from "./send.js";
import { register as registerAction } from "./action.js";

const TOKEN = 1_123_456; // sid=1, suffix=123456
const VALID_TOKEN = 1_123_456;

// ─────────────────────────────────────────────────────────────────────────────
// send tool — error hints
// ─────────────────────────────────────────────────────────────────────────────

describe("10-422: error guidance", () => {
  describe("send: error hints", () => {
    let call: ToolHandler;

    beforeEach(() => {
      vi.clearAllMocks();
      mocks.requireAuth.mockReturnValue(1);
      mocks.resolveChat.mockReturnValue(42);
      mocks.validateText.mockReturnValue(null);
      mocks.isTtsEnabled.mockReturnValue(true);
      mocks.stripForTts.mockImplementation((t: string) => t);
      mocks.applyTopicToText.mockImplementation((t: string) => t);
      mocks.markdownToV2.mockImplementation((t: string) => t);
      mocks.splitMessage.mockImplementation((t: string) => [t]);
      mocks.sendMessage.mockResolvedValue({ message_id: 42 });
      mocks.sendVoiceDirect.mockResolvedValue({ message_id: 43 });
      mocks.showTyping.mockResolvedValue(undefined);

      const server = createMockServer();
      registerSend(server);
      call = server.getHandler("send");
    });

    it("MISSING_CONTENT: no text or audio → error includes hint pointing to help", async () => {
      const result = await call({ type: "text", token: TOKEN });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("MISSING_CONTENT");
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
      expect((data.hint as string)).toContain("help");
    });

    it("TTS_NOT_CONFIGURED: audio with TTS disabled → hint mentions env var", async () => {
      mocks.isTtsEnabled.mockReturnValue(false);
      const result = await call({ audio: "hello", token: TOKEN });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("TTS_NOT_CONFIGURED");
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
      expect((data.hint as string)).toContain("TTS_HOST");
    });

    it("EMPTY_MESSAGE: audio stripped to empty → hint about non-empty text", async () => {
      mocks.stripForTts.mockReturnValue("");
      const result = await call({ audio: "   ", token: TOKEN });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("EMPTY_MESSAGE");
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
      expect((data.hint as string).toLowerCase()).toContain("non-empty");
    });

    it("progress MISSING_PARAM: no percent → hint mentions percent", async () => {
      const result = await call({ type: "progress", token: TOKEN });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("MISSING_PARAM");
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
      expect((data.hint as string)).toContain("percent");
    });

    it("checklist MISSING_PARAM: no title → hint mentions checklist requirements", async () => {
      const result = await call({ type: "checklist", token: TOKEN });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("MISSING_PARAM");
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
      expect((data.hint as string)).toContain("checklist");
    });

    it("MISSING_QUESTION_TYPE: question with no sub-type → hint names valid sub-types", async () => {
      const result = await call({ type: "question", token: TOKEN });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("MISSING_QUESTION_TYPE");
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
      expect((data.hint as string)).toContain("ask");
    });

    it("UNKNOWN_TYPE with typo: 'animaton' → fuzzy hint suggests 'animation'", async () => {
      const result = await call({ type: "animaton", token: TOKEN });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("UNKNOWN_TYPE");
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
      expect((data.hint as string)).toContain("animation");
    });

    it("UNKNOWN_TYPE with no close match: 'xyzzy99' → hint references help topic", async () => {
      const result = await call({ type: "xyzzy99", token: TOKEN });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("UNKNOWN_TYPE");
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
      expect((data.hint as string)).toContain("help");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // action tool — error hints (fuzzy matching requires z.string() type field)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("action: error hints", () => {
    let call: ToolHandler;

    beforeEach(() => {
      vi.clearAllMocks();
      mocks.requireAuth.mockReturnValue(1);
      mocks.getGovernorSid.mockReturnValue(1);
      mocks.listCategories.mockReturnValue(["config", "message", "session"]);
      mocks.listSubPaths.mockReturnValue([]);
      mocks.resolveAction.mockReturnValue(undefined);

      const server = createMockServer();
      registerAction(server);
      call = server.getHandler("action");
    });

    it("UNKNOWN_ACTION with typo: 'sessoin' → hint suggests 'session' (Levenshtein ≤ 3)", async () => {
      mocks.listCategories.mockReturnValue(["config", "message", "session"]);
      const result = await call({ type: "sessoin" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("UNKNOWN_ACTION");
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
      expect((data.hint as string)).toContain("session");
    });

    it("UNKNOWN_ACTION with substring match: 'session/stat' contains 'session' → hint suggests it", async () => {
      mocks.listCategories.mockReturnValue(["config", "message", "session"]);
      const result = await call({ type: "session/stat" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("UNKNOWN_ACTION");
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
      expect((data.hint as string)).toContain("session");
    });

    it("UNKNOWN_ACTION with no close match → hint references help topic", async () => {
      mocks.listCategories.mockReturnValue(["config", "message", "session"]);
      const result = await call({ type: "xyzzy123" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("UNKNOWN_ACTION");
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
      expect((data.hint as string)).toContain("help");
    });

    it("NOT_GOVERNOR → hint mentions governor and how to use governor token", async () => {
      const fakeHandler = vi.fn();
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: { governor: true } });
      mocks.requireAuth.mockReturnValue(2); // SID 2 — not governor
      mocks.getGovernorSid.mockReturnValue(1); // SID 1 is governor
      const result = await call({ type: "log/get", token: VALID_TOKEN });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("NOT_GOVERNOR");
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
      expect((data.hint as string)).toContain("governor");
    });
  });
});
