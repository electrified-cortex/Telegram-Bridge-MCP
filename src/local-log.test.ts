import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the `fs` module so tests never touch the real filesystem.
// ---------------------------------------------------------------------------

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn((): boolean => false),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  readFileSync: vi.fn((): string => ""),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn((): string[] => []),
}));

vi.mock("fs", () => ({
  existsSync: fsMocks.existsSync,
  mkdirSync: fsMocks.mkdirSync,
  appendFileSync: fsMocks.appendFileSync,
  readFileSync: fsMocks.readFileSync,
  unlinkSync: fsMocks.unlinkSync,
  readdirSync: fsMocks.readdirSync,
}));

import {
  logEvent,
  rollLog,
  getLog,
  deleteLog,
  listLogs,
  enableLogging,
  disableLogging,
  isLoggingEnabled,
  resetLocalLogForTest,
} from "./local-log.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse NDJSON lines appended via appendFileSync calls. */
function allAppendedEvents(): Array<{ ts: string; event: unknown }> {
  const calls = fsMocks.appendFileSync.mock.calls;
  if (calls.length === 0) return [];
  return calls.flatMap(([, content]: [string, string]) =>
    (content as string).split('\n').filter(Boolean).map(line => JSON.parse(line))
  );
}

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetLocalLogForTest();
  // Default: directory exists so ensureLogsDir does not call mkdirSync
  fsMocks.existsSync.mockReturnValue(true);
});

afterEach(() => {
  resetLocalLogForTest();
});

// ---------------------------------------------------------------------------
// logEvent
// ---------------------------------------------------------------------------

describe("logEvent", () => {
  it("writes events to disk immediately", () => {
    logEvent({ type: "message", text: "hello" });
    logEvent({ type: "message", text: "world" });
    // Both events are already on disk (no roll needed)
    const events = allAppendedEvents();
    expect(events).toHaveLength(2);
    expect(events[0].event).toEqual({ type: "message", text: "hello" });
    expect(events[1].event).toEqual({ type: "message", text: "world" });
  });

  it("is a no-op when logging is disabled", () => {
    disableLogging();
    logEvent({ type: "message", text: "ignored" });
    enableLogging();
    expect(fsMocks.appendFileSync).not.toHaveBeenCalled();
    const filename = rollLog();
    expect(filename).toBeNull();
  });

  it("does not throw when appendFileSync throws", () => {
    fsMocks.appendFileSync.mockImplementation(() => { throw new Error("disk full"); });
    expect(() => logEvent({ type: "event" })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// enableLogging / disableLogging
// ---------------------------------------------------------------------------

describe("enableLogging / disableLogging", () => {
  it("starts enabled by default", () => {
    expect(isLoggingEnabled()).toBe(true);
  });

  it("disableLogging turns logging off", () => {
    disableLogging();
    expect(isLoggingEnabled()).toBe(false);
  });

  it("enableLogging turns logging back on", () => {
    disableLogging();
    enableLogging();
    expect(isLoggingEnabled()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rollLog
// ---------------------------------------------------------------------------

describe("rollLog", () => {
  it("returns null when buffer is empty and no filename assigned", () => {
    const result = rollLog();
    expect(result).toBeNull();
  });

  it("returns filename after events were written", () => {
    logEvent({ type: "test" });
    const filename = rollLog();

    expect(filename).not.toBeNull();
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}T\d{6}\.json$/);
    // appendFileSync was called by logEvent, not rollLog
    expect(fsMocks.appendFileSync).toHaveBeenCalledOnce();
  });

  it("writes NDJSON events to disk", () => {
    logEvent({ type: "msg", id: 1 });
    logEvent({ type: "msg", id: 2 });
    const events = allAppendedEvents();
    expect(events).toHaveLength(2);
    expect(events.map(e => e.event)).toEqual([{ type: "msg", id: 1 }, { type: "msg", id: 2 }]);
    expect(typeof events[0].ts).toBe("string");
  });

  it("rollLog returns null when nothing has been logged", () => {
    resetLocalLogForTest();
    const result = rollLog();
    expect(result).toBeNull();
  });

  it("creates the logs directory if it does not exist", () => {
    fsMocks.existsSync.mockReturnValue(false);
    logEvent({ type: "event" });
    rollLog();

    expect(fsMocks.mkdirSync).toHaveBeenCalledOnce();
  });

  it("returns the archived filename", () => {
    logEvent({ type: "event" });
    const archived = rollLog();

    expect(archived).not.toBeNull();
    const writtenPath = (fsMocks.appendFileSync.mock.calls[0] as [string, string, string])[0];
    expect(writtenPath).toContain(archived!);
  });

  it("second rollLog with no new events returns null", () => {
    logEvent({ type: "event" });
    const first = rollLog();
    expect(first).not.toBeNull();
    // No new events — _currentFilename is null after first roll
    const second = rollLog();
    expect(second).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getLog
// ---------------------------------------------------------------------------

describe("getLog", () => {
  const validFilename = "2025-04-05T143022.json";

  it("reads and returns file content", () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue('{"events":[]}');

    const content = getLog(validFilename);
    expect(content).toBe('{"events":[]}');
    expect(fsMocks.readFileSync).toHaveBeenCalledOnce();
  });

  it("throws when file does not exist", () => {
    fsMocks.existsSync.mockReturnValue(false);
    expect(() => getLog(validFilename)).toThrow("not found");
  });

  it("throws on path traversal attempt (../../etc/passwd)", () => {
    expect(() => getLog("../../etc/passwd")).toThrow("Invalid log filename");
  });

  it("throws on path traversal attempt with valid suffix appended", () => {
    expect(() => getLog("../../etc/T143022.json")).toThrow("Invalid log filename");
  });

  it("throws on filename with leading slash", () => {
    expect(() => getLog("/etc/passwd")).toThrow("Invalid log filename");
  });

  it("throws on arbitrary non-timestamped filename", () => {
    expect(() => getLog("malicious.json")).toThrow("Invalid log filename");
  });

  it("accepts a bare timestamped filename", () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue("{}");
    expect(() => getLog(validFilename)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// deleteLog
// ---------------------------------------------------------------------------

describe("deleteLog", () => {
  const validFilename = "2025-04-05T143022.json";

  it("deletes a log file successfully", () => {
    fsMocks.existsSync.mockReturnValue(true);
    deleteLog(validFilename);
    expect(fsMocks.unlinkSync).toHaveBeenCalledOnce();
  });

  it("throws when file does not exist", () => {
    fsMocks.existsSync.mockReturnValue(false);
    expect(() => deleteLog(validFilename)).toThrow("not found");
  });

  it("throws on invalid (path traversal) filename", () => {
    expect(() => deleteLog("../../etc/passwd")).toThrow("Invalid log filename");
    expect(fsMocks.unlinkSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listLogs (via rollLog/getLog — the public list path)
// ---------------------------------------------------------------------------

describe("listLogs", () => {
  it("returns empty array when logs dir does not exist", () => {
    fsMocks.existsSync.mockReturnValue(false);
    const result = listLogs();
    expect(result).toEqual([]);
  });

  it("returns sorted list of .json files", () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readdirSync.mockReturnValue([
      "2025-04-05T143022.json",
      "2025-04-04T100000.json",
      "2025-04-05T090000.json",
      "README.txt", // should be filtered out
    ] as unknown as string[]);

    const result = listLogs();
    expect(result).toEqual([
      "2025-04-04T100000.json",
      "2025-04-05T090000.json",
      "2025-04-05T143022.json",
    ]);
  });

  it("returns empty array on readdirSync error", () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readdirSync.mockImplementation(() => { throw new Error("permission denied"); });
    const result = listLogs();
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sanitizeFilename — path traversal rejection (via getLog/deleteLog)
// ---------------------------------------------------------------------------

describe("sanitizeFilename (path traversal rejection)", () => {
  const cases = [
    "../../etc/passwd",
    "../secrets.json",
    "/etc/passwd",
    "\\etc\\passwd",
    "2025-04-05T143022.json/../evil",
    // Note: "foo/2025-04-05T143022.json" is NOT rejected — basename() strips the
    // directory prefix, yielding a valid timestamped filename. Callers providing
    // a path-prefixed filename simply get the basename resolved in LOGS_DIR.
    "2025-04-05T143022",           // missing .json extension
    "2025-04-05T14302.json",       // wrong timestamp format (5 not 6 digits)
    "2025-4-05T143022.json",       // wrong date format
  ];

  for (const bad of cases) {
    it(`rejects: ${bad}`, () => {
      fsMocks.existsSync.mockReturnValue(true);
      expect(() => getLog(bad)).toThrow("Invalid log filename");
    });
  }
});
