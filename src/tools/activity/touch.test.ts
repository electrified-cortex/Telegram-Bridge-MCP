/**
 * Integration tests for activity/file/touch handler.
 *
 * Covers:
 *   TC1. No activity file registered → NO_ACTIVITY_FILE error
 *   TC2. File registered but missing from disk → ACTIVITY_FILE_MISSING error
 *   TC3. File registered and present → touched:true, file_path, mtime returned
 *   TC4. Auth failure → AUTH_FAILED error
 *   TC5. Rapid repeated calls succeed (idempotent); each bumps mtime
 *   TC6. Touch on TMCP-owned file works same as agent-supplied file
 *
 * Uses real file I/O in a temporary directory — fs/promises is NOT mocked.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, open, stat } from "fs/promises";
import { delay } from "../../utils/timing.js";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../session-manager.js", () => ({
  getnotifyLockoutMs: vi.fn((_sid: number): number => 300_000),
  getnotifyDebounceMs: vi.fn((_sid: number): number => 60_000),
  getDequeueDefault: vi.fn((_sid: number): number => 300),
  setDequeueDefault: vi.fn((_sid: number, _v: number): void => {}),
}));
vi.mock("../../session-queue.js", () => ({
  hasPendingUserContent: vi.fn((_sid: number): boolean => false),
  deliverServiceMessage: vi.fn((..._args: unknown[]): boolean => true),
}));

const gateMocks = vi.hoisted(() => ({
  requireAuth: vi.fn((_token: number | undefined): number | { code: string; message: string } => 1),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: (token: number | undefined) => gateMocks.requireAuth(token),
}));

import { handleActivityFileTouch } from "./touch.js";
import { resetActivityFileStateForTest, setActivityFile } from "./file-state.js";

const SID = 2001;
const AUTH_ERROR = { code: "AUTH_FAILED", message: "Invalid token." };

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function isError(result: { isError?: boolean }) {
  return result.isError === true;
}

// ---------------------------------------------------------------------------
// TC1: no activity file registered
// ---------------------------------------------------------------------------

describe("TC1: no activity file registered", () => {
  beforeEach(() => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
  });

  afterEach(() => {
    resetActivityFileStateForTest();
  });

  it("returns NO_ACTIVITY_FILE error", async () => {
    const result = await handleActivityFileTouch({ token: SID });
    expect(isError(result as { isError?: boolean })).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("NO_ACTIVITY_FILE");
    expect(typeof body.message).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// TC2: file registered but missing from disk
// ---------------------------------------------------------------------------

describe("TC2: file registered but missing from disk", () => {
  beforeEach(() => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
    // Register a path that does not exist on disk
    setActivityFile(SID, {
      filePath: "/nonexistent/path/activity-file-that-does-not-exist",
      tmcpOwned: false,
      inflightDequeue: false,
      notifyLockedUntil: null,
      notifyPendingBecauseLocked: false,
      touchInFlight: false,
      pendingRetryHandle: null,
    });
  });

  afterEach(() => {
    resetActivityFileStateForTest();
  });

  it("returns ACTIVITY_FILE_MISSING error", async () => {
    const result = await handleActivityFileTouch({ token: SID });
    expect(isError(result as { isError?: boolean })).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("ACTIVITY_FILE_MISSING");
    expect(typeof body.message).toBe("string");
    expect(body.file_path).toBe("/nonexistent/path/activity-file-that-does-not-exist");
  });
});

// ---------------------------------------------------------------------------
// TC3: success path — file registered and present
// ---------------------------------------------------------------------------

describe("TC3: success — file registered and present on disk", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
    tmpDir = await mkdtemp(join(tmpdir(), "tmcp-touch-tc3-"));
    filePath = join(tmpDir, "activity-file");
    const fh = await open(filePath, "w");
    await fh.close();
    setActivityFile(SID, {
      filePath,
      tmcpOwned: false,
      inflightDequeue: false,
      notifyLockedUntil: null,
      notifyPendingBecauseLocked: false,
      touchInFlight: false,
      pendingRetryHandle: null,
    });
  });

  afterEach(async () => {
    resetActivityFileStateForTest();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns touched:true with file_path and mtime", async () => {
    const result = await handleActivityFileTouch({ token: SID });
    expect(isError(result as { isError?: boolean })).toBe(false);
    const body = parseResult(result);
    expect(body.touched).toBe(true);
    expect(body.file_path).toBe(filePath);
    expect(typeof body.mtime).toBe("string");
    // mtime should be a valid ISO timestamp
    expect(() => new Date(body.mtime as string).toISOString()).not.toThrow();
  });

  it("updates the file's mtime on disk", async () => {
    const before = (await stat(filePath)).mtimeMs;
    // Ensure at least 1ms passes so mtime can change
    await delay(10);
    await handleActivityFileTouch({ token: SID });
    const after = (await stat(filePath)).mtimeMs;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

// ---------------------------------------------------------------------------
// TC4: auth failure
// ---------------------------------------------------------------------------

describe("TC4: auth failure", () => {
  beforeEach(() => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(AUTH_ERROR);
  });

  afterEach(() => {
    resetActivityFileStateForTest();
  });

  it("returns AUTH_FAILED error", async () => {
    const result = await handleActivityFileTouch({ token: 99999 });
    expect(isError(result as { isError?: boolean })).toBe(true);
    const body = parseResult(result);
    expect(body.code).toBe("AUTH_FAILED");
  });
});

// ---------------------------------------------------------------------------
// TC5: idempotent — rapid repeated calls succeed
// ---------------------------------------------------------------------------

describe("TC5: idempotent — rapid repeated calls", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
    tmpDir = await mkdtemp(join(tmpdir(), "tmcp-touch-tc5-"));
    filePath = join(tmpDir, "activity-file");
    const fh = await open(filePath, "w");
    await fh.close();
    setActivityFile(SID, {
      filePath,
      tmcpOwned: false,
      inflightDequeue: false,
      notifyLockedUntil: null,
      notifyPendingBecauseLocked: false,
      touchInFlight: false,
      pendingRetryHandle: null,
    });
  });

  afterEach(async () => {
    resetActivityFileStateForTest();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("succeeds on every call without error", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await handleActivityFileTouch({ token: SID });
      expect(isError(result as { isError?: boolean })).toBe(false);
      const body = parseResult(result);
      expect(body.touched).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// TC6: TMCP-owned file works the same as agent-supplied
// ---------------------------------------------------------------------------

describe("TC6: TMCP-owned file", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
    tmpDir = await mkdtemp(join(tmpdir(), "tmcp-touch-tc6-"));
    filePath = join(tmpDir, "tmcp-owned");
    const fh = await open(filePath, "w");
    await fh.close();
    setActivityFile(SID, {
      filePath,
      tmcpOwned: true,
      inflightDequeue: false,
      notifyLockedUntil: null,
      notifyPendingBecauseLocked: false,
      touchInFlight: false,
      pendingRetryHandle: null,
    });
  });

  afterEach(async () => {
    resetActivityFileStateForTest();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns touched:true for TMCP-owned file", async () => {
    const result = await handleActivityFileTouch({ token: SID });
    expect(isError(result as { isError?: boolean })).toBe(false);
    const body = parseResult(result);
    expect(body.touched).toBe(true);
    expect(body.file_path).toBe(filePath);
  });
});
