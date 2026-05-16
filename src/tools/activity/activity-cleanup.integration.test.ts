/**
 * Integration tests for activity-file cleanup contract (task 30-1930).
 *
 * Proves that:
 * AC1: On session close, TMCP deletes the session's TMCP-owned activity file.
 * AC2: clearAllActivityFiles() (called on SIGTERM / full shutdown) deletes all
 *      TMCP-owned activity files across all registered sessions.
 *
 * Uses real file I/O in a temporary directory — fs/promises is NOT mocked.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { open, access, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../session-manager.js", () => ({
  getKickDebounceMs: vi.fn((_sid: number): number => 60_000),
}));
vi.mock("../../session-queue.js", () => ({
  hasPendingUserContent: vi.fn((_sid: number): boolean => false),
}));

import {
  setActivityFile,
  getActivityFile,
  clearActivityFile,
  clearAllActivityFiles,
  resetActivityFileStateForTest,
} from "./file-state.js";

async function createTempFile(dir: string): Promise<string> {
  const name = `act-${Math.random().toString(36).slice(2)}`;
  const filePath = join(dir, name);
  const fh = await open(filePath, "a", 0o600);
  await fh.close();
  return filePath;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function makeEntry(filePath: string, tmcpOwned: boolean) {
  return {
    filePath,
    tmcpOwned,
    lastTouchAt: null as number | null,
    debounceTimer: null as ReturnType<typeof setTimeout> | null,
    lastActivityAt: 0,
    inflightDequeue: false,
    nudgeArmed: true,
  };
}

// ---------------------------------------------------------------------------
// AC1: session close → TMCP-owned activity file deleted
// ---------------------------------------------------------------------------

describe("AC1: clearActivityFile (session-close path)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetActivityFileStateForTest();
    tmpDir = await mkdtemp(join(tmpdir(), "tmcp-ac1-"));
  });

  afterEach(async () => {
    resetActivityFileStateForTest();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("deletes a TMCP-owned file from disk within 1 second of session close", async () => {
    const SID = 101;
    const filePath = await createTempFile(tmpDir);
    setActivityFile(SID, makeEntry(filePath, true));

    expect(await fileExists(filePath)).toBe(true);
    const before = Date.now();
    await clearActivityFile(SID);
    const elapsed = Date.now() - before;

    expect(elapsed).toBeLessThan(1000);
    expect(await fileExists(filePath)).toBe(false);
    expect(getActivityFile(SID)).toBeUndefined();
  });

  it("removes the session registration even when the file is already gone", async () => {
    const SID = 102;
    const filePath = join(tmpDir, "never-created");
    setActivityFile(SID, makeEntry(filePath, true));

    await expect(clearActivityFile(SID)).resolves.toBeUndefined();
    expect(getActivityFile(SID)).toBeUndefined();
  });

  it("preserves agent-supplied (tmcpOwned=false) files on session close", async () => {
    const SID = 103;
    const filePath = await createTempFile(tmpDir);
    setActivityFile(SID, makeEntry(filePath, false));

    await clearActivityFile(SID);

    expect(getActivityFile(SID)).toBeUndefined();
    expect(await fileExists(filePath)).toBe(true);
  });

  it("is a no-op when no activity file is registered for the session", async () => {
    await expect(clearActivityFile(999)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC2: TMCP shutdown → all TMCP-owned activity files deleted
// ---------------------------------------------------------------------------

describe("AC2: clearAllActivityFiles (SIGTERM / full-shutdown path)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetActivityFileStateForTest();
    tmpDir = await mkdtemp(join(tmpdir(), "tmcp-ac2-"));
  });

  afterEach(async () => {
    resetActivityFileStateForTest();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("deletes all TMCP-owned files for all registered sessions", async () => {
    const sids = [201, 202, 203];
    const paths: string[] = [];

    for (const sid of sids) {
      const filePath = await createTempFile(tmpDir);
      paths.push(filePath);
      setActivityFile(sid, makeEntry(filePath, true));
    }

    for (const p of paths) {
      expect(await fileExists(p)).toBe(true);
    }

    await clearAllActivityFiles();

    for (const p of paths) {
      expect(await fileExists(p)).toBe(false);
    }
    for (const sid of sids) {
      expect(getActivityFile(sid)).toBeUndefined();
    }
  });

  it("does not delete agent-supplied files during bulk shutdown", async () => {
    const tmcpPath = await createTempFile(tmpDir);
    const agentPath = await createTempFile(tmpDir);

    setActivityFile(301, makeEntry(tmcpPath, true));
    setActivityFile(302, makeEntry(agentPath, false));

    await clearAllActivityFiles();

    expect(await fileExists(tmcpPath)).toBe(false);
    expect(await fileExists(agentPath)).toBe(true);
  });

  it("tolerates already-deleted files (best-effort — no throw)", async () => {
    const existingPath = await createTempFile(tmpDir);
    const missingPath = join(tmpDir, "never-created");

    setActivityFile(401, makeEntry(existingPath, true));
    setActivityFile(402, makeEntry(missingPath, true));

    await expect(clearAllActivityFiles()).resolves.toBeUndefined();

    expect(await fileExists(existingPath)).toBe(false);
    expect(getActivityFile(401)).toBeUndefined();
    expect(getActivityFile(402)).toBeUndefined();
  });

  it("is a no-op when no sessions are registered", async () => {
    await expect(clearAllActivityFiles()).resolves.toBeUndefined();
  });

  it("clears all registrations even in a mixed owned/unowned batch", async () => {
    const paths = await Promise.all([
      createTempFile(tmpDir),
      createTempFile(tmpDir),
      createTempFile(tmpDir),
    ]);

    setActivityFile(501, makeEntry(paths[0], true));
    setActivityFile(502, makeEntry(paths[1], false));
    setActivityFile(503, makeEntry(paths[2], true));

    await clearAllActivityFiles();

    expect(getActivityFile(501)).toBeUndefined();
    expect(getActivityFile(502)).toBeUndefined();
    expect(getActivityFile(503)).toBeUndefined();

    expect(await fileExists(paths[0])).toBe(false); // owned: deleted
    expect(await fileExists(paths[1])).toBe(true);  // unowned: preserved
    expect(await fileExists(paths[2])).toBe(false); // owned: deleted
  });
});
