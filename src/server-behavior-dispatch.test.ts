/**
 * Unit tests for dispatchBehaviorTracking — the server-side routing layer that
 * maps tool name + args to behavior-tracker record calls.
 *
 * Specifically covers the action-dispatcher path added in 10-774: when
 * action(type:"show-typing") or action(type:"react") arrive, the same
 * behavior-tracker functions must fire as for the legacy standalone tools.
 *
 * Also covers lazy onboarding guidance delivery (task 10-0581): five messages
 * previously sent at session start are now delivered at natural trigger points.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  initSession,
  getSessionState,
  resetBehaviorTrackerForTest,
} from "./behavior-tracker.js";
import { dispatchBehaviorTracking } from "./server.js";

beforeEach(() => {
  resetBehaviorTrackerForTest();
});

// ---------------------------------------------------------------------------
// action(type:"show-typing") — must fire btRecordTyping + recordPresenceSignal
// ---------------------------------------------------------------------------

describe("action(type:'show-typing') behavior tracking", () => {
  it("records typing and presence when type is show-typing", () => {
    initSession(1);
    dispatchBehaviorTracking(1, "action", { type: "show-typing" }, {});
    const state = getSessionState(1)!;
    expect(state.lastTypingAt).toBeDefined();
    expect(state.hadActivityAfterDequeue).toBe(true);
    expect(state.lastOutboundAt).toBeDefined();
  });

  it("skips recording when cancel:true is passed via action", () => {
    initSession(1);
    dispatchBehaviorTracking(1, "action", { type: "show-typing", cancel: true }, {});
    const state = getSessionState(1)!;
    expect(state.lastTypingAt).toBeUndefined();
    expect(state.lastOutboundAt).toBeUndefined();
  });

  it("fires the same state as legacy show_typing tool call", () => {
    initSession(1);
    initSession(2);
    dispatchBehaviorTracking(1, "action", { type: "show-typing" }, {});
    dispatchBehaviorTracking(2, "show_typing", {}, {});
    const s1 = getSessionState(1)!;
    const s2 = getSessionState(2)!;
    expect(s1.lastTypingAt).toBeDefined();
    expect(s2.lastTypingAt).toBeDefined();
    expect(s1.hadActivityAfterDequeue).toBe(s2.hadActivityAfterDequeue);
  });
});

// ---------------------------------------------------------------------------
// action(type:"react") — must fire btRecordReaction + recordPresenceSignal
// ---------------------------------------------------------------------------

describe("action(type:'react') behavior tracking", () => {
  it("marks hadActivityAfterDequeue and sets lastOutboundAt", () => {
    initSession(1);
    dispatchBehaviorTracking(1, "action", { type: "react" }, {});
    const state = getSessionState(1)!;
    expect(state.hadActivityAfterDequeue).toBe(true);
    expect(state.lastOutboundAt).toBeDefined();
  });

  it("fires the same state as legacy set_reaction tool call", () => {
    initSession(1);
    initSession(2);
    dispatchBehaviorTracking(1, "action", { type: "react" }, {});
    dispatchBehaviorTracking(2, "set_reaction", {}, {});
    const s1 = getSessionState(1)!;
    const s2 = getSessionState(2)!;
    expect(s1.hadActivityAfterDequeue).toBe(s2.hadActivityAfterDequeue);
    expect(s1.lastOutboundAt).toBeDefined();
    expect(s2.lastOutboundAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Legacy tool names still fire (regression guard)
// ---------------------------------------------------------------------------

describe("legacy show_typing and set_reaction still work", () => {
  it("show_typing fires typing + presence", () => {
    initSession(1);
    dispatchBehaviorTracking(1, "show_typing", {}, {});
    const state = getSessionState(1)!;
    expect(state.lastTypingAt).toBeDefined();
    expect(state.lastOutboundAt).toBeDefined();
  });

  it("show_typing with cancel:true skips recording", () => {
    initSession(1);
    dispatchBehaviorTracking(1, "show_typing", { cancel: true }, {});
    const state = getSessionState(1)!;
    expect(state.lastTypingAt).toBeUndefined();
    expect(state.lastOutboundAt).toBeUndefined();
  });

  it("set_reaction fires activity + presence", () => {
    initSession(1);
    dispatchBehaviorTracking(1, "set_reaction", {}, {});
    const state = getSessionState(1)!;
    expect(state.hadActivityAfterDequeue).toBe(true);
    expect(state.lastOutboundAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Other action types don't bleed into typing/reaction tracking
// ---------------------------------------------------------------------------

describe("other action types don't trigger typing or reaction tracking", () => {
  it("action(type:'confirm/yn') fires btRecordButtonUse and recordPresenceSignal, not typing", () => {
    initSession(1);
    dispatchBehaviorTracking(1, "action", { type: "confirm/yn" }, {});
    const state = getSessionState(1)!;
    expect(state.lastTypingAt).toBeUndefined();
    expect(state.lastOutboundAt).toBeDefined();
    expect(state.knowsButtons).toBe(true);
  });

  it("action(type:'session/list') fires no tracking", () => {
    initSession(1);
    dispatchBehaviorTracking(1, "action", { type: "session/list" }, {});
    const state = getSessionState(1)!;
    expect(state.lastTypingAt).toBeUndefined();
    expect(state.hadActivityAfterDequeue).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lazy onboarding guidance delivery (task 10-0581)
// ---------------------------------------------------------------------------

// Mock deliverServiceMessage and markFirstUseHintSeen to assert lazy delivery
// without touching real session queues or session manager state.
vi.mock("./session-queue.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./session-queue.js")>();
  return { ...original, deliverServiceMessage: vi.fn() };
});

vi.mock("./first-use-hints.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./first-use-hints.js")>();
  return { ...original, markFirstUseHintSeen: vi.fn(((_sid: number, _key: string) => true)) };
});

describe("lazy onboarding — Trigger A: first dequeue with user content", () => {
  beforeEach(async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    const { markFirstUseHintSeen } = await import("./first-use-hints.js");
    vi.mocked(deliverServiceMessage).mockClear();
    vi.mocked(markFirstUseHintSeen).mockImplementation((_sid, _key) => true);
  });

  function makeDequeueResult(fromUser: boolean) {
    const updates = fromUser
      ? [{ from: "user", content: { type: "text", text: "hello" } }]
      : [{ from: "service", eventType: "ping" }];
    return { content: [{ text: JSON.stringify({ updates }) }] };
  }

  it("delivers onboarding_protocol on first dequeue with user content", async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    initSession(1);
    dispatchBehaviorTracking(1, "dequeue", {}, makeDequeueResult(true));
    const delivered = vi.mocked(deliverServiceMessage).mock.calls.map(c =>
      typeof c[1] === "object" && c[1] !== null ? (c[1] as Record<string, unknown>).eventType : null
    );
    expect(delivered).toContain("onboarding_protocol");
  });

  it("delivers onboarding_modality_priority on first dequeue with user content", async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    initSession(1);
    dispatchBehaviorTracking(1, "dequeue", {}, makeDequeueResult(true));
    const delivered = vi.mocked(deliverServiceMessage).mock.calls.map(c =>
      typeof c[1] === "object" && c[1] !== null ? (c[1] as Record<string, unknown>).eventType : null
    );
    expect(delivered).toContain("onboarding_modality_priority");
  });

  it("delivers onboarding_presence_signals on first dequeue with user content", async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    initSession(1);
    dispatchBehaviorTracking(1, "dequeue", {}, makeDequeueResult(true));
    const delivered = vi.mocked(deliverServiceMessage).mock.calls.map(c =>
      typeof c[1] === "object" && c[1] !== null ? (c[1] as Record<string, unknown>).eventType : null
    );
    expect(delivered).toContain("onboarding_presence_signals");
  });

  it("does NOT deliver lazy onboarding messages when dequeue has no user content", async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    initSession(1);
    dispatchBehaviorTracking(1, "dequeue", {}, makeDequeueResult(false));
    const delivered = vi.mocked(deliverServiceMessage).mock.calls.map(c =>
      typeof c[1] === "object" && c[1] !== null ? (c[1] as Record<string, unknown>).eventType : null
    );
    expect(delivered).not.toContain("onboarding_protocol");
    expect(delivered).not.toContain("onboarding_modality_priority");
    expect(delivered).not.toContain("onboarding_presence_signals");
  });
});

describe("lazy onboarding — Trigger B: first send", () => {
  beforeEach(async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    const { markFirstUseHintSeen } = await import("./first-use-hints.js");
    vi.mocked(deliverServiceMessage).mockClear();
    vi.mocked(markFirstUseHintSeen).mockImplementation((_sid, _key) => true);
  });

  it("delivers onboarding_hybrid_messaging on first send call", async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    initSession(1);
    dispatchBehaviorTracking(1, "send", { type: "text", text: "hello" }, {});
    const delivered = vi.mocked(deliverServiceMessage).mock.calls.map(c =>
      typeof c[1] === "object" && c[1] !== null ? (c[1] as Record<string, unknown>).eventType : null
    );
    expect(delivered).toContain("onboarding_hybrid_messaging");
  });

  it("does NOT deliver onboarding_hybrid_messaging on send(type:'dm')", async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    const { markFirstUseHintSeen } = await import("./first-use-hints.js");
    vi.mocked(markFirstUseHintSeen).mockImplementation((_sid, _key) => true);
    initSession(1);
    dispatchBehaviorTracking(1, "send", { type: "dm", target: 2, text: "hello" }, {});
    const delivered = vi.mocked(deliverServiceMessage).mock.calls.map(c =>
      typeof c[1] === "object" && c[1] !== null ? (c[1] as Record<string, unknown>).eventType : null
    );
    expect(delivered).not.toContain("onboarding_hybrid_messaging");
  });
});

describe("lazy onboarding — Trigger C: first confirm/ action or send(question)", () => {
  beforeEach(async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    const { markFirstUseHintSeen } = await import("./first-use-hints.js");
    vi.mocked(deliverServiceMessage).mockClear();
    vi.mocked(markFirstUseHintSeen).mockImplementation((_sid, _key) => true);
  });

  it("delivers onboarding_buttons on first action(type:'confirm/yn')", async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    initSession(1);
    dispatchBehaviorTracking(1, "action", { type: "confirm/yn" }, {});
    const delivered = vi.mocked(deliverServiceMessage).mock.calls.map(c =>
      typeof c[1] === "object" && c[1] !== null ? (c[1] as Record<string, unknown>).eventType : null
    );
    expect(delivered).toContain("onboarding_buttons");
  });

  it("delivers onboarding_buttons on first action(type:'confirm/ok')", async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    initSession(1);
    dispatchBehaviorTracking(1, "action", { type: "confirm/ok" }, {});
    const delivered = vi.mocked(deliverServiceMessage).mock.calls.map(c =>
      typeof c[1] === "object" && c[1] !== null ? (c[1] as Record<string, unknown>).eventType : null
    );
    expect(delivered).toContain("onboarding_buttons");
  });

  it("delivers onboarding_buttons on first action(type:'confirm/ok-cancel')", async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    initSession(1);
    dispatchBehaviorTracking(1, "action", { type: "confirm/ok-cancel" }, {});
    const delivered = vi.mocked(deliverServiceMessage).mock.calls.map(c =>
      typeof c[1] === "object" && c[1] !== null ? (c[1] as Record<string, unknown>).eventType : null
    );
    expect(delivered).toContain("onboarding_buttons");
  });

  it("delivers onboarding_buttons on first send(type:'question', choose:[...])", async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    initSession(1);
    dispatchBehaviorTracking(1, "send", { type: "question", choose: ["yes", "no"] }, {});
    const delivered = vi.mocked(deliverServiceMessage).mock.calls.map(c =>
      typeof c[1] === "object" && c[1] !== null ? (c[1] as Record<string, unknown>).eventType : null
    );
    expect(delivered).toContain("onboarding_buttons");
  });

  it("delivers onboarding_buttons on first send(type:'question', options:[...])", async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    initSession(1);
    dispatchBehaviorTracking(1, "send", { type: "question", options: ["Option A", "Option B"] }, {});
    const delivered = vi.mocked(deliverServiceMessage).mock.calls.map(c =>
      typeof c[1] === "object" && c[1] !== null ? (c[1] as Record<string, unknown>).eventType : null
    );
    expect(delivered).toContain("onboarding_buttons");
  });

  it("does NOT deliver onboarding_buttons on plain send(type:'text')", async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    initSession(1);
    dispatchBehaviorTracking(1, "send", { type: "text", text: "plain message" }, {});
    const delivered = vi.mocked(deliverServiceMessage).mock.calls.map(c =>
      typeof c[1] === "object" && c[1] !== null ? (c[1] as Record<string, unknown>).eventType : null
    );
    expect(delivered).not.toContain("onboarding_buttons");
  });

  it("does NOT deliver onboarding_buttons on send(type:'question', ask:'...')", async () => {
    const { deliverServiceMessage } = await import("./session-queue.js");
    initSession(1);
    dispatchBehaviorTracking(1, "send", { type: "question", ask: "Free text question?" }, {});
    const delivered = vi.mocked(deliverServiceMessage).mock.calls.map(c =>
      typeof c[1] === "object" && c[1] !== null ? (c[1] as Record<string, unknown>).eventType : null
    );
    expect(delivered).not.toContain("onboarding_buttons");
  });
});
