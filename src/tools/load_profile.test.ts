import { vi, describe, it, expect, beforeEach } from "vitest";
import { createHash } from "crypto";
import { createMockServer, parseResult, isError } from "./test-utils.js";

function contentHash(text: string, recurring: boolean, trigger: "time" | "startup" = "time"): string {
  return createHash("sha256").update(`${text}\0${recurring}\0${trigger}`).digest("hex").slice(0, 16);
}

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn((): boolean => false),
  readProfile: vi.fn((): Record<string, unknown> | null => null),
  setSessionVoice: vi.fn(),
  setSessionSpeed: vi.fn(),
  setSessionDefault: vi.fn(),
  registerPreset: vi.fn(),
  addReminder: vi.fn(),
  listReminders: vi.fn((): Array<Record<string, unknown>> => []),
}));

vi.mock("../session-manager.js", () => ({ validateSession: mocks.validateSession }));
vi.mock("../profile-store.js", () => ({ readProfile: mocks.readProfile }));
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
  reminderContentHash: (text: string, recurring: boolean, trigger: "time" | "startup" = "time") => contentHash(text, recurring, trigger),
}));

import { register } from "./load_profile.js";

describe("load_profile tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.listReminders.mockReturnValue([]);
    const server = createMockServer();
    register(server);
    call = server.getHandler("load_profile");
  });

  it("returns NOT_FOUND when profile does not exist", async () => {
    mocks.readProfile.mockReturnValue(null);
    const result = await call({ key: "Missing", token: 1123456 });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("NOT_FOUND");
  });

  it("returns READ_FAILED when readProfile throws", async () => {
    mocks.readProfile.mockImplementation(() => { throw new Error("disk error"); });
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("READ_FAILED");
  });

  it("applies voice and voice_speed from profile", async () => {
    mocks.readProfile.mockReturnValue({ voice: "nova", voice_speed: 1.2 });
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    expect(mocks.setSessionVoice).toHaveBeenCalledWith("nova");
    expect(mocks.setSessionSpeed).toHaveBeenCalledWith(1.2);
  });

  it("successful load without reminders omits reminders hint", async () => {
    mocks.readProfile.mockReturnValue({ voice: "alloy" });
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ summary: string }>(result);
    expect(typeof data.summary).toBe("string");
    expect(data.summary).not.toContain("reminders/list");
  });

  it("summary contains voice and speed info", async () => {
    mocks.readProfile.mockReturnValue({ voice: "onyx", voice_speed: 1.1 });
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ summary: string }>(result);
    expect(data.summary).toContain("onyx");
    expect(data.summary).toContain("1.1×");
  });

  it("summary counts startup and recurring reminders separately", async () => {
    mocks.readProfile.mockReturnValue({
      reminders: [
        { text: "Boot msg", trigger: "startup", recurring: false },
        { text: "Hourly check", delay_seconds: 3600, recurring: true },
        { text: "One-shot", delay_seconds: 60, recurring: false },
      ],
    });
    mocks.addReminder.mockImplementation((r: { id: string; text: string; delay_seconds: number; recurring: boolean }) => ({
      ...r, state: "active", created_at: Date.now(), activated_at: Date.now(),
    }));
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ summary: string }>(result);
    // 1 startup reminder, 1 recurring
    expect(data.summary).toContain("1 startup reminder");
    expect(data.summary).toContain("1 recurring");
  });

  it("summary omits hex reminder IDs", async () => {
    mocks.readProfile.mockReturnValue({
      reminders: [{ text: "Check CI", delay_seconds: 0, recurring: false }],
    });
    mocks.addReminder.mockImplementation((r: { id: string; text: string; delay_seconds: number; recurring: boolean }) => ({
      ...r, state: "active", created_at: Date.now(), activated_at: Date.now(),
    }));
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ summary: string; applied?: unknown }>(result);
    // No 16-char hex string in summary
    expect(data.summary).not.toMatch(/\b[0-9a-f]{16}\b/);
    // applied is not present in response
    expect(data.applied).toBeUndefined();
  });

  it("summary without reminders omits help link for reminders", async () => {
    mocks.readProfile.mockReturnValue({ voice: "alloy" });
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ summary: string }>(result);
    expect(data.summary).not.toContain("help('reminders')");
  });

  it("uses content hash as reminder ID (not random UUID)", async () => {
    mocks.readProfile.mockReturnValue({
      reminders: [{ text: "Check CI", delay_seconds: 0, recurring: false }],
    });
    mocks.addReminder.mockImplementation((r: { id: string; text: string; delay_seconds: number; recurring: boolean }) => ({
      ...r, state: "active", created_at: Date.now(), activated_at: Date.now(),
    }));
    await call({ key: "Test", token: 1123456 });
    const expectedId = contentHash("Check CI", false);
    expect(mocks.addReminder).toHaveBeenCalledWith(
      expect.objectContaining({ id: expectedId }),
    );
  });

  it("loading same profile twice does not duplicate reminders (idempotent)", async () => {
    const reminderDef = { text: "Check CI", delay_seconds: 0, recurring: false };
    mocks.readProfile.mockReturnValue({ reminders: [reminderDef] });
    const existingId = contentHash("Check CI", false);

    const stub = {
      id: existingId, text: "Check CI", delay_seconds: 0, recurring: false,
      state: "active" as const, created_at: Date.now(), activated_at: Date.now(),
    };
    mocks.addReminder.mockReturnValue(stub);

    // First load — empty list, 1 time-based non-recurring reminder
    mocks.listReminders.mockReturnValue([]);
    const r1 = await call({ key: "Test", token: 1123456 });
    expect(isError(r1)).toBe(false);
    const d1 = parseResult<{ summary: string; applied?: unknown }>(r1);
    expect(typeof d1.summary).toBe("string");
    expect(d1.summary).toContain("0 startup reminder");
    expect(d1.applied).toBeUndefined();

    // Second load — existing reminder already present; summary still valid
    mocks.listReminders.mockReturnValue([stub]);
    const r2 = await call({ key: "Test", token: 1123456 });
    expect(isError(r2)).toBe(false);
    const d2 = parseResult<{ summary: string; applied?: unknown }>(r2);
    expect(typeof d2.summary).toBe("string");
    expect(d2.applied).toBeUndefined();
  });

  it("load_profile output summary reflects reminder counts (not raw IDs)", async () => {
    mocks.readProfile.mockReturnValue({
      reminders: [
        { text: "New reminder", delay_seconds: 0, recurring: false },
        { text: "Existing reminder", delay_seconds: 60, recurring: true },
      ],
    });
    const existingId = contentHash("Existing reminder", true);
    const existingStub = {
      id: existingId, text: "Existing reminder", delay_seconds: 60, recurring: true,
      state: "deferred" as const, created_at: Date.now(), activated_at: null,
    };
    mocks.listReminders.mockReturnValue([existingStub]);
    mocks.addReminder.mockImplementation((r: { id: string; text: string; delay_seconds: number; recurring: boolean }) => ({
      ...r, state: "active" as const, created_at: Date.now(), activated_at: Date.now(),
    }));

    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ summary: string; applied?: unknown }>(result);
    // summary is a string describing reminder counts
    expect(typeof data.summary).toBe("string");
    // 2 total reminders: 0 startup, 1 recurring
    expect(data.summary).toContain("0 startup reminder");
    expect(data.summary).toContain("1 recurring");
    // no raw hex IDs
    expect(data.summary).not.toMatch(/\b[0-9a-f]{16}\b/);
    // applied not exposed
    expect(data.applied).toBeUndefined();
  });

  it("empty profile produces empty summary", async () => {
    mocks.readProfile.mockReturnValue({});
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ summary: string }>(result);
    expect(typeof data.summary).toBe("string");
    // No reminders → no reminder hint
    expect(data.summary).not.toContain("reminders/list");
    // No voice section
    expect(data.summary).not.toMatch(/voice:/);
    // No preset count
    expect(data.summary).not.toMatch(/animation preset/);
    // No reminder count
    expect(data.summary).not.toMatch(/startup reminder/);
    expect(data.summary).not.toMatch(/recurring/);
  });

  it("reminder that is both startup and recurring counts only as startup (not both)", async () => {
    mocks.readProfile.mockReturnValue({
      reminders: [
        { text: "Boot msg", trigger: "startup", recurring: true },
      ],
    });
    mocks.addReminder.mockImplementation((r: { id: string; text: string; delay_seconds: number; recurring: boolean }) => ({
      ...r, state: "active", created_at: Date.now(), activated_at: Date.now(),
    }));
    const result = await call({ key: "Test", token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ summary: string }>(result);
    expect(data.summary).toContain("1 startup reminder");
    expect(data.summary).toContain("0 recurring");
  });

  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call({ key: "Test" });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED on invalid PIN", async () => {
      mocks.validateSession.mockReturnValue(false);
      const result = await call({ key: "Test", token: 1000000 });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("AUTH_FAILED");
    });
  });
});
