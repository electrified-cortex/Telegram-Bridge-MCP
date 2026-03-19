import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  createSession,
  closeSession,
  resetSessions,
} from "./session-manager.js";
import { SESSION_AUTH_SCHEMA, checkAuth } from "./session-auth.js";

beforeEach(() => {
  resetSessions();
});

describe("SESSION_AUTH_SCHEMA", () => {
  const schema = z.object(SESSION_AUTH_SCHEMA);

  it("accepts valid sid and pin", () => {
    const result = schema.safeParse({ sid: 1, pin: 123456 });
    expect(result.success).toBe(true);
  });

  it("rejects non-integer sid", () => {
    const result = schema.safeParse({ sid: 1.5, pin: 123456 });
    expect(result.success).toBe(false);
  });

  it("rejects zero sid", () => {
    const result = schema.safeParse({ sid: 0, pin: 123456 });
    expect(result.success).toBe(false);
  });

  it("rejects negative sid", () => {
    const result = schema.safeParse({ sid: -1, pin: 123456 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer pin", () => {
    const result = schema.safeParse({ sid: 1, pin: 12345.6 });
    expect(result.success).toBe(false);
  });

  it("rejects missing sid", () => {
    const result = schema.safeParse({ pin: 123456 });
    expect(result.success).toBe(false);
  });

  it("rejects missing pin", () => {
    const result = schema.safeParse({ sid: 1 });
    expect(result.success).toBe(false);
  });
});

describe("checkAuth", () => {
  it("returns undefined for valid credentials", () => {
    const s = createSession();
    expect(checkAuth(s.sid, s.pin)).toBeUndefined();
  });

  it("returns error result for wrong PIN", () => {
    const s = createSession();
    const result = checkAuth(s.sid, s.pin + 1);
    expect(result).toBeDefined();
    expect(result!.isError).toBe(true);
    const parsed = JSON.parse(
      (result!.content[0] as { text: string }).text,
    );
    expect(parsed.code).toBe("AUTH_FAILED");
  });

  it("returns error result for nonexistent session", () => {
    const result = checkAuth(999, 123456);
    expect(result).toBeDefined();
    expect(result!.isError).toBe(true);
  });

  it("returns error result after session is closed", () => {
    const s = createSession();
    closeSession(s.sid);
    const result = checkAuth(s.sid, s.pin);
    expect(result).toBeDefined();
    expect(result!.isError).toBe(true);
  });
});
