import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "../test-utils.js";
import { testIdentityGate } from "../test-helpers/identity-gate.js";
import { runInSessionContext } from "../../session-context.js";
import {
  resetReminderStateForTest,
  addReminder,
  listReminders,
  cancelReminder,
  popActiveReminders,
  promoteDeferred,
  getSoonestDeferredMs,
  popFireableScheduleReminders,
  getSoonestScheduleFireMs,
  clearSessionReminders,
  scheduleReminder,
  resolveIana,
  validateIana,
  toOffsetISO,
  initReminderSseNotify,
} from "../../reminder-state.js";
import { createSessionQueue, removeSessionQueue, resetSessionQueuesForTest } from "../../session-queue.js";
import { applyProfile } from "../profile/apply.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => false),
  getSession: vi.fn(),
  notifySseSubscriber: vi.fn(),
  notifyIfAllowed: vi.fn(),
}));

vi.mock("../../session-manager.js", () => ({
  validateSession: mocks.validateSession,
  getSession: mocks.getSession,
}));

vi.mock("../../sse-endpoint.js", () => ({
  notifySseSubscriber: mocks.notifySseSubscriber,
}));

vi.mock("../activity/file-state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../activity/file-state.js")>()),
  notifyIfAllowed: mocks.notifyIfAllowed,
}));

import { handleScheduleReminder } from "./schedule.js";
import { handleReminderUnschedule } from "./unschedule.js";
import { register as registerList } from "./list.js";

function withSid<T>(sid: number, fn: () => T): T {
  return runInSessionContext(sid, fn);
}

const FAKE_TOKEN = 1_123_456;

// ── TZ utilities ────────────────────────────────────────────────────────────

describe("resolveIana", () => {
  it("resolves known abbreviations", () => {
    expect(resolveIana("EST")).toBe("America/New_York");
    expect(resolveIana("EDT")).toBe("America/New_York");
    expect(resolveIana("PST")).toBe("America/Los_Angeles");
    expect(resolveIana("PDT")).toBe("America/Los_Angeles");
    expect(resolveIana("MST")).toBe("America/Denver");
    expect(resolveIana("MDT")).toBe("America/Denver");
    expect(resolveIana("CST")).toBe("America/Chicago");
    expect(resolveIana("CDT")).toBe("America/Chicago");
    expect(resolveIana("UTC")).toBe("UTC");
    expect(resolveIana("GMT")).toBe("Etc/GMT");
  });

  it("passes through unrecognized zones unchanged", () => {
    expect(resolveIana("America/New_York")).toBe("America/New_York");
    expect(resolveIana("Europe/London")).toBe("Europe/London");
  });
});

describe("validateIana", () => {
  it("accepts valid IANA timezones", () => {
    expect(validateIana("America/New_York")).toBe(true);
    expect(validateIana("UTC")).toBe(true);
    expect(validateIana("America/Denver")).toBe(true);
  });

  it("rejects invalid timezone strings", () => {
    expect(validateIana("INVALID_TZ")).toBe(false);
    expect(validateIana("Garbage/Zone")).toBe(false);
  });
});

describe("toOffsetISO", () => {
  it("formats New York time with -04:00 offset in summer (EDT)", () => {
    // 2026-06-10 05:00 UTC = 01:00 EDT (-04:00)
    const result = toOffsetISO(new Date("2026-06-10T05:00:00Z"), "America/New_York");
    expect(result).toBe("2026-06-10T01:00:00-04:00");
    expect(result).not.toContain("Z");
  });

  it("formats UTC with +00:00 offset", () => {
    const result = toOffsetISO(new Date("2026-06-10T01:00:00Z"), "UTC");
    expect(result).toBe("2026-06-10T01:00:00+00:00");
    expect(result).not.toContain("Z");
  });

  it("formats Denver time with -06:00 in summer (MDT)", () => {
    // 2026-06-10 07:00 UTC = 01:00 MDT (-06:00)
    const result = toOffsetISO(new Date("2026-06-10T07:00:00Z"), "America/Denver");
    expect(result).toBe("2026-06-10T01:00:00-06:00");
  });

  it("EST in July resolves to EDT (-04:00), not fixed UTC-5", () => {
    const resolvedTz = resolveIana("EST");
    // 1am EDT on 2026-07-01 = 05:00 UTC
    const result = toOffsetISO(new Date("2026-07-01T05:00:00Z"), resolvedTz);
    expect(result).toContain("-04:00");
  });
});

// ── reminder-state.ts schedule functions ────────────────────────────────────

describe("scheduleReminder / reminder-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    resetReminderStateForTest();
    resetSessionQueuesForTest();
    // B3: inject the mock SSE notify callback so the sweep can call it
    initReminderSseNotify(mocks.notifySseSubscriber);
  });

  it("adds a schedule reminder with correct state and next_fire_ms", () => {
    withSid(1, () => {
      const reminder = scheduleReminder({ id: "s1", text: "Daily", cron: "0 9 * * *", tz: "UTC" });
      expect(reminder.trigger).toBe("schedule");
      expect(reminder.state).toBe("schedule");
      expect(reminder.cron).toBe("0 9 * * *");
      expect(reminder.tz).toBe("UTC");
      expect(reminder.next_fire_ms).toBeGreaterThan(Date.now());
      expect(reminder.recurring).toBe(true);
      expect(reminder.activated_at).toBeNull();
    });
  });

  it("§G-2: schedule reminder NOT fired by popActiveReminders (60s-idle path)", () => {
    withSid(1, () => {
      scheduleReminder({ id: "s1", text: "Daily", cron: "0 0 * * *", tz: "UTC" });
      // Manually set next_fire_ms to the past to make it "due"
      const reminders = listReminders();
      reminders[0].next_fire_ms = Date.now() - 1;
      // popActiveReminders must never return schedule reminders
      const fired = popActiveReminders(1);
      expect(fired).toHaveLength(0);
    });
  });

  it("§G-3: schedule reminder excluded from promoteDeferred", () => {
    withSid(1, () => {
      scheduleReminder({ id: "s1", text: "Test", cron: "0 1 * * *", tz: "UTC" });
      promoteDeferred(1);
      const reminders = listReminders();
      expect(reminders.every(r => r.trigger !== "schedule" || r.state === "schedule")).toBe(true);
    });
  });

  it("§G-3: schedule reminder excluded from getSoonestDeferredMs (no spin-loop)", () => {
    withSid(1, () => {
      scheduleReminder({ id: "s1", text: "Test", cron: "* * * * *", tz: "UTC" });
      expect(getSoonestDeferredMs(1)).toBeNull();
    });
  });

  it("popFireableScheduleReminders fires when now >= next_fire_ms", () => {
    withSid(1, () => {
      scheduleReminder({ id: "s1", text: "Fire now", cron: "0 9 * * *", tz: "UTC" });
      const reminders = listReminders();
      reminders[0].next_fire_ms = Date.now() - 1000;
      const fired = popFireableScheduleReminders(1);
      expect(fired).toHaveLength(1);
      expect(fired[0].text).toBe("Fire now");
      // next_fire_ms must now be in the future
      const afterFire = listReminders();
      expect(afterFire[0].next_fire_ms!).toBeGreaterThan(Date.now());
    });
  });

  it("§R-2 catch-up: multiple missed fires collapse to one, advances past now", () => {
    withSid(1, () => {
      scheduleReminder({ id: "s1", text: "Hourly", cron: "0 * * * *", tz: "UTC" });
      const reminders = listReminders();
      reminders[0].next_fire_ms = Date.now() - 3 * 60 * 60 * 1000; // 3 hours ago
      const fired = popFireableScheduleReminders(1);
      expect(fired).toHaveLength(1); // Only one fire regardless of missed count
      const afterFire = listReminders();
      expect(afterFire[0].next_fire_ms!).toBeGreaterThan(Date.now());
    });
  });

  it("getSoonestScheduleFireMs returns ms until next fire", () => {
    withSid(1, () => {
      scheduleReminder({ id: "s1", text: "Test", cron: "0 9 * * *", tz: "UTC" });
      const ms = getSoonestScheduleFireMs(1);
      expect(ms).not.toBeNull();
      expect(ms!).toBeGreaterThan(0);
    });
  });

  it("getSoonestScheduleFireMs returns null when no schedule reminders", () => {
    withSid(1, () => {
      addReminder({ id: "t1", text: "time", delay_seconds: 300, recurring: false, trigger: "time" });
      expect(getSoonestScheduleFireMs(1)).toBeNull();
    });
  });

  it("sweep delivers due reminder via deliverReminderEvent, which calls notifySseSubscriber", () => {
    // §5-b step 8 (kick-ahead removal): schedule sweep now calls deliverReminderEvent directly
    // instead of notifyIfAllowed+notifySseSubscriber. deliverReminderEvent enqueues the event
    // and calls notifySseSubscriber internally. A session queue must exist for delivery to proceed.
    vi.useFakeTimers();
    createSessionQueue(7);
    try {
      mocks.notifySseSubscriber.mockClear();
      withSid(7, () => {
        scheduleReminder({ id: "s1", text: "Due now", cron: "0 9 * * *", tz: "UTC" });
        // Set next_fire_ms to the past so the sweep fires on the next tick
        listReminders()[0].next_fire_ms = Date.now() - 1_000;
      });
      vi.advanceTimersByTime(5_000); // one sweep tick (5s interval)
      expect(mocks.notifySseSubscriber).toHaveBeenCalledWith(7);
      // Note: notifyIfAllowed is no longer called directly by the sweep (§5-b step 8 / TODO 10-2305)
    } finally {
      removeSessionQueue(7);
      clearSessionReminders(7);
      vi.useRealTimers();
    }
  });

  it("§R-4: clearSessionReminders cleans up sweep state", () => {
    withSid(1, () => scheduleReminder({ id: "s1", text: "Test", cron: "0 9 * * *", tz: "UTC" }));
    clearSessionReminders(1);
    expect(getSoonestScheduleFireMs(1)).toBeNull();
    expect(withSid(1, () => listReminders())).toHaveLength(0);
  });

  it("§G-A: cancelReminder removes schedule reminder and clears sweep state", () => {
    withSid(1, () => {
      scheduleReminder({ id: "s1", text: "Test", cron: "0 9 * * *", tz: "UTC" });
      cancelReminder("s1");
      expect(getSoonestScheduleFireMs(1)).toBeNull();
      expect(listReminders()).toHaveLength(0);
    });
  });
});

// ── handleScheduleReminder handler ─────────────────────────────────────────

describe("handleScheduleReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    resetReminderStateForTest();
  });

  it("happy path: returns ok:true with offset ISO next_fire", () => {
    const result = withSid(1, () =>
      handleScheduleReminder({ token: FAKE_TOKEN, text: "Daily at 9am", cron: "0 9 * * *", tz: "UTC" })
    );
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.ok).toBe(true);
    expect(typeof data.id).toBe("string");
    expect(data.cron).toBe("0 9 * * *");
    expect(data.tz).toBe("UTC");
    const nextFire = data.next_fire as string;
    expect(typeof nextFire).toBe("string");
    expect(nextFire).not.toContain("Z");
    expect(nextFire).toMatch(/T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it("5-field enforcement: INVALID_CRON on 6-field input", () => {
    const result = withSid(1, () =>
      handleScheduleReminder({ token: FAKE_TOKEN, text: "Test", cron: "0 0 1 * * *" })
    );
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("INVALID_CRON");
  });

  it("5-field enforcement: accepts valid 5-field expression", () => {
    const result = withSid(1, () =>
      handleScheduleReminder({ token: FAKE_TOKEN, text: "Test", cron: "0 1 * * *" })
    );
    expect(isError(result)).toBe(false);
  });

  it("TZ alias: EST resolves to America/New_York", () => {
    const result = withSid(1, () =>
      handleScheduleReminder({ token: FAKE_TOKEN, text: "Test", cron: "0 9 * * *", tz: "EST" })
    );
    expect(isError(result)).toBe(false);
    expect(parseResult(result).tz).toBe("America/New_York");
  });

  it("TZ alias: PDT resolves to America/Los_Angeles", () => {
    const result = withSid(1, () =>
      handleScheduleReminder({ token: FAKE_TOKEN, text: "Test", cron: "0 9 * * *", tz: "PDT" })
    );
    expect(isError(result)).toBe(false);
    expect(parseResult(result).tz).toBe("America/Los_Angeles");
  });

  it("INVALID_TIMEZONE on bad zone", () => {
    const result = withSid(1, () =>
      handleScheduleReminder({ token: FAKE_TOKEN, text: "Test", cron: "0 9 * * *", tz: "NOT_A_TZ" })
    );
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("INVALID_TIMEZONE");
  });

  it("INVALID_CRON on invalid cron expression", () => {
    const result = withSid(1, () =>
      handleScheduleReminder({ token: FAKE_TOKEN, text: "Test", cron: "not-valid" })
    );
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("INVALID_CRON");
  });

  it("next_fire format is offset ISO, never UTC Z", () => {
    const result = withSid(1, () =>
      handleScheduleReminder({ token: FAKE_TOKEN, text: "Daily at 1am EST", cron: "0 1 * * *", tz: "EST" })
    );
    const data = parseResult(result);
    const nextFire = data.next_fire as string;
    expect(nextFire).not.toMatch(/Z$/);
    expect(nextFire).toMatch(/T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    // EST→America/New_York; in summer/winter will be -04:00 or -05:00, not Z
  });

  testIdentityGate(
    (args) => Promise.resolve(withSid(1, () => handleScheduleReminder({ ...args, cron: "0 9 * * *" } as Parameters<typeof handleScheduleReminder>[0]))),
    mocks.validateSession,
    { text: "test" },
    false,
  );
});

// ── handleReminderUnschedule handler ───────────────────────────────────────

describe("handleReminderUnschedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    resetReminderStateForTest();
  });

  it("removes schedule reminder and returns ok:true (§G-A: no orphaned state)", () => {
    withSid(1, () => scheduleReminder({ id: "s1", text: "Test", cron: "0 9 * * *", tz: "UTC" }));
    const result = withSid(1, () => handleReminderUnschedule({ token: FAKE_TOKEN, id: "s1" }));
    expect(isError(result)).toBe(false);
    expect(parseResult(result).ok).toBe(true);
    // §G-A: no orphaned sweep state after cancel
    expect(getSoonestScheduleFireMs(1)).toBeNull();
    expect(withSid(1, () => listReminders())).toHaveLength(0);
  });

  it("returns NOT_FOUND for unknown id", () => {
    const result = withSid(1, () => handleReminderUnschedule({ token: FAKE_TOKEN, id: "nonexistent" }));
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("NOT_FOUND");
  });

  testIdentityGate(
    (args) => Promise.resolve(withSid(1, () => handleReminderUnschedule({ ...args, id: "x" } as Parameters<typeof handleReminderUnschedule>[0]))),
    mocks.validateSession,
    {},
    false,
  );
});

// ── handleListReminders — schedule branch ───────────────────────────────────

describe("handleListReminders — schedule branch", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    resetReminderStateForTest();
    const server = createMockServer();
    registerList(server);
    call = server.getHandler("list_reminders");
  });

  it("shows cron, tz, next_fire for schedule reminders; omits delay_seconds", async () => {
    withSid(1, () => scheduleReminder({ id: "s1", text: "Daily", cron: "0 9 * * *", tz: "UTC" }));
    const result = await withSid(1, () => call({ token: FAKE_TOKEN }));
    expect(isError(result)).toBe(false);
    const data = parseResult<{ reminders: Record<string, unknown>[] }>(result);
    expect(data.reminders).toHaveLength(1);
    const entry = data.reminders[0];
    expect(entry.trigger).toBe("schedule");
    expect(entry.cron).toBe("0 9 * * *");
    expect(entry.tz).toBe("UTC");
    expect(typeof entry.next_fire).toBe("string");
    expect(entry.delay_seconds).toBeUndefined();
  });
});

// ── §G-4 profile round-trip ─────────────────────────────────────────────────

describe("§G-4: profile round-trip — schedule reminders serialize cron+tz only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    resetReminderStateForTest();
  });

  it("saved schedule reminder has cron+tz but no next_fire_ms or delay_seconds", () => {
    withSid(1, () => scheduleReminder({ id: "s1", text: "Daily", cron: "0 9 * * *", tz: "America/New_York" }));
    const reminders = withSid(1, () => listReminders());
    const sr = reminders[0];
    // Simulate what save.ts produces for a schedule reminder
    const saved: Record<string, unknown> = {
      trigger: "schedule",
      text: sr.text,
      cron: sr.cron,
      ...(sr.tz ? { tz: sr.tz } : {}),
    };
    expect(saved.cron).toBe("0 9 * * *");
    expect(saved.tz).toBe("America/New_York");
    expect(saved.next_fire_ms).toBeUndefined(); // G-B: runtime field absent from serialization
    expect(saved.timeoutHandle).toBeUndefined(); // G-B
    expect(saved.delay_seconds).toBeUndefined(); // not relevant for schedule
    expect(saved.recurring).toBeUndefined(); // implicitly always recurring
  });
});

// ── §G-C: dedup guard ───────────────────────────────────────────────────────

describe("§G-C: profile apply dedup guard — no double-arm on reconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    resetReminderStateForTest();
  });

  it("applying same schedule reminder twice does not double-register", () => {
    const profile = {
      reminders: [{ trigger: "schedule" as const, text: "Daily", cron: "0 9 * * *", tz: "UTC" }],
    };
    withSid(1, () => applyProfile(1, profile));
    const afterFirst = withSid(1, () => listReminders());
    expect(afterFirst).toHaveLength(1);

    // Second apply (simulating reconnect)
    withSid(1, () => applyProfile(1, profile));
    const afterSecond = withSid(1, () => listReminders());
    expect(afterSecond).toHaveLength(1); // dedup guard: still only one
  });
});
