/**
 * Integration tests for sub-session Phase 1 (PRD 10-1952 v0.2).
 *
 * Covers: AC1, AC1b, AC1d, AC2, AC3b, AC3c.
 *
 * Uses real session-manager, session-queue, and child-registry.
 * Mocks: Telegram HTTP transport, handleSessionStart (to avoid approval flow).
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { parseResult, isError, createMockServer } from "../test-utils.js";
import { runInSessionContext } from "../../session-context.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  handleSessionStart: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("./start.js", () => ({
  handleSessionStart: mocks.handleSessionStart,
  handleSessionReconnect: vi.fn().mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify({ code: "SESSION_EXISTS" }) }],
    isError: true,
  }),
}));

vi.mock("../../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({ sendMessage: mocks.sendMessage }),
    resolveChat: () => 42,
  };
});

// ---------------------------------------------------------------------------
// Real module imports
// ---------------------------------------------------------------------------

import {
  createSession,
  resetSessions,
  setSessionCapability,
} from "../../session-manager.js";
import {
  createSessionQueue,
  resetSessionQueuesForTest,
  getSessionQueue,
} from "../../session-queue.js";
import { clearChildRegistry } from "./child-registry.js";
import { requireAuth } from "../../session-gate.js";
import { handleSpawnChild } from "./spawn-child.js";
import { handleRevokeChild } from "./revoke-child.js";
import { handleChildForward } from "./forward-child.js";
import { register } from "../action.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextChildId = 10;

function makeStartSuccess(_parentSid: number) {
  _nextChildId++;
  const childSid = _nextChildId;
  const childToken = childSid * 1_000_000 + 654321;
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ token: childToken, sid: childSid, hint: "" }),
      },
    ],
  };
}

function getLastChildToken(): number {
  return _nextChildId * 1_000_000 + 654321;
}

function getLastChildSid(): number {
  return _nextChildId;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetSessions();
  resetSessionQueuesForTest();
  clearChildRegistry();
  vi.clearAllMocks();
  _nextChildId = 10;
});

// ---------------------------------------------------------------------------
// AC1 — spawn returns { token, sid, parent_sid }
// ---------------------------------------------------------------------------

describe("AC1: spawn-child response shape", () => {
  it("returns { token, sid, parent_sid } on success", async () => {
    const { sid: pSid, suffix: pSuffix } = createSession("Parent");
    createSessionQueue(pSid);
    const pToken = pSid * 1_000_000 + pSuffix;
    mocks.handleSessionStart.mockResolvedValue(makeStartSuccess(pSid));

    const result = await runInSessionContext(pSid, () =>
      handleSpawnChild({ token: pToken, name: "Helper" }),
    );

    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.token).toBe(getLastChildToken());
    expect(data.sid).toBe(getLastChildSid());
    expect(data.parent_sid).toBe(pSid);
  });
});

// ---------------------------------------------------------------------------
// AC1b — spawn with non-matching token returns UNAUTHORIZED
// ---------------------------------------------------------------------------

describe("AC1b: token/context mismatch → UNAUTHORIZED", () => {
  it("rejects spawn when token belongs to a different session than the caller context", async () => {
    const { sid: pSid, suffix: _pSuffix } = createSession("Parent");
    createSessionQueue(pSid);
    const { sid: qSid, suffix: qSuffix } = createSession("Other");
    createSessionQueue(qSid);
    const qToken = qSid * 1_000_000 + qSuffix;

    // Run in P's context but pass Q's token
    const result = await runInSessionContext(pSid, () =>
      handleSpawnChild({ token: qToken, name: "Child" }),
    );

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  it("allows spawn when token matches caller context", async () => {
    const { sid: pSid, suffix: pSuffix } = createSession("Parent");
    createSessionQueue(pSid);
    const pToken = pSid * 1_000_000 + pSuffix;
    mocks.handleSessionStart.mockResolvedValue(makeStartSuccess(pSid));

    const result = await runInSessionContext(pSid, () =>
      handleSpawnChild({ token: pToken, name: "Child" }),
    );

    expect(isError(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC1d — gather child calling spawn-child → CAPABILITY_DENIED
// ---------------------------------------------------------------------------

describe("AC1d: gather capability blocks session/spawn-child", () => {
  it("returns CAPABILITY_DENIED when a gather session calls session/spawn-child via action dispatch", async () => {
    // Set up the action tool via mock server
    const mockServer = createMockServer();
    register(mockServer);
    const actionHandler = mockServer.getHandler("action");

    // Create a session and mark it as gather
    const { sid, suffix } = createSession("GatherChild");
    createSessionQueue(sid);
    setSessionCapability(sid, "gather");
    const gatherToken = sid * 1_000_000 + suffix;

    const result = await actionHandler({
      type: "session/spawn-child",
      token: gatherToken,
      name: "SubChild",
    });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("CAPABILITY_DENIED");
    expect(mocks.handleSessionStart).not.toHaveBeenCalled();
  });

  it("allows session/spawn-child for a full-capability session", async () => {
    const mockServer = createMockServer();
    register(mockServer);
    const actionHandler = mockServer.getHandler("action");

    const { sid, suffix } = createSession("FullParent");
    createSessionQueue(sid);
    setSessionCapability(sid, "full");
    const fullToken = sid * 1_000_000 + suffix;
    mocks.handleSessionStart.mockResolvedValue(makeStartSuccess(sid));

    const result = await runInSessionContext(sid, () =>
      actionHandler({ type: "session/spawn-child", token: fullToken, name: "Child" }),
    );

    expect(isError(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC2 — after revoke, child token returns AUTH_FAILED / SESSION_NOT_FOUND
// ---------------------------------------------------------------------------

describe("AC2: revoke-child invalidates child session", () => {
  it("child session is closed after revoke — requireAuth returns AUTH_FAILED", async () => {
    const { sid: pSid, suffix: pSuffix } = createSession("Parent");
    createSessionQueue(pSid);
    const pToken = pSid * 1_000_000 + pSuffix;

    // Manually create a child session
    const { sid: cSid, suffix: cSuffix } = createSession("Child");
    createSessionQueue(cSid);
    const cToken = cSid * 1_000_000 + cSuffix;

    // Register parent-child relationship so revoke-child passes the auth check
    const { registerChild } = await import("./child-registry.js");
    registerChild(pSid, cSid);

    // Revoke it
    const revokeResult = parseResult(handleRevokeChild({ token: pToken, child_token: cSid }));
    expect(revokeResult.closed).toBe(true);

    // Now child token is invalid
    const authResult = requireAuth(cToken);
    expect(typeof authResult).not.toBe("number");
    expect((authResult as { code: string }).code).toBe("AUTH_FAILED");
  });

  it("revoke-child returns { closed: true, sid }", async () => {
    const { sid: pSid, suffix: pSuffix } = createSession("Parent");
    createSessionQueue(pSid);
    const pToken = pSid * 1_000_000 + pSuffix;

    const { sid: cSid } = createSession("Child");
    createSessionQueue(cSid);

    // Register parent-child relationship
    const { registerChild } = await import("./child-registry.js");
    registerChild(pSid, cSid);

    const result = parseResult(handleRevokeChild({ token: pToken, child_token: cSid }));
    expect(result.closed).toBe(true);
    expect(result.sid).toBe(cSid);
  });
});

// ---------------------------------------------------------------------------
// AC3b — parent calls child/forward → message appears in child dequeue
// ---------------------------------------------------------------------------

describe("AC3b: child/forward injects into child queue", () => {
  it("forwarded message appears in child session queue", async () => {
    const { sid: pSid, suffix: pSuffix } = createSession("Parent");
    createSessionQueue(pSid);
    const pToken = pSid * 1_000_000 + pSuffix;

    const { sid: cSid } = createSession("Child");
    createSessionQueue(cSid);

    const { registerChild } = await import("./child-registry.js");
    registerChild(pSid, cSid);

    const queueBefore = getSessionQueue(cSid)!.pendingCount();

    const result = parseResult(
      handleChildForward({ token: pToken, child_sid: cSid, message: "hello child" }),
    );

    expect(result.forwarded).toBe(true);
    expect(result.child_sid).toBe(cSid);

    const queueAfter = getSessionQueue(cSid)!.pendingCount();
    expect(queueAfter).toBe(queueBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// AC3c — non-parent calling child/forward → UNAUTHORIZED
// ---------------------------------------------------------------------------

describe("AC3c: child/forward rejects non-parent callers", () => {
  it("returns UNAUTHORIZED when caller is not the parent", async () => {
    const { sid: pSid, suffix: _pSuffix } = createSession("Parent");
    createSessionQueue(pSid);

    const { sid: qSid, suffix: qSuffix } = createSession("Other");
    createSessionQueue(qSid);
    const qToken = qSid * 1_000_000 + qSuffix;

    const { sid: cSid } = createSession("Child");
    createSessionQueue(cSid);

    const { registerChild } = await import("./child-registry.js");
    registerChild(pSid, cSid); // child belongs to P, not Q

    const result = handleChildForward({
      token: qToken,
      child_sid: cSid,
      message: "sneaky",
    });

    expect(isError(result)).toBe(true);
    expect(parseResult(result).code).toBe("UNAUTHORIZED");
  });
});
