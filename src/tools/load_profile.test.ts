import { vi, describe, it, expect, beforeEach } from "vitest";
import { createHash } from "crypto";
import { createMockServer, parseResult, isError } from "./test-utils.js";

function contentHash(text: string, recurring: boolean): string {
  return createHash("sha256").update(`${text}\0${recurring}`).digest("hex").slice(0, 16);
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
  reminderContentHash: (text: string, recurring: boolean) => contentHash(text, recurring),
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

    // First load — empty list
    mocks.listReminders.mockReturnValue([]);
    const r1 = await call({ key: "Test", token: 1123456 });
    const d1 = parseResult<{ applied: { reminders: { added: string[]; updated: string[] } } }>(r1);
    expect(d1.applied.reminders.added).toContain(existingId);
    expect(d1.applied.reminders.updated).toHaveLength(0);

    // Second load — existing reminder already present
    mocks.listReminders.mockReturnValue([stub]);
    const r2 = await call({ key: "Test", token: 1123456 });
    const d2 = parseResult<{ applied: { reminders: { added: string[]; updated: string[]; review_recommended?: boolean } } }>(r2);
    expect(d2.applied.reminders.added).toHaveLength(0);
    expect(d2.applied.reminders.updated).toContain(existingId);
    expect(d2.applied.reminders.review_recommended).toBe(true);
  });

  it("load_profile output distinguishes added vs updated reminders", async () => {
    mocks.readProfile.mockReturnValue({
      reminders: [
        { text: "New reminder", delay_seconds: 0, recurring: false },
        { text: "Existing reminder", delay_seconds: 60, recurring: true },
      ],
    });
    const existingId = contentHash("Existing reminder", true);
    const newId = contentHash("New reminder", false);
    const existingStub = {
      id: existingId, text: "Existing reminder", delay_seconds: 60, recurring: true,
      state: "deferred" as const, created_at: Date.now(), activated_at: null,
    };
    mocks.listReminders.mockReturnValue([existingStub]);
    mocks.addReminder.mockImplementation((r: { id: string; text: string; delay_seconds: number; recurring: boolean }) => ({
      ...r, state: "active" as const, created_at: Date.now(), activated_at: Date.now(),
    }));

    const result = await call({ key: "Test", token: 1123456 });
    const data = parseResult<{
      applied: { reminders: { added: string[]; updated: string[]; review_recommended?: boolean } };
    }>(result);
    expect(data.applied.reminders.added).toContain(newId);
    expect(data.applied.reminders.updated).toContain(existingId);
    expect(data.applied.reminders.review_recommended).toBe(true);
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
