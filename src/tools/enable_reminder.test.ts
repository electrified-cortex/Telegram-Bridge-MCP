import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";
import type { Reminder } from "../reminder-state.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  enableReminder: vi.fn((): Reminder | null => null),
}));

vi.mock("../session-manager.js", () => ({
  validateSession: mocks.validateSession,
}));

vi.mock("../reminder-state.js", () => ({
  enableReminder: mocks.enableReminder,
}));

import { register } from "./enable_reminder.js";

const stubReminder: Reminder = {
  id: "r1",
  text: "Check CI",
  delay_seconds: 0,
  recurring: false,
  trigger: "time",
  state: "active",
  created_at: Date.now(),
  activated_at: Date.now(),
  disabled: false,
};

describe("enable_reminder tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("enable_reminder");
  });

  it("enables a disabled reminder and returns { enabled: true, id, state }", async () => {
    mocks.enableReminder.mockReturnValue(stubReminder);
    const result = await call({ id: "r1", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.enabled).toBe(true);
    expect(data.id).toBe("r1");
    expect(data.state).toBe("active");
    expect(mocks.enableReminder).toHaveBeenCalledWith("r1");
  });

  it("is idempotent — enabling an already-active reminder succeeds", async () => {
    mocks.enableReminder.mockReturnValue({ ...stubReminder, disabled: false });
    const result = await call({ id: "r1", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.enabled).toBe(true);
  });

  it("returns NOT_FOUND when reminder does not exist", async () => {
    mocks.enableReminder.mockReturnValue(null);
    const result = await call({ id: "missing", token: 1123456 });
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.code).toBe("NOT_FOUND");
  });

  it("returns the underlying reminder state in the response", async () => {
    mocks.enableReminder.mockReturnValue({ ...stubReminder, state: "deferred" });
    const result = await call({ id: "r1", token: 1123456 });
    const data = parseResult(result);
    expect(data.state).toBe("deferred");
  });

  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call({ id: "r1" });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED on invalid token", async () => {
      mocks.validateSession.mockReturnValue(false);
      const result = await call({ id: "r1", token: 1000000 });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("AUTH_FAILED");
    });
  });
});
