import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode, type ToolHandler } from "./test-utils.js";

// ─────────────────────────────────────────────────────────────────────────────
// action tool handler tests
// (action-registry unit tests live in src/action-registry.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  registerAction: vi.fn(),
  resolveAction: vi.fn<() => undefined | { handler: ReturnType<typeof vi.fn>; meta: { governor?: boolean } }>(),
  listCategories: vi.fn<() => string[]>(),
  listSubPaths: vi.fn<() => string[]>(),
  clearRegistry: vi.fn(),
  requireAuth: vi.fn<() => number | { code: string; message: string }>(),
  getGovernorSid: vi.fn<() => number>(),
  // Phase 1 handler stubs — just need to exist for the import
  handleSetVoice: vi.fn(),
  handleListSessions: vi.fn(),
  handleCloseSession: vi.fn(),
  handleSessionStart: vi.fn(),
  handleSessionReconnect: vi.fn(),
  handleRenameSession: vi.fn(),
  handleEditMessage: vi.fn(),
  // Phase 2 handler stubs
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
  handleDumpSessionRecord: vi.fn(),
  handleCancelAnimation: vi.fn(),
  handleShowTyping: vi.fn(),
  handleConfirm: vi.fn(),
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

vi.mock("../action-registry.js", () => ({
  registerAction: mocks.registerAction,
  resolveAction: mocks.resolveAction,
  listCategories: mocks.listCategories,
  listSubPaths: mocks.listSubPaths,
  clearRegistry: mocks.clearRegistry,
}));

vi.mock("../session-gate.js", () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock("../routing-mode.js", () => ({
  getGovernorSid: mocks.getGovernorSid,
}));

vi.mock("./set_voice.js", () => ({
  handleSetVoice: mocks.handleSetVoice,
  register: vi.fn(),
}));

vi.mock("./list_sessions.js", () => ({
  handleListSessions: mocks.handleListSessions,
  register: vi.fn(),
}));

vi.mock("./close_session.js", () => ({
  handleCloseSession: mocks.handleCloseSession,
  register: vi.fn(),
}));

vi.mock("./session_start.js", () => ({
  handleSessionStart: mocks.handleSessionStart,
  handleSessionReconnect: mocks.handleSessionReconnect,
  register: vi.fn(),
}));

vi.mock("./rename_session.js", () => ({
  handleRenameSession: mocks.handleRenameSession,
  register: vi.fn(),
}));

vi.mock("./edit_message.js", () => ({
  handleEditMessage: mocks.handleEditMessage,
  register: vi.fn(),
}));

// Phase 2 vi.mocks — message/*
vi.mock("./delete_message.js", () => ({ handleDeleteMessage: mocks.handleDeleteMessage, register: vi.fn() }));
vi.mock("./pin_message.js", () => ({ handlePinMessage: mocks.handlePinMessage, register: vi.fn() }));
vi.mock("./set_reaction.js", () => ({ handleSetReaction: mocks.handleSetReaction, register: vi.fn() }));
vi.mock("./answer_callback_query.js", () => ({ handleAnswerCallbackQuery: mocks.handleAnswerCallbackQuery, register: vi.fn() }));
vi.mock("./route_message.js", () => ({ handleRouteMessage: mocks.handleRouteMessage, register: vi.fn() }));
// Phase 2 vi.mocks — profile/*, reminder/*, etc.
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
// Phase 2 vi.mocks — message/history, message/get
vi.mock("./get_chat_history.js", () => ({ handleGetChatHistory: mocks.handleGetChatHistory, register: vi.fn() }));
vi.mock("./get_chat.js", () => ({ handleGetChat: mocks.handleGetChat, register: vi.fn() }));
vi.mock("./get_message.js", () => ({ handleGetMessage: mocks.handleGetMessage, register: vi.fn() }));
// Phase 2 vi.mocks — log/*
vi.mock("./get_log.js", () => ({ handleGetLog: mocks.handleGetLog, register: vi.fn() }));
vi.mock("./list_logs.js", () => ({ handleListLogs: mocks.handleListLogs, register: vi.fn() }));
vi.mock("./roll_log.js", () => ({ handleRollLog: mocks.handleRollLog, register: vi.fn() }));
vi.mock("./delete_log.js", () => ({ handleDeleteLog: mocks.handleDeleteLog, register: vi.fn() }));
vi.mock("./get_debug_log.js", () => ({ handleGetDebugLog: mocks.handleGetDebugLog, handleGetTraceLog: mocks.handleGetTraceLog, register: vi.fn() }));
vi.mock("./dump_session_record.js", () => ({ handleDumpSessionRecord: mocks.handleDumpSessionRecord, register: vi.fn() }));
// Phase 2 vi.mocks — animation/*
vi.mock("./cancel_animation.js", () => ({ handleCancelAnimation: mocks.handleCancelAnimation, register: vi.fn() }));
// Phase 2 vi.mocks — standalone
vi.mock("./show_typing.js", () => ({ handleShowTyping: mocks.handleShowTyping, register: vi.fn() }));
vi.mock("./confirm.js", () => ({ handleConfirm: (...args: unknown[]) => mocks.handleConfirm(...args), register: vi.fn() }));
vi.mock("./approve_agent.js", () => ({ handleApproveAgent: mocks.handleApproveAgent, register: vi.fn() }));
vi.mock("./shutdown.js", () => ({ handleShutdown: mocks.handleShutdown, register: vi.fn() }));
vi.mock("./notify_shutdown_warning.js", () => ({ handleNotifyShutdownWarning: mocks.handleNotifyShutdownWarning, register: vi.fn() }));
vi.mock("./session_restore.js", () => ({ handleSessionRestore: mocks.handleSessionRestore, register: vi.fn() }));
vi.mock("./session_bounce.js", () => ({ handleSessionBounce: mocks.handleSessionBounce, register: vi.fn() }));
vi.mock("./transcribe_voice.js", () => ({ handleTranscribeVoice: mocks.handleTranscribeVoice, register: vi.fn() }));
vi.mock("./download_file.js", () => ({ handleDownloadFile: mocks.handleDownloadFile, register: vi.fn() }));
vi.mock("./send_new_checklist.js", () => ({ handleUpdateChecklist: mocks.handleUpdateChecklist, register: vi.fn() }));
vi.mock("./update_progress.js", () => ({ handleUpdateProgress: mocks.handleUpdateProgress, register: vi.fn() }));

import { register } from "./action.js";

const VALID_TOKEN = 1_123_456; // sid=1, pin=123456

describe("action tool", () => {
  let call: ToolHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockReturnValue(1);
    mocks.getGovernorSid.mockReturnValue(1);
    mocks.listCategories.mockReturnValue(["config", "message", "session"]);
    mocks.listSubPaths.mockReturnValue([]);
    mocks.resolveAction.mockReturnValue(undefined);

    const server = createMockServer();
    register(server);
    call = server.getHandler("action");
  });

  // ── Discovery tier 1: no type ───────────────────────────────────────────

  describe("tier 1: no type → category list", () => {
    it("returns categories when type is omitted", async () => {
      mocks.listCategories.mockReturnValue(["config", "session"]);
      const result = await call({});
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.categories).toEqual(["config", "session"]);
      expect(typeof data.hint).toBe("string");
    });

    it("includes a hint in the response", async () => {
      mocks.listCategories.mockReturnValue([]);
      const result = await call({});
      const data = parseResult(result);
      expect(data.hint).toContain("action");
    });
  });

  // ── Discovery tier 2: category only ────────────────────────────────────

  describe("tier 2: category only → sub-path list", () => {
    it("returns sub-paths when type is a category prefix", async () => {
      mocks.resolveAction.mockReturnValue(undefined);
      mocks.listSubPaths.mockReturnValue(["session/close", "session/list", "session/start"]);
      const result = await call({ type: "session" });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.category).toBe("session");
      expect(data.paths).toEqual(["session/close", "session/list", "session/start"]);
    });

    it("includes a usage hint in the sub-path response", async () => {
      mocks.resolveAction.mockReturnValue(undefined);
      mocks.listSubPaths.mockReturnValue(["session/list"]);
      const result = await call({ type: "session" });
      const data = parseResult(result);
      expect(typeof data.hint).toBe("string");
    });
  });

  // ── Discovery tier 3: full path dispatch ────────────────────────────────

  describe("tier 3: full path → dispatch", () => {
    it("dispatches to handler when type matches a registered path", async () => {
      const fakeHandler = vi.fn().mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] });
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: {} });
      const result = await call({ type: "session/list", token: VALID_TOKEN });
      expect(fakeHandler).toHaveBeenCalledOnce();
      expect(isError(result)).toBe(false);
    });

    it("forwards all args to the handler", async () => {
      const fakeHandler = vi.fn().mockReturnValue({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] });
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: {} });
      await call({ type: "profile/voice", token: VALID_TOKEN, voice: "alloy", speed: 1.2 });
      const calledArgs = fakeHandler.mock.calls[0][0];
      expect(calledArgs.voice).toBe("alloy");
      expect(calledArgs.speed).toBe(1.2);
      expect(calledArgs.token).toBe(VALID_TOKEN);
    });

    it("passes async handler results through correctly", async () => {
      const expected = { content: [{ type: "text", text: JSON.stringify({ sessions: [] }) }] };
      const fakeHandler = vi.fn().mockResolvedValue(expected);
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: {} });
      const result = await call({ type: "session/list", token: VALID_TOKEN });
      expect(result).toEqual(expected);
    });
  });

  // ── Unknown path ─────────────────────────────────────────────────────────

  describe("unknown path", () => {
    it("returns UNKNOWN_ACTION error for an unregistered path", async () => {
      mocks.resolveAction.mockReturnValue(undefined);
      mocks.listSubPaths.mockReturnValue([]);
      const result = await call({ type: "nonexistent/path" });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("UNKNOWN_ACTION");
    });

    it("includes the unknown path in the error message", async () => {
      mocks.resolveAction.mockReturnValue(undefined);
      mocks.listSubPaths.mockReturnValue([]);
      const result = await call({ type: "totally/unknown" });
      expect(isError(result)).toBe(true);
      const parsed = JSON.parse((result as { isError: boolean; content: Array<{ text: string }> }).content[0].text) as { message: string };
      expect(parsed.message).toContain("totally/unknown");
    });
  });

  // ── Auth gating ───────────────────────────────────────────────────────────

  describe("governor gating", () => {
    it("allows governor-only path when caller is the governor", async () => {
      const fakeHandler = vi.fn().mockReturnValue({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] });
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: { governor: true } });
      mocks.requireAuth.mockReturnValue(1);
      mocks.getGovernorSid.mockReturnValue(1);
      const result = await call({ type: "log/get", token: VALID_TOKEN });
      expect(isError(result)).toBe(false);
      expect(fakeHandler).toHaveBeenCalledOnce();
    });

    it("rejects governor-only path when caller is not the governor", async () => {
      const fakeHandler = vi.fn();
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: { governor: true } });
      mocks.requireAuth.mockReturnValue(2); // SID 2 is not governor
      mocks.getGovernorSid.mockReturnValue(1); // SID 1 is governor
      const result = await call({ type: "log/get", token: 2_123_456 });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("NOT_GOVERNOR");
      expect(fakeHandler).not.toHaveBeenCalled();
    });

    it("returns auth error when token is invalid for governor path", async () => {
      mocks.resolveAction.mockReturnValue({ handler: vi.fn(), meta: { governor: true } });
      mocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "Invalid token." });
      const result = await call({ type: "log/get", token: 999 });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });
  });

  // ── setupActionRegistry wires Phase 1 paths ───────────────────────────────

  describe("registry wiring", () => {
    it("calls registerAction for all Phase 1 paths on setup", () => {
      const registeredPaths = mocks.registerAction.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(registeredPaths).toContain("session/start");
      expect(registeredPaths).toContain("session/close");
      expect(registeredPaths).toContain("session/list");
      expect(registeredPaths).toContain("session/rename");
      expect(registeredPaths).toContain("profile/voice");
      expect(registeredPaths).toContain("message/edit");
    });

    it("calls registerAction for all Phase 2 message/* and standalone paths", () => {
      const registeredPaths = mocks.registerAction.mock.calls.map((c) => c[0] as string);
      expect(registeredPaths).toContain("message/delete");
      expect(registeredPaths).toContain("message/pin");
      expect(registeredPaths).toContain("react");
      expect(registeredPaths).toContain("acknowledge");
      expect(registeredPaths).toContain("message/route");
    });

    it("calls registerAction for all Phase 2 profile/*, reminder/*, etc. paths", () => {
      const registeredPaths = mocks.registerAction.mock.calls.map((c) => c[0] as string);
      expect(registeredPaths).toContain("profile/topic");
      expect(registeredPaths).toContain("profile/save");
      expect(registeredPaths).toContain("profile/load");
      expect(registeredPaths).toContain("profile/import");
      expect(registeredPaths).toContain("reminder/set");
      expect(registeredPaths).toContain("reminder/cancel");
      expect(registeredPaths).toContain("reminder/list");
      expect(registeredPaths).toContain("profile/dequeue-default");
      expect(registeredPaths).toContain("animation/default");
      expect(registeredPaths).toContain("logging/toggle");
    });

    it("calls registerAction for all Phase 2 message/history and message/get paths", () => {
      const registeredPaths = mocks.registerAction.mock.calls.map((c) => c[0] as string);
      expect(registeredPaths).toContain("message/history");
      expect(registeredPaths).toContain("message/get");
    });

    it("calls registerAction for chat/info", () => {
      const registeredPaths = mocks.registerAction.mock.calls.map((c) => c[0] as string);
      expect(registeredPaths).toContain("chat/info");
    });

    it("calls registerAction for all Phase 2 log/* paths", () => {
      const registeredPaths = mocks.registerAction.mock.calls.map((c) => c[0] as string);
      expect(registeredPaths).toContain("log/get");
      expect(registeredPaths).toContain("log/list");
      expect(registeredPaths).toContain("log/roll");
      expect(registeredPaths).toContain("log/delete");
      expect(registeredPaths).toContain("log/debug");
      expect(registeredPaths).toContain("log/trace");
      expect(registeredPaths).not.toContain("log/dump");
    });

    it("calls registerAction for all Phase 2 standalone paths", () => {
      const registeredPaths = mocks.registerAction.mock.calls.map((c) => c[0] as string);
      expect(registeredPaths).toContain("animation/cancel");
      expect(registeredPaths).toContain("show-typing");
      expect(registeredPaths).toContain("approve");
      expect(registeredPaths).toContain("shutdown");
      expect(registeredPaths).toContain("shutdown/warn");
      expect(registeredPaths).toContain("transcribe");
      expect(registeredPaths).toContain("download");
      expect(registeredPaths).toContain("checklist/update");
      expect(registeredPaths).toContain("progress/update");
    });

    it("calls registerAction for all confirm/* preset paths", () => {
      const registeredPaths = mocks.registerAction.mock.calls.map((c) => c[0] as string);
      expect(registeredPaths).toContain("confirm/ok");
      expect(registeredPaths).toContain("confirm/ok-cancel");
      expect(registeredPaths).toContain("confirm/yn");
    });

    it("registers governor-only paths with { governor: true } metadata", () => {
      const governorCalls = mocks.registerAction.mock.calls.filter(
        (c) => (c[2] as { governor?: boolean } | undefined)?.governor === true,
      );
      const governorPaths = governorCalls.map((c) => c[0] as string);
      expect(governorPaths).toContain("message/route");
      expect(governorPaths).toContain("log/get");
      expect(governorPaths).toContain("log/list");
      expect(governorPaths).toContain("log/roll");
      expect(governorPaths).toContain("log/delete");
      expect(governorPaths).toContain("log/debug");
      expect(governorPaths).toContain("log/trace");
      expect(governorPaths).not.toContain("log/dump");
      expect(governorPaths).toContain("approve");
      expect(governorPaths).toContain("shutdown");
      expect(governorPaths).toContain("shutdown/warn");
    });
  });

  // ── message/history dual routing ───────────────────────────────────────

  describe("message/history dual routing", () => {
    it("routes to handleGetChatHistory when count is present", async () => {
      const chatHistoryResult = { content: [{ type: "text", text: JSON.stringify({ events: [] }) }] };
      mocks.handleGetChatHistory.mockReturnValue(chatHistoryResult);
      // Simulate the inline router registered for message/history
      const routerCall = mocks.registerAction.mock.calls.find((c) => c[0] === "message/history");
      expect(routerCall).toBeDefined();
      const router = routerCall![1] as (args: Record<string, unknown>) => unknown;
      const result = await router({ count: 10, token: VALID_TOKEN });
      expect(mocks.handleGetChatHistory).toHaveBeenCalledOnce();
      expect(mocks.handleGetChat).not.toHaveBeenCalled();
      expect(result).toEqual(chatHistoryResult);
    });

    it("routes to handleGetChatHistory when before_id is present", async () => {
      const chatHistoryResult = { content: [{ type: "text", text: JSON.stringify({ events: [] }) }] };
      mocks.handleGetChatHistory.mockReturnValue(chatHistoryResult);
      const routerCall = mocks.registerAction.mock.calls.find((c) => c[0] === "message/history");
      const router = routerCall![1] as (args: Record<string, unknown>) => unknown;
      await router({ before_id: 100, token: VALID_TOKEN });
      expect(mocks.handleGetChatHistory).toHaveBeenCalledOnce();
      expect(mocks.handleGetChat).not.toHaveBeenCalled();
    });

    it("routes to handleGetChat when neither count nor before_id is present", async () => {
      const chatResult = { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
      mocks.handleGetChat.mockResolvedValue(chatResult);
      const routerCall = mocks.registerAction.mock.calls.find((c) => c[0] === "message/history");
      const router = routerCall![1] as (args: Record<string, unknown>) => unknown;
      await router({ token: VALID_TOKEN });
      expect(mocks.handleGetChat).toHaveBeenCalledOnce();
      expect(mocks.handleGetChatHistory).not.toHaveBeenCalled();
    });
  });

  // ── Phase 2 dispatch spot checks ─────────────────────────────────────────

  describe("Phase 2 dispatch spot checks", () => {
    it("dispatches checklist/update to handleUpdateChecklist", async () => {
      const fakeResult = { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
      const fakeHandler = vi.fn().mockReturnValue(fakeResult);
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: {} });
      const result = await call({ type: "checklist/update", token: VALID_TOKEN, message_id: 42, title: "Checklist" });
      expect(fakeHandler).toHaveBeenCalledOnce();
      const calledArgs = fakeHandler.mock.calls[0][0] as Record<string, unknown>;
      expect(calledArgs.message_id).toBe(42);
      expect(calledArgs.title).toBe("Checklist");
      expect(isError(result)).toBe(false);
    });

    it("dispatches progress/update to handleUpdateProgress", async () => {
      const fakeHandler = vi.fn().mockReturnValue({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] });
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: {} });
      await call({ type: "progress/update", token: VALID_TOKEN, message_id: 10, percent: 50 });
      expect(fakeHandler).toHaveBeenCalledOnce();
      const calledArgs = fakeHandler.mock.calls[0][0] as Record<string, unknown>;
      expect(calledArgs.percent).toBe(50);
    });

    it("dispatches transcribe to handleTranscribeVoice", async () => {
      const fakeHandler = vi.fn().mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ text: "hello" }) }] });
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: {} });
      await call({ type: "transcribe", token: VALID_TOKEN, file_id: "AgAC123" });
      expect(fakeHandler).toHaveBeenCalledOnce();
      const calledArgs = fakeHandler.mock.calls[0][0] as Record<string, unknown>;
      expect(calledArgs.file_id).toBe("AgAC123");
    });

    it("dispatches log/trace to handleGetTraceLog", async () => {
      const fakeResult = { content: [{ type: "text", text: JSON.stringify({ source: "trace", returned: 0, entries: [] }) }] };
      const fakeHandler = vi.fn().mockReturnValue(fakeResult);
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: { governor: true } });
      mocks.requireAuth.mockReturnValue(1);
      mocks.getGovernorSid.mockReturnValue(1);
      const result = await call({ type: "log/trace", token: VALID_TOKEN, session_id: 2, count: 10 });
      expect(fakeHandler).toHaveBeenCalledOnce();
      const calledArgs = fakeHandler.mock.calls[0][0] as Record<string, unknown>;
      expect(calledArgs.session_id).toBe(2);
      expect(calledArgs.count).toBe(10);
      expect(isError(result)).toBe(false);
    });

    // 10-425 regression: log/debug category param accepts any string (no enum rejection)
    it("log/debug: routes category string param to handler (no schema rejection)", async () => {
      const fakeHandler = vi.fn().mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ entries: [] }) }] });
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: {} });
      const result = await call({ type: "log/debug", category: "animation", token: VALID_TOKEN });
      expect(isError(result)).toBe(false);
      expect(fakeHandler).toHaveBeenCalledOnce();
      const calledArgs = fakeHandler.mock.calls[0][0] as Record<string, unknown>;
      expect(calledArgs.category).toBe("animation");
    });

    it("dispatches chat/info to handleGetChat", async () => {
      const chatResult = { content: [{ type: "text", text: JSON.stringify({ approved: true, id: 123 }) }] };
      const fakeHandler = vi.fn().mockResolvedValue(chatResult);
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: {} });
      const result = await call({ type: "chat/info", token: VALID_TOKEN });
      expect(fakeHandler).toHaveBeenCalledOnce();
      expect(isError(result)).toBe(false);
    });

    it("passes parse_mode: 'Markdown' by default when not supplied (message/edit regression)", async () => {
      const fakeHandler = vi.fn().mockReturnValue({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] });
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: {} });
      // Omit parse_mode — must default to "Markdown" so auto-conversion runs
      await call({ type: "message/edit", token: VALID_TOKEN, message_id: 1, text: "*bold*" });
      expect(fakeHandler).toHaveBeenCalledOnce();
      const calledArgs = fakeHandler.mock.calls[0][0] as Record<string, unknown>;
      expect(calledArgs.parse_mode).toBe("Markdown");
    });

    it("passes parse_mode: 'MarkdownV2' through when explicitly supplied", async () => {
      const fakeHandler = vi.fn().mockReturnValue({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] });
      mocks.resolveAction.mockReturnValue({ handler: fakeHandler, meta: {} });
      await call({ type: "message/edit", token: VALID_TOKEN, message_id: 1, text: "*bold*", parse_mode: "MarkdownV2" });
      expect(fakeHandler).toHaveBeenCalledOnce();
      const calledArgs = fakeHandler.mock.calls[0][0] as Record<string, unknown>;
      expect(calledArgs.parse_mode).toBe("MarkdownV2");
    });

    it("dispatches confirm/ok to handleConfirm with preset OK button", async () => {
      const fakeResult = { content: [{ type: "text", text: JSON.stringify({ confirmed: true }) }] };
      mocks.handleConfirm.mockResolvedValue(fakeResult);
      const confirmOkCall = mocks.registerAction.mock.calls.find((c) => c[0] === "confirm/ok");
      const handler = confirmOkCall![1] as (args: Record<string, unknown>) => unknown;
      await handler({ text: "Are you ready?", token: VALID_TOKEN });
      expect(mocks.handleConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ yes_text: "OK", no_text: "" }),
        undefined,
      );
    });

    it("action(type: 'acknowledge', remove_keyboard: true) passes args to handleAnswerCallbackQuery", async () => {
      // Validates arg forwarding via the action registry wiring — handleAnswerCallbackQuery is mocked
      const acknowledgeCall = mocks.registerAction.mock.calls.find((c) => c[0] === "acknowledge");
      expect(acknowledgeCall).toBeDefined();
      const handler = acknowledgeCall![1] as (args: Record<string, unknown>) => unknown;
      mocks.handleAnswerCallbackQuery.mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      });
      const result = await handler({
        type: "acknowledge",
        callback_query_id: "cbq_X",
        message_id: 42,
        remove_keyboard: true,
        token: VALID_TOKEN,
      });
      expect(mocks.handleAnswerCallbackQuery).toHaveBeenCalledOnce();
      const calledArgs = mocks.handleAnswerCallbackQuery.mock.calls[0][0] as Record<string, unknown>;
      expect(calledArgs.callback_query_id).toBe("cbq_X");
      expect(calledArgs.message_id).toBe(42);
      expect(calledArgs.remove_keyboard).toBe(true);
      expect(result).toEqual(expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('"ok":true') }),
        ]),
      }));
    });
  });
});
