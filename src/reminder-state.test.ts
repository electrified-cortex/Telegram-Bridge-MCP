import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  addReminder,
  cancelReminder,
  listReminders,
  getActiveReminders,
  getStartupReminders,
  getFireableStartupReminders,
  fireStartupReminders,
  promoteDeferred,
  popActiveReminders,
  getSoonestDeferredMs,
  buildReminderEvent,
  clearSessionReminders,
  resetReminderStateForTest,
  MAX_REMINDERS_PER_SESSION,
  reminderContentHash,
  disableReminder,
  enableReminder,
  sleepReminder,
  computeReminderDisplayState,
  recordLastSentAt,
  recordLastReceivedAt,
  getLastSentAt,
  getLastReceivedAt,
  getFireableEventReminders,
  popFireableEventReminders,
  getSoonestEventReminderMs,
  scheduleReminder,
  restartActiveSweepForTest,
  setReminderFireCallback,
  getScheduleSidsForTest,
} from "./reminder-state.js";
import { runInSessionContext } from "./session-context.js";
import { deliverReminderEvent } from "./session-queue.js";
import { isDequeueActive } from "./tools/activity/file-state.js";

// §5-b sweep tests: mock dependencies so fake-timer tests stay self-contained
vi.mock("./session-queue.js", () => ({
  deliverReminderEvent: vi.fn(),
}));
vi.mock("./tools/activity/file-state.js", () => ({
  isDequeueActive: vi.fn(),
}));

describe("reminder-state", () => {
  beforeEach(() => { resetReminderStateForTest(); });

  describe("addReminder", () => {
    it("adds an immediate reminder as active", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "r1", text: "hello", delay_seconds: 0, recurring: false });
        expect(r.state).toBe("active");
        expect(r.activated_at).not.toBeNull();
        expect(listReminders()).toHaveLength(1);
      });
    });

    it("adds a deferred reminder when delay_seconds > 0", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "r2", text: "later", delay_seconds: 60, recurring: false });
        expect(r.state).toBe("deferred");
        expect(r.activated_at).toBeNull();
      });
    });

    it("throws when MAX_REMINDERS_PER_SESSION is reached", () => {
      runInSessionContext(1, () => {
        for (let i = 0; i < MAX_REMINDERS_PER_SESSION; i++) {
          addReminder({ id: `r${i}`, text: "x", delay_seconds: 0, recurring: false });
        }
        expect(() => {
          addReminder({ id: "overflow", text: "too many", delay_seconds: 0, recurring: false });
        }).toThrow();
      });
    });
  });

  describe("cancelReminder", () => {
    it("removes a reminder by ID", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        expect(cancelReminder("r1")).toBe(true);
        expect(listReminders()).toHaveLength(0);
      });
    });

    it("returns false if ID not found", () => {
      runInSessionContext(1, () => {
        expect(cancelReminder("missing")).toBe(false);
      });
    });
  });

  describe("promoteDeferred", () => {
    it("promotes a deferred reminder when delay has elapsed", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        // Artificially make it deferred by mutation for this test
        r.state = "deferred";
        r.created_at = Date.now() - 5000; // pretend 5s ago with delay=1s
        r.delay_seconds = 1;
        r.activated_at = null;
        promoteDeferred(1);
        const list = listReminders();
        expect(list[0].state).toBe("active");
        expect(list[0].activated_at).not.toBeNull();
      });
    });

    it("does not promote a deferred reminder whose delay has not elapsed", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 3600, recurring: false });
        promoteDeferred(1);
        expect(listReminders()[0].state).toBe("deferred");
      });
    });
  });

  describe("deferred → fire at fires_in_seconds=0 (regression: bug-bridge-reminder-fire-failure)", () => {
    it("reminder stays deferred before promoteDeferred even at fires_in_seconds=0", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "pickup-test", text: "pickup", delay_seconds: 60, recurring: false });
        // Simulate delay elapsed: created 2 minutes ago, delay=60s → overdue
        r.created_at = Date.now() - 120_000;
        // fires_in_seconds=0 — delay is elapsed, but state is still deferred
        expect(getSoonestDeferredMs(1)).toBe(0);
        expect(listReminders()[0].state).toBe("deferred");
      });
    });

    it("promoteDeferred transitions a fires_in_seconds=0 reminder to active", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "pickup-test", text: "pickup", delay_seconds: 60, recurring: false });
        r.created_at = Date.now() - 120_000; // overdue by 1 minute
        promoteDeferred(1);
        const list = listReminders();
        expect(list[0].state).toBe("active");
        expect(list[0].activated_at).not.toBeNull();
      });
    });

    it("full deferred → fire path: elapsed reminder becomes active and fires via popActiveReminders", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "pickup-test", text: "pickup-lenora-230", delay_seconds: 9000, recurring: false });
        // Simulate: 9000s have elapsed since creation (fires_in_seconds=0)
        r.created_at = Date.now() - 9000_000;
        expect(r.state).toBe("deferred");
        expect(getSoonestDeferredMs(1)).toBe(0);
        // After promoteDeferred (called by dequeue), reminder becomes active
        promoteDeferred(1);
        expect(listReminders()[0].state).toBe("active");
        expect(getActiveReminders(1)).toHaveLength(1);
        // Fires via popActiveReminders (triggered by dequeue idle threshold)
        const fired = popActiveReminders(1);
        expect(fired).toHaveLength(1);
        expect(fired[0].id).toBe("pickup-test");
        expect(fired[0].text).toBe("pickup-lenora-230");
        // One-shot: removed after firing
        expect(listReminders()).toHaveLength(0);
      });
    });

    it("recurring elapsed reminder re-arms to deferred after firing", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "recurring-test", text: "recurring pickup", delay_seconds: 3600, recurring: true });
        r.created_at = Date.now() - 7200_000; // 2 hours ago, delay=1hr → elapsed
        promoteDeferred(1);
        expect(listReminders()[0].state).toBe("active");
        const fired = popActiveReminders(1);
        expect(fired).toHaveLength(1);
        // Re-armed as deferred with a fresh timer
        const remaining = listReminders();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].state).toBe("deferred");
        expect(remaining[0].delay_seconds).toBe(3600);
      });
    });
  });

  describe("getActiveReminders", () => {
    it("returns only active reminders for the given sid", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "a", text: "active", delay_seconds: 0, recurring: false });
        addReminder({ id: "d", text: "deferred", delay_seconds: 3600, recurring: false });
      });
      const active = getActiveReminders(1);
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe("a");
    });
  });

  describe("popActiveReminders", () => {
    it("removes and returns active one-shot reminders", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "once", delay_seconds: 0, recurring: false });
      });
      const popped = popActiveReminders(1);
      expect(popped).toHaveLength(1);
      expect(popped[0].id).toBe("r1");
      expect(getActiveReminders(1)).toHaveLength(0);
    });

    it("re-arms a recurring reminder with delay into deferred state", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "repeat", delay_seconds: 60, recurring: true });
        // Manually promote
        const r = listReminders()[0];
        r.state = "active";
        r.activated_at = Date.now();
      });
      popActiveReminders(1);
      runInSessionContext(1, () => {
        const list = listReminders();
        expect(list).toHaveLength(1);
        expect(list[0].state).toBe("deferred");
      });
    });

    it("re-arms a recurring reminder without delay as still active", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "repeat immediately", delay_seconds: 0, recurring: true });
      });
      const before = popActiveReminders(1);
      expect(before).toHaveLength(1);
      runInSessionContext(1, () => {
        const after = listReminders();
        expect(after).toHaveLength(1);
        expect(after[0].state).toBe("active");
      });
    });

    it("returns empty array when no active reminders", () => {
      expect(popActiveReminders(99)).toHaveLength(0);
    });
  });

  describe("getSoonestDeferredMs", () => {
    it("returns null when no deferred reminders", () => {
      expect(getSoonestDeferredMs(1)).toBeNull();
    });

    it("returns approximate ms to soonest deferred reminder", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "r1", text: "x", delay_seconds: 30, recurring: false });
        // created_at is ~now, delay_seconds=30 → fires in ~30s
        const ms = getSoonestDeferredMs(1);
        expect(ms).toBeGreaterThan(0);
        expect(ms).toBeLessThanOrEqual(30_000);
        void r;
      });
    });

    it("returns 0 when delay has already elapsed", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 1, recurring: false });
        const r = listReminders()[0];
        r.created_at = Date.now() - 5000; // 5s ago, delay=1s → overdue
        const ms = getSoonestDeferredMs(1);
        expect(ms).toBe(0);
      });
    });
  });

  describe("per-session isolation", () => {
    it("sessions do not share reminders", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "s1", delay_seconds: 0, recurring: false });
      });
      runInSessionContext(2, () => {
        addReminder({ id: "r2", text: "s2", delay_seconds: 0, recurring: false });
      });
      expect(getActiveReminders(1).map(r => r.id)).toEqual(["r1"]);
      expect(getActiveReminders(2).map(r => r.id)).toEqual(["r2"]);
    });
  });

  describe("clearSessionReminders", () => {
    it("removes all reminders for a session", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
      });
      clearSessionReminders(1);
      expect(getActiveReminders(1)).toHaveLength(0);
    });
  });

  describe("buildReminderEvent", () => {
    it("builds a well-formed synthetic reminder event", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "ci-1", text: "Check CI", delay_seconds: 0, recurring: false });
        const evt = buildReminderEvent(r);
        expect(evt.event).toBe("reminder");
        expect(evt.from).toBe("system");
        expect(evt.routing).toBe("ambiguous");
        const content = evt.content as Record<string, unknown>;
        expect(content.type).toBe("reminder");
        expect(content.text).toBe("Check CI");
        expect(content.reminder_id).toBe("ci-1");
        expect(content.recurring).toBe(false);
        expect(typeof evt.id).toBe("number");
        expect((evt.id)).toBeLessThan(0);
      });
    });

    it("assigns unique IDs to consecutive events", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "x", text: "x", delay_seconds: 0, recurring: false });
        const e1 = buildReminderEvent(r);
        const e2 = buildReminderEvent(r);
        expect(e1.id).not.toBe(e2.id);
      });
    });

    it("includes trigger in the event content", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "s1", text: "Startup reminder", delay_seconds: 0, recurring: false, trigger: "startup" });
        const evt = buildReminderEvent(r);
        const content = evt.content as Record<string, unknown>;
        expect(content.trigger).toBe("startup");
      });
    });
  });

  describe("startup reminders", () => {
    it("adds a startup reminder with state=startup", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "s1", text: "on startup", delay_seconds: 0, recurring: false, trigger: "startup" });
        expect(r.state).toBe("startup");
        expect(r.trigger).toBe("startup");
        expect(r.activated_at).toBeNull();
      });
    });

    it("startup reminder does NOT appear in getActiveReminders", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "s1", text: "on startup", delay_seconds: 0, recurring: false, trigger: "startup" });
      });
      expect(getActiveReminders(1)).toHaveLength(0);
    });

    it("getStartupReminders returns startup reminders", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "s1", text: "on startup", delay_seconds: 0, recurring: false, trigger: "startup" });
        addReminder({ id: "t1", text: "timed", delay_seconds: 0, recurring: false });
      });
      const startup = getStartupReminders(1);
      expect(startup).toHaveLength(1);
      expect(startup[0].id).toBe("s1");
    });

    it("fireStartupReminders — one-shot: fires and is removed", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "s1", text: "once", delay_seconds: 0, recurring: false, trigger: "startup" });
      });
      const fired = fireStartupReminders(1);
      expect(fired).toHaveLength(1);
      expect(fired[0].id).toBe("s1");
      expect(getStartupReminders(1)).toHaveLength(0);
    });

    it("fireStartupReminders — recurring: fires and persists", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "s2", text: "every start", delay_seconds: 0, recurring: true, trigger: "startup" });
      });
      const fired = fireStartupReminders(1);
      expect(fired).toHaveLength(1);
      expect(fired[0].id).toBe("s2");
      // Recurring startup reminder should still be in the list
      expect(getStartupReminders(1)).toHaveLength(1);
    });

    it("fireStartupReminders — returns empty when no startup reminders", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "t1", text: "timed", delay_seconds: 0, recurring: false });
      });
      const fired = fireStartupReminders(1);
      expect(fired).toHaveLength(0);
    });

    it("fireStartupReminders — does not fire time-trigger reminders", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "t1", text: "timed", delay_seconds: 0, recurring: false, trigger: "time" });
        addReminder({ id: "s1", text: "startup", delay_seconds: 0, recurring: false, trigger: "startup" });
      });
      const fired = fireStartupReminders(1);
      expect(fired).toHaveLength(1);
      expect(fired[0].id).toBe("s1");
      // Time reminder should remain
      expect(getActiveReminders(1)).toHaveLength(1);
    });

    it("startup reminder — timeout is not required (delay_seconds defaults to 0)", () => {
      runInSessionContext(1, () => {
        // No delay_seconds provided — should not throw
        expect(() => {
          addReminder({ id: "s1", text: "no delay required", delay_seconds: 0, recurring: false, trigger: "startup" });
        }).not.toThrow();
      });
    });

    it("listReminders includes startup reminders with trigger field", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "s1", text: "startup", delay_seconds: 0, recurring: true, trigger: "startup" });
        addReminder({ id: "t1", text: "timed", delay_seconds: 60, recurring: false, trigger: "time" });
        const list = listReminders();
        const startup = list.find(r => r.id === "s1");
        const timed = list.find(r => r.id === "t1");
        expect(startup?.trigger).toBe("startup");
        expect(timed?.trigger).toBe("time");
      });
    });

    it("behavior matrix: trigger=time recurring=false fires once then deleted (existing behavior)", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "t1", text: "once timed", delay_seconds: 0, recurring: false, trigger: "time" });
      });
      const popped = popActiveReminders(1);
      expect(popped).toHaveLength(1);
      expect(getActiveReminders(1)).toHaveLength(0);
    });

    it("behavior matrix: trigger=time recurring=true fires and re-arms", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "t2", text: "recurring timed", delay_seconds: 0, recurring: true, trigger: "time" });
      });
      popActiveReminders(1);
      runInSessionContext(1, () => {
        expect(listReminders()).toHaveLength(1);
      });
    });

    it("behavior matrix: trigger=startup recurring=false fires once then deleted", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "s1", text: "once startup", delay_seconds: 0, recurring: false, trigger: "startup" });
      });
      const fired = fireStartupReminders(1);
      expect(fired).toHaveLength(1);
      expect(getStartupReminders(1)).toHaveLength(0);
    });

    it("behavior matrix: trigger=startup recurring=true fires every session start", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "s2", text: "every startup", delay_seconds: 0, recurring: true, trigger: "startup" });
      });
      // First session start
      const fired1 = fireStartupReminders(1);
      expect(fired1).toHaveLength(1);
      expect(getStartupReminders(1)).toHaveLength(1);
      // Second session start
      const fired2 = fireStartupReminders(1);
      expect(fired2).toHaveLength(1);
      expect(getStartupReminders(1)).toHaveLength(1);
    });
  });

  describe("reminderContentHash", () => {
    it("is deterministic — same inputs yield same hash", () => {
      const h1 = reminderContentHash("Check CI", false);
      const h2 = reminderContentHash("Check CI", false);
      expect(h1).toBe(h2);
    });

    it("is 16 hex characters long", () => {
      const h = reminderContentHash("hello", true);
      expect(h).toMatch(/^[0-9a-f]{16}$/);
    });

    it("different recurring flag produces different hash", () => {
      const hOne = reminderContentHash("Check CI", false);
      const hRec = reminderContentHash("Check CI", true);
      expect(hOne).not.toBe(hRec);
    });

    it("different text produces different hash", () => {
      const h1 = reminderContentHash("reminder A", false);
      const h2 = reminderContentHash("reminder B", false);
      expect(h1).not.toBe(h2);
    });

    it("different trigger produces different hash for same text and recurring", () => {
      const hTime = reminderContentHash("Deploy check", false, "time");
      const hStartup = reminderContentHash("Deploy check", false, "startup");
      expect(hTime).not.toBe(hStartup);
    });

    it("default trigger (omitted) equals explicit trigger='time'", () => {
      const hDefault = reminderContentHash("Deploy check", false);
      const hTime = reminderContentHash("Deploy check", false, "time");
      expect(hDefault).toBe(hTime);
    });
  });

  // ── disable / enable ──────────────────────────────────────────────────────

  describe("disableReminder / enableReminder", () => {
    it("disable prevents an active reminder from appearing in getActiveReminders", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        disableReminder("r1");
      });
      expect(getActiveReminders(1)).toHaveLength(0);
    });

    it("enable restores a disabled reminder to getActiveReminders", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        disableReminder("r1");
        enableReminder("r1");
      });
      expect(getActiveReminders(1)).toHaveLength(1);
    });

    it("disable-then-enable round-trip: reminder fires after re-enable but not between", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "ping", delay_seconds: 0, recurring: true });
      });

      // Disable — should not fire
      runInSessionContext(1, () => { disableReminder("r1"); });
      const firedWhileDisabled = popActiveReminders(1);
      expect(firedWhileDisabled).toHaveLength(0);

      // Re-enable — should fire
      runInSessionContext(1, () => { enableReminder("r1"); });
      const firedAfterEnable = popActiveReminders(1);
      expect(firedAfterEnable).toHaveLength(1);
      expect(firedAfterEnable[0].id).toBe("r1");
    });

    it("disable is idempotent — calling twice does not throw", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        disableReminder("r1");
        expect(() => disableReminder("r1")).not.toThrow();
      });
      expect(getActiveReminders(1)).toHaveLength(0);
    });

    it("enable is idempotent — calling on active reminder does not throw", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        expect(() => enableReminder("r1")).not.toThrow();
      });
      expect(getActiveReminders(1)).toHaveLength(1);
    });

    it("disableReminder returns null for unknown ID", () => {
      runInSessionContext(1, () => {
        const result = disableReminder("nope");
        expect(result).toBeNull();
      });
    });

    it("enableReminder returns null for unknown ID", () => {
      runInSessionContext(1, () => {
        const result = enableReminder("nope");
        expect(result).toBeNull();
      });
    });

    it("disabled startup reminders do not appear in getFireableStartupReminders", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "s1", text: "startup", delay_seconds: 0, recurring: false, trigger: "startup" });
        disableReminder("s1");
      });
      expect(getFireableStartupReminders(1)).toHaveLength(0);
      // But still visible in getStartupReminders (raw list)
      expect(getStartupReminders(1)).toHaveLength(1);
    });

    it("disabled startup reminders are skipped by fireStartupReminders", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "s1", text: "startup", delay_seconds: 0, recurring: false, trigger: "startup" });
        disableReminder("s1");
      });
      const fired = fireStartupReminders(1);
      expect(fired).toHaveLength(0);
    });
  });

  // ── sleep ─────────────────────────────────────────────────────────────────

  describe("sleepReminder", () => {
    it("a sleeping reminder does not appear in getActiveReminders", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        sleepReminder("r1", Date.now() + 60_000);
      });
      expect(getActiveReminders(1)).toHaveLength(0);
    });

    it("a sleeping reminder fires once sleep_until is in the past", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        // Set sleep_until to a past time (already expired)
        sleepReminder("r1", Date.now() - 1000);
      });
      expect(getActiveReminders(1)).toHaveLength(1);
    });

    it("skips firing during sleep, resumes when now >= until", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: true });
        sleepReminder("r1", Date.now() + 60_000);
      });

      // Should not fire while sleeping
      const whileSleeping = popActiveReminders(1);
      expect(whileSleeping).toHaveLength(0);

      // Manually expire the sleep
      runInSessionContext(1, () => {
        sleepReminder("r1", Date.now() - 1000);
      });

      const afterWake = popActiveReminders(1);
      expect(afterWake).toHaveLength(1);
      expect(afterWake[0].id).toBe("r1");
    });

    it("sleep_until is cleared after firing (not persisted across re-arm for recurring)", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: true });
        // Set expired sleep so it fires
        sleepReminder("r1", Date.now() - 1000);
      });
      popActiveReminders(1);
      // After re-arm, sleep_until should be cleared
      runInSessionContext(1, () => {
        const list = listReminders();
        expect(list[0].sleep_until).toBeUndefined();
      });
    });

    it("sleeping startup reminders are skipped by fireStartupReminders", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "s1", text: "startup", delay_seconds: 0, recurring: false, trigger: "startup" });
        sleepReminder("s1", Date.now() + 60_000);
      });
      const fired = fireStartupReminders(1);
      expect(fired).toHaveLength(0);
    });

    it("sleepReminder returns null for unknown ID", () => {
      runInSessionContext(1, () => {
        const result = sleepReminder("nope", Date.now() + 1000);
        expect(result).toBeNull();
      });
    });

    it("sleeping deferred reminder stays suppressed after promoteDeferred", () => {
      runInSessionContext(1, () => {
        // Add a reminder with a future delay (deferred)
        const r = addReminder({ id: "r1", text: "x", delay_seconds: 3600, recurring: false });
        // Sleep it with a future timestamp
        sleepReminder("r1", Date.now() + 60_000);
        // Manually set created_at to past so promoteDeferred would promote it
        r.created_at = Date.now() - 7200_000; // 2 hours ago → delay elapsed
      });
      // Promote: reminder moves from deferred to active
      promoteDeferred(1);
      // But it should still be suppressed (sleeping) — not in getActiveReminders
      expect(getActiveReminders(1)).toHaveLength(0);
    });

    it("sleeping startup reminder excluded from getFireableStartupReminders", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "s1", text: "on startup", delay_seconds: 0, recurring: false, trigger: "startup" });
        sleepReminder("s1", Date.now() + 60_000);
      });
      expect(getFireableStartupReminders(1)).toHaveLength(0);
    });
  });

  // ── computeReminderDisplayState ───────────────────────────────────────────

  describe("computeReminderDisplayState", () => {
    it("returns 'disabled' for a disabled reminder regardless of internal state", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        r.disabled = true;
        const { state } = computeReminderDisplayState(r, Date.now());
        expect(state).toBe("disabled");
      });
    });

    it("returns 'sleeping' with until when sleep_until is in the future", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        const futureMs = Date.now() + 60_000;
        r.sleep_until = futureMs;
        const { state, until } = computeReminderDisplayState(r, Date.now());
        expect(state).toBe("sleeping");
        expect(until).toBe(futureMs);
      });
    });

    it("disabled takes precedence over sleep", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        r.disabled = true;
        r.sleep_until = Date.now() + 60_000;
        const { state } = computeReminderDisplayState(r, Date.now());
        expect(state).toBe("disabled");
      });
    });

    it("returns internal state when neither disabled nor sleeping", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        const { state } = computeReminderDisplayState(r, Date.now());
        expect(state).toBe("active");
      });
    });

    it("returns internal state when sleep_until is in the past", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        r.sleep_until = Date.now() - 1000;
        const { state } = computeReminderDisplayState(r, Date.now());
        expect(state).toBe("active");
      });
    });
  });

  // ── sleep transience (profile/save must NOT persist sleep_until) ──────────

  describe("sleep transience — profile/save integration contract", () => {
    it("listReminders exposes sleep_until on the reminder object for callers to inspect", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        sleepReminder("r1", Date.now() + 60_000);
        const list = listReminders();
        // sleep_until is available in memory for the computeReminderDisplayState path
        expect(list[0].sleep_until).toBeDefined();
        // disabled is not set
        expect(list[0].disabled).toBeUndefined();
      });
    });

    it("disabled flag is preserved on the reminder object for profile/save to persist", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "r1", text: "x", delay_seconds: 0, recurring: false });
        disableReminder("r1");
        const list = listReminders();
        expect(list[0].disabled).toBe(true);
      });
    });
  });

  // ── last_sent reminders ───────────────────────────────────────────────────

  describe("last_sent reminders", () => {
    it("AC1: registers a persistent last_sent reminder with event_pending state", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "ls1", text: "Did you follow up?", delay_seconds: 180, recurring: true, trigger: "last_sent" });
        expect(r.trigger).toBe("last_sent");
        expect(r.recurring).toBe(true);
        expect(r.state).toBe("event_pending");
        expect(r.activated_at).toBeNull();
        expect(listReminders()).toHaveLength(1);
      });
    });

    it("AC2: recordLastSentAt updates last_sent_at", () => {
      const ts = Date.now();
      recordLastSentAt(1, ts);
      expect(getLastSentAt(1)).toBe(ts);
    });

    it("AC2: subsequent recordLastSentAt overwrites (most recent send wins)", () => {
      recordLastSentAt(1, 1000);
      recordLastSentAt(1, 2000);
      expect(getLastSentAt(1)).toBe(2000);
    });

    it("AC3: persistent last_sent fires after delay_seconds elapsed, re-arms (no immediate re-fire)", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "Follow up", delay_seconds: 10, recurring: true, trigger: "last_sent" });
      });
      const sendTime = Date.now() - 15_000; // 15s ago, delay=10s → elapsed
      recordLastSentAt(1, sendTime);

      expect(getFireableEventReminders(1)).toHaveLength(1);
      const fired = popFireableEventReminders(1);
      expect(fired).toHaveLength(1);
      expect(fired[0].trigger).toBe("last_sent");

      // Recurring: still in list, but won't re-fire for the same send
      runInSessionContext(1, () => {
        const remaining = listReminders();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].last_fired_for).toBe(sendTime);
      });
      expect(getFireableEventReminders(1)).toHaveLength(0);
    });

    it("AC3: persistent last_sent re-arms on next send after delay", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "Follow up", delay_seconds: 10, recurring: true, trigger: "last_sent" });
      });
      // First send + fire
      const send1 = Date.now() - 15_000;
      recordLastSentAt(1, send1);
      popFireableEventReminders(1);

      // New send → new clock
      const send2 = Date.now() - 12_000; // 12s ago, delay=10s → elapsed
      recordLastSentAt(1, send2);
      const fired2 = popFireableEventReminders(1);
      expect(fired2).toHaveLength(1);
    });

    it("AC4: one-shot last_sent fires exactly once then is removed", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls2", text: "Once", delay_seconds: 10, recurring: false, trigger: "last_sent" });
      });
      recordLastSentAt(1, Date.now() - 15_000);

      const fired = popFireableEventReminders(1);
      expect(fired).toHaveLength(1);

      // One-shot: deleted
      runInSessionContext(1, () => {
        expect(listReminders()).toHaveLength(0);
      });
      // No re-fire even with same event
      expect(getFireableEventReminders(1)).toHaveLength(0);
    });

    it("AC5: inbound messages do NOT reset last_sent_at", () => {
      const sendTime = Date.now() - 15_000;
      recordLastSentAt(1, sendTime);
      recordLastReceivedAt(1, "all", Date.now()); // new inbound
      expect(getLastSentAt(1)).toBe(sendTime); // unchanged
    });

    it("last_sent does not fire before delay_seconds has elapsed", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "Not yet", delay_seconds: 30, recurring: false, trigger: "last_sent" });
      });
      recordLastSentAt(1, Date.now() - 10_000); // only 10s ago, delay=30s
      expect(getFireableEventReminders(1)).toHaveLength(0);
    });

    it("last_sent does not fire when no send has occurred yet", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "Waiting", delay_seconds: 10, recurring: false, trigger: "last_sent" });
      });
      expect(getFireableEventReminders(1)).toHaveLength(0);
    });

    it("last_sent is excluded from getActiveReminders and promoteDeferred", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "Event-based", delay_seconds: 0, recurring: false, trigger: "last_sent" });
      });
      promoteDeferred(1);
      expect(getActiveReminders(1)).toHaveLength(0);
    });

    it("disabled last_sent reminder does not fire", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "Disabled", delay_seconds: 10, recurring: false, trigger: "last_sent" });
        disableReminder("ls1");
      });
      recordLastSentAt(1, Date.now() - 15_000);
      expect(getFireableEventReminders(1)).toHaveLength(0);
    });

    it("sleeping last_sent reminder does not fire while sleeping", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "Sleeping", delay_seconds: 10, recurring: false, trigger: "last_sent" });
        sleepReminder("ls1", Date.now() + 60_000);
      });
      recordLastSentAt(1, Date.now() - 15_000);
      expect(getFireableEventReminders(1)).toHaveLength(0);
    });

    it("getSoonestEventReminderMs returns null when no send has occurred", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "x", delay_seconds: 60, recurring: false, trigger: "last_sent" });
      });
      expect(getSoonestEventReminderMs(1)).toBeNull();
    });

    it("getSoonestEventReminderMs returns approximate ms to fire after send", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "x", delay_seconds: 30, recurring: false, trigger: "last_sent" });
      });
      recordLastSentAt(1, Date.now() - 10_000); // 10s elapsed, 20s remaining
      const ms = getSoonestEventReminderMs(1);
      expect(ms).not.toBeNull();
      expect(ms!).toBeGreaterThan(0);
      expect(ms!).toBeLessThanOrEqual(20_000);
    });

    it("getSoonestEventReminderMs returns 0 when already fireable", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "x", delay_seconds: 10, recurring: false, trigger: "last_sent" });
      });
      recordLastSentAt(1, Date.now() - 15_000);
      expect(getSoonestEventReminderMs(1)).toBe(0);
    });

    it("reminderContentHash includes trigger — last_sent hash differs from time hash", () => {
      const hTime = reminderContentHash("test", false, "time");
      const hLastSent = reminderContentHash("test", false, "last_sent");
      expect(hTime).not.toBe(hLastSent);
    });

    it("clearSessionReminders clears last_sent_at for the session", () => {
      recordLastSentAt(1, Date.now());
      clearSessionReminders(1);
      expect(getLastSentAt(1)).toBeUndefined();
    });
  });

  // ── last_received reminders ───────────────────────────────────────────────

  describe("last_received reminders", () => {
    it("AC6: registers a last_received reminder with mode", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "lr1", text: "Quiet?", delay_seconds: 300, recurring: true, trigger: "last_received", mode: "all" });
        expect(r.trigger).toBe("last_received");
        expect(r.mode).toBe("all");
        expect(r.state).toBe("event_pending");
      });
    });

    it("AC6: last_received defaults mode to 'all' when omitted", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "lr1", text: "Quiet?", delay_seconds: 300, recurring: true, trigger: "last_received" });
        expect(r.mode).toBe("all");
      });
    });

    it("AC7: mode='all' — recordLastReceivedAt updates 'all' for operator messages and DMs", () => {
      recordLastReceivedAt(1, "all", 1000);
      expect(getLastReceivedAt(1, "all")).toBe(1000);
      recordLastReceivedAt(1, "all", 2000); // second event (DM)
      expect(getLastReceivedAt(1, "all")).toBe(2000); // max wins
    });

    it("AC7/AC8: operator message updates both 'all' and 'operator'; DM updates only 'all'", () => {
      // Operator message: update both
      recordLastReceivedAt(1, "all", 1000);
      recordLastReceivedAt(1, "operator", 1000);
      expect(getLastReceivedAt(1, "all")).toBe(1000);
      expect(getLastReceivedAt(1, "operator")).toBe(1000);

      // DM: update only 'all'
      recordLastReceivedAt(1, "all", 2000);
      expect(getLastReceivedAt(1, "all")).toBe(2000);
      expect(getLastReceivedAt(1, "operator")).toBe(1000); // unchanged
    });

    it("AC8: mode='operator' reminder only fires based on operator timestamp", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "lr-op", text: "Operator quiet", delay_seconds: 10, recurring: false, trigger: "last_received", mode: "operator" });
      });
      // Only 'all' updated (DM), not 'operator'
      recordLastReceivedAt(1, "all", Date.now() - 15_000);
      expect(getFireableEventReminders(1)).toHaveLength(0); // operator mode, no operator event

      // Now operator event
      recordLastReceivedAt(1, "operator", Date.now() - 15_000);
      expect(getFireableEventReminders(1)).toHaveLength(1);
    });

    it("AC10: persistent last_received fires and re-arms, won't re-fire until next event", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "lr1", text: "Quiet?", delay_seconds: 10, recurring: true, trigger: "last_received", mode: "all" });
      });
      const recv1 = Date.now() - 15_000;
      recordLastReceivedAt(1, "all", recv1);

      const fired1 = popFireableEventReminders(1);
      expect(fired1).toHaveLength(1);

      // Won't re-fire for same event
      expect(getFireableEventReminders(1)).toHaveLength(0);

      // New qualifying event → re-arms
      const recv2 = Date.now() - 12_000; // newer than recv1 and delay elapsed
      recordLastReceivedAt(1, "all", recv2);
      const fired2 = popFireableEventReminders(1);
      expect(fired2).toHaveLength(1);

      // Still in list (recurring)
      runInSessionContext(1, () => {
        expect(listReminders()).toHaveLength(1);
      });
    });

    it("AC11: one-shot last_received fires once then is removed", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "lr2", text: "Once", delay_seconds: 10, recurring: false, trigger: "last_received", mode: "all" });
      });
      recordLastReceivedAt(1, "all", Date.now() - 15_000);

      const fired = popFireableEventReminders(1);
      expect(fired).toHaveLength(1);
      runInSessionContext(1, () => {
        expect(listReminders()).toHaveLength(0);
      });
    });

    it("AC12: outbound sends do NOT reset last_received_at", () => {
      const receiveTime = Date.now() - 5_000;
      recordLastReceivedAt(1, "all", receiveTime);
      recordLastSentAt(1, Date.now()); // outbound send
      expect(getLastReceivedAt(1, "all")).toBe(receiveTime); // unchanged
    });

    it("recordLastReceivedAt uses max semantics — older timestamp does not overwrite", () => {
      recordLastReceivedAt(1, "all", 2000);
      recordLastReceivedAt(1, "all", 1000); // older
      expect(getLastReceivedAt(1, "all")).toBe(2000);
    });

    it("last_received does not fire before delay_seconds elapsed", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "lr1", text: "Not yet", delay_seconds: 30, recurring: false, trigger: "last_received", mode: "all" });
      });
      recordLastReceivedAt(1, "all", Date.now() - 10_000); // only 10s elapsed
      expect(getFireableEventReminders(1)).toHaveLength(0);
    });

    it("last_received does not fire when no qualifying event yet", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "lr1", text: "Waiting", delay_seconds: 10, recurring: false, trigger: "last_received", mode: "all" });
      });
      expect(getFireableEventReminders(1)).toHaveLength(0);
    });

    it("reminderContentHash includes mode — different modes produce different hashes", () => {
      const hAll = reminderContentHash("test", false, "last_received", "all");
      const hOp = reminderContentHash("test", false, "last_received", "operator");
      expect(hAll).not.toBe(hOp);
    });

    it("reminderContentHash — last_received hash differs from last_sent hash", () => {
      const hSent = reminderContentHash("test", false, "last_sent");
      const hRecv = reminderContentHash("test", false, "last_received");
      expect(hSent).not.toBe(hRecv);
    });

    it("clearSessionReminders clears last_received_at for the session", () => {
      recordLastReceivedAt(1, "all", Date.now());
      clearSessionReminders(1);
      expect(getLastReceivedAt(1, "all")).toBeUndefined();
    });
  });

  // ── AC13: multiple reminders coexist independently ───────────────────────

  describe("AC13: multiple last_sent / last_received reminders coexist independently", () => {
    it("two last_sent reminders with different delays fire at the right time", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls-60", text: "1m", delay_seconds: 60, recurring: true, trigger: "last_sent" });
        addReminder({ id: "ls-300", text: "5m", delay_seconds: 300, recurring: true, trigger: "last_sent" });
      });
      recordLastSentAt(1, Date.now() - 90_000); // 90s ago
      // ls-60 should fire (90 > 60), ls-300 should not (90 < 300)
      const fired = popFireableEventReminders(1);
      expect(fired).toHaveLength(1);
      expect(fired[0].id).toBe("ls-60");

      // ls-300 still waiting
      runInSessionContext(1, () => {
        const remaining = listReminders();
        expect(remaining).toHaveLength(2);
        const ls300 = remaining.find(r => r.id === "ls-300");
        expect(ls300?.last_fired_for).toBeUndefined();
      });
    });

    it("last_sent and last_received reminders coexist without interfering", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "sent", delay_seconds: 10, recurring: false, trigger: "last_sent" });
        addReminder({ id: "lr1", text: "recv", delay_seconds: 10, recurring: false, trigger: "last_received", mode: "all" });
      });
      recordLastSentAt(1, Date.now() - 15_000);
      recordLastReceivedAt(1, "all", Date.now() - 15_000);

      const fired = popFireableEventReminders(1);
      expect(fired).toHaveLength(2);
      const ids = fired.map(r => r.id).sort();
      expect(ids).toEqual(["lr1", "ls1"]);
    });

    it("last_sent does not reset last_received and vice versa", () => {
      const recvTime = Date.now() - 3_000;
      const sentTime = Date.now() - 5_000;
      recordLastReceivedAt(1, "all", recvTime);
      recordLastSentAt(1, sentTime);
      expect(getLastReceivedAt(1, "all")).toBe(recvTime);
      expect(getLastSentAt(1)).toBe(sentTime);
    });
  });

  // ── only_if_silent flag ───────────────────────────────────────────────────

  describe("only_if_silent flag (last_received)", () => {
    it("AC1: registers last_received reminder with only_if_silent: true", () => {
      runInSessionContext(1, () => {
        const r = addReminder({ id: "ois1", text: "Quiet?", delay_seconds: 180, recurring: true, trigger: "last_received", mode: "operator", only_if_silent: true });
        expect(r.trigger).toBe("last_received");
        expect(r.mode).toBe("operator");
        expect(r.only_if_silent).toBe(true);
        expect(r.state).toBe("event_pending");
      });
    });

    it("AC2: default only_if_silent=false fires on elapsed time alone (existing behavior preserved)", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "lr1", text: "No flag", delay_seconds: 10, recurring: false, trigger: "last_received", mode: "all" });
      });
      const recvTime = Date.now() - 15_000;
      recordLastReceivedAt(1, "all", recvTime);
      // Send AFTER inbound — should NOT suppress because only_if_silent is false
      recordLastSentAt(1, Date.now() - 5_000);
      expect(getFireableEventReminders(1)).toHaveLength(1);
    });

    it("AC3: only_if_silent=true fires when elapsed AND no reply since inbound", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ois1", text: "Quiet?", delay_seconds: 10, recurring: false, trigger: "last_received", mode: "all", only_if_silent: true });
      });
      const recvTime = Date.now() - 15_000;
      recordLastReceivedAt(1, "all", recvTime);
      // No send at all → lastSentAt is undefined → fire
      expect(getFireableEventReminders(1)).toHaveLength(1);
    });

    it("AC3: only_if_silent=true with send BEFORE inbound still fires (send predates inbound)", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ois1", text: "Quiet?", delay_seconds: 10, recurring: false, trigger: "last_received", mode: "all", only_if_silent: true });
      });
      const sendTime = Date.now() - 30_000;
      const recvTime = Date.now() - 15_000; // inbound AFTER send
      recordLastSentAt(1, sendTime);
      recordLastReceivedAt(1, "all", recvTime);
      // lastSentAt < lastReceivedAt → agent has NOT replied since inbound → fire
      expect(getFireableEventReminders(1)).toHaveLength(1);
    });

    it("AC4: outbound send AFTER last qualifying inbound suppresses the reminder", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ois1", text: "Quiet?", delay_seconds: 10, recurring: false, trigger: "last_received", mode: "all", only_if_silent: true });
      });
      const recvTime = Date.now() - 15_000;
      recordLastReceivedAt(1, "all", recvTime);
      // Send after inbound → suppress
      recordLastSentAt(1, Date.now() - 5_000); // sent 5s ago, after inbound at 15s ago
      expect(getFireableEventReminders(1)).toHaveLength(0);
    });

    it("AC4: suppression lifted by next qualifying inbound after the send", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ois1", text: "Quiet?", delay_seconds: 10, recurring: true, trigger: "last_received", mode: "all", only_if_silent: true });
      });
      // Inbound → sent after → new inbound → should be fireable again
      const recv1 = Date.now() - 30_000;
      recordLastReceivedAt(1, "all", recv1);
      recordLastSentAt(1, Date.now() - 20_000); // replied
      // Still suppressed for recv1 because send >= recv1
      expect(getFireableEventReminders(1)).toHaveLength(0);

      // New inbound after the send
      const recv2 = Date.now() - 15_000; // newer than send
      recordLastReceivedAt(1, "all", recv2);
      // Now lastSentAt (20s ago) < recv2 (15s ago) → fire
      expect(getFireableEventReminders(1)).toHaveLength(1);
    });

    it("AC5: two last_received reminders with different only_if_silent coexist independently", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ois-t", text: "Time only", delay_seconds: 10, recurring: false, trigger: "last_received", mode: "all", only_if_silent: false });
        addReminder({ id: "ois-s", text: "Silent only", delay_seconds: 10, recurring: false, trigger: "last_received", mode: "all", only_if_silent: true });
      });
      const recvTime = Date.now() - 15_000;
      recordLastReceivedAt(1, "all", recvTime);
      // Send after inbound — suppresses only_if_silent=true, not the other
      recordLastSentAt(1, Date.now() - 5_000);

      const fired = getFireableEventReminders(1);
      expect(fired).toHaveLength(1);
      expect(fired[0].id).toBe("ois-t");
    });

    it("AC6: persistent re-arm — only_if_silent recurring reminder re-arms on next qualifying inbound", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ois1", text: "Quiet?", delay_seconds: 10, recurring: true, trigger: "last_received", mode: "all", only_if_silent: true });
      });
      // First qualifying inbound, no send → fires
      const recv1 = Date.now() - 15_000;
      recordLastReceivedAt(1, "all", recv1);
      const fired1 = popFireableEventReminders(1);
      expect(fired1).toHaveLength(1);

      // Still in list (recurring), but won't re-fire for same event
      expect(getFireableEventReminders(1)).toHaveLength(0);

      // New qualifying inbound (no send after it) → re-arms
      const recv2 = Date.now() - 12_000;
      recordLastReceivedAt(1, "all", recv2);
      expect(getFireableEventReminders(1)).toHaveLength(1);
    });

    it("AC7: recurring=false one-off only_if_silent reminder fires once then is removed", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ois-once", text: "Once", delay_seconds: 10, recurring: false, trigger: "last_received", mode: "all", only_if_silent: true });
      });
      recordLastReceivedAt(1, "all", Date.now() - 15_000);
      const fired = popFireableEventReminders(1);
      expect(fired).toHaveLength(1);
      runInSessionContext(1, () => {
        expect(listReminders()).toHaveLength(0);
      });
    });

    it("AC8: reminder/list returns the only_if_silent flag value", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ois1", text: "With flag", delay_seconds: 60, recurring: true, trigger: "last_received", mode: "all", only_if_silent: true });
        addReminder({ id: "ois2", text: "Without flag", delay_seconds: 60, recurring: true, trigger: "last_received", mode: "all" });
        const list = listReminders();
        const withFlag = list.find(r => r.id === "ois1");
        const withoutFlag = list.find(r => r.id === "ois2");
        expect(withFlag?.only_if_silent).toBe(true);
        expect(withoutFlag?.only_if_silent).toBeUndefined();
      });
    });

    it("reminderContentHash — different only_if_silent produces different hash", () => {
      const hFalse = reminderContentHash("Quiet?", true, "last_received", "all", false);
      const hTrue = reminderContentHash("Quiet?", true, "last_received", "all", true);
      expect(hFalse).not.toBe(hTrue);
    });

    it("only_if_silent=true with null lastSentAt (never sent) fires when elapsed", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ois1", text: "Never sent", delay_seconds: 10, recurring: false, trigger: "last_received", mode: "all", only_if_silent: true });
      });
      // Inbound elapsed, no send ever
      recordLastReceivedAt(1, "all", Date.now() - 15_000);
      expect(getFireableEventReminders(1)).toHaveLength(1);
    });

    it("only_if_silent=true — send exactly at lastReceivedAt timestamp suppresses", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ois1", text: "Exact", delay_seconds: 10, recurring: false, trigger: "last_received", mode: "all", only_if_silent: true });
      });
      const ts = Date.now() - 15_000;
      recordLastReceivedAt(1, "all", ts);
      recordLastSentAt(1, ts); // same instant → >= → suppress
      expect(getFireableEventReminders(1)).toHaveLength(0);
    });
  });

  // ── AC14: reconnect catch-up ──────────────────────────────────────────────

  describe("AC14: reconnect catch-up — fires immediately if elapsed > delay_seconds", () => {
    it("last_sent fires immediately if last_sent_at was set before reconnect and delay has elapsed", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "reconnect", delay_seconds: 60, recurring: false, trigger: "last_sent" });
      });
      // Simulate: send happened 5 minutes ago (before disconnect)
      recordLastSentAt(1, Date.now() - 300_000);
      // On reconnect, the check runs immediately — fires right away
      expect(getFireableEventReminders(1)).toHaveLength(1);
    });

    it("last_received fires immediately if last_received_at was set before reconnect", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "lr1", text: "reconnect", delay_seconds: 60, recurring: false, trigger: "last_received", mode: "all" });
      });
      recordLastReceivedAt(1, "all", Date.now() - 300_000);
      expect(getFireableEventReminders(1)).toHaveLength(1);
    });
  });

  // ── loop prevention ───────────────────────────────────────────────────────

  describe("loop prevention — reminder fires do not reset event clocks", () => {
    it("popFireableEventReminders does not update last_sent_at", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "x", delay_seconds: 10, recurring: true, trigger: "last_sent" });
      });
      const sentTime = Date.now() - 15_000;
      recordLastSentAt(1, sentTime);
      popFireableEventReminders(1);
      // last_sent_at must remain unchanged (reminder fire is not a send)
      expect(getLastSentAt(1)).toBe(sentTime);
    });

    it("popFireableEventReminders does not update last_received_at", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "lr1", text: "x", delay_seconds: 10, recurring: true, trigger: "last_received", mode: "all" });
      });
      const recvTime = Date.now() - 15_000;
      recordLastReceivedAt(1, "all", recvTime);
      popFireableEventReminders(1);
      expect(getLastReceivedAt(1, "all")).toBe(recvTime);
    });

    it("recurring reminder's last_fired_for prevents immediate re-fire", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "x", delay_seconds: 10, recurring: true, trigger: "last_sent" });
      });
      const sent = Date.now() - 15_000;
      recordLastSentAt(1, sent);
      popFireableEventReminders(1);
      // Should not be fireable again until a new send
      expect(getFireableEventReminders(1)).toHaveLength(0);
    });
  });

  // ── Bug 2 — popActiveReminders guard: event-triggered triggers excluded ────

  describe("Bug 2 — popActiveReminders guard: event-triggered triggers excluded from sweep", () => {
    it("last_received: popActiveReminders returns empty even when state is forced to active", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "lr1", text: "x", delay_seconds: 0, recurring: true, trigger: "last_received", mode: "all" });
        // Force state to active to simulate the Bug 2 edge case guarded by §5-b fix
        const r = listReminders()[0];
        r.state = "active";
        r.activated_at = Date.now();
      });
      // Bug 2 guard: last_received is excluded from popActiveReminders regardless of state
      expect(popActiveReminders(1)).toHaveLength(0);
    });

    it("last_sent: popActiveReminders returns empty even when state is forced to active", () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ls1", text: "x", delay_seconds: 0, recurring: true, trigger: "last_sent" });
        const r = listReminders()[0];
        r.state = "active";
        r.activated_at = Date.now();
      });
      // Bug 2 guard: last_sent is excluded from popActiveReminders regardless of state
      expect(popActiveReminders(1)).toHaveLength(0);
    });
  });

  // ── AC-8 — active-reminder sweep ──────────────────────────────────────────

  describe("AC-8 — active-reminder sweep delivers to parked agent", () => {
    beforeEach(() => {
      resetReminderStateForTest();       // clear any real timers before installing fake ones
      vi.useFakeTimers();               // replace setInterval with fake implementation
      restartActiveSweepForTest();      // restart sweep using the now-fake setInterval
      vi.mocked(deliverReminderEvent).mockClear();
      vi.mocked(isDequeueActive).mockReturnValue(false);
      setReminderFireCallback(vi.mocked(deliverReminderEvent));
    });

    afterEach(() => {
      resetReminderStateForTest(); // clear fake timer interval first
      vi.useRealTimers();          // then restore real timers
    });

    it("delivers active time reminder after 5 000 ms to a parked agent", async () => {
      runInSessionContext(1, () => {
        addReminder({ id: "ac8-time", text: "Check in", delay_seconds: 0, recurring: false });
      });

      await vi.advanceTimersByTimeAsync(5_000);

      expect(deliverReminderEvent).toHaveBeenCalledOnce();
      expect(deliverReminderEvent).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ event: "reminder" }),
      );
    });

    it("does NOT deliver when dequeue is active (conversation in flight)", async () => {
      vi.mocked(isDequeueActive).mockReturnValue(true);

      runInSessionContext(1, () => {
        addReminder({ id: "ac8-blocked", text: "Blocked reminder", delay_seconds: 0, recurring: false });
      });

      await vi.advanceTimersByTimeAsync(5_000);

      expect(deliverReminderEvent).not.toHaveBeenCalled();
    });
  });

  // ── P4 — sweep leak on disable ────────────────────────────────────────────

  describe("P4 — sweep tracking pruned when schedule reminder is disabled", () => {
    beforeEach(() => {
      resetReminderStateForTest();
    });

    afterEach(() => {
      resetReminderStateForTest();
    });

    it("removes session from _scheduleSids when the last schedule reminder is disabled", () => {
      runInSessionContext(1, () => {
        scheduleReminder({ id: "r1", text: "Test", cron: "* * * * *", tz: "UTC" });
      });

      expect(getScheduleSidsForTest().has(1)).toBe(true);

      runInSessionContext(1, () => {
        disableReminder("r1");
      });

      expect(getScheduleSidsForTest().has(1)).toBe(false);
    });

    it("keeps session in _scheduleSids while at least one schedule reminder remains enabled", () => {
      runInSessionContext(1, () => {
        scheduleReminder({ id: "r1", text: "First",  cron: "* * * * *", tz: "UTC" });
        scheduleReminder({ id: "r2", text: "Second", cron: "0 * * * *", tz: "UTC" });
      });

      runInSessionContext(1, () => {
        disableReminder("r1");
      });

      // r2 is still enabled → session must remain tracked
      expect(getScheduleSidsForTest().has(1)).toBe(true);
    });

    it("removes session only after all schedule reminders are disabled one by one", () => {
      runInSessionContext(1, () => {
        scheduleReminder({ id: "r1", text: "First",  cron: "* * * * *", tz: "UTC" });
        scheduleReminder({ id: "r2", text: "Second", cron: "0 * * * *", tz: "UTC" });
      });

      runInSessionContext(1, () => { disableReminder("r1"); });
      expect(getScheduleSidsForTest().has(1)).toBe(true);  // r2 still active

      runInSessionContext(1, () => { disableReminder("r2"); });
      expect(getScheduleSidsForTest().has(1)).toBe(false); // all disabled
    });

    it("sweep does not invoke the fire callback after the session's last reminder is disabled", () => {
      resetReminderStateForTest();
      vi.useFakeTimers({ now: new Date("2024-01-01T00:00:00.000Z").getTime() });
      vi.mocked(deliverReminderEvent).mockClear();
      setReminderFireCallback(vi.mocked(deliverReminderEvent));

      try {
        const reminder = runInSessionContext(1, () =>
          scheduleReminder({ id: "r1", text: "Test", cron: "1 * * * *", tz: "UTC" }),
        );

        // Force next_fire_ms into the past so a live sweep would fire it
        reminder.next_fire_ms = 0;

        runInSessionContext(1, () => { disableReminder("r1"); });

        // Advance well past the 5 s sweep interval
        vi.advanceTimersByTime(10_000);

        expect(deliverReminderEvent).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── Schedule sweep — fires via reminder-fire callback ────────────────────

  describe("Schedule sweep — fires via reminder-fire callback (§5-b, kick-ahead removal)", () => {
    beforeEach(() => {
      resetReminderStateForTest();
      // Fake time: 2024-01-01 00:00:00 UTC
      vi.useFakeTimers({ now: new Date("2024-01-01T00:00:00.000Z").getTime() });
      vi.mocked(deliverReminderEvent).mockClear();
      setReminderFireCallback(vi.mocked(deliverReminderEvent));
    });

    afterEach(() => {
      resetReminderStateForTest();
      vi.useRealTimers();
    });

    it("fires schedule reminder via reminder-fire callback when next_fire_ms is reached", async () => {
      runInSessionContext(1, () => {
        // cron "1 * * * *" = at minute :01 every hour → next fire is 00:01:00Z = 60 000 ms away
        scheduleReminder({ id: "sched1", text: "Scheduled ping", cron: "1 * * * *", tz: "UTC" });
      });

      // Advance past next_fire_ms (60s) + one sweep interval (5s) to trigger delivery
      await vi.advanceTimersByTimeAsync(65_000);

      expect(deliverReminderEvent).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ event: "reminder" }),
      );
    });
  });
});
