import { vi, describe, it, expect, beforeEach } from "vitest";
import { createHash } from "crypto";
import { createMockServer, parseResult, isError } from "./test-utils.js";

function contentHash(text: string, recurring: boolean, trigger: "time" | "startup" = "time"): string {
  return createHash("sha256").update(`${text}\0${recurring}\0${trigger}`).digest("hex").slice(0, 16);
}

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn((): boolean => false),
  setSessionVoice: vi.fn(),
  setSessionSpeed: vi.fn(),
  setSessionDefault: vi.fn(),
  registerPreset: vi.fn(),
  addReminder: vi.fn(),
  listReminders: vi.fn((): Array<Record<string, unknown>> => []),
}));

vi.mock("../session-manager.js", () => ({ validateSession: mocks.validateSession }));
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

import { register } from "./import_profile.js";

describe("import_profile tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.listReminders.mockReturnValue([]);
    const server = createMockServer();
    register(server);
    call = server.getHandler("import_profile");
  });

  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call({ voice: "nova" });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED on invalid token", async () => {
      mocks.validateSession.mockReturnValue(false);
      const result = await call({ voice: "nova", token: 1000000 });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("AUTH_FAILED");
    });
  });

  it("imports voice and voice_speed", async () => {
    const result = await call({ voice: "nova", voice_speed: 1.1, token: 1123456 });
    expect(isError(result)).toBe(false);
    expect(mocks.setSessionVoice).toHaveBeenCalledWith("nova");
    expect(mocks.setSessionSpeed).toHaveBeenCalledWith(1.1);
    const data = parseResult<{ imported: boolean; applied: Record<string, unknown> }>(result);
    expect(data.imported).toBe(true);
    expect(data.applied.voice).toBe("nova");
    expect(data.applied.voice_speed).toBe(1.1);
  });

  it("imports animation_default", async () => {
    const frames = ["🤔", "🤔", "🧐"];
    const result = await call({ animation_default: frames, token: 1123456 });
    expect(isError(result)).toBe(false);
    expect(mocks.setSessionDefault).toHaveBeenCalledWith(1, frames);
    const data = parseResult<{ applied: Record<string, unknown> }>(result);
    expect(data.applied.animation_default).toBe(true);
  });

  it("imports animation_presets", async () => {
    const presets = { thinking: ["🤔", "🧐"], working: ["👨‍💻", "🔧"] };
    const result = await call({ animation_presets: presets, token: 1123456 });
    expect(isError(result)).toBe(false);
    expect(mocks.registerPreset).toHaveBeenCalledWith(1, "thinking", ["🤔", "🧐"]);
    expect(mocks.registerPreset).toHaveBeenCalledWith(1, "working", ["👨‍💻", "🔧"]);
    const data = parseResult<{ applied: { presets: string[] } }>(result);
    expect(data.applied.presets).toContain("thinking");
    expect(data.applied.presets).toContain("working");
  });

  it("imports reminders with content-hash IDs", async () => {
    mocks.addReminder.mockImplementation((r: { id: string; text: string; delay_seconds: number; recurring: boolean }) => ({
      ...r, state: "active", created_at: Date.now(), activated_at: Date.now(),
    }));
    const result = await call({
      reminders: [{ text: "Check CI", delay_seconds: 0, recurring: false }],
      token: 1123456,
    });
    expect(isError(result)).toBe(false);
    const expectedId = contentHash("Check CI", false);
    expect(mocks.addReminder).toHaveBeenCalledWith(
      expect.objectContaining({ id: expectedId }),
    );
  });

  it("sparse merge — missing keys do not clear existing state", async () => {
    const result = await call({ voice: "alloy", token: 1123456 });
    expect(isError(result)).toBe(false);
    expect(mocks.setSessionVoice).toHaveBeenCalledWith("alloy");
    expect(mocks.setSessionSpeed).not.toHaveBeenCalled();
    expect(mocks.setSessionDefault).not.toHaveBeenCalled();
    expect(mocks.registerPreset).not.toHaveBeenCalled();
    expect(mocks.addReminder).not.toHaveBeenCalled();
  });

  it("importing same reminders twice is idempotent — second import shows updated", async () => {
    const reminderDef = { text: "Check CI", delay_seconds: 0, recurring: false };
    const existingId = contentHash("Check CI", false);
    const stub = {
      id: existingId, text: "Check CI", delay_seconds: 0, recurring: false,
      state: "active" as const, created_at: Date.now(), activated_at: Date.now(),
    };
    mocks.addReminder.mockReturnValue(stub);

    // First import
    mocks.listReminders.mockReturnValue([]);
    const r1 = await call({ reminders: [reminderDef], token: 1123456 });
    const d1 = parseResult<{ applied: { reminders: { added: string[]; updated: string[] } } }>(r1);
    expect(d1.applied.reminders.added).toContain(existingId);
    expect(d1.applied.reminders.updated).toHaveLength(0);

    // Second import — reminder already present
    mocks.listReminders.mockReturnValue([stub]);
    const r2 = await call({ reminders: [reminderDef], token: 1123456 });
    const d2 = parseResult<{ applied: { reminders: { added: string[]; updated: string[]; review_recommended?: boolean } } }>(r2);
    expect(d2.applied.reminders.added).toHaveLength(0);
    expect(d2.applied.reminders.updated).toContain(existingId);
    expect(d2.applied.reminders.review_recommended).toBe(true);
  });

  it("returns applied summary on success", async () => {
    mocks.addReminder.mockImplementation((r: { id: string; text: string; delay_seconds: number; recurring: boolean }) => ({
      ...r, state: "active", created_at: Date.now(), activated_at: Date.now(),
    }));
    const result = await call({
      voice: "nova",
      voice_speed: 1.0,
      animation_presets: { thinking: ["🤔"] },
      reminders: [{ text: "Hello", delay_seconds: 60, recurring: true }],
      token: 1123456,
    });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ imported: boolean; applied: Record<string, unknown> }>(result);
    expect(data.imported).toBe(true);
    expect(data.applied).toHaveProperty("voice", "nova");
    expect(data.applied).toHaveProperty("voice_speed", 1.0);
    expect(data.applied).toHaveProperty("presets");
    expect(data.applied).toHaveProperty("reminders");
  });

  it("empty call with only identity returns empty applied", async () => {
    const result = await call({ token: 1123456 });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ imported: boolean; applied: Record<string, unknown> }>(result);
    expect(data.imported).toBe(true);
    expect(data.applied).toEqual({});
  });

  it("recurring defaults to false when omitted from reminders", async () => {
    mocks.addReminder.mockImplementation((r: { id: string; text: string; delay_seconds: number; recurring: boolean }) => ({
      ...r, state: "active", created_at: Date.now(), activated_at: Date.now(),
    }));
    const result = await call({
      // recurring intentionally omitted — should default to false via Zod default
      reminders: [{ text: "One-shot", delay_seconds: 30 }],
      token: 1123456,
    });
    expect(isError(result)).toBe(false);
    expect(mocks.addReminder).toHaveBeenCalledWith(
      expect.objectContaining({ text: "One-shot", recurring: false }),
    );
  });
});
