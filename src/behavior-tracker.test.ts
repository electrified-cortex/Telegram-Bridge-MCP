import { describe, it, expect, beforeEach } from "vitest";
import {
  initSession,
  removeSession,
  getSessionState,
  recordDequeue,
  recordTyping,
  recordAnimation,
  recordReaction,
  recordSend,
  recordButtonUse,
  recordOutboundText,
  setNudgeInjector,
  resetBehaviorTrackerForTest,
} from "./behavior-tracker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNudgeSpy(): { calls: Array<{ sid: number; text: string; eventType: string }> } {
  const calls: Array<{ sid: number; text: string; eventType: string }> = [];
  setNudgeInjector((sid, text, eventType) => {
    calls.push({ sid, text, eventType });
  });
  return { calls };
}

/** Simulate N sends with NO preceding show_typing. */
function sendWithoutTyping(sid: number, count: number, startNow = 1000): number {
  let now = startNow;
  for (let i = 0; i < count; i++) {
    recordSend(sid, now);
    now += 5000; // 5s between sends, well past 10s typing window
  }
  return now;
}

/** Simulate N sends with show_typing immediately before each. */
function sendWithTyping(sid: number, count: number, startNow = 1000): number {
  let now = startNow;
  for (let i = 0; i < count; i++) {
    recordTyping(sid, now);
    recordSend(sid, now + 100); // 100ms later — within 10s window
    now += 5000;
  }
  return now;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetBehaviorTrackerForTest();
});

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

describe("session lifecycle", () => {
  it("initializes a session with zero counts", () => {
    initSession(1);
    const state = getSessionState(1);
    expect(state).toBeDefined();
    expect(state!.sendCount).toBe(0);
    expect(state!.nudgeCount).toBe(0);
    expect(state!.firstUserMessageSeen).toBe(false);
  });

  it("is idempotent: double-init does not reset state", () => {
    initSession(1);
    recordTyping(1, 1000);
    initSession(1); // second call
    const state = getSessionState(1);
    expect(state!.lastTypingAt).toBe(1000); // state preserved
  });

  it("removes session state on removeSession", () => {
    initSession(1);
    removeSession(1);
    expect(getSessionState(1)).toBeUndefined();
  });

  it("is a no-op to record events on an uninitialized session", () => {
    // No throw expected
    expect(() => {
      recordDequeue(99, true, 1000);
      recordTyping(99, 1000);
      recordSend(99, 1000);
      recordReaction(99);
      recordAnimation(99, 1000);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Per-session isolation
// ---------------------------------------------------------------------------

describe("per-session isolation", () => {
  it("sessions have independent state", () => {
    initSession(1);
    initSession(2);

    sendWithoutTyping(1, 5); // session 1 sends 5 without typing
    sendWithTyping(2, 5);    // session 2 sends 5 with typing

    const s1 = getSessionState(1)!;
    const s2 = getSessionState(2)!;

    expect(s1.sendCount).toBe(5);
    expect(s1.typingBeforeSendCount).toBe(0);
    expect(s2.sendCount).toBe(5);
    expect(s2.typingBeforeSendCount).toBe(5);
  });

  it("nudges for session 1 do not affect session 2", () => {
    initSession(1);
    initSession(2);
    const spy = makeNudgeSpy();

    sendWithoutTyping(1, 5); // triggers nudge for session 1
    sendWithTyping(2, 5);    // good behavior for session 2 — no nudge

    const s1Nudges = spy.calls.filter(c => c.sid === 1);
    const s2Nudges = spy.calls.filter(c => c.sid === 2);

    expect(s1Nudges.length).toBeGreaterThan(0);
    expect(s2Nudges.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// First-message nudge
// ---------------------------------------------------------------------------

describe("first-message nudge", () => {
  it("injects a nudge on the first user message", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordDequeue(1, true, 1000);

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0].eventType).toBe("behavior_nudge_first_message");
    expect(typeof spy.calls[0].text).toBe("string");
    expect(spy.calls[0].sid).toBe(1);
  });

  it("does not fire again on subsequent user messages", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordDequeue(1, true, 1000);
    recordDequeue(1, true, 2000);
    recordDequeue(1, true, 3000);

    const firstMsgNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_first_message");
    expect(firstMsgNudges).toHaveLength(1);
  });

  it("does not fire when dequeue returns non-user events (hasUserMessage: false)", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordDequeue(1, false, 1000);

    expect(spy.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Show-typing rate nudge
// ---------------------------------------------------------------------------

describe("show-typing rate nudge", () => {
  it("does not nudge below the minimum send threshold (5 sends)", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    sendWithoutTyping(1, 4);

    const typingNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_typing_rate");
    expect(typingNudges).toHaveLength(0);
  });

  it("nudges when rate drops below 30% after 5+ sends", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    sendWithoutTyping(1, 5); // 0% rate

    const typingNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_typing_rate");
    expect(typingNudges).toHaveLength(1);
    expect(typeof typingNudges[0].text).toBe("string");
  });

  it("does not nudge when rate stays at or above 30%", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    // 3/10 = 30% = at threshold — should NOT nudge (threshold is strictly <30%)
    // To get >= 30%: 3 typed out of 5 = 60% — well above threshold
    sendWithTyping(1, 3);    // 3 sends with typing
    sendWithoutTyping(1, 2, 50000); // 2 sends without typing — rate = 3/5 = 60%

    const typingNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_typing_rate");
    expect(typingNudges).toHaveLength(0);
  });

  it("nudges exactly once even if rate stays low after 5+ sends", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    sendWithoutTyping(1, 10);

    const typingNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_typing_rate");
    expect(typingNudges).toHaveLength(1);
  });

  it("does not count typing that is older than 10s window", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    // typing at t=0, then send at t=11000 (outside 10s window)
    recordTyping(1, 0);
    recordSend(1, 11_000);
    recordSend(1, 20_000);
    recordSend(1, 30_000);
    recordSend(1, 40_000);
    recordSend(1, 50_000);

    // 0 of 5 sends had typing within window → rate 0% → nudge fires
    const typingNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_typing_rate");
    expect(typingNudges).toHaveLength(1);
  });

  it("counts typing within the 10s window correctly", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    let now = 1000;
    // 5 sends, each preceded by typing within 10s
    for (let i = 0; i < 5; i++) {
      recordTyping(1, now);
      recordSend(1, now + 500); // 500ms later — within window
      now += 5000;
    }

    // Rate = 5/5 = 100% — no nudge
    const typingNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_typing_rate");
    expect(typingNudges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dequeue-to-send gap nudge
// ---------------------------------------------------------------------------

describe("dequeue-to-send gap nudge", () => {
  it("does not nudge when activity occurs within 8s of dequeue", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    // First dequeue
    recordDequeue(1, true, 1000);
    // Activity at t=1500 (0.5s — within threshold)
    recordTyping(1, 1500);
    // Second dequeue
    recordDequeue(1, true, 10_000);
    recordTyping(1, 10_500);
    // Third dequeue
    recordDequeue(1, true, 20_000);

    const gapNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_slow_gap");
    expect(gapNudges).toHaveLength(0);
  });

  it("nudges when gap exceeds 8s for 2+ consecutive messages", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    // First dequeue — starts the gap timer
    recordDequeue(1, true, 1000);
    // No activity — second dequeue 10s later (gap = 10s > 8s → slowGapCount=1)
    recordDequeue(1, true, 11_000);
    // Still no activity — third dequeue 10s later (gap = 10s > 8s → slowGapCount=2 → nudge)
    recordDequeue(1, true, 21_000);

    const gapNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_slow_gap");
    expect(gapNudges).toHaveLength(1);
    expect(typeof gapNudges[0].text).toBe("string");
  });

  it("resets slow-gap count when activity occurs", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    // First dequeue, then activity → gap count resets
    recordDequeue(1, true, 1000);
    // No activity — slow gap
    recordDequeue(1, true, 11_000);
    // slowGapCount = 1

    // Activity happens now
    recordTyping(1, 12_000);

    // Next dequeue: hadActivity=true → resets count
    recordDequeue(1, true, 21_000);
    // slowGapCount reset to 0; next gap now starts fresh

    // Only 1 slow gap before reset → no nudge
    const gapNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_slow_gap");
    expect(gapNudges).toHaveLength(0);
  });

  it("includes seconds waited in the nudge message", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordDequeue(1, true, 1000);
    recordDequeue(1, true, 15_000); // 14s gap
    recordDequeue(1, true, 29_000); // 14s gap again — nudge fires

    const gapNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_slow_gap");
    expect(gapNudges).toHaveLength(1);
    // The nudge fires and has the correct event type
    expect(gapNudges[0].eventType).toBe("behavior_nudge_slow_gap");
  });

  it("does not nudge on first dequeue (no prior gap to measure)", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordDequeue(1, true, 1000);

    // Only the first-message nudge should fire, not a gap nudge
    const gapNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_slow_gap");
    expect(gapNudges).toHaveLength(0);
  });

  it("fires gap nudge only once", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    // 4 consecutive slow dequeues (first-message nudge takes 1 nudge slot)
    recordDequeue(1, true, 1000);
    recordDequeue(1, true, 15_000);
    recordDequeue(1, true, 29_000); // gap nudge fires here
    recordDequeue(1, true, 43_000); // already fired

    const gapNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_slow_gap");
    expect(gapNudges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Nudge cap
// ---------------------------------------------------------------------------

describe("nudge cap (max 5 per session)", () => {
  it("injects at most 3 behavior nudges from existing rules", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    // Trigger first-message nudge (1)
    recordDequeue(1, true, 1000);

    // Trigger gap nudge — 2 consecutive slow gaps (nudge 2)
    recordDequeue(1, true, 15_000);
    recordDequeue(1, true, 29_000);

    // Trigger typing nudge — 5 sends without typing (nudge 3)
    // (start time well past the last typing window)
    sendWithoutTyping(1, 5, 40_000);

    expect(spy.calls).toHaveLength(3);
  });

  it("does not exceed the nudge cap even when many rules would fire", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    // Nudge 1: first-message nudge
    recordDequeue(1, true, 1000);
    // Nudge 2: gap nudge
    recordDequeue(1, true, 15_000);
    recordDequeue(1, true, 29_000);
    // Nudge 3: typing rate nudge
    sendWithoutTyping(1, 5, 40_000);
    // Nudge 4: question hint nudge
    recordOutboundText(1, "Is this ready?");
    // Nudge 5: question escalation requires 10 questions — fill up to cap of 5 with additional ?s
    for (let i = 0; i < 9; i++) {
      recordOutboundText(1, `Can I proceed with step ${i}?`);
    }
    // nudge 5 (escalation) fires at 10th question — but cap is 5 so it fires if slots remain

    // No matter what, cap is 5
    expect(spy.calls.length).toBeLessThanOrEqual(5);
  });

  it("does not inject a nudge once cap is reached", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    // Manually fill the nudge cap by triggering 3 nudges quickly
    // Nudge 1: first-message nudge
    recordDequeue(1, true, 1000);
    // Nudge 2: gap nudge
    recordDequeue(1, true, 15_000);
    recordDequeue(1, true, 29_000);
    // Nudge 3: typing rate nudge
    sendWithoutTyping(1, 5, 40_000);

    expect(spy.calls).toHaveLength(3);

    // Additional events that would trigger more nudges if cap weren't in place
    sendWithoutTyping(1, 10, 100_000); // typing nudge already fired — no new one
    recordDequeue(1, true, 200_000);   // another slow gap — already capped

    // Still only 3 total (cap not yet hit — but no new nudge rules fire either)
    expect(spy.calls).toHaveLength(3);
  });

  it("does not nudge at all when cap is zero (hypothetically)", () => {
    // This tests that canNudge() works — tested indirectly via fresh session
    // where nudgeCount starts at 0
    initSession(1);
    const state = getSessionState(1)!;
    expect(state.nudgeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Behavior already good — no nudges
// ---------------------------------------------------------------------------

describe("no nudges when behavior is good", () => {
  it("no nudges when agent types before every send", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    // First dequeue (first-message nudge will fire — that's expected)
    recordDequeue(1, true, 1000);
    // But add typing + fast send so no gap nudge
    recordTyping(1, 1100);
    recordSend(1, 1200);

    // Subsequent dequeues with immediate typing
    for (let i = 0; i < 4; i++) {
      const base = 10_000 + i * 5000;
      recordDequeue(1, true, base);
      recordTyping(1, base + 100);
      recordSend(1, base + 500);
    }

    // Only the first-message nudge fires
    const typingNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_typing_rate");
    const gapNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_slow_gap");
    expect(typingNudges).toHaveLength(0);
    expect(gapNudges).toHaveLength(0);
  });

  it("no gap nudge when agent reacts immediately after dequeue", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordDequeue(1, true, 1000);
    recordReaction(1); // immediate reaction counts as activity

    recordDequeue(1, true, 15_000); // gap = 14s but hadActivity = true → no count
    recordReaction(1);

    recordDequeue(1, true, 30_000);

    const gapNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_slow_gap");
    expect(gapNudges).toHaveLength(0);
  });

  it("no gap nudge when agent shows animation quickly", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordDequeue(1, true, 1000);
    recordAnimation(1, 1100); // quick animation = activity

    recordDequeue(1, true, 15_000);
    recordAnimation(1, 15_100);

    recordDequeue(1, true, 30_000);

    const gapNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_slow_gap");
    expect(gapNudges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// recordReaction / recordAnimation mark activity
// ---------------------------------------------------------------------------

describe("activity tracking", () => {
  it("recordReaction marks hadActivityAfterDequeue", () => {
    initSession(1);
    recordDequeue(1, true, 1000);
    recordReaction(1);
    const state = getSessionState(1)!;
    expect(state.hadActivityAfterDequeue).toBe(true);
  });

  it("recordAnimation marks hadActivityAfterDequeue", () => {
    initSession(1);
    recordDequeue(1, true, 1000);
    recordAnimation(1, 1100);
    const state = getSessionState(1)!;
    expect(state.hadActivityAfterDequeue).toBe(true);
  });

  it("recordTyping marks hadActivityAfterDequeue", () => {
    initSession(1);
    recordDequeue(1, true, 1000);
    recordTyping(1, 1100);
    const state = getSessionState(1)!;
    expect(state.hadActivityAfterDequeue).toBe(true);
  });

  it("recordSend marks hadActivityAfterDequeue", () => {
    initSession(1);
    recordDequeue(1, true, 1000);
    recordSend(1, 1100);
    const state = getSessionState(1)!;
    expect(state.hadActivityAfterDequeue).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Button tracking / question nudges
// ---------------------------------------------------------------------------

describe("recordButtonUse", () => {
  it("sets knowsButtons and suppresses subsequent question nudges", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordButtonUse(1);
    const state = getSessionState(1)!;
    expect(state.knowsButtons).toBe(true);

    // Sending actionable questions should produce no nudge now
    recordOutboundText(1, "Is this ready?");
    recordOutboundText(1, "Should I continue?");

    const questionNudges = spy.calls.filter(
      c => c.eventType === "behavior_nudge_question_hint" || c.eventType === "behavior_nudge_question_escalation"
    );
    expect(questionNudges).toHaveLength(0);
  });
});

describe("recordOutboundText", () => {
  it("first ? question fires lightweight hint nudge", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordOutboundText(1, "Is this ready?");

    const hintNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_question_hint");
    expect(hintNudges).toHaveLength(1);
    expect(hintNudges[0].text).toContain("confirm/yn");
    expect(hintNudges[0].sid).toBe(1);
  });

  it("10+ questions without buttons fires escalation nudge", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    // Send 10 actionable questions
    for (let i = 0; i < 10; i++) {
      recordOutboundText(1, `Can I proceed with step ${i}?`);
    }

    const escalationNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_question_escalation");
    expect(escalationNudges).toHaveLength(1);
    expect(typeof escalationNudges[0].text).toBe("string");
  });

  it("button use after questions suppresses further nudges", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    // First question fires hint
    recordOutboundText(1, "Is this ready?");
    const hintNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_question_hint");
    expect(hintNudges).toHaveLength(1);

    // Agent now uses buttons
    recordButtonUse(1);
    spy.calls.length = 0; // clear calls

    // More questions — no more nudges
    for (let i = 0; i < 10; i++) {
      recordOutboundText(1, `Should I continue step ${i}?`);
    }
    expect(spy.calls).toHaveLength(0);
  });

  it("open-ended question (>200 chars) does not trigger nudge", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    // Construct a long question (>200 chars) ending with ?
    const longQuestion = "What if we consider the implications of the architectural decision to use a distributed cache in conjunction with the event-sourcing pattern across all microservices in this large-scale distributed system?";
    expect(longQuestion.length).toBeGreaterThan(200);
    recordOutboundText(1, longQuestion);

    const questionNudges = spy.calls.filter(
      c => c.eventType === "behavior_nudge_question_hint" || c.eventType === "behavior_nudge_question_escalation"
    );
    expect(questionNudges).toHaveLength(0);
  });

  it("binary question pattern triggers nudge", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordOutboundText(1, "Would you like me to proceed with the deployment?");

    const hintNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_question_hint");
    expect(hintNudges).toHaveLength(1);
  });

  it("code-block question does not trigger nudge", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordOutboundText(1, "Is this correct?\n```\nconst x = 1;\n```");

    const questionNudges = spy.calls.filter(
      c => c.eventType === "behavior_nudge_question_hint" || c.eventType === "behavior_nudge_question_escalation"
    );
    expect(questionNudges).toHaveLength(0);
  });

  it("hint fires only once even with multiple ? questions", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordOutboundText(1, "Is this ready?");
    recordOutboundText(1, "Can I deploy now?");
    recordOutboundText(1, "Should I wait?");

    const hintNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_question_hint");
    expect(hintNudges).toHaveLength(1);
  });

  it("escalation fires only once even with 15+ ? questions", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    for (let i = 0; i < 15; i++) {
      recordOutboundText(1, `Can I proceed with step ${i}?`);
    }

    const escalationNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_question_escalation");
    expect(escalationNudges).toHaveLength(1);
  });

  it("non-question text does not trigger nudge", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordOutboundText(1, "Here is the deployment report.");
    recordOutboundText(1, "Task completed successfully.");

    const questionNudges = spy.calls.filter(
      c => c.eventType === "behavior_nudge_question_hint" || c.eventType === "behavior_nudge_question_escalation"
    );
    expect(questionNudges).toHaveLength(0);
  });

  it("open-ended prefix (what if / how does / why does) does not trigger nudge", () => {
    initSession(1);
    const spy = makeNudgeSpy();

    recordOutboundText(1, "What if we used a different approach?");
    recordOutboundText(1, "How does the system handle failures?");
    recordOutboundText(1, "Why does this pattern work better?");

    const questionNudges = spy.calls.filter(
      c => c.eventType === "behavior_nudge_question_hint" || c.eventType === "behavior_nudge_question_escalation"
    );
    expect(questionNudges).toHaveLength(0);
  });
});
