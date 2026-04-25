import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";
import type { Reminder } from "../reminder-state.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  disableReminder: vi.fn((): Reminder | null => null),
}));

vi.mock("../session-manager.js", () => ({
  validateSession: mocks.validateSession,
}));

vi.mock("../reminder-state.js", () => ({
  disableReminder: mocks.disableReminder,
}));

import { register } from "./disable_reminder.js";

const stubReminder: Reminder = {
  id: "r1",
  text: "Check CI",
  delay_seconds: 0,
  recurring: false,
  trigger: "time",
  state: "active",
  created_at: Date.now(),
  activated_at: Date.now(),
  disabled: true,
};

describe("disable_reminder tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("disable_reminder");
  });

  it("disables an existing reminder and returns { disabled: true, id }", async () => {
    mocks.disableReminder.mockReturnValue(stubReminder);
    const result = await call({ id: "r1", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.disabled).toBe(true);
    expect(data.id).toBe("r1");
    expect(mocks.disableReminder).toHaveBeenCalledWith("r1");
  });

  it("is idempotent — disabling an already-disabled reminder succeeds", async () => {
    mocks.disableReminder.mockReturnValue({ ...stubReminder, disabled: true });
    const result = await call({ id: "r1", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.disabled).toBe(true);
  });

  it("returns NOT_FOUND when reminder does not exist", async () => {
    mocks.disableReminder.mockReturnValue(null);
    const result = await call({ id: "missing", token: 1123456 });
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.code).toBe("NOT_FOUND");
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
