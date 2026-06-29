/**
 * Tests for profile/audio-remap action handlers.
 * Harness-agnostic: no real Telegram IDs. SIM payloads ASCII-only.
 * No proper names or phonetically personal strings in fixtures.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError } from "../test-utils.js";

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn((): boolean => false),
  getSession: vi.fn<() => { audio_remapping?: Record<string, string> } | undefined>(),
}));

vi.mock("../../session-manager.js", () => ({
  validateSession: mocks.validateSession,
  getSession: mocks.getSession,
}));

import {
  handleAudioRemapSet,
  handleAudioRemapRemove,
  handleAudioRemapList,
} from "./audio-remap.js";

const TOKEN = 1_123_456; // sid=1, suffix=123456

// =============================================================================
// handleAudioRemapSet
// =============================================================================

describe("handleAudioRemapSet", () => {
  let session: { audio_remapping?: Record<string, string> };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    session = {};
    mocks.getSession.mockReturnValue(session);
  });

  it("adds a new entry and returns { word, replacement, previous: null, set: true }", () => {
    const result = handleAudioRemapSet({ word: "api", replacement: "ay-pee-eye", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.word).toBe("api");
    expect(data.replacement).toBe("ay-pee-eye");
    expect(data.previous).toBeNull();
    expect(data.set).toBe(true);
    expect(session.audio_remapping?.["api"]).toBe("ay-pee-eye");
  });

  it("updates an existing entry and reports the previous value", () => {
    session.audio_remapping = { "db": "database" };
    const result = handleAudioRemapSet({ word: "db", replacement: "dee-bee", token: TOKEN });
    const data = parseResult(result);
    expect(data.previous).toBe("database");
    expect(data.replacement).toBe("dee-bee");
    expect(session.audio_remapping?.["db"]).toBe("dee-bee");
  });

  it("initializes the map when session has none", () => {
    expect(session.audio_remapping).toBeUndefined();
    handleAudioRemapSet({ word: "sql", replacement: "sequel", token: TOKEN });
    expect(session.audio_remapping).toBeDefined();
    expect(session.audio_remapping!["sql"]).toBe("sequel");
  });

  it("returns AUTH_FAILED when token is invalid", () => {
    mocks.validateSession.mockReturnValue(false);
    const result = handleAudioRemapSet({ word: "x", replacement: "y", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("AUTH_FAILED");
  });

  it("returns SESSION_NOT_FOUND when session is undefined", () => {
    mocks.getSession.mockReturnValue(undefined);
    const result = handleAudioRemapSet({ word: "x", replacement: "y", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SESSION_NOT_FOUND");
  });
});

// =============================================================================
// handleAudioRemapRemove
// =============================================================================

describe("handleAudioRemapRemove", () => {
  let session: { audio_remapping?: Record<string, string> };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    session = { audio_remapping: { "nginx": "engine-x", "sql": "sequel" } };
    mocks.getSession.mockReturnValue(session);
  });

  it("removes an existing entry and returns { word, previous, removed: true }", () => {
    const result = handleAudioRemapRemove({ word: "nginx", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.word).toBe("nginx");
    expect(data.previous).toBe("engine-x");
    expect(data.removed).toBe(true);
    expect("nginx" in (session.audio_remapping ?? {})).toBe(false);
  });

  it("clears audio_remapping to undefined when the last entry is removed", () => {
    session.audio_remapping = { "ssl": "es-es-el" };
    handleAudioRemapRemove({ word: "ssl", token: TOKEN });
    expect(session.audio_remapping).toBeUndefined();
  });

  it("returns NOT_FOUND when the word does not exist in the map", () => {
    const result = handleAudioRemapRemove({ word: "missing", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND when session has no audio_remapping map at all", () => {
    session.audio_remapping = undefined;
    const result = handleAudioRemapRemove({ word: "anything", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("NOT_FOUND");
  });

  it("returns AUTH_FAILED when token is invalid", () => {
    mocks.validateSession.mockReturnValue(false);
    const result = handleAudioRemapRemove({ word: "nginx", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("AUTH_FAILED");
  });
});

// =============================================================================
// handleAudioRemapList
// =============================================================================

describe("handleAudioRemapList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
  });

  it("returns empty entries when session has no audio_remapping", () => {
    mocks.getSession.mockReturnValue({});
    const result = handleAudioRemapList({ token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.entries).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("returns all entries as { word, replacement } pairs with count", () => {
    mocks.getSession.mockReturnValue({
      audio_remapping: { "nginx": "engine-x", "sql": "sequel" },
    });
    const result = handleAudioRemapList({ token: TOKEN });
    const data = parseResult(result);
    expect(data.count).toBe(2);
    expect(data.entries).toContainEqual({ word: "nginx", replacement: "engine-x" });
    expect(data.entries).toContainEqual({ word: "sql", replacement: "sequel" });
  });

  it("returns AUTH_FAILED when token is invalid", () => {
    mocks.validateSession.mockReturnValue(false);
    const result = handleAudioRemapList({ token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("AUTH_FAILED");
  });

  it("returns SESSION_NOT_FOUND when session is undefined", () => {
    mocks.getSession.mockReturnValue(undefined);
    const result = handleAudioRemapList({ token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("SESSION_NOT_FOUND");
  });
});
