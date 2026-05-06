import { describe, it, expect, beforeEach } from "vitest";
import { getFirstUseHint, appendHintToResult, hasSeenHint, markFirstUseHintSeen } from "./first-use-hints.js";
import { createSession, resetSessions } from "./session-manager.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(): number {
  const { sid } = createSession("test");
  return sid;
}

function makeResult(data: Record<string, unknown> = { message_id: 1 }) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

function makeErrorResult() {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ code: "SOME_ERR", message: "oops" }) }],
    isError: true as const,
  };
}

function parsedContent(result: { content: { type: string; text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("getFirstUseHint", () => {
  beforeEach(() => {
    resetSessions();
  });

  it("returns hint text on first call for send:choice", () => {
    const sid = makeSession();
    const hint = getFirstUseHint(sid, "send:choice");
    expect(hint).not.toBeNull();
    expect(typeof hint).toBe("string");
    expect(hint).toContain('send(type: "question", choose: [...])');
  });

  it("returns null on second call for send:choice (no repeat)", () => {
    const sid = makeSession();
    getFirstUseHint(sid, "send:choice"); // consume first use
    const hint = getFirstUseHint(sid, "send:choice");
    expect(hint).toBeNull();
  });

  it("returns hint text on first call for send:question:choose", () => {
    const sid = makeSession();
    const hint = getFirstUseHint(sid, "send:question:choose");
    expect(hint).not.toBeNull();
    expect(typeof hint).toBe("string");
    expect(hint).toContain('send(type: "choice")');
  });

  it("returns null on second call for send:question:choose", () => {
    const sid = makeSession();
    getFirstUseHint(sid, "send:question:choose");
    expect(getFirstUseHint(sid, "send:question:choose")).toBeNull();
  });

  it("returns hint text on first call for send:progress", () => {
    const sid = makeSession();
    const hint = getFirstUseHint(sid, "send:progress");
    expect(hint).not.toBeNull();
    expect(typeof hint).toBe("string");
    expect(hint).toContain("progress/update");
  });

  it("returns null on second call for send:progress", () => {
    const sid = makeSession();
    getFirstUseHint(sid, "send:progress");
    expect(getFirstUseHint(sid, "send:progress")).toBeNull();
  });

  it("returns hint text on first call for send:checklist", () => {
    const sid = makeSession();
    const hint = getFirstUseHint(sid, "send:checklist");
    expect(hint).not.toBeNull();
    expect(typeof hint).toBe("string");
    expect(hint).toContain("checklist/update");
  });

  it("returns null on second call for send:checklist", () => {
    const sid = makeSession();
    getFirstUseHint(sid, "send:checklist");
    expect(getFirstUseHint(sid, "send:checklist")).toBeNull();
  });

  it("returns hint text on first call for send:animation", () => {
    const sid = makeSession();
    const hint = getFirstUseHint(sid, "send:animation");
    expect(hint).not.toBeNull();
    expect(typeof hint).toBe("string");
    expect(hint).toContain("help('animation')");
  });

  it("returns null on second call for send:animation", () => {
    const sid = makeSession();
    getFirstUseHint(sid, "send:animation");
    expect(getFirstUseHint(sid, "send:animation")).toBeNull();
  });

  it("returns hint text on first call for send:append", () => {
    const sid = makeSession();
    const hint = getFirstUseHint(sid, "send:append");
    expect(hint).not.toBeNull();
    expect(typeof hint).toBe("string");
    expect((hint as string).length).toBeGreaterThan(0);
  });

  it("returns null on second call for send:append", () => {
    const sid = makeSession();
    getFirstUseHint(sid, "send:append");
    expect(getFirstUseHint(sid, "send:append")).toBeNull();
  });

  it("tracks hint seen state independently per hint key", () => {
    const sid = makeSession();
    getFirstUseHint(sid, "send:choice"); // mark choice as seen
    // progress is still unseen — should still return hint
    expect(getFirstUseHint(sid, "send:progress")).not.toBeNull();
    // choice is seen — no hint
    expect(getFirstUseHint(sid, "send:choice")).toBeNull();
  });

  it("tracks hint seen state independently per session", () => {
    const sid1 = makeSession();
    const sid2 = makeSession();
    getFirstUseHint(sid1, "send:choice"); // mark for sid1 only
    // sid2 should still see the first-use hint
    expect(getFirstUseHint(sid2, "send:choice")).not.toBeNull();
  });

  it("returns null for unknown hint keys", () => {
    const sid = makeSession();
    expect(getFirstUseHint(sid, "send:nonexistent")).toBeNull();
  });

  it("returns null for invalid session id", () => {
    expect(getFirstUseHint(9999, "send:choice")).toBeNull();
  });
});

describe("hasSeenHint", () => {
  beforeEach(() => {
    resetSessions();
  });

  it("returns false before hint has been shown", () => {
    const sid = makeSession();
    expect(hasSeenHint(sid, "send:choice")).toBe(false);
  });

  it("returns true after hint has been shown via getFirstUseHint", () => {
    const sid = makeSession();
    getFirstUseHint(sid, "send:choice");
    expect(hasSeenHint(sid, "send:choice")).toBe(true);
  });

  it("returns false for a different hint key that has not been seen", () => {
    const sid = makeSession();
    getFirstUseHint(sid, "send:choice");
    expect(hasSeenHint(sid, "send:progress")).toBe(false);
  });

  it("returns false for invalid session id", () => {
    expect(hasSeenHint(9999, "send:choice")).toBe(false);
  });

  it("returns true after markFirstUseHintSeen was called for same key", () => {
    const sid = makeSession();
    markFirstUseHintSeen(sid, "send:choice");
    expect(hasSeenHint(sid, "send:choice")).toBe(true);
  });
});

describe("markFirstUseHintSeen", () => {
  beforeEach(() => {
    resetSessions();
  });

  it("returns true on first mark", () => {
    const sid = makeSession();
    expect(markFirstUseHintSeen(sid, "send:choice")).toBe(true);
  });

  it("returns false on subsequent marks for the same key", () => {
    const sid = makeSession();
    markFirstUseHintSeen(sid, "send:choice");
    expect(markFirstUseHintSeen(sid, "send:choice")).toBe(false);
  });

  it("returns false for invalid session id", () => {
    expect(markFirstUseHintSeen(9999, "send:choice")).toBe(false);
  });

  it("tracks keys independently", () => {
    const sid = makeSession();
    markFirstUseHintSeen(sid, "send:choice");
    expect(markFirstUseHintSeen(sid, "send:progress")).toBe(true);
    expect(markFirstUseHintSeen(sid, "send:choice")).toBe(false);
  });

  it("is isolated per session", () => {
    const sid1 = makeSession();
    const sid2 = makeSession();
    markFirstUseHintSeen(sid1, "send:choice");
    expect(markFirstUseHintSeen(sid2, "send:choice")).toBe(true); // first time for sid2
  });
});

describe("appendHintToResult", () => {
  it("adds _first_use_hint field to result content when hint is provided", () => {
    const result = makeResult({ message_id: 5 });
    const updated = appendHintToResult(result, "This is a hint.");
    const parsed = parsedContent(updated);
    expect(parsed._first_use_hint).toBe("This is a hint.");
    expect(parsed.message_id).toBe(5); // original data preserved
  });

  it("returns result unchanged when hint is null", () => {
    const result = makeResult({ message_id: 5 });
    const original = result.content[0].text;
    const updated = appendHintToResult(result, null);
    expect(updated.content[0].text).toBe(original);
  });

  it("does not append hint to error results", () => {
    const result = makeErrorResult();
    const original = result.content[0].text;
    const updated = appendHintToResult(result, "hint text");
    expect(updated.content[0].text).toBe(original);
  });

  it("preserves all other fields in the result", () => {
    const result = makeResult({ message_id: 7, split: true, split_count: 3 });
    const updated = appendHintToResult(result, "Hint.");
    const parsed = parsedContent(updated);
    expect(parsed.message_id).toBe(7);
    expect(parsed.split).toBe(true);
    expect(parsed.split_count).toBe(3);
    expect(parsed._first_use_hint).toBe("Hint.");
  });

  it("returns result unchanged when hint is empty string", () => {
    const result = makeResult({ message_id: 5 });
    const original = result.content[0].text;
    const updated = appendHintToResult(result, "");
    expect(updated.content[0].text).toBe(original);
  });

  it("returns result unchanged when content array is empty", () => {
    const result = { content: [] as { type: "text"; text: string }[] };
    const original = result.content.length;
    const updated = appendHintToResult(result, "some hint");
    expect(updated.content.length).toBe(original);
  });

  it("returns result unchanged when content[0].type is not 'text'", () => {
    const result = { content: [{ type: "image" as const, text: '{"message_id":1}' }] };
    const original = result.content[0].text;
    const updated = appendHintToResult(result as unknown as { content: { type: string; text: string }[] }, "some hint");
    expect(updated.content[0].text).toBe(original);
  });

  it("returns result unchanged when content[0].text is not valid JSON (catch branch)", () => {
    const result = { content: [{ type: "text" as const, text: "not-json" }] };
    const original = result.content[0].text;
    const updated = appendHintToResult(result, "some hint");
    expect(updated.content[0].text).toBe(original);
  });
});
