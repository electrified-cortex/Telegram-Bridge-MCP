/**
 * Integration tests for spawn-child service message chain.
 * Spec: spawn-child-service-message-chain-2026-05-24
 * Covers AC1–AC5d, AC7–AC8.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createSessionQueue,
  resetSessionQueuesForTest,
  deliverServiceMessage,
} from "./session-queue.js";
import { resetSessions, createSession, getSession } from "./session-manager.js";
import { resetStoreForTest, recordOutgoing } from "./message-store.js";
import { runDrainLoop, _resetStaleWarningMapForTest, _resetTimeoutHintForTest } from "./tools/dequeue.js";
import { handleRevokeChild } from "./tools/session/revoke-child.js";
import { handleChildForward } from "./tools/session/forward-child.js";
import { handleSpawnChild } from "./tools/session/spawn-child.js";
import { clearChildRegistry, registerChild } from "./tools/session/child-registry.js";
import { handleHttpDequeue } from "./dequeue-endpoint.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAbortSignal(): AbortSignal {
  return new AbortController().signal;
}

interface ChildInfo {
  sid: number;
  token: number;
}

interface ParentInfo {
  sid: number;
  token: number;
}

/** Create parent session + queue. Returns { sid, token }. */
function makeParentSession(name: string): ParentInfo {
  const r = createSession(name);
  createSessionQueue(r.sid);
  return { sid: r.sid, token: r.sid * 1_000_000 + r.suffix };
}

/**
 * Create a child session + queue registered under parentSid.
 * Returns { sid, token }.
 */
function makeChildSession(parentSid: number, name: string): ChildInfo {
  const r = createSession(name);
  createSessionQueue(r.sid);
  const session = getSession(r.sid)!;
  session.parent_sid = parentSid;
  registerChild(parentSid, r.sid);
  return { sid: r.sid, token: r.sid * 1_000_000 + r.suffix };
}

/** Instant (timeout=0) drain of a session queue. */
async function drain(sid: number): Promise<Record<string, unknown>> {
  return runDrainLoop(sid, 0, makeAbortSignal());
}

/** Extract event_type list from a dequeue result's updates. */
function eventTypes(result: Record<string, unknown>): string[] {
  const updates = result["updates"] as Array<Record<string, unknown>> | undefined;
  if (!updates) return [];
  return updates.map(u => {
    const c = u["content"] as Record<string, unknown> | undefined;
    return (c?.["event_type"] as string) ?? "";
  }).filter(Boolean);
}

/** Find a content object by event_type in a dequeue result. */
function contentOf(result: Record<string, unknown>, eventType: string): Record<string, unknown> | undefined {
  const updates = result["updates"] as Array<Record<string, unknown>> | undefined;
  return updates?.find(u => {
    const c = u["content"] as Record<string, unknown>;
    return c["event_type"] === eventType;
  })?.["content"] as Record<string, unknown> | undefined;
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  resetSessions();
  resetSessionQueuesForTest();
  resetStoreForTest();
  clearChildRegistry();
  _resetStaleWarningMapForTest();
  _resetTimeoutHintForTest();
});

afterEach(() => {
  resetSessions();
  resetSessionQueuesForTest();
  resetStoreForTest();
  clearChildRegistry();
});

// ── AC1: origin discriminator ─────────────────────────────────────────────────

describe("AC1 — EventContent.origin discriminator", () => {
  it("AC1: deliverServiceMessage stamps origin: 'bridge' on service messages", async () => {
    const parent = makeParentSession("Parent");

    deliverServiceMessage(parent.sid, "test msg", "test_type");

    const result = await drain(parent.sid);
    const updates = result["updates"] as Array<Record<string, unknown>>;
    const content = updates[0]["content"] as Record<string, unknown>;
    expect(content["origin"]).toBe("bridge");
  });

  it("AC1: bundled-entry form also stamps origin: 'bridge'", async () => {
    const parent = makeParentSession("Parent");
    // Use the static NO_PENDING_YET entry (no text function)
    const { SERVICE_MESSAGES } = await import("./service-messages.js");
    deliverServiceMessage(parent.sid, SERVICE_MESSAGES.ONBOARDING_NO_PENDING_YET);

    const result = await drain(parent.sid);
    const updates = result["updates"] as Array<Record<string, unknown>>;
    const content = updates[0]["content"] as Record<string, unknown>;
    expect(content["origin"]).toBe("bridge");
  });

  it("AC1: child/forward events carry origin: 'child_forward'", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    // Directly inject via handleChildForward (real path)
    handleChildForward({ token: parent.token, child_sid: child.sid, message: "forwarded" });

    const result = await drain(child.sid);
    const updates = result["updates"] as Array<Record<string, unknown>>;
    // Skip onboarding messages (first dequeue); find the parent_forward
    const forwarded = updates.find(u => {
      const c = u["content"] as Record<string, unknown>;
      return c["event_type"] === "parent_forward";
    });
    expect(forwarded).toBeDefined();
    expect((forwarded!["content"] as Record<string, unknown>)["origin"]).toBe("child_forward");
  });

  it("AC1: CHILD_ONBOARDING_* messages carry origin: 'bridge'", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    const result = await drain(child.sid);
    const updates = result["updates"] as Array<Record<string, unknown>>;
    const onboarding = updates.filter(u => {
      const c = u["content"] as Record<string, unknown>;
      const et = c["event_type"] as string;
      return et?.startsWith("onboarding_child_");
    });
    expect(onboarding.length).toBe(4);
    for (const u of onboarding) {
      expect((u["content"] as Record<string, unknown>)["origin"]).toBe("bridge");
    }
  });

  it("AC1: CHILD_FIRST_DEQUEUE_CONFIRMED carries origin: 'bridge'", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    await drain(child.sid);
    const parentResult = await drain(parent.sid);
    const content = contentOf(parentResult, "child_first_dequeue_confirmed");

    expect(content).toBeDefined();
    expect(content!["origin"]).toBe("bridge");
  });
});

// ── AC2: first dequeue → 4 onboarding messages in order ──────────────────────

describe("AC2 — First dequeue injects 4 onboarding messages in order", () => {
  it("AC2: first dequeue returns onboarding_child_token, _role, _loop, _exit_protocol (in that order)", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "ResearchTask");

    const result = await drain(child.sid);
    const types = eventTypes(result);

    const tokenIdx = types.indexOf("onboarding_child_token");
    const roleIdx = types.indexOf("onboarding_child_role");
    const loopIdx = types.indexOf("onboarding_child_loop");
    const exitIdx = types.indexOf("onboarding_child_exit_protocol");

    expect(tokenIdx).toBeGreaterThanOrEqual(0);
    expect(roleIdx).toBeGreaterThanOrEqual(0);
    expect(loopIdx).toBeGreaterThanOrEqual(0);
    expect(exitIdx).toBeGreaterThanOrEqual(0);
    expect(tokenIdx).toBeLessThan(roleIdx);
    expect(roleIdx).toBeLessThan(loopIdx);
    expect(loopIdx).toBeLessThan(exitIdx);
  });

  it("AC2: ROLE text mentions the child's topic name and parent info", async () => {
    const parent = makeParentSession("ParentAgent");
    const child = makeChildSession(parent.sid, "ResearchTask");

    const result = await drain(child.sid);
    const roleContent = contentOf(result, "onboarding_child_role");

    expect(roleContent).toBeDefined();
    const text = roleContent!["text"] as string;
    expect(text).toContain("ResearchTask");
    expect(text).toContain("ParentAgent");
  });

  it("AC2: LOOP text contains the child dispatch token", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    const result = await drain(child.sid);
    const loopContent = contentOf(result, "onboarding_child_loop");

    expect(loopContent).toBeDefined();
    expect(loopContent!["text"] as string).toContain(String(child.token));
  });

  it("AC2: EXIT_PROTOCOL text contains the child dispatch token", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    const result = await drain(child.sid);
    const exitContent = contentOf(result, "onboarding_child_exit_protocol");

    expect(exitContent).toBeDefined();
    expect(exitContent!["text"] as string).toContain(String(child.token));
  });
});

// ── AC3: second dequeue → no onboarding messages (idempotency) ───────────────

describe("AC3 — Second dequeue does not repeat onboarding messages", () => {
  it("AC3: onboarding messages only appear on the first dequeue", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    await drain(child.sid); // first — triggers onboarding

    const result2 = await drain(child.sid); // second — no onboarding
    const types2 = eventTypes(result2);

    expect(types2).not.toContain("onboarding_child_role");
    expect(types2).not.toContain("onboarding_child_loop");
    expect(types2).not.toContain("onboarding_child_exit_protocol");
  });
});

// ── AC4: CHILD_FIRST_DEQUEUE_CONFIRMED fired to parent only ──────────────────

describe("AC4 — CHILD_FIRST_DEQUEUE_CONFIRMED fired to parent exactly once", () => {
  it("AC4: parent gets child_first_dequeue_confirmed on first child dequeue", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    await drain(child.sid);
    const parentResult = await drain(parent.sid);

    expect(eventTypes(parentResult)).toContain("child_first_dequeue_confirmed");
  });

  it("AC4: confirmed fires exactly once even across multiple child dequeues", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    await drain(child.sid); // first — fires confirmed
    await drain(child.sid); // second — no repeat

    const parentResult = await drain(parent.sid);
    const updates = parentResult["updates"] as Array<Record<string, unknown>> | undefined;
    const count = (updates ?? []).filter(u => {
      const c = u["content"] as Record<string, unknown>;
      return c["event_type"] === "child_first_dequeue_confirmed";
    }).length;
    expect(count).toBe(1);
  });

  it("AC4: sibling session does not receive CHILD_FIRST_DEQUEUE_CONFIRMED", async () => {
    const parent = makeParentSession("Parent");
    const sibling = makeParentSession("Sibling");
    const child = makeChildSession(parent.sid, "Helper");

    await drain(child.sid);
    const sibResult = await drain(sibling.sid);

    expect(eventTypes(sibResult)).not.toContain("child_first_dequeue_confirmed");
  });

  it("AC4: onboarding still fires when parent queue is absent (parent-gone edge case)", async () => {
    const parentR = createSession("Parent"); // create session but NO queue
    const child = makeChildSession(parentR.sid, "Helper");

    // Should not throw; child still gets onboarding
    const result = await drain(child.sid);
    const types = eventTypes(result);

    expect(types).toContain("onboarding_child_role");
    expect(types).toContain("onboarding_child_loop");
    expect(types).toContain("onboarding_child_exit_protocol");
  });
});

// ── AC5: EXIT_STATUS, self-revoke, CHILD_SESSION_RESOLVED ────────────────────

describe("AC5 — EXIT_STATUS detection and revocation flow", () => {
  it("AC5a: EXIT_STATUS: prefix stores exit_status on child session", () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    recordOutgoing(9001, "text", "EXIT_STATUS: resolved", undefined, undefined, child.sid);

    expect(getSession(child.sid)!.exit_status).toBe("resolved");
  });

  it("AC5a: multi-word EXIT_STATUS description is stored in full", () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    recordOutgoing(9002, "text", "EXIT_STATUS: filed task X", undefined, undefined, child.sid);

    expect(getSession(child.sid)!.exit_status).toBe("filed task X");
  });

  it("AC5a: non-EXIT_STATUS outbound messages do not set exit_status", () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    recordOutgoing(9003, "text", "Regular message", undefined, undefined, child.sid);

    expect(getSession(child.sid)!.exit_status).toBeUndefined();
  });

  it("AC5a: EXIT_STATUS from root session (no parent_sid) is ignored", () => {
    const root = makeParentSession("Root");

    recordOutgoing(9004, "text", "EXIT_STATUS: resolved", undefined, undefined, root.sid);

    expect(getSession(root.sid)!.exit_status).toBeUndefined();
  });

  it("AC5b: child self-revocation succeeds via own dispatch token", () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    const result = handleRevokeChild({ token: child.token, child_token: child.token });

    const data = JSON.parse((result as { content: { text: string }[] }).content[0].text) as { closed: boolean };
    expect(data.closed).toBe(true);
  });

  it("AC5c: parent receives child_session_resolved on self-revocation with exit_status", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    recordOutgoing(9005, "text", "EXIT_STATUS: resolved", undefined, undefined, child.sid);
    handleRevokeChild({ token: child.token, child_token: child.token });

    const parentResult = await drain(parent.sid);
    const resolved = contentOf(parentResult, "child_session_resolved");
    expect(resolved).toBeDefined();
    expect(resolved!["text"] as string).toContain("resolved");
  });

  it("AC5c: parent receives child_session_resolved on parent-initiated revocation", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    recordOutgoing(9006, "text", "EXIT_STATUS: awaiting external auth", undefined, undefined, child.sid);
    handleRevokeChild({ token: parent.token, child_token: child.token });

    const parentResult = await drain(parent.sid);
    const resolved = contentOf(parentResult, "child_session_resolved");
    expect(resolved).toBeDefined();
    expect(resolved!["text"] as string).toContain("awaiting external auth");
  });

  it("AC5d: parent revocation via callerSid === registeredParent still works", () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    const result = handleRevokeChild({ token: parent.token, child_token: child.token });

    const data = JSON.parse((result as { content: { text: string }[] }).content[0].text) as { closed: boolean };
    expect(data.closed).toBe(true);
  });
});

// ── AC7: CAPABILITY_DENIED (direct MCP tool path) ────────────────────────────

describe("AC7 — CAPABILITY_DENIED from direct handleSpawnChild call", () => {
  it("AC7: gather-capability session blocked when calling handleSpawnChild directly", async () => {
    const parent = makeParentSession("Parent");
    getSession(parent.sid)!.child_capability = "gather";

    const result = await handleSpawnChild({ token: parent.token, name: "Child" });

    const data = JSON.parse((result as { isError: boolean; content: { text: string }[] }).content[0].text) as { code: string };
    expect((result as { isError: boolean }).isError).toBe(true);
    expect(data.code).toBe("CAPABILITY_DENIED");
  });

  it("AC7: read-only-capability session blocked when calling handleSpawnChild directly", async () => {
    const parent = makeParentSession("Parent");
    getSession(parent.sid)!.child_capability = "read-only";

    const result = await handleSpawnChild({ token: parent.token, name: "Child" });

    const data = JSON.parse((result as { isError: boolean; content: { text: string }[] }).content[0].text) as { code: string };
    expect((result as { isError: boolean }).isError).toBe(true);
    expect(data.code).toBe("CAPABILITY_DENIED");
  });
});

// ── AC8: HTTP /dequeue path fires R4/R2 identically to MCP ──────────────────

describe("AC8 — HTTP /dequeue fires R4/R2 identically to MCP dequeue", () => {
  it("AC8: first HTTP dequeue on child session returns 3 onboarding messages", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    const [status, result] = await handleHttpDequeue(String(child.token), { max_wait: 0 }, makeAbortSignal());

    expect(status).toBe(200);
    const types = eventTypes(result);
    expect(types).toContain("onboarding_child_role");
    expect(types).toContain("onboarding_child_loop");
    expect(types).toContain("onboarding_child_exit_protocol");
  });

  it("AC8: second HTTP dequeue does not repeat onboarding messages", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    await handleHttpDequeue(String(child.token), { max_wait: 0 }, makeAbortSignal());

    const [, result2] = await handleHttpDequeue(String(child.token), { max_wait: 0 }, makeAbortSignal());
    const types2 = eventTypes(result2);
    expect(types2).not.toContain("onboarding_child_role");
    expect(types2).not.toContain("onboarding_child_loop");
    expect(types2).not.toContain("onboarding_child_exit_protocol");
  });

  it("AC8: HTTP dequeue also fires CHILD_FIRST_DEQUEUE_CONFIRMED to parent", async () => {
    const parent = makeParentSession("Parent");
    const child = makeChildSession(parent.sid, "Helper");

    await handleHttpDequeue(String(child.token), { max_wait: 0 }, makeAbortSignal());

    const [, parentResult] = await handleHttpDequeue(String(parent.token), { max_wait: 0 }, makeAbortSignal());
    expect(eventTypes(parentResult)).toContain("child_first_dequeue_confirmed");
  });
});
