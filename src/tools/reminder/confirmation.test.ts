/**
 * Tests for reminder confirmation service message (Feature A — 15-0004)
 *
 * AC1  Every reminder/set call → reminder_confirmation service message
 * AC2  Tier 1 (≤15m recurring): tier=1, next_fire=null
 * AC3  Tier 2 (hourly/daily):   tier=2, next_fire is ISO-8601 string
 * AC4  Tier 3 (weekly+/gap>7d): tier=3, tier_warning non-null
 * AC5  persistence_note always present and accurate
 * AC6  Tool response body unchanged — tested implicitly (we only test confirmation.ts here)
 * AC7  Annual-pinned cron (0 9 15 6 *) → Tier 3 warning
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { classifyReminderTier, deliverReminderConfirmation } from "./confirmation.js";
import type { Reminder } from "../../reminder-state.js";

// ── mock deliverServiceMessage ────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  deliverServiceMessage: vi.fn(),
}));

vi.mock("../../session-queue.js", () => ({
  deliverServiceMessage: mocks.deliverServiceMessage,
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "test-id",
    text: "Test reminder",
    delay_seconds: 300,
    recurring: false,
    trigger: "time",
    state: "deferred",
    created_at: Date.now(),
    activated_at: null,
    ...overrides,
  };
}

/** Fixed epoch ms used to make tier calculations deterministic. */
const NOW = 1_750_000_000_000;

// ── classifyReminderTier ──────────────────────────────────────────────────────

describe("classifyReminderTier — time trigger", () => {
  it("AC2: delay_seconds = 0 → Tier 1", () => {
    expect(classifyReminderTier(makeReminder({ delay_seconds: 0, trigger: "time" }), NOW)).toBe(1);
  });

  it("AC2: delay_seconds = 300 (5 min) → Tier 1", () => {
    expect(classifyReminderTier(makeReminder({ delay_seconds: 300, trigger: "time" }), NOW)).toBe(1);
  });

  it("AC2: delay_seconds = 900 (15 min exact) → Tier 1", () => {
    expect(classifyReminderTier(makeReminder({ delay_seconds: 900, trigger: "time" }), NOW)).toBe(1);
  });

  it("AC3: delay_seconds = 901 → Tier 2", () => {
    expect(classifyReminderTier(makeReminder({ delay_seconds: 901, trigger: "time" }), NOW)).toBe(2);
  });

  it("AC3: delay_seconds = 3600 (1 hr) → Tier 2", () => {
    expect(classifyReminderTier(makeReminder({ delay_seconds: 3_600, trigger: "time" }), NOW)).toBe(2);
  });

  it("AC3: delay_seconds = 86400 (1 day) → Tier 2", () => {
    expect(classifyReminderTier(makeReminder({ delay_seconds: 86_400, trigger: "time" }), NOW)).toBe(2);
  });
});

describe("classifyReminderTier — startup trigger", () => {
  it("startup always Tier 2 (event-based, unpredictable)", () => {
    expect(
      classifyReminderTier(
        makeReminder({ trigger: "startup", delay_seconds: 0, state: "startup" }),
        NOW,
      ),
    ).toBe(2);
  });
});

describe("classifyReminderTier — last_sent / last_received", () => {
  it("delay_seconds = 300 (5 min) → Tier 1", () => {
    expect(classifyReminderTier(makeReminder({ delay_seconds: 300, trigger: "last_sent" }), NOW)).toBe(1);
    expect(classifyReminderTier(makeReminder({ delay_seconds: 300, trigger: "last_received" }), NOW)).toBe(1);
  });

  it("delay_seconds = 7200 (2 hr) → Tier 2", () => {
    expect(classifyReminderTier(makeReminder({ delay_seconds: 7_200, trigger: "last_sent" }), NOW)).toBe(2);
  });
});

describe("classifyReminderTier — schedule trigger", () => {
  it("AC2: every-5min cron → Tier 1", () => {
    const inFiveMin = NOW + 5 * 60 * 1_000;
    expect(
      classifyReminderTier(
        makeReminder({
          trigger: "schedule",
          state: "schedule",
          cron: "*/5 * * * *",
          tz: "UTC",
          next_fire_ms: inFiveMin,
          recurring: true,
        }),
        NOW,
      ),
    ).toBe(1);
  });

  it("AC3: daily cron (0 9 * * *) → Tier 2", () => {
    const tomorrow = NOW + 24 * 60 * 60 * 1_000;
    expect(
      classifyReminderTier(
        makeReminder({
          trigger: "schedule",
          state: "schedule",
          cron: "0 9 * * *",
          tz: "UTC",
          next_fire_ms: tomorrow,
          recurring: true,
        }),
        NOW,
      ),
    ).toBe(2);
  });

  it("AC4: weekly cron (0 9 * * 1) with gap > 7d → Tier 3", () => {
    const in8Days = NOW + 8 * 24 * 60 * 60 * 1_000;
    expect(
      classifyReminderTier(
        makeReminder({
          trigger: "schedule",
          state: "schedule",
          cron: "0 9 * * 1",
          tz: "UTC",
          next_fire_ms: in8Days,
          recurring: true,
        }),
        NOW,
      ),
    ).toBe(3);
  });

  it("AC7: annual-pinned cron (0 9 15 6 *) → Tier 3", () => {
    // next fire is approximately 1 year away
    const nextYear = NOW + 365 * 24 * 60 * 60 * 1_000;
    expect(
      classifyReminderTier(
        makeReminder({
          trigger: "schedule",
          state: "schedule",
          cron: "0 9 15 6 *",
          tz: "UTC",
          next_fire_ms: nextYear,
          recurring: true,
        }),
        NOW,
      ),
    ).toBe(3);
  });
});

// ── deliverReminderConfirmation ────────────────────────────────────────────────

describe("deliverReminderConfirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("AC1: emits reminder_confirmation service message with correct eventType", () => {
    deliverReminderConfirmation(1, makeReminder({ delay_seconds: 300, recurring: true }));
    expect(mocks.deliverServiceMessage).toHaveBeenCalledOnce();
    const [sid, _text, eventType, details] = mocks.deliverServiceMessage.mock.calls[0];
    expect(sid).toBe(1);
    expect(eventType).toBe("reminder_confirmation");
    expect(details).toBeDefined();
    expect(details.reminder_id).toBe("test-id");
  });

  it("AC1: plain_summary (text) is a non-empty string", () => {
    deliverReminderConfirmation(1, makeReminder({ delay_seconds: 300, recurring: false }));
    const [, text] = mocks.deliverServiceMessage.mock.calls[0];
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("AC2: Tier 1 — tier=1, next_fire=null", () => {
    deliverReminderConfirmation(1, makeReminder({ delay_seconds: 300, recurring: true }));
    const details = mocks.deliverServiceMessage.mock.calls[0][3];
    expect(details.tier).toBe(1);
    expect(details.next_fire).toBeNull();
  });

  it("AC2: Tier 1 — tier_warning is null", () => {
    deliverReminderConfirmation(1, makeReminder({ delay_seconds: 300, recurring: true }));
    const details = mocks.deliverServiceMessage.mock.calls[0][3];
    expect(details.tier_warning).toBeNull();
  });

  it("AC3: Tier 2 — tier=2, next_fire is an ISO-8601 string", () => {
    deliverReminderConfirmation(1, makeReminder({ delay_seconds: 3_600, recurring: false }));
    const details = mocks.deliverServiceMessage.mock.calls[0][3];
    expect(details.tier).toBe(2);
    expect(typeof details.next_fire).toBe("string");
    // Valid ISO-8601 date/time
    expect(new Date(details.next_fire as string).getTime()).toBeGreaterThan(0);
  });

  it("AC4: Tier 3 — tier=3, tier_warning is a non-null string", () => {
    const nextYear = Date.now() + 365 * 24 * 60 * 60 * 1_000;
    const r = makeReminder({
      trigger: "schedule",
      state: "schedule",
      cron: "0 9 15 6 *",
      tz: "UTC",
      next_fire_ms: nextYear,
      recurring: true,
    });
    deliverReminderConfirmation(1, r);
    const details = mocks.deliverServiceMessage.mock.calls[0][3];
    expect(details.tier).toBe(3);
    expect(typeof details.tier_warning).toBe("string");
    expect(details.tier_warning).not.toBeNull();
  });

  it("AC4: Tier 3 — tier_warning contains actionable cancel hint", () => {
    const nextYear = Date.now() + 365 * 24 * 60 * 60 * 1_000;
    const r = makeReminder({
      id: "annual-r",
      trigger: "schedule",
      state: "schedule",
      cron: "0 9 15 6 *",
      tz: "UTC",
      next_fire_ms: nextYear,
      recurring: true,
    });
    deliverReminderConfirmation(1, r);
    const details = mocks.deliverServiceMessage.mock.calls[0][3];
    expect(details.tier_warning).toContain("annual-r");
  });

  it("AC5: persistence_note always present and non-empty", () => {
    deliverReminderConfirmation(1, makeReminder({ delay_seconds: 300, recurring: false }));
    const details = mocks.deliverServiceMessage.mock.calls[0][3];
    expect(details.persistence).toBe("session_only");
    expect(typeof details.persistence_note).toBe("string");
    expect((details.persistence_note as string).length).toBeGreaterThan(0);
  });

  it("AC5: one-shot reminder — persistence_note mentions 'expire'", () => {
    deliverReminderConfirmation(1, makeReminder({ delay_seconds: 300, recurring: false }));
    const details = mocks.deliverServiceMessage.mock.calls[0][3];
    expect(details.persistence_note).toContain("expire");
  });

  it("AC5: recurring reminder — persistence_note mentions 'profile/save'", () => {
    deliverReminderConfirmation(1, makeReminder({ delay_seconds: 3_600, recurring: true }));
    const details = mocks.deliverServiceMessage.mock.calls[0][3];
    expect(details.persistence_note).toContain("profile/save");
  });

  it("AC5: schedule reminders (always recurring) — persistence_note mentions 'profile/save'", () => {
    const tomorrow = Date.now() + 24 * 60 * 60 * 1_000;
    const r = makeReminder({
      trigger: "schedule",
      state: "schedule",
      cron: "0 9 * * *",
      tz: "UTC",
      next_fire_ms: tomorrow,
      recurring: true,
    });
    deliverReminderConfirmation(1, r);
    const details = mocks.deliverServiceMessage.mock.calls[0][3];
    expect(details.persistence_note).toContain("profile/save");
  });

  it("AC7: annual-pinned recurring cron → Tier 3 with warning containing ⚠️", () => {
    const nextYear = Date.now() + 365 * 24 * 60 * 60 * 1_000;
    const r = makeReminder({
      trigger: "schedule",
      state: "schedule",
      cron: "0 9 15 6 *",
      tz: "UTC",
      next_fire_ms: nextYear,
      recurring: true,
    });
    deliverReminderConfirmation(1, r);
    const details = mocks.deliverServiceMessage.mock.calls[0][3];
    expect(details.tier).toBe(3);
    expect(details.tier_warning).toContain("⚠️");
  });

  it("AC7: annual cron plain_summary starts with ⚠️", () => {
    const nextYear = Date.now() + 365 * 24 * 60 * 60 * 1_000;
    const r = makeReminder({
      trigger: "schedule",
      state: "schedule",
      cron: "0 9 15 6 *",
      tz: "UTC",
      next_fire_ms: nextYear,
      recurring: true,
    });
    deliverReminderConfirmation(1, r);
    const [, text] = mocks.deliverServiceMessage.mock.calls[0];
    expect(text).toMatch(/^⚠️/);
  });

  it("next_fire included for schedule Tier 2 (daily cron)", () => {
    const tomorrow = Date.now() + 24 * 60 * 60 * 1_000;
    const r = makeReminder({
      trigger: "schedule",
      state: "schedule",
      cron: "0 9 * * *",
      tz: "UTC",
      next_fire_ms: tomorrow,
      recurring: true,
    });
    deliverReminderConfirmation(1, r);
    const details = mocks.deliverServiceMessage.mock.calls[0][3];
    expect(details.tier).toBe(2);
    expect(typeof details.next_fire).toBe("string");
  });

  it("startup reminder: Tier 2, next_fire=null (event-based)", () => {
    const r = makeReminder({
      trigger: "startup",
      state: "startup",
      delay_seconds: 0,
      recurring: false,
    });
    deliverReminderConfirmation(1, r);
    const details = mocks.deliverServiceMessage.mock.calls[0][3];
    expect(details.tier).toBe(2);
    expect(details.next_fire).toBeNull();
  });
});
