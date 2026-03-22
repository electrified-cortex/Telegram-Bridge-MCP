import { describe, it, expect, beforeEach } from "vitest";
import {
  addReminder,
  cancelReminder,
  listReminders,
  getActiveReminders,
  promoteDeferred,
  popActiveReminders,
  getSoonestDeferredMs,
  buildReminderEvent,
  clearSessionReminders,
  resetReminderStateForTest,
  MAX_REMINDERS_PER_SESSION,
  reminderContentHash,
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
        expect((evt.id as number)).toBeLessThan(0);
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
  });
});
