import { vi, describe, it, expect, beforeEach } from "vitest";
import type { TelegramError } from "../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  sendMessage: vi.fn(),
  editMessageText: vi.fn(),
  pinChatMessage: vi.fn(),
  unpinChatMessage: vi.fn(),
  resolveChat: vi.fn((): number | TelegramError => 1),
  validateText: vi.fn((): TelegramError | null => null),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => mocks,
    resolveChat: mocks.resolveChat,
    validateText: mocks.validateText,
  };
});

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

import { register } from "./send_new_checklist.js";
import { resetCompletionTrackingForTest } from "./send_new_checklist.js";

const STEPS = [
  { label: "Install deps", status: "done" },
  { label: "Build", status: "running" },
  { label: "Test", status: "pending" },
  { label: "Deploy", status: "failed" },
];

describe("send_new_checklist tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.pinChatMessage.mockResolvedValue(true);
    mocks.unpinChatMessage.mockResolvedValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("send_new_checklist");
  });

  it("creates a new message when called", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 10, chat: { id: 1 }, date: 0 });
    const result = await call({ title: "CI Pipeline", steps: STEPS, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(10);
    expect(data.hint).toBeUndefined();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(mocks.editMessageText).not.toHaveBeenCalled();
  });

  it("renders step statuses with appropriate icons", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({ title: "T", steps: STEPS, token: 1123456});
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("✅");   // done
    expect(text).toContain("⛔");   // failed
    expect(text).toContain("🔄");   // running
    expect(text).toContain("⬜");   // pending
  });

  it("includes title in HTML bold", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({ title: "Pipeline", steps: [{ label: "X", status: "done" }], token: 1123456 });
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("<b>Pipeline</b>");
  });

  it("renders optional detail text as italic", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({
      title: "T",
      steps: [{ label: "Build", status: "failed", detail: "exit code 1" }],
      token: 1123456,
    });
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("<i>exit code 1</i>");
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ title: "T", steps: STEPS, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
  });

  it("returns error when validateText fails", async () => {
    mocks.validateText.mockReturnValueOnce({
      code: "MESSAGE_TOO_LONG",
      message: "too long",
    });
    const result = await call({ title: "T", steps: STEPS, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_TOO_LONG");
  });

  it("auto-pins the message after sending (silent)", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 10, chat: { id: 1 }, date: 0 });
    await call({ title: "CI Pipeline", steps: STEPS, token: 1123456 });
    expect(mocks.pinChatMessage).toHaveBeenCalledWith(1, 10, { disable_notification: true });
  });

  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call({"title":"T","steps":[{"label":"a","status":"pending"}]});
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when identity has wrong suffix", async () => {
      mocks.validateSession.mockReturnValueOnce(false);
      const result = await call({"title":"T","steps":[{"label":"a","status":"pending"}],"token": 1099999});
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });

    it("proceeds when identity is valid", async () => {
      mocks.validateSession.mockReturnValueOnce(true);
      let code: string | undefined;
      try { code = errorCode(await call({"title":"T","steps":[{"label":"a","status":"pending"}],"token": 1099999})); } catch { /* gate passed, other error ok */ }
      expect(code).not.toBe("SID_REQUIRED");
      expect(code).not.toBe("AUTH_FAILED");
    });

  });
});

describe("update_checklist tool", () => {
  let update: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.pinChatMessage.mockResolvedValue(true);
    mocks.unpinChatMessage.mockResolvedValue(true);
    mocks.sendMessage.mockResolvedValue({ message_id: 99 });
    resetCompletionTrackingForTest();
    const server = createMockServer();
    register(server);
    update = server.getHandler("update_checklist");
  });

  it("edits in-place when message_id is provided", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const result = await update({ title: "CI Pipeline", steps: STEPS, message_id: 10, token: 1123456 });
    expect(isError(result)).toBe(false);
    expect((parseResult(result)).updated).toBe(true);
    expect(mocks.editMessageText).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("handles boolean editMessageText response (channel case)", async () => {
    mocks.editMessageText.mockResolvedValue(true);
    const result = await update({ title: "T", steps: STEPS, message_id: 42, token: 1123456 });
    expect(isError(result)).toBe(false);
    expect((parseResult(result)).message_id).toBe(42);
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await update({
      title: "T", steps: STEPS, message_id: 10, token: 1123456,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
  });

  it("returns error when validateText fails", async () => {
    mocks.validateText.mockReturnValueOnce({
      code: "MESSAGE_TOO_LONG",
      message: "too long",
    });
    const result = await update({
      title: "T", steps: STEPS, message_id: 10, token: 1123456,
    });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_TOO_LONG");
  });

  it("auto-unpins when all steps reach terminal status", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const terminalSteps = [
      { label: "Build", status: "done" },
      { label: "Lint", status: "failed" },
      { label: "Deploy", status: "skipped" },
    ];
    await update({ title: "CI", steps: terminalSteps, message_id: 10, token: 1123456 });
    expect(mocks.unpinChatMessage).toHaveBeenCalledWith(1, 10);
  });

  it("sends completion reply when all steps reach terminal status", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    mocks.sendMessage.mockResolvedValue({ message_id: 11 });
    const terminalSteps = [
      { label: "Build", status: "done" },
      { label: "Lint", status: "failed" },
      { label: "Deploy", status: "skipped" },
    ];
    await update({ title: "CI", steps: terminalSteps, message_id: 10, token: 1123456 });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      1,
      expect.stringMatching(/^🔴 Failed/),
      expect.objectContaining({ reply_to_message_id: 10, _skipHeader: true }),
    );
  });

  it("completion badge: all done → starts with ✅ Complete", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 20 });
    mocks.sendMessage.mockResolvedValue({ message_id: 21 });
    const allDoneSteps = [
      { label: "Build", status: "done" },
      { label: "Test", status: "done" },
    ];
    await update({ title: "CI", steps: allDoneSteps, message_id: 20, token: 1123456 });
    const badge = mocks.sendMessage.mock.calls[0][1] as string;
    expect(badge).toMatch(/^✅ Complete/);
  });

  it("completion badge: some failed → starts with 🔴 Failed", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 30 });
    mocks.sendMessage.mockResolvedValue({ message_id: 31 });
    const failedSteps = [
      { label: "Build", status: "done" },
      { label: "Test", status: "failed" },
    ];
    await update({ title: "CI", steps: failedSteps, message_id: 30, token: 1123456 });
    const badge = mocks.sendMessage.mock.calls[0][1] as string;
    expect(badge).toMatch(/^🔴 Failed/);
  });

  it("completion badge: some skipped (no failed) → starts with 🟡 Incomplete", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 40 });
    mocks.sendMessage.mockResolvedValue({ message_id: 41 });
    const skippedSteps = [
      { label: "Build", status: "done" },
      { label: "Deploy", status: "skipped" },
    ];
    await update({ title: "CI", steps: skippedSteps, message_id: 40, token: 1123456 });
    const badge = mocks.sendMessage.mock.calls[0][1] as string;
    expect(badge).toMatch(/^🟡 Incomplete/);
  });

  it("completion badge: failed + skipped → starts with 🔴 Failed", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 50 });
    mocks.sendMessage.mockResolvedValue({ message_id: 51 });
    const mixedSteps = [
      { label: "Build", status: "done" },
      { label: "Test", status: "failed" },
      { label: "Deploy", status: "skipped" },
    ];
    await update({ title: "CI", steps: mixedSteps, message_id: 50, token: 1123456 });
    const badge = mocks.sendMessage.mock.calls[0][1] as string;
    expect(badge).toMatch(/^🔴 Failed/);
  });

  it("does not send duplicate completion reply on repeated terminal updates", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const terminalSteps = [
      { label: "Build", status: "done" },
    ];
    await update({ title: "CI", steps: terminalSteps, message_id: 10, token: 1123456 });
    await update({ title: "CI", steps: terminalSteps, message_id: 10, token: 1123456 });
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not send completion reply when steps are not all terminal", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await update({ title: "CI Pipeline", steps: STEPS, message_id: 10, token: 1123456 });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("does not unpin when steps are still in progress", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await update({ title: "CI Pipeline", steps: STEPS, message_id: 10, token: 1123456 });
    expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
  });

  it("does not unpin when any step is still pending or running", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const mixedSteps = [
      { label: "Build", status: "done" },
      { label: "Test", status: "running" },
    ];
    await update({ title: "CI", steps: mixedSteps, message_id: 10, token: 1123456 });
    expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
  });
});
