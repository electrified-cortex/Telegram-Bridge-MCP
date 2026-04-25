import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";
import type { Reminder } from "../reminder-state.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  sleepReminder: vi.fn((): Reminder | null => null),
}));

vi.mock("../session-manager.js", () => ({
  validateSession: mocks.validateSession,
}));

vi.mock("../reminder-state.js", () => ({
  sleepReminder: mocks.sleepReminder,
}));

import { register } from "./sleep_reminder.js";

const FUTURE_ISO = "2099-01-01T00:00:00Z";
const PAST_ISO = "2000-01-01T00:00:00Z";

const stubReminder: Reminder = {
  id: "r1",
  text: "Check CI",
  delay_seconds: 0,
  recurring: false,
  trigger: "time",
  state: "active",
  created_at: Date.now(),
  activated_at: Date.now(),
};

describe("sleep_reminder tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.sleepReminder.mockReturnValue({ ...stubReminder, sleep_until: Date.parse(FUTURE_ISO) });
    const server = createMockServer();
    register(server);
    call = server.getHandler("sleep_reminder");
  });

  it("puts a reminder to sleep and returns { sleeping: true, id, until }", async () => {
    const result = await call({ id: "r1", until: FUTURE_ISO, token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.sleeping).toBe(true);
    expect(data.id).toBe("r1");
    expect(typeof data.until).toBe("string");
    expect(mocks.sleepReminder).toHaveBeenCalledWith("r1", Date.parse(FUTURE_ISO));
  });

  it("returns sleeping: false when until is in the past (early wake)", async () => {
    mocks.sleepReminder.mockReturnValue({ ...stubReminder, sleep_until: Date.parse(PAST_ISO) });
    const result = await call({ id: "r1", until: PAST_ISO, token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.sleeping).toBe(false);
    expect(typeof data.note).toBe("string");
  });

  it("returns the until datetime as ISO-8601 in the response", async () => {
    const result = await call({ id: "r1", until: FUTURE_ISO, token: 1123456 });
    const data = parseResult(result);
    expect(data.until).toBe(new Date(Date.parse(FUTURE_ISO)).toISOString());
  });

  it("returns NOT_FOUND when reminder does not exist", async () => {
    mocks.sleepReminder.mockReturnValue(null);
    const result = await call({ id: "missing", until: FUTURE_ISO, token: 1123456 });
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.code).toBe("NOT_FOUND");
  });

  it("returns INVALID_PARAM for a non-ISO-8601 until string", async () => {
    const result = await call({ id: "r1", until: "not-a-date", token: 1123456 });
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.code).toBe("INVALID_PARAM");
    expect(mocks.sleepReminder).not.toHaveBeenCalled();
  });

  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call({ id: "r1", until: FUTURE_ISO });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED on invalid token", async () => {
      mocks.validateSession.mockReturnValue(false);
      const result = await call({ id: "r1", until: FUTURE_ISO, token: 1000000 });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("AUTH_FAILED");
    });
  });
});
