import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn((): boolean => false),
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

vi.mock("../session-manager.js", () => ({ validateSession: mocks.validateSession }));
vi.mock("../voice-state.js", () => ({
  getSessionVoiceFor: mocks.getSessionVoiceFor,
  getSessionSpeedFor: mocks.getSessionSpeedFor,
}));
vi.mock("../animation-state.js", () => ({
  hasSessionDefault: mocks.hasSessionDefault,
  getDefaultFrames: mocks.getDefaultFrames,
  listPresets: mocks.listPresets,
  getPreset: mocks.getPreset,
}));
vi.mock("../reminder-state.js", () => ({ listReminders: mocks.listReminders }));
vi.mock("../profile-store.js", () => ({
  writeProfile: mocks.writeProfile,
  resolveProfilePath: mocks.resolveProfilePath,
}));

import { register } from "./save_profile.js";

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
    expect(data.saved).toBe(true);
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

  it("saved reminders never contain id field", async () => {
    mocks.listReminders.mockReturnValue([
      { id: "abc123def456789", text: "Check CI", delay_seconds: 0, recurring: false },
      { id: "xyz987", text: "Stand by", delay_seconds: 300, recurring: true },
    ]);
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    const reminders = written.reminders as Array<Record<string, unknown>>;
    expect(reminders).toHaveLength(2);
    for (const r of reminders) {
      expect(r).not.toHaveProperty("id");
    }
  });

  it("includes reminder text, delay_seconds, and recurring in save", async () => {
    mocks.listReminders.mockReturnValue([
      { id: "abc123", text: "Check CI", delay_seconds: 60, recurring: true, trigger: "time" },
    ]);
    await call({ key: "Test", token: 1123456 });
    const written = mocks.writeProfile.mock.calls[0][1] as Record<string, unknown>;
    const reminders = written.reminders as Array<Record<string, unknown>>;
    // trigger="time" is the default and not saved to avoid clutter
    expect(reminders[0]).toEqual({ text: "Check CI", delay_seconds: 60, recurring: true });
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

  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call({ key: "Test" });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED on invalid token", async () => {
      mocks.validateSession.mockReturnValue(false);
      const result = await call({ key: "Test", token: 1000000 });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("AUTH_FAILED");
    });
  });
});
