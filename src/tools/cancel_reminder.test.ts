import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  cancelReminder: vi.fn(() => false),
}));

vi.mock("../session-manager.js", () => ({
  validateSession: mocks.validateSession,
}));

vi.mock("../reminder-state.js", () => ({
  cancelReminder: mocks.cancelReminder,
}));

import { register } from "./cancel_reminder.js";

describe("cancel_reminder tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("cancel_reminder");
  });

  it("cancels an existing reminder and returns { cancelled: true, id }", async () => {
    mocks.cancelReminder.mockReturnValue(true);
    const result = await call({ id: "r1", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.cancelled).toBe(true);
    expect(data.id).toBe("r1");
    expect(mocks.cancelReminder).toHaveBeenCalledWith("r1");
  });

  it("returns NOT_FOUND when reminder does not exist", async () => {
    mocks.cancelReminder.mockReturnValue(false);
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

    it("returns AUTH_FAILED on invalid PIN", async () => {
      mocks.validateSession.mockReturnValue(false);
      const result = await call({ id: "r1", token: 1000000 });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("AUTH_FAILED");
    });
  });
});
