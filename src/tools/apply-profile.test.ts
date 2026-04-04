import { vi, describe, it, expect, beforeEach } from "vitest";
import { createHash } from "crypto";

function contentHash(text: string, recurring: boolean, trigger: "time" | "startup" = "time"): string {
  return createHash("sha256").update(`${text}\0${recurring}\0${trigger}`).digest("hex").slice(0, 16);
}

const mocks = vi.hoisted(() => ({
  setSessionVoice: vi.fn(),
  setSessionSpeed: vi.fn(),
  setSessionDefault: vi.fn(),
  registerPreset: vi.fn(),
  addReminder: vi.fn(),
  listReminders: vi.fn((): Array<Record<string, unknown>> => []),
}));

vi.mock("../voice-state.js", () => ({
  setSessionVoice: mocks.setSessionVoice,
  setSessionSpeed: mocks.setSessionSpeed,
}));
vi.mock("../animation-state.js", () => ({
  setSessionDefault: mocks.setSessionDefault,
  registerPreset: mocks.registerPreset,
}));
vi.mock("../reminder-state.js", () => ({
  addReminder: mocks.addReminder,
  listReminders: mocks.listReminders,
  reminderContentHash: (text: string, recurring: boolean, trigger: "time" | "startup" = "time") =>
    contentHash(text, recurring, trigger),
}));

import { applyProfile } from "./apply-profile.js";

describe("applyProfile — reminder guard behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listReminders.mockReturnValue([]);
    mocks.addReminder.mockImplementation(
      (r: { id: string; text: string; delay_seconds: number; recurring: boolean; trigger?: string }) => ({
        ...r,
        state: "active",
        created_at: Date.now(),
        activated_at: Date.now(),
      }),
    );
  });

  it("startup reminder without delay_seconds is added successfully (defaults to 0)", () => {
    const result = applyProfile(1, {
      reminders: [{ trigger: "startup", text: "Boot check", recurring: false }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.addReminder).toHaveBeenCalledOnce();
    expect(mocks.addReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "startup",
        text: "Boot check",
        delay_seconds: 0,
      }),
    );
  });

  it("time reminder with valid delay_seconds is added successfully", () => {
    const result = applyProfile(1, {
      reminders: [{ text: "Standup", recurring: false, delay_seconds: 3600 }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.addReminder).toHaveBeenCalledOnce();
    expect(mocks.addReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "time",
        text: "Standup",
        delay_seconds: 3600,
      }),
    );
  });

  it("time reminder with missing delay_seconds is silently skipped", () => {
    const result = applyProfile(1, {
      // Cast to any to simulate a profile loaded from disk where delay_seconds is absent
      reminders: [{ text: "Missing delay", recurring: false } as { text: string; recurring: boolean; delay_seconds: number }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.addReminder).not.toHaveBeenCalled();
    // No reminders in applied summary
    const applied = (result as { applied: Record<string, unknown> }).applied;
    expect(applied.reminders).toBeUndefined();
  });

  it("time reminder with non-numeric delay_seconds is silently skipped", () => {
    const result = applyProfile(1, {
      // Cast to any to simulate bad data (e.g., delay_seconds: "bad")
      reminders: [{ text: "Bad delay", recurring: false, delay_seconds: "bad" as unknown as number }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.addReminder).not.toHaveBeenCalled();
    const applied = (result as { applied: Record<string, unknown> }).applied;
    expect(applied.reminders).toBeUndefined();
  });

  it("time reminder with delay_seconds: NaN is silently skipped", () => {
    const result = applyProfile(1, {
      reminders: [{ text: "NaN delay", recurring: false, delay_seconds: NaN }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.addReminder).not.toHaveBeenCalled();
    const applied = (result as { applied: Record<string, unknown> }).applied;
    expect(applied.reminders).toBeUndefined();
  });

  it("startup reminder uses content hash with trigger='startup'", () => {
    const result = applyProfile(1, {
      reminders: [{ trigger: "startup", text: "On boot", recurring: true }],
    });
    expect("applied" in result).toBe(true);
    const expectedId = contentHash("On boot", true, "startup");
    expect(mocks.addReminder).toHaveBeenCalledWith(
      expect.objectContaining({ id: expectedId }),
    );
  });

  it("time reminder uses content hash with trigger='time'", () => {
    const result = applyProfile(1, {
      reminders: [{ text: "Standup", recurring: false, delay_seconds: 900 }],
    });
    expect("applied" in result).toBe(true);
    const expectedId = contentHash("Standup", false, "time");
    expect(mocks.addReminder).toHaveBeenCalledWith(
      expect.objectContaining({ id: expectedId }),
    );
  });

  it("mixed reminder list: valid time + startup without delay + invalid time are handled correctly", () => {
    const result = applyProfile(1, {
      reminders: [
        { text: "Valid time", recurring: false, delay_seconds: 60 },
        { trigger: "startup", text: "Boot msg", recurring: false },
        { text: "No delay", recurring: false } as { text: string; recurring: boolean; delay_seconds: number },
      ],
    });
    expect("applied" in result).toBe(true);
    // Only valid time + startup should be added (2 calls)
    expect(mocks.addReminder).toHaveBeenCalledTimes(2);
    const calls = mocks.addReminder.mock.calls.map((c: [{ trigger?: string }]) => c[0].trigger);
    expect(calls).toContain("time");
    expect(calls).toContain("startup");
  });
});
