import { vi, describe, it, expect, beforeEach } from "vitest";
import { createHash } from "crypto";

function contentHash(
  text: string,
  recurring: boolean,
  trigger: "time" | "startup" | "last_sent" | "last_received" = "time",
  mode?: "all" | "operator",
  only_if_silent?: boolean,
): string {
  return createHash("sha256")
    .update(`${text}\0${recurring}\0${trigger}\0${mode ?? ""}\0${only_if_silent ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

const mocks = vi.hoisted(() => ({
  setSessionVoice: vi.fn(),
  setSessionSpeed: vi.fn(),
  setSessionDefault: vi.fn(),
  registerPreset: vi.fn(),
  addReminder: vi.fn(),
  listReminders: vi.fn((): Array<Record<string, unknown>> => []),
  disableReminder: vi.fn(),
  enableReminder: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("../../voice-state.js", () => ({
  setSessionVoice: mocks.setSessionVoice,
  setSessionSpeed: mocks.setSessionSpeed,
}));
vi.mock("../../animation-state.js", () => ({
  setSessionDefault: mocks.setSessionDefault,
  registerPreset: mocks.registerPreset,
}));
vi.mock("../../reminder-state.js", () => ({
  addReminder: mocks.addReminder,
  listReminders: mocks.listReminders,
  disableReminder: mocks.disableReminder,
  enableReminder: mocks.enableReminder,
  reminderContentHash: (
    text: string,
    recurring: boolean,
    trigger: "time" | "startup" | "last_sent" | "last_received" = "time",
    mode?: "all" | "operator",
    only_if_silent?: boolean,
  ) => contentHash(text, recurring, trigger, mode, only_if_silent),
}));
vi.mock("../../session-manager.js", () => ({ getSession: mocks.getSession }));

import { applyProfile } from "./apply.js";

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
    const calls = (mocks.addReminder.mock.calls as unknown as Array<[{ trigger?: string }]>).map((c) => c[0].trigger);
    expect(calls).toContain("time");
    expect(calls).toContain("startup");
  });

  it("applyProfile with r.disabled = true calls disableReminder", () => {
    const expectedId = contentHash("Disabled reminder", false, "time");
    mocks.addReminder.mockReturnValue({
      id: expectedId,
      text: "Disabled reminder",
      delay_seconds: 3600,
      recurring: false,
      trigger: "time",
      state: "deferred",
      created_at: Date.now(),
      activated_at: null,
    });
    const result = applyProfile(1, {
      reminders: [{ text: "Disabled reminder", recurring: false, delay_seconds: 3600, disabled: true }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.disableReminder).toHaveBeenCalledOnce();
    expect(mocks.disableReminder).toHaveBeenCalledWith(expectedId);
    expect(mocks.enableReminder).not.toHaveBeenCalled();
  });

  it("applyProfile with r.disabled = false calls enableReminder", () => {
    const expectedId = contentHash("Enabled reminder", false, "time");
    mocks.addReminder.mockReturnValue({
      id: expectedId,
      text: "Enabled reminder",
      delay_seconds: 1800,
      recurring: false,
      trigger: "time",
      state: "deferred",
      created_at: Date.now(),
      activated_at: null,
    });
    const result = applyProfile(1, {
      reminders: [{ text: "Enabled reminder", recurring: false, delay_seconds: 1800, disabled: false }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.enableReminder).toHaveBeenCalledOnce();
    expect(mocks.enableReminder).toHaveBeenCalledWith(expectedId);
    expect(mocks.disableReminder).not.toHaveBeenCalled();
  });

  it("applyProfile with r.disabled = undefined calls neither disableReminder nor enableReminder", () => {
    const expectedId = contentHash("Neutral reminder", false, "time");
    mocks.addReminder.mockReturnValue({
      id: expectedId,
      text: "Neutral reminder",
      delay_seconds: 600,
      recurring: false,
      trigger: "time",
      state: "deferred",
      created_at: Date.now(),
      activated_at: null,
    });
    const result = applyProfile(1, {
      reminders: [{ text: "Neutral reminder", recurring: false, delay_seconds: 600 }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.disableReminder).not.toHaveBeenCalled();
    expect(mocks.enableReminder).not.toHaveBeenCalled();
  });
});

describe("applyProfile — last_received/last_sent loop fix (BT-7274)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listReminders.mockReturnValue([]);
    mocks.addReminder.mockImplementation(
      (r: { id: string; text: string; delay_seconds: number; recurring: boolean; trigger?: string }) => ({
        ...r,
        state: "event_pending",
        created_at: Date.now(),
        activated_at: null,
      }),
    );
  });

  it("last_received: adds reminder when not already present", () => {
    const result = applyProfile(1, {
      reminders: [{ trigger: "last_received", text: "Ping me", recurring: true, delay_seconds: 120 }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.addReminder).toHaveBeenCalledOnce();
    const applied = (result as { applied: Record<string, unknown> }).applied;
    expect((applied.reminders as { added: string[] }).added).toHaveLength(1);
  });

  it("last_received: skips addReminder when already present (preserves last_fired_for)", () => {
    const existingId = contentHash("Ping me", true, "last_received", "all");
    mocks.listReminders.mockReturnValue([{ id: existingId }]);
    const result = applyProfile(1, {
      reminders: [{ trigger: "last_received", text: "Ping me", recurring: true, delay_seconds: 120 }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.addReminder).not.toHaveBeenCalled();
    const applied = (result as { applied: Record<string, unknown> }).applied;
    expect((applied.reminders as { updated: string[] }).updated).toContain(existingId);
  });

  it("last_sent: adds reminder when not already present", () => {
    const result = applyProfile(1, {
      reminders: [{ trigger: "last_sent", text: "Follow up", recurring: true, delay_seconds: 300 }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.addReminder).toHaveBeenCalledOnce();
    const applied = (result as { applied: Record<string, unknown> }).applied;
    expect((applied.reminders as { added: string[] }).added).toHaveLength(1);
  });

  it("last_sent: skips addReminder when already present (preserves last_fired_for)", () => {
    const existingId = contentHash("Follow up", true, "last_sent");
    mocks.listReminders.mockReturnValue([{ id: existingId }]);
    const result = applyProfile(1, {
      reminders: [{ trigger: "last_sent", text: "Follow up", recurring: true, delay_seconds: 300 }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.addReminder).not.toHaveBeenCalled();
    const applied = (result as { applied: Record<string, unknown> }).applied;
    expect((applied.reminders as { updated: string[] }).updated).toContain(existingId);
  });

  it("last_received: disabled flag applied to existing reminder without re-adding it", () => {
    const existingId = contentHash("Ping me", true, "last_received", "all");
    mocks.listReminders.mockReturnValue([{ id: existingId }]);
    applyProfile(1, {
      reminders: [{ trigger: "last_received", text: "Ping me", recurring: true, delay_seconds: 120, disabled: true }],
    });
    expect(mocks.addReminder).not.toHaveBeenCalled();
    expect(mocks.disableReminder).toHaveBeenCalledWith(existingId);
  });

  it("last_sent: enabled flag applied to existing reminder without re-adding it", () => {
    const existingId = contentHash("Follow up", true, "last_sent");
    mocks.listReminders.mockReturnValue([{ id: existingId }]);
    applyProfile(1, {
      reminders: [{ trigger: "last_sent", text: "Follow up", recurring: true, delay_seconds: 300, disabled: false }],
    });
    expect(mocks.addReminder).not.toHaveBeenCalled();
    expect(mocks.enableReminder).toHaveBeenCalledWith(existingId);
  });

  it("last_received with operator mode: skips addReminder when already present", () => {
    const existingId = contentHash("Op ping", false, "last_received", "operator");
    mocks.listReminders.mockReturnValue([{ id: existingId }]);
    const result = applyProfile(1, {
      reminders: [{ trigger: "last_received", text: "Op ping", recurring: false, delay_seconds: 60, mode: "operator" }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.addReminder).not.toHaveBeenCalled();
    const applied = (result as { applied: Record<string, unknown> }).applied;
    expect((applied.reminders as { updated: string[] }).updated).toContain(existingId);
  });

  it("Bug 1 fix — last_received with only_if_silent: true passes flag to addReminder and reminderContentHash", () => {
    const result = applyProfile(1, {
      // Cast to any to pass only_if_silent — the apply.ts code reads it via rd.only_if_silent cast
      reminders: [{ trigger: "last_received", text: "Quiet check", recurring: false, delay_seconds: 60, only_if_silent: true } as unknown as { trigger: "last_received"; text: string; recurring: boolean; delay_seconds: number }],
    });
    expect("applied" in result).toBe(true);
    expect(mocks.addReminder).toHaveBeenCalledOnce();
    // only_if_silent must reach addReminder (Bug 1 fix: apply.ts now extracts and passes it)
    expect(mocks.addReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "last_received",
        only_if_silent: true,
      }),
    );
    // The content hash must include only_if_silent (different hash from without flag)
    const withFlagId = contentHash("Quiet check", false, "last_received", "all", true);
    const withoutFlagId = contentHash("Quiet check", false, "last_received", "all", undefined);
    expect(withFlagId).not.toBe(withoutFlagId); // hash changes when only_if_silent differs
    const callArgs = (mocks.addReminder.mock.calls[0] as [{ id: string }])[0];
    expect(callArgs.id).toBe(withFlagId);
  });
});

describe("applyProfile — name_tag application", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listReminders.mockReturnValue([]);
    mocks.addReminder.mockImplementation(
      (r: { id: string; text: string; delay_seconds: number; recurring: boolean }) => ({
        ...r,
        state: "active",
        created_at: Date.now(),
        activated_at: Date.now(),
      }),
    );
  });

  it("profile with name_tag applies it to session", () => {
    const session = { name_tag: undefined as string | undefined };
    mocks.getSession.mockReturnValue(session);
    const result = applyProfile(42, { name_tag: "🤖 Worker" });
    expect("applied" in result).toBe(true);
    expect(session.name_tag).toBe("🤖 Worker");
    expect((result as { applied: Record<string, unknown> }).applied.name_tag).toBe("🤖 Worker");
  });

  it("profile without name_tag does not call getSession", () => {
    const result = applyProfile(42, { voice: "alloy" });
    expect("applied" in result).toBe(true);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("profile with name_tag when getSession returns undefined skips silently", () => {
    mocks.getSession.mockReturnValue(undefined);
    const result = applyProfile(42, { name_tag: "Ghost" });
    expect("applied" in result).toBe(true);
    expect(mocks.getSession).toHaveBeenCalledWith(42);
    expect((result as { applied: Record<string, unknown> }).applied.name_tag).toBeUndefined();
  });
});
