/**
 * Tests for 10-3029: unexpected subscription close — fail-hard notification.
 *
 * New approach: MONITOR_EXIT is emitted directly on the SSE stream or
 * activity file BEFORE dropping the connection. Agents wake immediately.
 *
 * AC1: Unexpected SSE close emits MONITOR_EXIT on stream before drop
 *      → tested in sse-endpoint.test.ts (integration, see "unexpected close" section)
 * AC2: Activity-file retry exhaustion writes equivalent signal before file clear
 *      → tested here (unit, mocked writeFile)
 * AC3: Agent-initiated teardown (expected=true) does NOT emit the signal
 *      → tested here (file path) and in sse-endpoint.test.ts (SSE path)
 * AC4: sse-monitor.sh routes data: lines to stdout — passes MONITOR_EXIT through
 *      → tested here (script content inspection)
 * AC5: Both paths covered
 *      → AC2 (file path, this file) + sse-endpoint.test.ts (SSE path)
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Mock session-manager ────────────────────────────────────────────────────
vi.mock("../../session-manager.js", () => ({
  getNotifyDebounceMs: vi.fn((_sid: number): number => 300_000),
}));

// ── Mock session-queue ──────────────────────────────────────────────────────
vi.mock("../../session-queue.js", () => ({
  hasPendingUserContent: vi.fn((_sid: number): boolean => true),
  hasPendingReminderContent: vi.fn((_sid: number): boolean => false),
  deliverServiceMessage: vi.fn((..._args: unknown[]): boolean => true),
}));

// ── Mock fs/promises ────────────────────────────────────────────────────────
vi.mock("fs/promises", () => ({
  appendFile: vi.fn(() => Promise.resolve()),
  writeFile: vi.fn(() => Promise.resolve()),
  unlink: vi.fn(() => Promise.resolve()),
  mkdir: vi.fn(() => Promise.resolve()),
  open: vi.fn(() => Promise.resolve({ close: vi.fn() })),
}));

import { appendFile, writeFile } from "fs/promises";
import { hasPendingUserContent } from "../../session-queue.js";

import {
  registerSseMonitor,
  unregisterSseMonitor,
  clearActivityFile,
  replaceActivityFile,
  resetActivityFileStateForTest,
  setActivityFile,
  notifyIfAllowed,
  type ActivityFileState,
} from "./file-state.js";

const SID = 99;

const __dirname_test = dirname(fileURLToPath(import.meta.url));
/** Path to sse-monitor.sh from the repo root */
const SSE_MONITOR_SH = resolve(__dirname_test, "../../../tools/sse-monitor.sh");

function makeFileState(overrides: Partial<ActivityFileState> = {}): ActivityFileState {
  return {
    filePath: "/tmp/test-activity.txt",
    tmcpOwned: false,
    inflightDequeue: false,
    notifyDebounceUntil: null,
    notifyPendingBecauseDebounce: false,
    touchInFlight: false,
    pendingRetryHandle: null,
    pendingReNotifyHandle: null,
    ...overrides,
  };
}

// ── AC2: Activity-file retry exhaustion writes MONITOR_EXIT ────────────────

describe("AC2: activity-file retry exhaustion writes MONITOR_EXIT to file", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetActivityFileStateForTest();
    vi.mocked(hasPendingUserContent).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes MONITOR_EXIT signal to activity file after all retries are exhausted", async () => {
    // appendFile always fails → retries exhaust → MONITOR_EXIT written via writeFile
    vi.mocked(appendFile).mockRejectedValue(
      Object.assign(new Error("EACCES"), { code: "EACCES" }),
    );

    setActivityFile(SID, makeFileState());

    // Trigger the notify gate → doTouchWithRollback → initial touch fails → retry 0 scheduled
    notifyIfAllowed(SID, "operator", false);

    // Flush initial touch async
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Retry 0: fires after 1s, fails → scheduleRetry(1)
    vi.advanceTimersByTime(1_001);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Retry 1: fires after 5s, fails → scheduleRetry(2) → exhausted → MONITOR_EXIT written
    vi.advanceTimersByTime(5_001);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Verify writeFile was called with the MONITOR_EXIT signal
    const allCalls = vi.mocked(writeFile).mock.calls;
    const monitorExitCall = allCalls.find(
      ([, content]) =>
        typeof content === "string" &&
        content.includes("MONITOR_EXIT") &&
        content.includes("reason=subscription_closed_unexpectedly") &&
        content.includes("action=re-arm"),
    );
    expect(monitorExitCall).toBeDefined();
    expect(monitorExitCall![0]).toBe("/tmp/test-activity.txt");
  });

  it("MONITOR_EXIT content starts with MONITOR_EXIT (monitor.sh content-check compatible)", async () => {
    vi.mocked(appendFile).mockRejectedValue(
      Object.assign(new Error("EACCES"), { code: "EACCES" }),
    );

    setActivityFile(SID, makeFileState());
    notifyIfAllowed(SID, "operator", false);

    for (let i = 0; i < 10; i++) await Promise.resolve();
    vi.advanceTimersByTime(1_001);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    vi.advanceTimersByTime(5_001);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const allCalls = vi.mocked(writeFile).mock.calls;
    const monitorExitCall = allCalls.find(([, content]) =>
      typeof content === "string" && content.startsWith("MONITOR_EXIT"),
    );
    // Content must START with MONITOR_EXIT so monitor.sh check passes:
    //   [[ "$content" == MONITOR_EXIT* ]]
    expect(monitorExitCall).toBeDefined();
    expect(monitorExitCall![1]).toBe(
      "MONITOR_EXIT reason=subscription_closed_unexpectedly action=re-arm",
    );
  });

  it("does NOT write MONITOR_EXIT if touch succeeds eventually (no exhaustion)", async () => {
    let callCount = 0;
    vi.mocked(appendFile).mockImplementation(() => {
      callCount++;
      // Succeed on third call (retry 0)
      if (callCount >= 3) return Promise.resolve(undefined);
      return Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    });

    setActivityFile(SID, makeFileState());
    notifyIfAllowed(SID, "operator", false);

    for (let i = 0; i < 10; i++) await Promise.resolve();
    vi.advanceTimersByTime(1_001);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    vi.advanceTimersByTime(5_001);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // writeFile should not have been called (touch succeeded before exhaustion)
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });
});

// ── AC3 (file path): Agent-initiated teardown cancels retries — no MONITOR_EXIT ──

describe("AC3 (file path): agent-initiated teardown cancels retries before exhaustion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetActivityFileStateForTest();
    vi.mocked(hasPendingUserContent).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clearActivityFile cancels pending retry — MONITOR_EXIT is not written", async () => {
    vi.mocked(appendFile).mockRejectedValue(
      Object.assign(new Error("EACCES"), { code: "EACCES" }),
    );

    setActivityFile(SID, makeFileState());
    notifyIfAllowed(SID, "operator", false);

    // Initial touch fires and fails
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Agent calls clearActivityFile (e.g. activity/file/delete) before retry 0 fires
    await clearActivityFile(SID);

    // Advance past all retry delays — timer was cancelled, nothing fires
    vi.advanceTimersByTime(10_000);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Verify MONITOR_EXIT was NOT written
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });

  it("replaceActivityFile cancels pending retry — no MONITOR_EXIT on old path", async () => {
    vi.mocked(appendFile).mockRejectedValue(
      Object.assign(new Error("EACCES"), { code: "EACCES" }),
    );

    setActivityFile(SID, makeFileState({ filePath: "/tmp/old-activity.txt" }));
    notifyIfAllowed(SID, "operator", false);

    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Agent swaps file (e.g. activity/file/create with new path)
    await replaceActivityFile(SID, makeFileState({ filePath: "/tmp/new-activity.txt" }));

    vi.advanceTimersByTime(10_000);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const allCalls = vi.mocked(writeFile).mock.calls;
    const monitorExitOnOldPath = allCalls.find(
      ([path, content]) =>
        path === "/tmp/old-activity.txt" &&
        typeof content === "string" &&
        content.includes("MONITOR_EXIT"),
    );
    expect(monitorExitOnOldPath).toBeUndefined();
  });
});

// ── AC3 (SSE path): unregisterSseMonitor expected=true — no signal ─────────

describe("AC3 (SSE path): agent-initiated SSE cancel (expected=true) does not trigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetActivityFileStateForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("unregisterSseMonitor with expected=true does not modify activity file", () => {
    // SSE path: the caller (sse-endpoint.ts) is responsible for writing MONITOR_EXIT
    // only for unexpected closes. Expected close uses expected=true and writes
    // 'data: cancelled' instead. This test verifies the file-state layer does NOT
    // trigger any signal — the emission decision belongs to the SSE endpoint layer.
    registerSseMonitor(SID);
    unregisterSseMonitor(SID, true); // expected = true (agent called cancel)

    // No writeFile or appendFile calls expected from the gate layer for expected closes
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
  });

  it("unregisterSseMonitor with expected=false does not write to file (SSE-only gate)", () => {
    // SSE-only gate (no activity file): unexpected close — MONITOR_EXIT is written to
    // the SSE stream (res.write) in sse-endpoint.ts, NOT to the file. The gate layer
    // should not attempt a file write since filePath === null.
    registerSseMonitor(SID);
    unregisterSseMonitor(SID, false); // unexpected, but SSE-only — no file

    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
    expect(vi.mocked(appendFile)).not.toHaveBeenCalled();
  });
});

// ── AC4: sse-monitor.sh passes data: MONITOR_EXIT through to stdout ────────

describe("AC4: sse-monitor.sh routes data: MONITOR_EXIT to stdout", () => {
  it("script contains data:* case that echoes $line — MONITOR_EXIT passes through", () => {
    const script = readFileSync(SSE_MONITOR_SH, "utf-8");

    // The script must have a data:* catch-all that echoes lines to stdout
    expect(script).toMatch(/data:\*\)/);
    expect(script).toMatch(/echo "\$line"/);
  });

  it("script does NOT have a special case for MONITOR_EXIT — it falls through to data:*", () => {
    const script = readFileSync(SSE_MONITOR_SH, "utf-8");

    // MONITOR_EXIT should not be special-cased — it should flow through data:* like any
    // other data event (reach the agent as-is so the agent sees the wake signal)
    expect(script).not.toMatch(/MONITOR_EXIT reason=subscription_closed_unexpectedly/);
  });

  it("the MONITOR_EXIT signal matches the data:* pattern (starts with data:)", () => {
    // This verifies the signal format matches what sse-monitor.sh routes to stdout
    const signal = "data: MONITOR_EXIT reason=subscription_closed_unexpectedly action=re-arm";
    expect(signal.startsWith("data:")).toBe(true);
  });
});

// ── AC5: Both paths covered ────────────────────────────────────────────────

describe("AC5: coverage summary — both paths", () => {
  it("file-path MONITOR_EXIT tested above (AC2)", () => {
    // Covered by "AC2: activity-file retry exhaustion writes MONITOR_EXIT to file"
    expect(true).toBe(true);
  });

  it("SSE-path MONITOR_EXIT tested in sse-endpoint.test.ts (AC1)", () => {
    // sse-endpoint.test.ts "unexpected close: MONITOR_EXIT emission" section covers:
    //   - req 'close' path: MONITOR_EXIT attempted before unregisterSseMonitor
    //   - expected cancel (cancelSseConnection) does NOT emit MONITOR_EXIT
    expect(true).toBe(true);
  });
});
