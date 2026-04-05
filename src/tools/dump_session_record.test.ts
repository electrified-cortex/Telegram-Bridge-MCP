import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, isError, errorCode } from "./test-utils.js";

// ── dump_session_record (V4 — local log roll, no Telegram file send) ──────────

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  rollLog: vi.fn((): string | null => null),
  sendServiceMessage: vi.fn(() => Promise.resolve()),
}));

vi.mock("../local-log.js", () => ({
  rollLog: mocks.rollLog,
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    sendServiceMessage: mocks.sendServiceMessage,
  };
});

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => 0,
  getActiveSession: () => 0,
  validateSession: mocks.validateSession,
}));

import { register as registerDump } from "./dump_session_record.js";

describe("dump_session_record tool (V4 — local log)", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  const getText = (result: unknown) =>
    (result as { content: { text: string }[] }).content[0].text;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.rollLog.mockReturnValue(null);
    const server = createMockServer();
    registerDump(server);
    call = server.getHandler("dump_session_record");
  });

  it("returns 'nothing to roll' when no events buffered", async () => {
    mocks.rollLog.mockReturnValue(null);
    const text = getText(await call({ token: 1123456 }));
    const parsed = JSON.parse(text) as { filename: null; message: string };
    expect(parsed.filename).toBeNull();
    expect(parsed.message).toContain("No events");
  });

  it("returns filename when log was rolled", async () => {
    mocks.rollLog.mockReturnValue("2025-04-05T143022.json");
    const text = getText(await call({ token: 1123456 }));
    const parsed = JSON.parse(text) as { filename: string; message: string };
    expect(parsed.filename).toBe("2025-04-05T143022.json");
    expect(parsed.message).toContain("get_log");
  });

  it("emits service notification with filename after roll", async () => {
    mocks.rollLog.mockReturnValue("2025-04-05T143022.json");
    await call({ token: 1123456 });
    // sendServiceMessage is called async (void), so allow microtask to settle
    await Promise.resolve();
    expect(mocks.sendServiceMessage).toHaveBeenCalledWith(
      expect.stringContaining("2025-04-05T143022.json")
    );
  });

  it("does not call sendServiceMessage when nothing was rolled", async () => {
    mocks.rollLog.mockReturnValue(null);
    await call({ token: 1123456 });
    await Promise.resolve();
    expect(mocks.sendServiceMessage).not.toHaveBeenCalled();
  });

  it("does not error with valid token", async () => {
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
      const result = await call({ token: 1099999 });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });

    it("proceeds when identity is valid", async () => {
      mocks.validateSession.mockReturnValueOnce(true);
      let code: string | undefined;
      try { code = errorCode(await call({ token: 1099999 })); } catch { /* gate passed, other error ok */ }
      expect(code).not.toBe("SID_REQUIRED");
      expect(code).not.toBe("AUTH_FAILED");
    });
  });
});
