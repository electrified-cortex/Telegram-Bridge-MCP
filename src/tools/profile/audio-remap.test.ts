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
    const result = handleAudioRemapSet({ word: "zorp", replacement: "ZOR-pee", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.word).toBe("zorp");
    expect(data.replacement).toBe("ZOR-pee");
    expect(data.previous).toBeNull();
    expect(data.set).toBe(true);
    expect(session.audio_remapping?.["zorp"]).toBe("ZOR-pee");
  });

  it("normalizes word to lowercase on new entry", () => {
    const result = handleAudioRemapSet({ word: "Zorp", replacement: "ZOR-pee", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.word).toBe("zorp");
    expect(session.audio_remapping?.["zorp"]).toBe("ZOR-pee");
    expect("Zorp" in (session.audio_remapping ?? {})).toBe(false);
  });

  it("updates an existing entry and reports the previous value", () => {
    session.audio_remapping = { "flibble": "FLIB-ul" };
    const result = handleAudioRemapSet({ word: "flibble", replacement: "flib-ul", token: TOKEN });
    const data = parseResult(result);
    expect(data.previous).toBe("FLIB-ul");
    expect(data.replacement).toBe("flib-ul");
    expect(session.audio_remapping?.["flibble"]).toBe("flib-ul");
  });

  it("updates normalized key when mixed-case word matches same phonetics", () => {
    // Existing entry at 'zorp' → 'ZOR-pee'; setting 'Zorp' → 'ZOR-pee' (same phonetics) updates in place
    session.audio_remapping = { "zorp": "ZOR-pee" };
    const result = handleAudioRemapSet({ word: "Zorp", replacement: "ZOR-pee", token: TOKEN });
    const data = parseResult(result);
    expect(data.word).toBe("zorp");
    expect(data.previous).toBe("ZOR-pee");
    expect(session.audio_remapping?.["zorp"]).toBe("ZOR-pee");
    expect("Zorp" in (session.audio_remapping ?? {})).toBe(false);
  });

  it("creates case-sensitive exception entry when casing differs AND phonetics differ", () => {
    // 'zorp' → 'ZOR-pee' already stored; setting 'ZORP' → 'kyoox' (distinct phonetics) → new verbatim key
    session.audio_remapping = { "zorp": "ZOR-pee" };
    const result = handleAudioRemapSet({ word: "ZORP", replacement: "kyoox", token: TOKEN });
    const data = parseResult(result);
    expect(data.word).toBe("ZORP");
    expect(data.previous).toBeNull();
    expect(session.audio_remapping?.["zorp"]).toBe("ZOR-pee");
    expect(session.audio_remapping?.["ZORP"]).toBe("kyoox");
  });

  it("updates verbatim exception entry when exact key already stored", () => {
    session.audio_remapping = { "zorp": "ZOR-pee", "ZORP": "kyoox" };
    const result = handleAudioRemapSet({ word: "ZORP", replacement: "KYO-ox", token: TOKEN });
    const data = parseResult(result);
    expect(data.word).toBe("ZORP");
    expect(data.previous).toBe("kyoox");
    expect(session.audio_remapping?.["ZORP"]).toBe("KYO-ox");
  });

  it("initializes the map when session has none", () => {
    expect(session.audio_remapping).toBeUndefined();
    handleAudioRemapSet({ word: "quux", replacement: "kyoox", token: TOKEN });
    expect(session.audio_remapping).toBeDefined();
    expect(session.audio_remapping!["quux"]).toBe("kyoox");
  });

  it("returns INVALID_INPUT when word is empty string", () => {
    const result = handleAudioRemapSet({ word: "", replacement: "ZOR-pee", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when replacement is empty string", () => {
    const result = handleAudioRemapSet({ word: "zorp", replacement: "", token: TOKEN });
    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("INVALID_INPUT");
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
    session = { audio_remapping: { "zorp": "ZOR-pee", "flibble": "FLIB-ul" } };
    mocks.getSession.mockReturnValue(session);
  });

  it("removes an existing entry and returns { word, previous, removed: true }", () => {
    const result = handleAudioRemapRemove({ word: "zorp", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.word).toBe("zorp");
    expect(data.previous).toBe("ZOR-pee");
    expect(data.removed).toBe(true);
    expect("zorp" in (session.audio_remapping ?? {})).toBe(false);
  });

  it("removes via case-insensitive fallback when stored key is lowercase", () => {
    // session has 'zorp'; removing 'Zorp' should find and delete 'zorp'
    const result = handleAudioRemapRemove({ word: "Zorp", token: TOKEN });
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.word).toBe("zorp");
    expect(data.previous).toBe("ZOR-pee");
    expect("zorp" in (session.audio_remapping ?? {})).toBe(false);
  });

  it("removes verbatim exception entry when exact key matches (not normalized)", () => {
    session.audio_remapping = { "zorp": "ZOR-pee", "ZORP": "kyoox" };
    const result = handleAudioRemapRemove({ word: "ZORP", token: TOKEN });
    const data = parseResult(result);
    expect(data.word).toBe("ZORP");
    expect(data.previous).toBe("kyoox");
    // normalized entry must remain
    expect(session.audio_remapping?.["zorp"]).toBe("ZOR-pee");
    expect("ZORP" in (session.audio_remapping ?? {})).toBe(false);
  });

  it("clears audio_remapping to undefined when the last entry is removed", () => {
    session.audio_remapping = { "quux": "kyoox" };
    handleAudioRemapRemove({ word: "quux", token: TOKEN });
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
    const result = handleAudioRemapRemove({ word: "zorp", token: TOKEN });
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
      audio_remapping: { "zorp": "ZOR-pee", "flibble": "FLIB-ul" },
    });
    const result = handleAudioRemapList({ token: TOKEN });
    const data = parseResult(result);
    expect(data.count).toBe(2);
    expect(data.entries).toContainEqual({ word: "zorp", replacement: "ZOR-pee" });
    expect(data.entries).toContainEqual({ word: "flibble", replacement: "FLIB-ul" });
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
