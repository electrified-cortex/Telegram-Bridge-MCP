import { vi, describe, it, expect, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
}));

import {
  loadConfig,
  getSessionLogMode,
  setSessionLogMode,
  sessionLogLabel,
  getDefaultVoice,
  setDefaultVoice,
  getConfiguredVoices,
  setConfiguredVoices,
  resetConfigForTest,
} from "./config.js";

describe("config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConfigForTest();
    mocks.writeFileSync.mockImplementation(() => undefined);
  });

  // ── loadConfig ────────────────────────────────────────────────────────────

  describe("loadConfig", () => {
    it("starts empty when file does not exist", () => {
      mocks.existsSync.mockReturnValue(false);
      loadConfig();
      expect(getSessionLogMode()).toBeNull();
      expect(getDefaultVoice()).toBeNull();
    });

    it("reads and parses a valid config file", () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue(JSON.stringify({ sessionLog: 50, defaultVoice: "nova" }));
      loadConfig();
      expect(getSessionLogMode()).toBe(50);
      expect(getDefaultVoice()).toBe("nova");
    });

    it("falls back to empty config on invalid JSON", () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue("not json {{{");
      loadConfig();
      expect(getSessionLogMode()).toBeNull();
    });

    it("falls back to empty config when JSON is not an object", () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue("42");
      loadConfig();
      expect(getSessionLogMode()).toBeNull();
    });

    it("falls back to empty config when JSON is null", () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue("null");
      loadConfig();
      expect(getSessionLogMode()).toBeNull();
    });

    it("loads voice list from config", () => {
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue(
        JSON.stringify({ voices: [{ name: "af_heart", language: "en" }] }),
      );
      loadConfig();
      expect(getConfiguredVoices()).toEqual([{ name: "af_heart", language: "en" }]);
    });
  });

  // ── getSessionLogMode / setSessionLogMode ─────────────────────────────────

  describe("getSessionLogMode / setSessionLogMode", () => {
    it("returns null by default", () => {
      expect(getSessionLogMode()).toBeNull();
    });

    it("returns 'manual' when set to manual", () => {
      setSessionLogMode("manual");
      expect(getSessionLogMode()).toBe("manual");
    });

    it("returns a positive integer when set to one", () => {
      setSessionLogMode(50);
      expect(getSessionLogMode()).toBe(50);
    });

    it("floors floating-point numbers", () => {
      setSessionLogMode(50.9);
      expect(getSessionLogMode()).toBe(50);
    });

    it("returns null when set back to null", () => {
      setSessionLogMode("manual");
      setSessionLogMode(null);
      expect(getSessionLogMode()).toBeNull();
    });

    it("returns null for zero", () => {
      setSessionLogMode(0);
      expect(getSessionLogMode()).toBeNull();
    });

    it("returns null for negative numbers", () => {
      setSessionLogMode(-5);
      expect(getSessionLogMode()).toBeNull();
    });

    it("returns null for Infinity", () => {
      setSessionLogMode(Infinity);
      expect(getSessionLogMode()).toBeNull();
    });

    it("persists to disk on every change", () => {
      setSessionLogMode(10);
      expect(mocks.writeFileSync).toHaveBeenCalledTimes(1);
      setSessionLogMode(null);
      expect(mocks.writeFileSync).toHaveBeenCalledTimes(2);
    });

    it("silently ignores writeFileSync errors", () => {
      mocks.writeFileSync.mockImplementation(() => { throw new Error("permission denied"); });
      expect(() => { setSessionLogMode(10); }).not.toThrow();
    });
  });

  // ── sessionLogLabel ───────────────────────────────────────────────────────

  describe("sessionLogLabel", () => {
    it("returns 'disabled' when mode is null", () => {
      expect(sessionLogLabel()).toBe("disabled");
    });

    it("returns 'manual' when mode is manual", () => {
      setSessionLogMode("manual");
      expect(sessionLogLabel()).toBe("manual");
    });

    it("returns 'every N messages' for a numeric mode", () => {
      setSessionLogMode(50);
      expect(sessionLogLabel()).toBe("every 50 messages");
    });
  });

  // ── getDefaultVoice / setDefaultVoice ─────────────────────────────────────

  describe("getDefaultVoice / setDefaultVoice", () => {
    it("returns null by default", () => {
      expect(getDefaultVoice()).toBeNull();
    });

    it("returns the configured voice", () => {
      setDefaultVoice("af_heart");
      expect(getDefaultVoice()).toBe("af_heart");
    });

    it("clears the voice when set to null", () => {
      setDefaultVoice("af_heart");
      setDefaultVoice(null);
      expect(getDefaultVoice()).toBeNull();
    });

    it("persists to disk", () => {
      setDefaultVoice("nova");
      expect(mocks.writeFileSync).toHaveBeenCalled();
    });
  });

  // ── getConfiguredVoices / setConfiguredVoices ─────────────────────────────

  describe("getConfiguredVoices / setConfiguredVoices", () => {
    it("returns empty array by default", () => {
      expect(getConfiguredVoices()).toEqual([]);
    });

    it("returns configured voices", () => {
      const voices = [{ name: "af_heart", language: "en", gender: "female" }];
      setConfiguredVoices(voices);
      expect(getConfiguredVoices()).toEqual(voices);
    });

    it("clears voices when set to an empty array", () => {
      setConfiguredVoices([{ name: "nova" }]);
      setConfiguredVoices([]);
      expect(getConfiguredVoices()).toEqual([]);
    });

    it("persists to disk", () => {
      setConfiguredVoices([{ name: "nova" }]);
      expect(mocks.writeFileSync).toHaveBeenCalled();
    });
  });
});
