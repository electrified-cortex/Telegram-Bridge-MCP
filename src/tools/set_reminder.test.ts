import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

import { createHash } from "crypto";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  addReminder: vi.fn(),
  getCallerSid: vi.fn(() => 1),
}));

vi.mock("../session-manager.js", () => ({
  validateSession: mocks.validateSession,
}));

vi.mock("../reminder-state.js", () => ({
  addReminder: mocks.addReminder,
  MAX_REMINDERS_PER_SESSION: 20,
  reminderContentHash: (text: string, recurring: boolean) =>
    createHash("sha256").update(`${text}\0${recurring}`).digest("hex").slice(0, 16),
}));

const stubStartupReminder = {
  id: "startup-id",
  text: "Check task board",
  delay_seconds: 0,
  recurring: false,
  trigger: "startup" as const,
  state: "startup" as const,
  created_at: Date.now(),
  activated_at: null,
};

import { register } from "./set_reminder.js";

describe("set_reminder tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  const stubReminder = {
    id: "test-id",
    text: "Check CI",
    delay_seconds: 0,
    recurring: false,
    trigger: "time" as const,
    state: "active" as const,
    created_at: Date.now(),
    activated_at: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.addReminder.mockReturnValue(stubReminder);
    const server = createMockServer();
    register(server);
    call = server.getHandler("set_reminder");
  });

  it("creates an immediate reminder and returns it", async () => {
    const result = await call({ text: "Check CI", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.text).toBe("Check CI");
    expect(data.state).toBe("active");
    expect(mocks.addReminder).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Check CI", delay_seconds: 0, recurring: false }),
    );
  });

  it("uses provided ID instead of UUID", async () => {
    mocks.addReminder.mockReturnValue({ ...stubReminder, id: "my-id" });
    await call({ text: "x", id: "my-id", token: 1123456 });
    expect(mocks.addReminder).toHaveBeenCalledWith(
      expect.objectContaining({ id: "my-id" }),
    );
  });

  it("uses content hash as default ID when none provided", async () => {
    await call({ text: "Check CI", token: 1123456 });
    const expectedHash = createHash("sha256")
      .update("Check CI\0false")
      .digest("hex")
      .slice(0, 16);
    expect(mocks.addReminder).toHaveBeenCalledWith(
      expect.objectContaining({ id: expectedHash }),
    );
  });

  it("passes delay_seconds and recurring through", async () => {
    mocks.addReminder.mockReturnValue({
      ...stubReminder,
      delay_seconds: 300,
      recurring: true,
      state: "deferred",
      activated_at: null,
    });
    const result = await call({ text: "later", delay_seconds: 300, recurring: true, token: 1123456 });
    const data = parseResult(result);
    expect(data.state).toBe("deferred");
    expect(data.fires_in_seconds).toBe(300);
  });

  it("returns LIMIT_EXCEEDED when addReminder throws", async () => {
    mocks.addReminder.mockImplementation(() => {
      throw new Error("Max reminders per session (20) reached");
    });
    const result = await call({ text: "overflow", token: 1123456 });
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.code).toBe("LIMIT_EXCEEDED");
  });

  describe("trigger parameter", () => {
    it("defaults trigger to 'time' when not specified", async () => {
      await call({ text: "default trigger", token: 1123456 });
      expect(mocks.addReminder).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: "time" }),
      );
    });

    it("passes trigger='startup' to addReminder", async () => {
      mocks.addReminder.mockReturnValue(stubStartupReminder);
      await call({ text: "Check task board", trigger: "startup", token: 1123456 });
      expect(mocks.addReminder).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: "startup" }),
      );
    });

    it("startup reminder result includes trigger and state=startup", async () => {
      mocks.addReminder.mockReturnValue(stubStartupReminder);
      const result = await call({ text: "Check task board", trigger: "startup", token: 1123456 });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.trigger).toBe("startup");
      expect(data.state).toBe("startup");
    });

    it("startup reminder does not include fires_in_seconds", async () => {
      mocks.addReminder.mockReturnValue(stubStartupReminder);
      const result = await call({ text: "Check task board", trigger: "startup", token: 1123456 });
      const data = parseResult(result);
      expect(data.fires_in_seconds).toBeUndefined();
    });

    it("startup trigger — delay_seconds is optional (omitting does not error)", async () => {
      mocks.addReminder.mockReturnValue(stubStartupReminder);
      // No delay_seconds provided
      const result = await call({ text: "no delay needed", trigger: "startup", token: 1123456 });
      expect(isError(result)).toBe(false);
    });

    it("time reminder result includes trigger='time'", async () => {
      const result = await call({ text: "Check CI", token: 1123456 });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.trigger).toBe("time");
    });
  });

  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call({ text: "x" });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED on invalid PIN", async () => {
      mocks.validateSession.mockReturnValue(false);
      const result = await call({ text: "x", token: 1000000 });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("AUTH_FAILED");
    });
  });
});
