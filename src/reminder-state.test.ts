import { describe, it, expect, beforeEach } from "vitest";
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
} from "./reminder-state.js";
import { runInSessionContext } from "./session-context.js";

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
});
