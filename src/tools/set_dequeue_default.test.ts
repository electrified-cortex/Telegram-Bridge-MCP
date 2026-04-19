import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";
import type { TimelineEvent } from "../message-store.js";

// ---------------------------------------------------------------------------
// Shared state for getDequeueDefault / setDequeueDefault (stateful mock)
// ---------------------------------------------------------------------------
const sessionDefaults = new Map<number, number>();

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn((_sid: number, _suffix: number) => true),
  dequeueBatch: vi.fn((): TimelineEvent[] => []),
  pendingCount: vi.fn((): number => 0),
  waitForEnqueue: vi.fn((): Promise<void> => Promise.resolve()),
  getSessionQueue: vi.fn((_sid: number): unknown => undefined),
  getMessageOwner: vi.fn((_msgId: number): number => 0),
  touchSession: vi.fn((_sid: number) => {}),
  setActiveSession: vi.fn((_sid: number) => {}),
  getActiveSession: vi.fn(() => 0),
  activeSessionCount: vi.fn(() => 0),
  ackVoiceMessage: vi.fn((_msgId: number) => {}),
}));

vi.mock("../session-manager.js", () => ({
  validateSession: (sid: number, suffix: number) => mocks.validateSession(sid, suffix),
  getDequeueDefault: (sid: number) => sessionDefaults.get(sid) ?? 300,
  setDequeueDefault: (sid: number, timeout: number) => { sessionDefaults.set(sid, timeout); },
  setActiveSession: (sid: number) => { mocks.setActiveSession(sid); },
  getActiveSession: () => mocks.getActiveSession(),
  activeSessionCount: () => mocks.activeSessionCount(),
  touchSession: (sid: number) => { mocks.touchSession(sid); },
  setDequeueIdle: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    ackVoiceMessage: (msgId: number) => { mocks.ackVoiceMessage(msgId); },
  };
});

vi.mock("../session-queue.js", () => ({
  getSessionQueue: (sid: number) => mocks.getSessionQueue(sid),
  getMessageOwner: (msgId: number) => mocks.getMessageOwner(msgId),
}));

import { register } from "./set_dequeue_default.js";
import { register as registerDequeue } from "./dequeue.js";

interface DequeueResult {
  updates?: unknown[];
  timed_out?: boolean;
  empty?: boolean;
  error?: string;
  message?: string;
  hint?: string;
}

describe("set_dequeue_default tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionDefaults.clear();
    mocks.validateSession.mockReturnValue(true);
    const server = createMockServer();
    register(server);
    call = server.getHandler("set_dequeue_default");
  });

  it("sets default successfully and returns ok: true", async () => {
    const result = await call({ token: 1_123_456, timeout: 600 });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ ok: boolean; timeout: number; previous: number }>(result);
    expect(data.ok).toBe(true);
    expect(data.timeout).toBe(600);
  });

  it("returns the previous value before the update", async () => {
    // Default is 300 (server default) before any set
    const result = await call({ token: 1_123_456, timeout: 600 });
    const data = parseResult<{ ok: boolean; timeout: number; previous: number }>(result);
    expect(data.previous).toBe(300);
  });

  it("subsequent call shows updated previous value", async () => {
    await call({ token: 1_123_456, timeout: 600 });
    const result2 = await call({ token: 1_123_456, timeout: 900 });
    const data = parseResult<{ ok: boolean; timeout: number; previous: number }>(result2);
    expect(data.previous).toBe(600);
    expect(data.timeout).toBe(900);
  });

  it("calls setDequeueDefault with the correct sid and timeout", async () => {
    await call({ token: 2_001_234, timeout: 450 });
    expect(sessionDefaults.get(2)).toBe(450);
  });

  it("allows timeout of 0 (instant poll mode)", async () => {
    const result = await call({ token: 1_123_456, timeout: 0 });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ ok: boolean; timeout: number }>(result);
    expect(data.ok).toBe(true);
    expect(data.timeout).toBe(0);
  });

  it("allows timeout of 3600 (max allowed value)", async () => {
    const result = await call({ token: 1_123_456, timeout: 3600 });
    expect(isError(result)).toBe(false);
    const data = parseResult<{ ok: boolean; timeout: number }>(result);
    expect(data.timeout).toBe(3600);
  });

  it("rejects timeout above 3600 (overflow guard)", async () => {
    const result = call({ token: 1_123_456, timeout: 99999 });
    await expect(result).rejects.toThrow();
  });

  it("returns SID_REQUIRED when token is missing", async () => {
    const result = await call({});
    expect(isError(result)).toBe(true);
    const text = JSON.stringify(result);
    expect(text).toContain("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when suffix does not match", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({ token: 1_999_999, timeout: 300 });
    expect(isError(result)).toBe(true);
    const text = JSON.stringify(result);
    expect(text).toContain("AUTH_FAILED");
  });

  it("rejects non-integer timeout", async () => {
    const result = call({ token: 1_123_456, timeout: 1.5 });
    await expect(result).rejects.toThrow();
  });

  it("rejects negative timeout", async () => {
    const result = call({ token: 1_123_456, timeout: -1 });
    await expect(result).rejects.toThrow();
  });
});

// =========================================================================
// Integration: set_dequeue_default affects dequeue gate logic
// =========================================================================

describe("integration: set_dequeue_default affects dequeue gate", () => {
  let callDequeue: (args: Record<string, unknown>, extra?: Record<string, unknown>) => Promise<unknown>;
  let callSetDefault: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionDefaults.clear();
    mocks.validateSession.mockReturnValue(true);
    mocks.pendingCount.mockReturnValue(0);
    mocks.waitForEnqueue.mockResolvedValue(undefined);
    mocks.getSessionQueue.mockImplementation(() => ({
      dequeueBatch: () => mocks.dequeueBatch(),
      pendingCount: () => mocks.pendingCount(),
      waitForEnqueue: () => mocks.waitForEnqueue(),
    }));

    const server = createMockServer();
    registerDequeue(server);
    register(server);
    callDequeue = server.getHandler("dequeue");
    callSetDefault = server.getHandler("set_dequeue_default");
  });

  it("with default=600 set, timeout=500 passes without force", async () => {
    // Raise the default to 600 (simulated — we use small real values to avoid blocking)
    // Set default to 5 to simulate a raised default; use timeout=3 < 5 → passes
    await callSetDefault({ token: 1_123_456, timeout: 5 });
    expect(sessionDefaults.get(1)).toBe(5);

    mocks.dequeueBatch.mockReturnValue([]);
    mocks.waitForEnqueue.mockImplementation(
      () => new Promise<void>((r) => setTimeout(r, 50)),
    );
    const result = await callDequeue({ timeout: 3, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.error).toBeUndefined();
    expect(data.timed_out).toBe(true);
  });

  it("with default=60 (session default), timeout=200 is rejected", async () => {
    // Set session default to 60; timeout 200 > 60 → TIMEOUT_EXCEEDS_DEFAULT
    await callSetDefault({ token: 1_123_456, timeout: 60 });
    const result = await callDequeue({ timeout: 200, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.code).toBe("TIMEOUT_EXCEEDS_DEFAULT");
    expect(data.message).toContain("200");
    expect(data.message).toContain("60");
  });

  it("after set_dequeue_default, timeout below new default passes without force", async () => {
    // Set default to 2s; then timeout=1 < 2 → should pass (and complete quickly)
    await callSetDefault({ token: 1_123_456, timeout: 2 });

    mocks.dequeueBatch.mockReturnValue([]);
    mocks.waitForEnqueue.mockImplementation(
      () => new Promise<void>((r) => setTimeout(r, 50)),
    );
    const result = await callDequeue({ timeout: 1, token: 1_123_456 });
    const data = parseResult<DequeueResult>(result);
    expect(data.error).toBeUndefined();
    expect(data.timed_out).toBe(true);
  });
});
