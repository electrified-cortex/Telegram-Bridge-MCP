import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError } from "./test-utils.js";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

type MockSession = { name: string; color?: string; name_tag?: string };

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn((): boolean => true),
  getSession: vi.fn((): MockSession | undefined => undefined),
  requireAuth: vi.fn((): number | { code: string; message: string } => 1),
}));

vi.mock("../session-gate.js", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("../session-manager.js", () => ({
  getSession: mocks.getSession,
}));

import { handleNameTag } from "./name-tag.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function call(args: { token: number; name_tag?: string }) {
  return handleNameTag(args);
}

describe("handleNameTag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockReturnValue(1);
    mocks.getSession.mockReturnValue({ name: "Scout", color: "🟦" });
  });

  // ── GET ────────────────────────────────────────────────────────────────

  describe("GET (no name_tag arg)", () => {
    it("returns the auto-default '<color> <name>' when no explicit name_tag set", () => {
      const result = call({ token: 1000001 });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.name_tag).toBe("🟦 Scout");
      expect(data.custom).toBe(false);
    });

    it("returns just name when session has no color", () => {
      mocks.getSession.mockReturnValue({ name: "Scout" });
      const result = call({ token: 1000001 });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.name_tag).toBe("Scout");
      expect(data.custom).toBe(false);
    });

    it("returns explicit name_tag when one is set", () => {
      mocks.getSession.mockReturnValue({ name: "Scout", color: "🟦", name_tag: "Lawnmower 💃" });
      const result = call({ token: 1000001 });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.name_tag).toBe("Lawnmower 💃");
      expect(data.custom).toBe(true);
    });
  });

  // ── SET ────────────────────────────────────────────────────────────────

  describe("SET (name_tag arg provided)", () => {
    it("stores and returns the new name tag", () => {
      const session: MockSession = { name: "Scout", color: "🟦" };
      mocks.getSession.mockReturnValue(session);

      const result = call({ token: 1000001, name_tag: "Overlord 🦅" });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      expect(data.name_tag).toBe("Overlord 🦅");
      expect(data.custom).toBe(true);
      expect(session.name_tag).toBe("Overlord 🦅");
    });

    it("GET-after-SET returns the new name tag", () => {
      const session: MockSession = { name: "Scout", color: "🟦" };
      mocks.getSession.mockReturnValue(session);

      call({ token: 1000001, name_tag: "Phoenix 🔥" });
      const result = call({ token: 1000001 });
      expect(parseResult(result).name_tag).toBe("Phoenix 🔥");
    });

    it("empty string resets to auto-default (removes override)", () => {
      const session: MockSession = { name: "Scout", color: "🟦", name_tag: "Old" };
      mocks.getSession.mockReturnValue(session);

      const result = call({ token: 1000001, name_tag: "" });
      expect(isError(result)).toBe(false);
      const data = parseResult(result);
      // After reset, effective tag is the auto-default
      expect(data.name_tag).toBe("🟦 Scout");
      expect(data.custom).toBe(false);
      expect(session.name_tag).toBeUndefined();
    });
  });

  // ── Validation ─────────────────────────────────────────────────────────

  describe("validation", () => {
    it("rejects name_tag with embedded newline", () => {
      const result = call({ token: 1000001, name_tag: "bad\ntag" });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("INVALID_NAME_TAG");
    });

    it("rejects name_tag longer than 64 characters", () => {
      const result = call({ token: 1000001, name_tag: "a".repeat(65) });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("INVALID_NAME_TAG");
    });

    it("accepts name_tag of exactly 64 characters", () => {
      const session: MockSession = { name: "Scout", color: "🟦" };
      mocks.getSession.mockReturnValue(session);
      const result = call({ token: 1000001, name_tag: "a".repeat(64) });
      expect(isError(result)).toBe(false);
    });
  });

  // ── Auth ───────────────────────────────────────────────────────────────

  describe("auth", () => {
    it("returns error when requireAuth fails", () => {
      mocks.requireAuth.mockReturnValue({ code: "AUTH_FAILED", message: "Bad token" });
      const result = call({ token: 9999999 });
      expect(isError(result)).toBe(true);
    });

    it("returns SESSION_NOT_FOUND when getSession returns undefined", () => {
      mocks.getSession.mockReturnValue(undefined);
      const result = call({ token: 1000001 });
      expect(isError(result)).toBe(true);
      expect(parseResult(result).code).toBe("SESSION_NOT_FOUND");
    });
  });
});
