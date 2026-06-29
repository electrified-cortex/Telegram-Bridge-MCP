import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { TelegramError } from "../../telegram.js";
import { createMockServer, parseResult, isError, errorCode } from "../test-utils.js";
import { testIdentityGate } from "../test-helpers/identity-gate.js";

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  editMessageText: vi.fn(),
  sendMessage: vi.fn(),
  unpinChatMessage: vi.fn(),
  resolveChat: vi.fn((): number | TelegramError => 1),
  validateText: vi.fn((): TelegramError | null => null),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deliverProgressStaleEvent: vi.fn((..._args: any[]) => true),
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
  deliverProgressStaleEvent: (sid: number, message_id: number, title: string, percent: number, stale_after_s: number) =>
    mocks.deliverProgressStaleEvent(sid, message_id, title, percent, stale_after_s),
}));

import { register } from "./update.js";
import { resetCompletionTrackingForTest, handleUpdateProgress } from "./update.js";
import { armStaleTimer, resetStaleTimer, resetStaleTimerStateForTest } from "./stale-timer.js";

describe("update_progress tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.unpinChatMessage.mockResolvedValue(true);
    mocks.sendMessage.mockResolvedValue({ message_id: 99 });
    resetCompletionTrackingForTest();
    const server = createMockServer();
    register(server);
    call = server.getHandler("update_progress");
  });

  it("edits message in-place and returns message_id", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const result = await call({ message_id: 10, percent: 75, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(10);
    expect(mocks.editMessageText).toHaveBeenCalledOnce();
  });

  it("renders updated bar with bold title", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 100, title: "Building", token: 1123456});
    const [, , text] = mocks.editMessageText.mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("<b>Building</b>");
    expect(text).toContain("▓▓▓▓▓▓▓▓▓▓  100%");
  });

  it("renders bar-only when no title", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 50, token: 1123456});
    const [, , text] = mocks.editMessageText.mock.calls[0] as [unknown, unknown, string];
    expect(text).not.toContain("<b>");
    expect(text).toContain("▓▓▓▓▓░░░░░  50%");
  });

  it("renders subtext when provided", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 50, subtext: "half done", token: 1123456});
    const [, , text] = mocks.editMessageText.mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("<i>half done</i>");
  });

  it("handles boolean result from editMessageText (Telegram unchanged)", async () => {
    mocks.editMessageText.mockResolvedValue(true);
    const result = await call({ message_id: 10, percent: 50, token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.message_id).toBe(10);
  });

  it("returns error when resolveChat fails", async () => {
    mocks.resolveChat.mockReturnValueOnce({
      code: "UNAUTHORIZED_CHAT",
      message: "no chat",
    });
    const result = await call({ message_id: 10, percent: 50, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("UNAUTHORIZED_CHAT");
  });

  it("returns error when validateText fails", async () => {
    mocks.validateText.mockReturnValueOnce({
      code: "MESSAGE_TOO_LONG",
      message: "too long",
    });
    const result = await call({ message_id: 10, percent: 50, token: 1123456});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("MESSAGE_TOO_LONG");
  });

  it("auto-unpins when percent reaches 100", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 100, token: 1123456 });
    expect(mocks.unpinChatMessage).toHaveBeenCalledWith(1, 10);
  });

  it("sends completion reply when percent reaches 100", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    mocks.sendMessage.mockResolvedValue({ message_id: 11 });
    await call({ message_id: 10, percent: 100, token: 1123456 });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      1,
      "✅ Complete",
      expect.objectContaining({ reply_parameters: { message_id: 10 }, _skipHeader: true }),
    );
  });

  it("does not send duplicate completion reply on repeated 100% updates", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 100, token: 1123456 });
    await call({ message_id: 10, percent: 100, token: 1123456 });
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not send completion reply when percent is less than 100", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 99, token: 1123456 });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("does not unpin when percent is less than 100", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    await call({ message_id: 10, percent: 99, token: 1123456 });
    expect(mocks.unpinChatMessage).not.toHaveBeenCalled();
  });

testIdentityGate((args) => call(args), mocks.validateSession, {"message_id":1,"percent":50});

});

// ─────────────────────────────────────────────────────────────────────────────
// Stale progress timer — unit tests (armStaleTimer direct)
// ─────────────────────────────────────────────────────────────────────────────

describe("stale progress timer — armStaleTimer direct", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.deliverProgressStaleEvent.mockClear();
    resetStaleTimerStateForTest();
  });

  afterEach(() => {
    resetStaleTimerStateForTest();
    vi.useRealTimers();
  });

  it("fires reminder after stale_after elapses with percent < 100", () => {
    armStaleTimer(42, 1, 60_000, "Deploying", 45);
    vi.advanceTimersByTime(59_000);
    expect(mocks.deliverProgressStaleEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000); // total: 61 s
    expect(mocks.deliverProgressStaleEvent).toHaveBeenCalledOnce();
    const callArgs = mocks.deliverProgressStaleEvent.mock.calls[0];
    expect(callArgs[0]).toBe(1);          // sid
    expect(callArgs[1]).toBe(42);         // message_id
    expect(callArgs[2]).toBe("Deploying"); // title
    expect(callArgs[3]).toBe(45);         // percent
    expect(callArgs[4]).toBe(60);         // stale_after_s
  });

  it("suppresses reminder when percent is 100 at fire time", () => {
    armStaleTimer(43, 1, 60_000, "Done Task", 100);
    vi.advanceTimersByTime(61_000);
    expect(mocks.deliverProgressStaleEvent).not.toHaveBeenCalled();
  });

  it("resetStaleTimer delays reminder by stale_after from the reset point", () => {
    armStaleTimer(44, 1, 60_000, "Building", 30);
    vi.advanceTimersByTime(30_000); // 30s elapsed
    resetStaleTimer(44, "Building", 60); // resets clock
    vi.advanceTimersByTime(30_000); // 30s since reset — NOT stale yet (need 60s)
    expect(mocks.deliverProgressStaleEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(31_000); // now 61s since reset — stale
    expect(mocks.deliverProgressStaleEvent).toHaveBeenCalledOnce();
  });

  it("fires only once — no repeat fire after the timer expires", () => {
    armStaleTimer(45, 1, 60_000, "Task", 50);
    vi.advanceTimersByTime(61_000);
    vi.advanceTimersByTime(61_000); // second interval — no second fire
    expect(mocks.deliverProgressStaleEvent).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stale progress timer — integration via handleUpdateProgress
// ─────────────────────────────────────────────────────────────────────────────

describe("stale progress timer — integration via handleUpdateProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.editMessageText.mockResolvedValue({ message_id: 55 });
    mocks.unpinChatMessage.mockResolvedValue(true);
    mocks.sendMessage.mockResolvedValue({ message_id: 99 });
    resetCompletionTrackingForTest();
    resetStaleTimerStateForTest();
  });

  afterEach(() => {
    resetStaleTimerStateForTest();
    vi.useRealTimers();
  });

  it("percent=100 clears the stale timer — no reminder fires", async () => {
    // Arm a stale timer manually so we can verify clearStaleTimer is called
    armStaleTimer(55, 1, 60_000, "Deploy", 50);
    // Update to 100% → should clear the timer
    await handleUpdateProgress({ message_id: 55, percent: 100, token: 1123456 });
    vi.advanceTimersByTime(120_000); // advance well past stale_after
    expect(mocks.deliverProgressStaleEvent).not.toHaveBeenCalled();
  });

  it("percent<100 resets the stale timer — fires after threshold from last update", async () => {
    // Arm a stale timer first
    armStaleTimer(55, 1, 60_000, "Deploy", 30);
    vi.advanceTimersByTime(30_000); // 30s elapsed
    // Update (non-100%) resets the clock
    await handleUpdateProgress({ message_id: 55, percent: 60, title: "Deploy", token: 1123456 });
    vi.advanceTimersByTime(35_000); // only 35s since last update — not stale yet
    expect(mocks.deliverProgressStaleEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(26_000); // now 61s since last update — stale
    expect(mocks.deliverProgressStaleEvent).toHaveBeenCalledOnce();
  });
});
