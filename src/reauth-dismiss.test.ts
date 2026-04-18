/**
 * Tests for the auth hook auto-dismiss path:
 * When the auth hook fires (registered in index.ts via setAuthHook),
 * it should delete the stored reauth dialog message if one exists.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setAuthHook } from "./session-gate.js";

const mocks = vi.hoisted(() => ({
  touchSession: vi.fn(),
  getSessionReauthDialogMsgId: vi.fn<(sid: number) => number | undefined>().mockReturnValue(undefined),
  clearSessionReauthDialogMsgId: vi.fn(),
  validateSession: vi.fn().mockReturnValue(true),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  resolveChat: vi.fn<() => number | string>().mockReturnValue(100),
}));

vi.mock("./session-manager.js", () => ({
  touchSession: (sid: number) => mocks.touchSession(sid),
  getSessionReauthDialogMsgId: (sid: number) => mocks.getSessionReauthDialogMsgId(sid),
  clearSessionReauthDialogMsgId: (sid: number) => mocks.clearSessionReauthDialogMsgId(sid),
  validateSession: (sid: number, suffix: number) => mocks.validateSession(sid, suffix),
}));

vi.mock("./telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      deleteMessage: mocks.deleteMessage,
    }),
    resolveChat: () => mocks.resolveChat(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validateSession.mockReturnValue(true);
  mocks.resolveChat.mockReturnValue(100);
  mocks.getSessionReauthDialogMsgId.mockReturnValue(undefined);
});

afterEach(() => {
  setAuthHook(() => {});
});

describe("auth hook — reauth dialog auto-dismiss", () => {
  it("calls deleteMessage with stored msgId when auth hook fires and reauth dialog exists", async () => {
    // Wire up the same composite hook as index.ts
    setAuthHook((sid: number) => {
      mocks.touchSession(sid);
      const reauthMsgId = mocks.getSessionReauthDialogMsgId(sid);
      if (reauthMsgId !== undefined) {
        mocks.clearSessionReauthDialogMsgId(sid);
        const chatId = mocks.resolveChat();
        if (typeof chatId === "number") {
          void mocks.deleteMessage(chatId, reauthMsgId);
        }
      }
    });

    mocks.getSessionReauthDialogMsgId.mockReturnValue(999);
    mocks.resolveChat.mockReturnValue(42);

    // Simulate a successful auth by calling requireAuth with a valid token
    const { requireAuth } = await import("./session-gate.js");
    const sid = 3;
    const suffix = 456789;
    const token = sid * 1_000_000 + suffix;
    mocks.validateSession.mockReturnValue(true);

    const result = requireAuth(token);
    expect(result).toBe(sid);

    // Hook should have fired: deleteMessage called with chatId=42, msgId=999
    expect(mocks.deleteMessage).toHaveBeenCalledWith(42, 999);
    expect(mocks.clearSessionReauthDialogMsgId).toHaveBeenCalledWith(sid);
  });

  it("does NOT call deleteMessage when no reauth dialog is stored", async () => {
    setAuthHook((sid: number) => {
      mocks.touchSession(sid);
      const reauthMsgId = mocks.getSessionReauthDialogMsgId(sid);
      if (reauthMsgId !== undefined) {
        mocks.clearSessionReauthDialogMsgId(sid);
        const chatId = mocks.resolveChat();
        if (typeof chatId === "number") {
          void mocks.deleteMessage(chatId, reauthMsgId);
        }
      }
    });

    // No reauth dialog stored
    mocks.getSessionReauthDialogMsgId.mockReturnValue(undefined);

    const { requireAuth } = await import("./session-gate.js");
    const sid = 2;
    const suffix = 111111;
    const token = sid * 1_000_000 + suffix;
    mocks.validateSession.mockReturnValue(true);

    const result = requireAuth(token);
    expect(result).toBe(sid);

    expect(mocks.deleteMessage).not.toHaveBeenCalled();
    expect(mocks.clearSessionReauthDialogMsgId).not.toHaveBeenCalled();
  });

  it("does NOT call deleteMessage when resolveChat returns a non-number", async () => {
    setAuthHook((sid: number) => {
      mocks.touchSession(sid);
      const reauthMsgId = mocks.getSessionReauthDialogMsgId(sid);
      if (reauthMsgId !== undefined) {
        mocks.clearSessionReauthDialogMsgId(sid);
        const chatId = mocks.resolveChat();
        if (typeof chatId === "number") {
          void mocks.deleteMessage(chatId, reauthMsgId);
        }
      }
    });

    mocks.getSessionReauthDialogMsgId.mockReturnValue(777);
    mocks.resolveChat.mockReturnValue("CHAT_NOT_CONFIGURED");

    const { requireAuth } = await import("./session-gate.js");
    const sid = 4;
    const suffix = 222222;
    const token = sid * 1_000_000 + suffix;
    mocks.validateSession.mockReturnValue(true);

    const result = requireAuth(token);
    expect(result).toBe(sid);

    // clearSessionReauthDialogMsgId was still called (clear always happens before chat check)
    expect(mocks.clearSessionReauthDialogMsgId).toHaveBeenCalledWith(sid);
    // But deleteMessage must NOT be called when chatId is not a number
    expect(mocks.deleteMessage).not.toHaveBeenCalled();
  });
});
