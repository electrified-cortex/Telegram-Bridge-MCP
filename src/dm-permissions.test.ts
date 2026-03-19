import { describe, it, expect, beforeEach } from "vitest";
import {
  hasDmPermission,
  revokeAllForSession,
  resetDmPermissionsForTest,
} from "./dm-permissions.js";

describe("dm-permissions", () => {
  beforeEach(() => {
    resetDmPermissionsForTest();
  });

  describe("hasDmPermission", () => {
    it("always returns true — all approved sessions can DM each other", () => {
      expect(hasDmPermission(1, 2)).toBe(true);
    });

    it("returns true in both directions without any setup", () => {
      expect(hasDmPermission(1, 2)).toBe(true);
      expect(hasDmPermission(2, 1)).toBe(true);
    });

    it("returns true for any session pair", () => {
      expect(hasDmPermission(100, 200)).toBe(true);
    });
  });

  describe("revokeAllForSession", () => {
    it("does not throw when called — no-op", () => {
      expect(() => { revokeAllForSession(1); }).not.toThrow();
    });

    it("permissions remain true after revokeAllForSession — implicit model", () => {
      revokeAllForSession(1);
      expect(hasDmPermission(1, 2)).toBe(true);
      expect(hasDmPermission(2, 1)).toBe(true);
    });
  });
});

