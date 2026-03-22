import { vi, describe, it, expect, beforeEach } from "vitest";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// fs mock — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
  mkdirSync: mocks.mkdirSync,
}));

import { resolveProfilePath, readProfile, writeProfile } from "./profile-store.js";

// Repo root derived the same way as the module itself
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

describe("profile-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── resolveProfilePath ────────────────────────────────────────────────────

  describe("resolveProfilePath", () => {
    it("resolves a bare key to data/profiles/", () => {
      const path = resolveProfilePath("Overseer");
      expect(path).toBe(resolve(REPO_ROOT, "data", "profiles", "Overseer.json"));
    });

    it("resolves a path key relative to repo root", () => {
      const path = resolveProfilePath("profiles/Overseer");
      expect(path).toBe(resolve(REPO_ROOT, "profiles", "Overseer.json"));
    });

    it("resolves nested path keys", () => {
      const path = resolveProfilePath("custom/dir/myprofile");
      expect(path).toBe(resolve(REPO_ROOT, "custom", "dir", "myprofile.json"));
    });

    it("rejects keys containing path traversal (..)", () => {
      expect(() => resolveProfilePath("../etc/passwd")).toThrow("path traversal");
    });

    it("rejects keys containing .. in the middle", () => {
      expect(() => resolveProfilePath("profiles/../../../etc/passwd")).toThrow("path traversal");
    });

    it("rejects absolute paths (Unix style)", () => {
      expect(() => resolveProfilePath("/etc/passwd")).toThrow("absolute paths");
    });

    it("rejects null bytes", () => {
      expect(() => resolveProfilePath("key\0evil")).toThrow("null byte");
    });
  });

  // ── readProfile ───────────────────────────────────────────────────────────

  describe("readProfile", () => {
    it("returns null when the file does not exist", () => {
      mocks.existsSync.mockReturnValue(false);
      expect(readProfile("missing")).toBeNull();
    });

    it("parses and returns the profile when the file exists", () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue(
        JSON.stringify({ voice: "nova", animation_default: ["⠋", "⠙"] }),
      );
      const result = readProfile("test");
      expect(result).toEqual({ voice: "nova", animation_default: ["⠋", "⠙"] });
    });

    it("reads from the correct path for bare keys", () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue("{}");
      readProfile("MyProfile");
      const expectedPath = resolve(REPO_ROOT, "data", "profiles", "MyProfile.json");
      expect(mocks.existsSync).toHaveBeenCalledWith(expectedPath);
      expect(mocks.readFileSync).toHaveBeenCalledWith(expectedPath, "utf-8");
    });

    it("reads from the correct path for path keys", () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue("{}");
      readProfile("profiles/Workers");
      const expectedPath = resolve(REPO_ROOT, "profiles", "Workers.json");
      expect(mocks.readFileSync).toHaveBeenCalledWith(expectedPath, "utf-8");
    });

    it("handles profiles with all optional fields absent", () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue("{}");
      expect(readProfile("empty")).toEqual({});
    });

    it("ignores unknown top-level fields (forward compatibility)", () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue(JSON.stringify({ voice: "alloy", future_field: 42 }));
      const result = readProfile("future");
      // Parsed as-is — unknown fields are preserved (callers ignore them)
      expect(result).toMatchObject({ voice: "alloy" });
    });
  });

  // ── writeProfile ──────────────────────────────────────────────────────────

  describe("writeProfile", () => {
    it("creates parent directories and writes the file", () => {
      mocks.mkdirSync.mockImplementation(() => undefined);
      mocks.writeFileSync.mockImplementation(() => undefined);

      writeProfile("TestKey", { voice: "alloy" });

      const expectedPath = resolve(REPO_ROOT, "data", "profiles", "TestKey.json");
      const expectedDir = resolve(REPO_ROOT, "data", "profiles");

      expect(mocks.mkdirSync).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(mocks.writeFileSync).toHaveBeenCalledWith(
        expectedPath,
        expect.stringContaining('"voice": "alloy"'),
        "utf-8",
      );
    });

    it("serializes all profile fields", () => {
      mocks.mkdirSync.mockImplementation(() => undefined);
      mocks.writeFileSync.mockImplementation(() => undefined);

      const data = {
        voice: "nova",
        animation_default: ["⠋", "⠙"],
        animation_presets: { thinking: ["🤔"] },
        reminders: [{ text: "check board", delay_seconds: 900, recurring: true }],
      };

      writeProfile("full", data);

      const [, written] = mocks.writeFileSync.mock.calls[0] as [string, string, string];
      const parsed = JSON.parse(written);
      expect(parsed).toEqual(data);
    });

    it("ends written content with a newline", () => {
      mocks.mkdirSync.mockImplementation(() => undefined);
      mocks.writeFileSync.mockImplementation(() => undefined);

      writeProfile("newline-test", { voice: "echo" });

      const [, written] = mocks.writeFileSync.mock.calls[0] as [string, string, string];
      expect(written.endsWith("\n")).toBe(true);
    });
  });

  // ── round-trip ────────────────────────────────────────────────────────────

  describe("write + read round-trip", () => {
    it("returns the same data that was written", () => {
      let stored = "";
      mocks.mkdirSync.mockImplementation(() => undefined);
      mocks.writeFileSync.mockImplementation((_p: string, content: string) => {
        stored = content;
      });
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockImplementation(() => stored);

      const original = {
        voice: "shimmer",
        animation_default: ["a", "b", "c"],
        animation_presets: { working: ["w1", "w2"] },
        reminders: [{ text: "ping", delay_seconds: 300, recurring: false }],
      };

      writeProfile("roundtrip", original);
      const result = readProfile("roundtrip");

      expect(result).toEqual(original);
    });

    it("includes voice_speed in round-trip when set", () => {
      let stored = "";
      mocks.mkdirSync.mockImplementation(() => undefined);
      mocks.writeFileSync.mockImplementation((_p: string, content: string) => {
        stored = content;
      });
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockImplementation(() => stored);

      const original = {
        voice: "nova",
        voice_speed: 1.5,
        animation_default: ["a", "b"],
      };

      writeProfile("roundtrip-speed", original);
      const result = readProfile("roundtrip-speed");

      expect(result).toEqual(original);
      expect(result?.voice_speed).toBe(1.5);
    });
  });
});
