import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordToolCall,
  recordNonToolEvent,
  getTraceLog,
  traceLogSize,
  clearTraceLog,
  resetTraceLogForTest,
} from "./trace-log.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock routing-mode so we can control governor SID in tests.
const mocks = vi.hoisted(() => ({
  getGovernorSid: vi.fn(() => 0),
}));

vi.mock("./routing-mode.js", () => ({
  getGovernorSid: mocks.getGovernorSid,
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetTraceLogForTest();
  vi.clearAllMocks();
  mocks.getGovernorSid.mockReturnValue(0);
});

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

describe("ring buffer", () => {
  it("starts empty", () => {
    expect(traceLogSize()).toBe(0);
  });

  it("records tool calls and increments size", () => {
    recordToolCall("dequeue", { token: 1123456 }, 1, "Worker", "ok");
    expect(traceLogSize()).toBe(1);
  });

  it("enforces max size of 10,000 entries", () => {
    for (let i = 0; i < 10_050; i++) {
      recordToolCall("send", {}, 1, "Worker", "ok");
    }
    expect(traceLogSize()).toBe(10_000);
  });

  it("evicts oldest entries when full", () => {
    for (let i = 0; i < 10_050; i++) {
      recordToolCall("send", { idx: i }, 1, "Worker", "ok");
    }
    const entries = getTraceLog({ limit: 10_000, caller_sid: 1, governor_sid: 1 });
    // First entry should be the 51st recorded (index 50)
    expect(entries[0].params?.idx).toBe(50);
  });

  it("assigns auto-incrementing seq numbers", () => {
    recordToolCall("dequeue", {}, 1, "Worker", "ok");
    recordToolCall("send", {}, 1, "Worker", "ok");
    recordNonToolEvent("session_create", 2, "Overseer");
    const entries = getTraceLog({ limit: 10, caller_sid: 1, governor_sid: 1 });
    expect(entries[0].seq).toBe(1);
    expect(entries[1].seq).toBe(2);
    expect(entries[2].seq).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Param sanitization
// ---------------------------------------------------------------------------

describe("param sanitization", () => {
  it("strips token from params", () => {
    recordToolCall("dequeue", { token: 9999999, timeout: 30 }, 9, "Test", "ok");
    const entries = getTraceLog({ limit: 1, caller_sid: 9, governor_sid: 9 });
    expect(entries[0].params).not.toHaveProperty("token");
    expect(entries[0].params?.timeout).toBe(30);
  });

  it("strips pin from params", () => {
    recordToolCall("session_start", { pin: 123456, name: "Bot" }, 1, "Bot", "ok");
    const entries = getTraceLog({ limit: 1, caller_sid: 1, governor_sid: 1 });
    expect(entries[0].params).not.toHaveProperty("pin");
    expect(entries[0].params?.name).toBe("Bot");
  });

  it("strips secret from params", () => {
    recordToolCall("auth", { secret: "xyzzy", mode: "test" }, 1, "Agent", "ok");
    const entries = getTraceLog({ limit: 1, caller_sid: 1, governor_sid: 1 });
    expect(entries[0].params).not.toHaveProperty("secret");
    expect(entries[0].params?.mode).toBe("test");
  });

  it("strips fields matching token/pin/secret pattern case-insensitively", () => {
    recordToolCall("test", { TOKEN: "a", PIN: "b", Secret_Key: "c", keep: "d" }, 1, "A", "ok");
    const entries = getTraceLog({ limit: 1, caller_sid: 1, governor_sid: 1 });
    expect(entries[0].params).not.toHaveProperty("TOKEN");
    expect(entries[0].params).not.toHaveProperty("PIN");
    expect(entries[0].params).not.toHaveProperty("Secret_Key");
    expect(entries[0].params?.keep).toBe("d");
  });

  it("preserves non-sensitive params intact", () => {
    recordToolCall("send", { text: "hello", chat_id: 12345 }, 3, "Bot", "ok");
    const entries = getTraceLog({ limit: 1, caller_sid: 3, governor_sid: 3 });
    expect(entries[0].params).toEqual({ text: "hello", chat_id: 12345 });
  });
});

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

describe("filtering", () => {
  beforeEach(() => {
    mocks.getGovernorSid.mockReturnValue(99);
    recordToolCall("dequeue", {}, 1, "Worker1", "ok");
    recordToolCall("send", {}, 1, "Worker1", "ok");
    recordToolCall("dequeue", {}, 2, "Worker2", "ok");
    recordNonToolEvent("session_create", 3, "Observer");
  });

  it("filters by sid", () => {
    const entries = getTraceLog({ sid: 2, caller_sid: 99, governor_sid: 99 });
    expect(entries).toHaveLength(1);
    expect(entries[0].sid).toBe(2);
  });

  it("filters by tool name", () => {
    const entries = getTraceLog({ tool: "dequeue", caller_sid: 99, governor_sid: 99 });
    expect(entries).toHaveLength(2);
    entries.forEach(e => { expect(e.tool).toBe("dequeue"); });
  });

  it("filters by since_seq", () => {
    const all = getTraceLog({ limit: 100, caller_sid: 99, governor_sid: 99 });
    const afterFirst = getTraceLog({ since_seq: all[0].seq, caller_sid: 99, governor_sid: 99 });
    expect(afterFirst).toHaveLength(all.length - 1);
    expect(afterFirst[0].seq).toBeGreaterThan(all[0].seq);
  });

  it("filters by since_ts", () => {
    const all = getTraceLog({ limit: 100, caller_sid: 99, governor_sid: 99 });
    // Use timestamp of first entry — should exclude it (>=, so it should include it)
    const afterTs = getTraceLog({ since_ts: all[1].ts, caller_sid: 99, governor_sid: 99 });
    // Should return entries from index 1 onwards
    expect(afterTs.length).toBeLessThanOrEqual(all.length);
    expect(afterTs.every(e => e.ts >= all[1].ts)).toBe(true);
  });

  it("respects limit", () => {
    const limited = getTraceLog({ limit: 2, caller_sid: 99, governor_sid: 99 });
    expect(limited).toHaveLength(2);
  });

  it("can combine sid and tool filters", () => {
    const entries = getTraceLog({ sid: 1, tool: "send", caller_sid: 99, governor_sid: 99 });
    expect(entries).toHaveLength(1);
    expect(entries[0].sid).toBe(1);
    expect(entries[0].tool).toBe("send");
  });
});

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

describe("access control", () => {
  beforeEach(() => {
    recordToolCall("dequeue", {}, 1, "Worker1", "ok");
    recordToolCall("send", {}, 2, "Worker2", "ok");
    recordToolCall("dequeue", {}, 3, "Worker3", "ok");
  });

  it("governor can see all sessions", () => {
    mocks.getGovernorSid.mockReturnValue(99);
    const entries = getTraceLog({ caller_sid: 99, governor_sid: 99 });
    expect(entries).toHaveLength(3);
  });

  it("governor with explicit sid filter works correctly", () => {
    mocks.getGovernorSid.mockReturnValue(99);
    const entries = getTraceLog({ sid: 2, caller_sid: 99, governor_sid: 99 });
    expect(entries).toHaveLength(1);
    expect(entries[0].sid).toBe(2);
  });

  it("non-governor is restricted to own sid", () => {
    mocks.getGovernorSid.mockReturnValue(99);
    const entries = getTraceLog({ caller_sid: 2, governor_sid: 99 });
    expect(entries).toHaveLength(1);
    expect(entries[0].sid).toBe(2);
  });

  it("non-governor cannot see other sids even with explicit sid filter", () => {
    mocks.getGovernorSid.mockReturnValue(99);
    const entries = getTraceLog({ sid: 1, caller_sid: 2, governor_sid: 99 });
    // caller_sid=2 is not governor, so forced to own sid=2
    expect(entries).toHaveLength(1);
    expect(entries[0].sid).toBe(2);
  });

  it("caller_sid=0 with no governor returns empty (anonymous callers denied)", () => {
    mocks.getGovernorSid.mockReturnValue(0);
    const entries = getTraceLog({ caller_sid: 0 });
    expect(entries).toHaveLength(0);
  });

  it("uses getGovernorSid() when governor_sid not supplied", () => {
    mocks.getGovernorSid.mockReturnValue(2);
    // caller_sid=2 === getGovernorSid()=2 → governor → sees all
    const entries = getTraceLog({ caller_sid: 2 });
    expect(entries).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// recordNonToolEvent
// ---------------------------------------------------------------------------

describe("recordNonToolEvent", () => {
  it("records session_create events", () => {
    recordNonToolEvent("session_create", 5, "Agent5");
    const entries = getTraceLog({ limit: 10, caller_sid: 5, governor_sid: 5 });
    expect(entries).toHaveLength(1);
    expect(entries[0].event_type).toBe("session_create");
    expect(entries[0].sid).toBe(5);
    expect(entries[0].session_name).toBe("Agent5");
    expect(entries[0].tool).toBeUndefined();
  });

  it("records session_close events", () => {
    recordNonToolEvent("session_close", 5, "Agent5");
    const entries = getTraceLog({ limit: 10, caller_sid: 5, governor_sid: 5 });
    expect(entries[0].event_type).toBe("session_close");
  });

  it("records reminder_fire events with detail", () => {
    recordNonToolEvent("reminder_fire", 3, "Worker", "Check status");
    const entries = getTraceLog({ limit: 10, caller_sid: 3, governor_sid: 3 });
    expect(entries[0].event_type).toBe("reminder_fire");
    expect(entries[0].detail).toBe("Check status");
  });

  it("omits detail field when not provided", () => {
    recordNonToolEvent("session_create", 1, "A");
    const entries = getTraceLog({ limit: 10, caller_sid: 1, governor_sid: 1 });
    expect(entries[0]).not.toHaveProperty("detail");
  });
});

// ---------------------------------------------------------------------------
// recordToolCall
// ---------------------------------------------------------------------------

describe("recordToolCall", () => {
  it("records ok result with event_type tool_call", () => {
    recordToolCall("dequeue", { timeout: 30 }, 1, "Worker", "ok");
    const entries = getTraceLog({ limit: 10, caller_sid: 1, governor_sid: 1 });
    expect(entries[0].event_type).toBe("tool_call");
    expect(entries[0].result).toBe("ok");
    expect(entries[0].tool).toBe("dequeue");
  });

  it("records error result with event_type tool_call", () => {
    recordToolCall("send", {}, 1, "Worker", "error", "AUTH_FAILED");
    const entries = getTraceLog({ limit: 10, caller_sid: 1, governor_sid: 1 });
    expect(entries[0].event_type).toBe("tool_call");
    expect(entries[0].result).toBe("error");
    expect(entries[0].error_code).toBe("AUTH_FAILED");
  });

  it("records blocked result with event_type tool_blocked", () => {
    recordToolCall("send", {}, 1, "Worker", "blocked", "BLOCKED");
    const entries = getTraceLog({ limit: 10, caller_sid: 1, governor_sid: 1 });
    expect(entries[0].event_type).toBe("tool_blocked");
    expect(entries[0].result).toBe("blocked");
  });

  it("omits error_code when not provided", () => {
    recordToolCall("dequeue", {}, 1, "Worker", "ok");
    const entries = getTraceLog({ limit: 10, caller_sid: 1, governor_sid: 1 });
    expect(entries[0]).not.toHaveProperty("error_code");
  });

  it("includes ISO timestamp", () => {
    recordToolCall("dequeue", {}, 1, "Worker", "ok");
    const entries = getTraceLog({ limit: 10, caller_sid: 1, governor_sid: 1 });
    expect(entries[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// clearTraceLog
// ---------------------------------------------------------------------------

describe("clearTraceLog", () => {
  it("empties the buffer", () => {
    recordToolCall("dequeue", {}, 1, "Worker", "ok");
    recordNonToolEvent("session_close", 1, "Worker");
    expect(traceLogSize()).toBe(2);
    clearTraceLog();
    expect(traceLogSize()).toBe(0);
  });

  it("resets sequence numbers so next entry starts at seq 1", () => {
    recordToolCall("send", {}, 1, "Worker", "ok");
    clearTraceLog();
    recordToolCall("dequeue", {}, 1, "Worker", "ok");
    mocks.getGovernorSid.mockReturnValue(1);
    const entries = getTraceLog({ caller_sid: 1, governor_sid: 1 });
    expect(entries[0].seq).toBe(1);
  });

  it("no-op on already-empty buffer", () => {
    expect(traceLogSize()).toBe(0);
    clearTraceLog();
    expect(traceLogSize()).toBe(0);
  });
});
