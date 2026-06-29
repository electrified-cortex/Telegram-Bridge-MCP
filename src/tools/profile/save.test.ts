import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "../test-utils.js";
import { testIdentityGate } from "../test-helpers/identity-gate.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn((): boolean => false),
  getSession: vi.fn((): { name_tag?: string; suppress_pending_hint?: boolean; audio_remapping?: Record<string, string> } | undefined => undefined),
  getSessionVoiceFor: vi.fn((): string | null => null),
  getSessionSpeedFor: vi.fn((): number | null => null),
  hasSessionDefault: vi.fn((): boolean => false),
  getDefaultFrames: vi.fn((): string[] => ["`▎···  ▎`", "`▎··   ▎`"]),
  listPresets: vi.fn((): string[] => []),
  getPreset: vi.fn((): string[] | undefined => undefined),
  listReminders: vi.fn((): Array<Record<string, unknown>> => []),
  writeProfile: vi.fn(),
  resolveProfilePath: vi.fn((): string => "/data/profiles/Test.json"),
}));

vi.mock("../../session-manager.js", () => ({ validateSession: mocks.validateSession, getSession: mocks.getSession }));
vi.mock("../../voice-state.js", () => ({
  getSessionVoiceFor: mocks.getSessionVoiceFor,
  getSessionSpeedFor: mocks.getSessionSpeedFor,
}));
vi.mock("../../animation-state.js", () => ({
  hasSessionDefault: mocks.hasSessionDefault,
  getDefaultFrames: mocks.getDefaultFrames,
  listPresets: mocks.listPresets,
  getPreset: mocks.getPreset,
}));
vi.mock("../../reminder-state.js", () => ({ listReminders: mocks.listReminders }));
vi.mock("../../profile-store.js", () => ({
  writeProfile: mocks.writeProfile,
  resolveProfilePath: mocks.resolveProfilePath,
}));

import { register } from "./save.js";

describe("save_profile tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.resolveProfilePath.mockReturnValue("/data/profiles/Test.json");
    const server = createMockServer();
    register(server);
    call = server.getHandler("save_profile");
  });

  it("saves successfully and returns saved sections", async () => {
    mocks.getSessionVoiceFor.mockReturnValue("nova");
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.key).toBe("Test");
  });

  it("omits animation_default when no custom default is set", async () => {
    mocks.hasSessionDefault.mockReturnValue(false);
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).not.toHaveProperty("animation_default");
  });

  it("includes animation_default when custom default is set", async () => {
    mocks.hasSessionDefault.mockReturnValue(true);
    mocks.getDefaultFrames.mockReturnValue(["`[working]`"]);
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).toHaveProperty("animation_default");
    expect(written.animation_default).toEqual(["`[working]`"]);
  });

  it("saves reminder id field when present", async () => {
    mocks.listReminders.mockReturnValue([
      { id: "abc123def456789", text: "Check CI", delay_seconds: 0, recurring: false },
      { id: "xyz987", text: "Stand by", delay_seconds: 300, recurring: true },
    ]);
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    const reminders = written.reminders as Array<Record<string, unknown>>;
    expect(reminders).toHaveLength(2);
    expect(reminders[0]).toHaveProperty("id", "abc123def456789");
    expect(reminders[1]).toHaveProperty("id", "xyz987");
  });

  it("saves id field on schedule-trigger reminders", async () => {
    mocks.listReminders.mockReturnValue([
      { id: "sched42", text: "Daily standup", trigger: "schedule", cron: "0 9 * * 1-5", tz: "America/New_York" },
    ]);
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    const reminders = written.reminders as Array<Record<string, unknown>>;
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toHaveProperty("id", "sched42");
    expect(reminders[0]).toHaveProperty("trigger", "schedule");
    expect(reminders[0]).toHaveProperty("cron", "0 9 * * 1-5");
  });

  it("omits id field on schedule-trigger reminders that have no id", async () => {
    mocks.listReminders.mockReturnValue([
      { text: "Anonymous cron", trigger: "schedule", cron: "0 8 * * *" },
    ]);
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    const reminders = written.reminders as Array<Record<string, unknown>>;
    expect(reminders[0]).not.toHaveProperty("id");
  });

  it("includes reminder id, text, delay_seconds, and recurring in save", async () => {
    mocks.listReminders.mockReturnValue([
      { id: "abc123", text: "Check CI", delay_seconds: 60, recurring: true, trigger: "time" },
    ]);
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    const reminders = written.reminders as Array<Record<string, unknown>>;
    // trigger="time" is the default and not saved to avoid clutter
    expect(reminders[0]).toEqual({ id: "abc123", text: "Check CI", delay_seconds: 60, recurring: true });
  });

  it("saves startup trigger reminders with trigger field included", async () => {
    mocks.listReminders.mockReturnValue([
      { id: "s1", text: "Resume tasks", delay_seconds: 0, recurring: true, trigger: "startup" },
    ]);
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    const reminders = written.reminders as Array<Record<string, unknown>>;
    expect(reminders[0].trigger).toBe("startup");
  });

  it("does not save trigger field for time-trigger reminders (omit default)", async () => {
    mocks.listReminders.mockReturnValue([
      { id: "t1", text: "timed reminder", delay_seconds: 300, recurring: true, trigger: "time" },
    ]);
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    const reminders = written.reminders as Array<Record<string, unknown>>;
    expect(reminders[0]).not.toHaveProperty("trigger");
  });

  it("persists disabled=true for disabled reminders", async () => {
    mocks.listReminders.mockReturnValue([
      { id: "d1", text: "muted", delay_seconds: 0, recurring: false, trigger: "time", disabled: true },
    ]);
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    const reminders = written.reminders as Array<Record<string, unknown>>;
    expect(reminders[0].disabled).toBe(true);
  });

  it("does NOT persist sleep_until — sleep is transient and not saved to profile", async () => {
    mocks.listReminders.mockReturnValue([
      { id: "s1", text: "sleeping", delay_seconds: 0, recurring: false, trigger: "time", sleep_until: Date.now() + 60_000 },
    ]);
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    const reminders = written.reminders as Array<Record<string, unknown>>;
    expect(reminders[0]).not.toHaveProperty("sleep_until");
  });

  it("does NOT include disabled field when reminder is not disabled (omit false)", async () => {
    mocks.listReminders.mockReturnValue([
      { id: "t1", text: "active one", delay_seconds: 0, recurring: false, trigger: "time", disabled: false },
    ]);
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    const reminders = written.reminders as Array<Record<string, unknown>>;
    expect(reminders[0]).not.toHaveProperty("disabled");
  });

  it("persists autoload: true when flag is provided", async () => {
    mocks.writeProfile.mockReset();
    const result = await call({ key: "Test", autoload: true, token: 1123456 });
    expect(isError(result)).toBe(false);
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).toHaveProperty("autoload", true);
    const data = parseResult(result);
    expect(data.autoload).toBe(true);
    expect(data.sections).toContain("autoload");
  });

  it("does NOT persist autoload field when flag is false (default)", async () => {
    mocks.writeProfile.mockReset();
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).not.toHaveProperty("autoload");
  });

  it("autoload defaults to false when omitted — result returns false", async () => {
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.autoload).toBe(false);
  });

  it("rejects path keys (containing /)", async () => {
    const result = await call({ key: "profiles/Test", token: 1123456 });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("INVALID_KEY");
  });

  it("returns WRITE_FAILED when writeProfile throws", async () => {
    mocks.writeProfile.mockImplementation(() => { throw new Error("disk full"); });
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("WRITE_FAILED");
  });

  it("includes name_tag in profile when session has it set", async () => {
    mocks.writeProfile.mockReset();
    mocks.getSession.mockReturnValue({ name_tag: "🦊 Scout" });
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).toHaveProperty("name_tag", "🦊 Scout");
    const data = parseResult(result);
    expect(data.sections).toContain("name_tag");
  });

  it("does NOT include name_tag in profile when using default (name_tag undefined)", async () => {
    mocks.writeProfile.mockReset();
    mocks.getSession.mockReturnValue({ name_tag: undefined });
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).not.toHaveProperty("name_tag");
  });

  // AC4: persist suppress_pending_hint when set on session
  it("includes suppress_pending_hint: true in saved profile when session has it set", async () => {
    mocks.writeProfile.mockReset();
    mocks.getSession.mockReturnValue({ suppress_pending_hint: true });
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).toHaveProperty("suppress_pending_hint", true);
    const data = parseResult(result);
    expect(data.sections).toContain("suppress_pending_hint");
  });

  // AC5: persist suppress_pending_hint: false (explicit disable)
  it("includes suppress_pending_hint: false in saved profile when session has it explicitly false", async () => {
    mocks.writeProfile.mockReset();
    mocks.getSession.mockReturnValue({ suppress_pending_hint: false });
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).toHaveProperty("suppress_pending_hint", false);
    const data = parseResult(result);
    expect(data.sections).toContain("suppress_pending_hint");
  });

  // Default: suppress_pending_hint not serialized when undefined
  it("does NOT include suppress_pending_hint in saved profile when session field is undefined", async () => {
    mocks.writeProfile.mockReset();
    mocks.getSession.mockReturnValue({ name_tag: undefined });
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).not.toHaveProperty("suppress_pending_hint");
  });

  // ── AC6: silent_lifecycle persistence ──────────────────────────────────────

  // AC6: persists silent_lifecycle: true when passed as parameter
  it("AC6: persists silent_lifecycle: true in saved profile when parameter is true", async () => {
    mocks.writeProfile.mockReset();
    const result = await call({ key: "SilentBot", silent_lifecycle: true, token: 1123456 });
    expect(isError(result)).toBe(false);
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).toHaveProperty("silent_lifecycle", true);
    const data = parseResult(result);
    expect(data.sections).toContain("silent_lifecycle");
  });

  it("AC6: persists silent_lifecycle: false when parameter is false", async () => {
    mocks.writeProfile.mockReset();
    const result = await call({ key: "SilentBot", silent_lifecycle: false, token: 1123456 });
    expect(isError(result)).toBe(false);
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).toHaveProperty("silent_lifecycle", false);
    const data = parseResult(result);
    expect(data.sections).toContain("silent_lifecycle");
  });

  it("AC6: does NOT persist silent_lifecycle when parameter is omitted", async () => {
    mocks.writeProfile.mockReset();
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).not.toHaveProperty("silent_lifecycle");
  });

  // ── AC7: audio_remapping persistence ───────────────────────────────────────

  it("AC7: persists audio_remapping in saved profile when session has it set", async () => {
    mocks.writeProfile.mockReset();
    mocks.getSession.mockReturnValue({ audio_remapping: { "nginx": "engine-x" } });
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).toHaveProperty("audio_remapping");
    expect((written.audio_remapping as Record<string, string>)["nginx"]).toBe("engine-x");
    const data = parseResult(result);
    expect(data.sections).toContain("audio_remapping");
  });

  it("AC7: does NOT persist audio_remapping when session field is undefined", async () => {
    mocks.writeProfile.mockReset();
    mocks.getSession.mockReturnValue({ name_tag: undefined });
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    expect(written).not.toHaveProperty("audio_remapping");
  });

  testIdentityGate((args) => call(args), mocks.validateSession, {"key":"Test"}, false);
});
