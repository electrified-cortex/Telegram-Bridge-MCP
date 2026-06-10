/**
 * Integration tests for activity/file/create refresh flag.
 *
 * Covers:
 *   AC1. refresh:true + no existing registration → creates TMCP file, replaced:false
 *   AC2. refresh:true + no existing + agent-supplied path → replaced:false
 *   AC3. refresh:true + existing TMCP-owned registration → old file deleted, new created, replaced:true
 *   AC4. refresh:true + existing TMCP-owned + new agent path → old deleted, new registered, replaced:true
 *   AC5. refresh:true + existing AGENT-SUPPLIED registration → old forgotten (not deleted), new created, replaced:true
 *   AC6. refresh:false / omitted + existing registration → ALREADY_REGISTERED (regression)
 *   AC7. refresh omitted → response has NO `replaced` field (exact shape regression)
 *   AC8. refresh:"true" or refresh:1 → INVALID_ARG validation error
 *
 * Uses real file I/O in a temporary directory — fs/promises is NOT mocked.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { open, access, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../session-manager.js", () => ({
  getNotifyLockoutMs: vi.fn((_sid: number): number => 300_000),
  getNotifyDebounceMs: vi.fn((_sid: number): number => 60_000),
  getDequeueDefault: vi.fn((_sid: number): number => 300),
  setDequeueDefault: vi.fn((_sid: number, _v: number): void => {}),
}));
vi.mock("../../session-queue.js", () => ({
  hasPendingUserContent: vi.fn((_sid: number): boolean => false),
  deliverServiceMessage: vi.fn((..._args: unknown[]): boolean => true),
}));

const gateMocks = vi.hoisted(() => ({
  requireAuth: vi.fn((_token: number | undefined): number | { code: string; message: string } => 1001),
}));

vi.mock("../../session-gate.js", () => ({
  requireAuth: (token: number | undefined) => gateMocks.requireAuth(token),
}));

import { handleActivityFileCreate } from "./create.js";
import { resetActivityFileStateForTest, getActivityFile } from "./file-state.js";

const SID = 1001;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// AC1: refresh:true, no prior registration, TMCP-generated path
// ---------------------------------------------------------------------------

describe("AC1: no prior registration, refresh:true, TMCP-generated path", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
    tmpDir = await mkdtemp(join(tmpdir(), "tmcp-refresh-ac1-"));
  });

  afterEach(async () => {
    resetActivityFileStateForTest();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("succeeds without error", async () => {
    const result = await handleActivityFileCreate({ token: SID, refresh: true });
    expect((result as { isError?: true }).isError).toBeUndefined();
  });

  it("returns replaced:false in response", async () => {
    const result = await handleActivityFileCreate({ token: SID, refresh: true });
    const data = parseResult(result);
    expect(data.replaced).toBe(false);
  });

  it("creates a TMCP-owned file at the returned path", async () => {
    const result = await handleActivityFileCreate({ token: SID, refresh: true });
    const data = parseResult(result);
    const filePath = data.file_path as string;
    expect(typeof filePath).toBe("string");
    expect(await fileExists(filePath)).toBe(true);
    expect(getActivityFile(SID)?.tmcpOwned).toBe(true);
  });

  it("returns hint and file_path; monitor field is gone (instructions arrive via next dequeue service message)", async () => {
    const result = await handleActivityFileCreate({ token: SID, refresh: true });
    const data = parseResult(result);
    expect(typeof data.hint).toBe("string");
    expect(typeof data.file_path).toBe("string");
    expect(Object.prototype.hasOwnProperty.call(data, "monitor")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC2: refresh:true, no prior registration, agent-supplied path
// ---------------------------------------------------------------------------

describe("AC2: no prior registration, refresh:true, agent-supplied path", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
    tmpDir = await mkdtemp(join(tmpdir(), "tmcp-refresh-ac2-"));
  });

  afterEach(async () => {
    resetActivityFileStateForTest();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns replaced:false and registers the agent-supplied path", async () => {
    const agentPath = join(tmpDir, "agent-supplied.txt");
    const fh = await open(agentPath, "a", 0o600);
    await fh.close();

    const result = await handleActivityFileCreate({ token: SID, refresh: true, file_path: agentPath });
    expect((result as { isError?: true }).isError).toBeUndefined();
    const data = parseResult(result);
    expect(data.replaced).toBe(false);
    expect(data.file_path).toBe(agentPath);
  });

  it("registers agent-supplied path as not TMCP-owned", async () => {
    const agentPath = join(tmpDir, "agent-ac2.txt");
    const fh = await open(agentPath, "a", 0o600);
    await fh.close();

    await handleActivityFileCreate({ token: SID, refresh: true, file_path: agentPath });

    const entry = getActivityFile(SID);
    expect(entry?.filePath).toBe(agentPath);
    expect(entry?.tmcpOwned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC3: refresh:true, existing TMCP-owned registration, TMCP-generated path
// ---------------------------------------------------------------------------

describe("AC3: existing TMCP-owned registration, refresh:true, TMCP-generated path", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
    tmpDir = await mkdtemp(join(tmpdir(), "tmcp-refresh-ac3-"));
  });

  afterEach(async () => {
    resetActivityFileStateForTest();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("deletes old file from disk and creates a new TMCP-owned file", async () => {
    const first = await handleActivityFileCreate({ token: SID });
    const oldPath = parseResult(first).file_path as string;
    expect(await fileExists(oldPath)).toBe(true);

    const second = await handleActivityFileCreate({ token: SID, refresh: true });
    expect((second as { isError?: true }).isError).toBeUndefined();
    const secondData = parseResult(second);

    expect(await fileExists(oldPath)).toBe(false);
    expect(typeof secondData.file_path).toBe("string");
    expect(await fileExists(secondData.file_path as string)).toBe(true);
  });

  it("returns replaced:true", async () => {
    await handleActivityFileCreate({ token: SID });
    const result = await handleActivityFileCreate({ token: SID, refresh: true });
    expect(parseResult(result).replaced).toBe(true);
  });

  it("new TMCP-owned file has a different path from the old file", async () => {
    const first = await handleActivityFileCreate({ token: SID });
    const oldPath = parseResult(first).file_path as string;

    const second = await handleActivityFileCreate({ token: SID, refresh: true });
    const newPath = parseResult(second).file_path as string;

    expect(newPath).not.toBe(oldPath);
  });
});

// ---------------------------------------------------------------------------
// AC4: refresh:true, existing TMCP-owned registration, new agent-supplied path
// ---------------------------------------------------------------------------

describe("AC4: existing TMCP-owned registration, refresh:true, new agent-supplied path", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
    tmpDir = await mkdtemp(join(tmpdir(), "tmcp-refresh-ac4-"));
  });

  afterEach(async () => {
    resetActivityFileStateForTest();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("deletes old TMCP file and registers new agent path with replaced:true", async () => {
    const first = await handleActivityFileCreate({ token: SID });
    const oldPath = parseResult(first).file_path as string;
    expect(await fileExists(oldPath)).toBe(true);

    const newPath = join(tmpDir, "new-agent.txt");
    const fh = await open(newPath, "a", 0o600);
    await fh.close();

    const result = await handleActivityFileCreate({ token: SID, refresh: true, file_path: newPath });
    expect((result as { isError?: true }).isError).toBeUndefined();
    const data = parseResult(result);

    expect(await fileExists(oldPath)).toBe(false);
    expect(data.file_path).toBe(newPath);
    expect(data.replaced).toBe(true);

    const entry = getActivityFile(SID);
    expect(entry?.filePath).toBe(newPath);
    expect(entry?.tmcpOwned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC5: refresh:true, existing AGENT-SUPPLIED registration
// ---------------------------------------------------------------------------

describe("AC5: existing agent-supplied registration, refresh:true", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
    tmpDir = await mkdtemp(join(tmpdir(), "tmcp-refresh-ac5-"));
  });

  afterEach(async () => {
    resetActivityFileStateForTest();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("forgets old agent registration without deleting its file, creates new TMCP file with replaced:true", async () => {
    const agentPath = join(tmpDir, "agent-existing.txt");
    const fh = await open(agentPath, "a", 0o600);
    await fh.close();

    await handleActivityFileCreate({ token: SID, file_path: agentPath });
    expect(getActivityFile(SID)?.filePath).toBe(agentPath);

    const result = await handleActivityFileCreate({ token: SID, refresh: true });
    expect((result as { isError?: true }).isError).toBeUndefined();
    const data = parseResult(result);

    expect(data.replaced).toBe(true);

    // Original agent-supplied file still exists (not TMCP-owned, so not deleted)
    expect(await fileExists(agentPath)).toBe(true);

    // New TMCP-owned file created
    const newPath = data.file_path as string;
    expect(typeof newPath).toBe("string");
    expect(newPath).not.toBe(agentPath);
    expect(await fileExists(newPath)).toBe(true);

    expect(getActivityFile(SID)?.tmcpOwned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC6: existing registration, no refresh — ALREADY_REGISTERED unchanged
// ---------------------------------------------------------------------------

describe("AC6: existing registration, no refresh — ALREADY_REGISTERED regression", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
    tmpDir = await mkdtemp(join(tmpdir(), "tmcp-refresh-ac6-"));
  });

  afterEach(async () => {
    resetActivityFileStateForTest();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("omitting refresh returns ALREADY_REGISTERED", async () => {
    await handleActivityFileCreate({ token: SID });
    const result = await handleActivityFileCreate({ token: SID });
    expect((result as { isError?: true }).isError).toBe(true);
    expect(parseResult(result).code).toBe("ALREADY_REGISTERED");
  });

  it("refresh:false returns ALREADY_REGISTERED", async () => {
    await handleActivityFileCreate({ token: SID });
    const result = await handleActivityFileCreate({ token: SID, refresh: false });
    expect((result as { isError?: true }).isError).toBe(true);
    expect(parseResult(result).code).toBe("ALREADY_REGISTERED");
  });

  it("ALREADY_REGISTERED error includes details.file_path and details.tmcp_owned", async () => {
    await handleActivityFileCreate({ token: SID });
    const result = await handleActivityFileCreate({ token: SID, refresh: false });
    const err = parseResult(result) as Record<string, unknown> & { details: Record<string, unknown> };
    expect(typeof err.details.file_path).toBe("string");
    expect(typeof err.details.tmcp_owned).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// AC7: refresh omitted / false → NO `replaced` field in response
// ---------------------------------------------------------------------------

describe("AC7: refresh omitted or false — no replaced field in response", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
    tmpDir = await mkdtemp(join(tmpdir(), "tmcp-refresh-ac7-"));
  });

  afterEach(async () => {
    resetActivityFileStateForTest();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("response has no replaced field when refresh is omitted", async () => {
    const result = await handleActivityFileCreate({ token: SID });
    expect((result as { isError?: true }).isError).toBeUndefined();
    const data = parseResult(result);
    expect(Object.prototype.hasOwnProperty.call(data, "replaced")).toBe(false);
  });

  it("response has no replaced field when refresh:false", async () => {
    const result = await handleActivityFileCreate({ token: SID, refresh: false });
    expect((result as { isError?: true }).isError).toBeUndefined();
    const data = parseResult(result);
    expect(Object.prototype.hasOwnProperty.call(data, "replaced")).toBe(false);
  });

  it("response contains hint and file_path, no monitor field, no replaced field", async () => {
    const result = await handleActivityFileCreate({ token: SID });
    const data = parseResult(result);
    expect(typeof data.hint).toBe("string");
    expect(typeof data.file_path).toBe("string");
    expect(Object.prototype.hasOwnProperty.call(data, "monitor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(data, "replaced")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC8: schema validation — non-boolean refresh rejected
// ---------------------------------------------------------------------------

describe("AC8: refresh type validation — non-boolean values rejected", () => {
  beforeEach(() => {
    resetActivityFileStateForTest();
    gateMocks.requireAuth.mockReturnValue(SID);
  });

  afterEach(() => {
    resetActivityFileStateForTest();
  });

  it('refresh:"true" (string) returns INVALID_ARG error', async () => {
    const result = await handleActivityFileCreate({ token: SID, refresh: "true" });
    expect((result as { isError?: true }).isError).toBe(true);
    expect(parseResult(result).code).toBe("INVALID_ARG");
  });

  it("refresh:1 (number) returns INVALID_ARG error", async () => {
    const result = await handleActivityFileCreate({ token: SID, refresh: 1 });
    expect((result as { isError?: true }).isError).toBe(true);
    expect(parseResult(result).code).toBe("INVALID_ARG");
  });

  it("refresh:0 (number) returns INVALID_ARG error", async () => {
    const result = await handleActivityFileCreate({ token: SID, refresh: 0 });
    expect((result as { isError?: true }).isError).toBe(true);
    expect(parseResult(result).code).toBe("INVALID_ARG");
  });

  it("refresh:null returns INVALID_ARG error (present but not a boolean)", async () => {
    const result = await handleActivityFileCreate({ token: SID, refresh: null });
    expect((result as { isError?: true }).isError).toBe(true);
    expect(parseResult(result).code).toBe("INVALID_ARG");
  });
});
