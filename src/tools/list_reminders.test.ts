import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";
import type { Reminder } from "../reminder-state.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  listReminders: vi.fn((): Reminder[] => []),
}));

vi.mock("../session-manager.js", () => ({
  validateSession: mocks.validateSession,
}));

vi.mock("../reminder-state.js", () => ({
  listReminders: mocks.listReminders,
}));

import { register } from "./list_reminders.js";

describe("list_reminders tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("list_reminders");
  });

  it("returns empty reminders list when none set", async () => {
    mocks.listReminders.mockReturnValue([]);
    const result = await call({ token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.reminders).toEqual([]);
  });

  it("returns active reminders without fires_in_seconds", async () => {
    const now = Date.now();
    mocks.listReminders.mockReturnValue([
      { id: "r1", text: "active!", delay_seconds: 0, recurring: false, trigger: "time", state: "active", created_at: now, activated_at: now },
    ]);
    const result = await call({ token: 1123456 });
    const data = parseResult<{ reminders: Record<string, unknown>[] }>(result);
    expect(data.reminders[0].fires_in_seconds).toBeUndefined();
  });

  it("includes fires_in_seconds for deferred reminders", async () => {
    const now = Date.now();
    mocks.listReminders.mockReturnValue([
      { id: "r2", text: "later", delay_seconds: 60, recurring: false, trigger: "time", state: "deferred", created_at: now, activated_at: null },
    ]);
    const result = await call({ token: 1123456 });
    const data = parseResult<{ reminders: Record<string, unknown>[] }>(result);
    expect(typeof data.reminders[0].fires_in_seconds).toBe("number");
    expect(data.reminders[0].fires_in_seconds as number).toBeGreaterThan(0);
    expect(data.reminders[0].fires_in_seconds as number).toBeLessThanOrEqual(60);
  });

  it("includes trigger field for each reminder", async () => {
    const now = Date.now();
    mocks.listReminders.mockReturnValue([
      { id: "r1", text: "timed", delay_seconds: 0, recurring: false, trigger: "time", state: "active", created_at: now, activated_at: now },
      { id: "r2", text: "startup", delay_seconds: 0, recurring: true, trigger: "startup", state: "startup", created_at: now, activated_at: null },
    ]);
    const result = await call({ token: 1123456 });
    const data = parseResult<{ reminders: Record<string, unknown>[] }>(result);
    expect(data.reminders[0].trigger).toBe("time");
    expect(data.reminders[1].trigger).toBe("startup");
  });

  it("startup reminders have state=startup in listing", async () => {
    const now = Date.now();
    mocks.listReminders.mockReturnValue([
      { id: "s1", text: "startup", delay_seconds: 0, recurring: false, trigger: "startup", state: "startup", created_at: now, activated_at: null },
    ]);
    const result = await call({ token: 1123456 });
    const data = parseResult<{ reminders: Record<string, unknown>[] }>(result);
    expect(data.reminders[0].state).toBe("startup");
    expect(data.reminders[0].fires_in_seconds).toBeUndefined();
  });

  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call({});
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED on invalid token", async () => {
      mocks.validateSession.mockReturnValue(false);
      const result = await call({ token: 1000000 });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("AUTH_FAILED");
    });
  });
});
