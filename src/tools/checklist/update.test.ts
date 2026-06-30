import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { TelegramError } from "../../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "../test-utils.js";
import { testIdentityGate } from "../test-helpers/identity-gate.js";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deliverChecklistStaleEvent: vi.fn((..._args: any[]) => true),
}));

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => mocks,
    resolveChat: mocks.resolveChat,
    validateText: mocks.validateText,
  };
});

vi.mock("../../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

vi.mock("../../session-queue.js", () => ({
  deliverChecklistStaleEvent: (sid: number, message_id: number, title: string, pending_count: number, stale_after_s: number) =>
    mocks.deliverChecklistStaleEvent(sid, message_id, title, pending_count, stale_after_s),
}));

import { register, resetCompletionTrackingForTest, handleUpdateChecklist, handleSendNewChecklist } from "./update.js";
import { armStaleTimer, resetStaleTimer, resetStaleTimerStateForTest } from "./stale-timer.js";

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

  testIdentityGate((args) => call(args), mocks.validateSession, {"title":"T","steps":[{"label":"a","status":"pending"}]});
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

  it("completion badge: some skipped (no failed) → starts with ✅ Complete", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 40 });
    mocks.sendMessage.mockResolvedValue({ message_id: 41 });
    const skippedSteps = [
      { label: "Build", status: "done" },
      { label: "Deploy", status: "skipped" },
    ];
    await update({ title: "CI", steps: skippedSteps, message_id: 40, token: 1123456 });
    const badge = mocks.sendMessage.mock.calls[0][1] as string;
    expect(badge).toMatch(/^✅ Complete/);
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

  it("completion badge: all done → exact string '✅ Complete' with no summary line", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 60 });
    mocks.sendMessage.mockResolvedValue({ message_id: 61 });
    const allDoneSteps = [
      { label: "Build", status: "done" },
      { label: "Test", status: "done" },
    ];
    await update({ title: "CI", steps: allDoneSteps, message_id: 60, token: 1123456 });
    const badge = mocks.sendMessage.mock.calls[0][1] as string;
    expect(badge).toBe("✅ Complete");
  });

  it("completion badge: done + skipped → '✅ Complete (1 skipped)'", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 70 });
    mocks.sendMessage.mockResolvedValue({ message_id: 71 });
    const skippedSteps = [
      { label: "Build", status: "done" },
      { label: "Deploy", status: "skipped" },
    ];
    await update({ title: "CI", steps: skippedSteps, message_id: 70, token: 1123456 });
    const badge = mocks.sendMessage.mock.calls[0][1] as string;
    expect(badge).toBe("✅ Complete (1 skipped)");
  });

  it("completion badge: all steps skipped → '✅ Complete (2 skipped)'", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 75 });
    mocks.sendMessage.mockResolvedValue({ message_id: 76 });
    const allSkippedSteps = [
      { label: "Build", status: "skipped" },
      { label: "Deploy", status: "skipped" },
    ];
    await update({ title: "CI", steps: allSkippedSteps, message_id: 75, token: 1123456 });
    const badge = mocks.sendMessage.mock.calls[0][1] as string;
    expect(badge).toBe("✅ Complete (2 skipped)");
  });

  it("completion badge: any failed → exact string '🔴 Failed' (no count suffix)", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 80 });
    mocks.sendMessage.mockResolvedValue({ message_id: 81 });
    const failedSteps = [
      { label: "Build", status: "done" },
      { label: "Test", status: "failed" },
    ];
    await update({ title: "CI", steps: failedSteps, message_id: 80, token: 1123456 });
    const badge = mocks.sendMessage.mock.calls[0][1] as string;
    expect(badge).toBe("🔴 Failed");
  });

  it("completion badge: failed + skipped → '🔴 Failed' (failure takes priority)", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 90 });
    mocks.sendMessage.mockResolvedValue({ message_id: 91 });
    const mixedSteps = [
      { label: "Build", status: "done" },
      { label: "Test", status: "failed" },
      { label: "Deploy", status: "skipped" },
    ];
    await update({ title: "CI", steps: mixedSteps, message_id: 90, token: 1123456 });
    const badge = mocks.sendMessage.mock.calls[0][1] as string;
    expect(badge).toBe("🔴 Failed");
  });

  it("completion badge: no em-dash anywhere in output", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 100 });
    mocks.sendMessage.mockResolvedValue({ message_id: 101 });
    const steps = [
      { label: "Build", status: "done" },
      { label: "Test", status: "failed" },
      { label: "Deploy", status: "skipped" },
    ];
    await update({ title: "CI", steps, message_id: 100, token: 1123456 });
    const badge = mocks.sendMessage.mock.calls[0][1] as string;
    expect(badge).not.toContain("—");
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

  it("returns MISSING_REQUIRED_FIELD when title is undefined", async () => {
    const result = await handleUpdateChecklist({ title: undefined as unknown as string, message_id: 123, steps: [], token: 1123456 });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MISSING_REQUIRED_FIELD");
  });

  describe("response_format: compact", () => {
    it("compact: update_checklist omits updated:true from response", async () => {
      mocks.editMessageText.mockResolvedValue({ message_id: 10 });
      const result = await update({ title: "CI Pipeline", steps: STEPS, message_id: 10, token: 1123456, response_format: "compact" });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.message_id).toBe(10);
      expect(data.updated).toBeUndefined();
    });

    it("default: update_checklist includes updated:true", async () => {
      mocks.editMessageText.mockResolvedValue({ message_id: 10 });
      const result = await update({ title: "CI Pipeline", steps: STEPS, message_id: 10, token: 1123456, response_format: "default" });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.updated).toBe(true);
    });

    it("omitted response_format: update_checklist includes updated:true (backward compat)", async () => {
      mocks.editMessageText.mockResolvedValue({ message_id: 10 });
      const result = await update({ title: "CI Pipeline", steps: STEPS, message_id: 10, token: 1123456 });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.updated).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stale checklist timer — unit tests
// ─────────────────────────────────────────────────────────────────────────────

const PENDING_STEPS = [
  { label: "Build", status: "running" as const },
  { label: "Deploy", status: "pending" as const },
];

const TERMINAL_STEPS = [
  { label: "Build", status: "done" as const },
  { label: "Deploy", status: "skipped" as const },
];

describe("stale checklist timer — armStaleTimer direct", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.deliverChecklistStaleEvent.mockClear();
    resetStaleTimerStateForTest();
  });

  afterEach(() => {
    resetStaleTimerStateForTest();
    vi.useRealTimers();
  });

  it("fires reminder after stale_after elapses with non-terminal steps", () => {
    armStaleTimer(42, 1, 60_000, "My Task", PENDING_STEPS);
    vi.advanceTimersByTime(59_000);
    expect(mocks.deliverChecklistStaleEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000); // total: 61 s
    expect(mocks.deliverChecklistStaleEvent).toHaveBeenCalledOnce();
    const callArgs = mocks.deliverChecklistStaleEvent.mock.calls[0];
    expect(callArgs[0]).toBe(1);  // sid
    expect(callArgs[1]).toBe(42); // message_id
    expect(callArgs[2]).toBe("My Task"); // title
    expect(callArgs[3]).toBe(2);  // pending_count
  });

  it("suppresses reminder when all steps are terminal at fire time", () => {
    armStaleTimer(43, 1, 60_000, "Done Task", TERMINAL_STEPS);
    vi.advanceTimersByTime(61_000);
    expect(mocks.deliverChecklistStaleEvent).not.toHaveBeenCalled();
  });

  it("resetStaleTimer delays reminder by stale_after from the reset point", () => {
    armStaleTimer(44, 1, 60_000, "Active Task", PENDING_STEPS);
    vi.advanceTimersByTime(30_000); // 30s elapsed
    resetStaleTimer(44, "Active Task", PENDING_STEPS); // resets clock
    vi.advanceTimersByTime(30_000); // 30s since reset — NOT stale yet (need 60s)
    expect(mocks.deliverChecklistStaleEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(31_000); // now 61s since reset — stale
    expect(mocks.deliverChecklistStaleEvent).toHaveBeenCalledOnce();
  });

  it("nags RECURRINGLY — re-fires each interval until fixed (e.g. 10 min, then 20 min, …)", () => {
    armStaleTimer(45, 1, 60_000, "Task", PENDING_STEPS);
    vi.advanceTimersByTime(61_000); // first nag ("minute 10")
    expect(mocks.deliverChecklistStaleEvent).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000); // second interval, still not fixed ("minute 20")
    expect(mocks.deliverChecklistStaleEvent).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000); // keeps nagging while unfixed
    expect(mocks.deliverChecklistStaleEvent).toHaveBeenCalledTimes(3);
  });

  it("stops nagging once the checklist is updated to all-terminal", () => {
    armStaleTimer(46, 1, 60_000, "Task", PENDING_STEPS);
    vi.advanceTimersByTime(61_000); // first nag
    expect(mocks.deliverChecklistStaleEvent).toHaveBeenCalledTimes(1);
    resetStaleTimer(46, "Task", TERMINAL_STEPS); // checklist finished via update
    vi.advanceTimersByTime(61_000); // fire sees all-terminal → suppress + stop
    vi.advanceTimersByTime(180_000); // really stopped — no further nags
    expect(mocks.deliverChecklistStaleEvent).toHaveBeenCalledTimes(1);
  });

  it("a modification resets the nag clock (no nag until a fresh interval elapses)", () => {
    armStaleTimer(47, 1, 60_000, "Task", PENDING_STEPS);
    vi.advanceTimersByTime(61_000); // first nag fires
    expect(mocks.deliverChecklistStaleEvent).toHaveBeenCalledTimes(1);
    resetStaleTimer(47, "Task", PENDING_STEPS); // agent touched it (still pending)
    vi.advanceTimersByTime(59_000); // not yet stale since the reset
    expect(mocks.deliverChecklistStaleEvent).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000); // 61s since reset → next nag
    expect(mocks.deliverChecklistStaleEvent).toHaveBeenCalledTimes(2);
  });
});

describe("stale checklist timer — integration via handleSendNewChecklist", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.pinChatMessage.mockResolvedValue(true);
    mocks.unpinChatMessage.mockResolvedValue(true);
    resetCompletionTrackingForTest();
    resetStaleTimerStateForTest();
  });

  afterEach(() => {
    resetStaleTimerStateForTest();
    vi.useRealTimers();
  });

  it("stale_after not set → no timer, no reminder ever fires", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 10, chat: { id: 1 }, date: 0 });
    await handleSendNewChecklist({ title: "CI", steps: PENDING_STEPS, token: 1123456 });
    vi.advanceTimersByTime(120_000);
    expect(mocks.deliverChecklistStaleEvent).not.toHaveBeenCalled();
  });

  it("stale_after set → reminder fires after stale_after elapses", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 42, chat: { id: 1 }, date: 0 });
    await handleSendNewChecklist({
      title: "CI Pipeline",
      steps: PENDING_STEPS,
      token: 1123456,
      stale_after: 60,
    });
    vi.advanceTimersByTime(59_000);
    expect(mocks.deliverChecklistStaleEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000); // 61s total
    expect(mocks.deliverChecklistStaleEvent).toHaveBeenCalledOnce();
    const callArgs = mocks.deliverChecklistStaleEvent.mock.calls[0];
    expect(callArgs[1]).toBe(42);          // message_id
    expect(callArgs[2]).toBe("CI Pipeline"); // title
    expect(callArgs[3]).toBe(2);           // pending_count
    expect(typeof callArgs[0]).toBe("number"); // sid
  });

  it("handleUpdateChecklist resets the stale timer", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 55, chat: { id: 1 }, date: 0 });
    mocks.editMessageText.mockResolvedValue({ message_id: 55 });
    await handleSendNewChecklist({
      title: "Long Task",
      steps: PENDING_STEPS,
      token: 1123456,
      stale_after: 60,
    });
    vi.advanceTimersByTime(30_000); // 30s elapsed
    // Update resets the clock
    await handleUpdateChecklist({ title: "Long Task", steps: PENDING_STEPS, message_id: 55, token: 1123456 });
    vi.advanceTimersByTime(35_000); // only 35s since last update — not stale
    expect(mocks.deliverChecklistStaleEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(26_000); // now 61s since last update — stale
    expect(mocks.deliverChecklistStaleEvent).toHaveBeenCalledOnce();
  });

  it("handleUpdateChecklist with all-terminal steps clears the stale timer", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 66, chat: { id: 1 }, date: 0 });
    mocks.editMessageText.mockResolvedValue({ message_id: 66 });
    await handleSendNewChecklist({
      title: "Finishing Task",
      steps: PENDING_STEPS,
      token: 1123456,
      stale_after: 60,
    });
    // Update to all-terminal — timer should be cleared
    await handleUpdateChecklist({ title: "Finishing Task", steps: TERMINAL_STEPS, message_id: 66, token: 1123456 });
    vi.advanceTimersByTime(120_000); // advance well past stale_after
    expect(mocks.deliverChecklistStaleEvent).not.toHaveBeenCalled();
  });
});
