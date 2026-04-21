/**
 * Unit tests for dispatchBehaviorTracking — the server-side routing layer that
 * maps tool name + args to behavior-tracker record calls.
 *
 * Specifically covers the action-dispatcher path added in 10-774: when
 * action(type:"show-typing") or action(type:"react") arrive, the same
 * behavior-tracker functions must fire as for the legacy standalone tools.
 */
import { describe, it, expect, beforeEach } from "vitest";
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
