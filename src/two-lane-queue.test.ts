/**
 * Tests for TemporalQueue — the temporal ordered queue with heavyweight
 * delimiter semantics. Imported via two-lane-queue.ts shim for backward compat.
 *
 * See tasks/3-in-progress/100-temporal-queue-redesign.md for the 11 required
 * test scenarios.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { TemporalQueue } from "./temporal-queue.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestItem {
  id: number;
  /** "text" or "voice" = heavyweight; "reaction"/"callback" = lightweight */
  type: string;
  text?: string;
  /** false = voice not yet transcribed (not ready). Defaults to true. */
  ready?: boolean;
}

/** Create a queue with text/voice heavy, reaction/callback light. */
function makeQueue(opts?: { maxSize?: number }) {
  return new TemporalQueue<TestItem>({
    maxSize: opts?.maxSize,
    isHeavyweight: (item) => item.type === "text" || item.type === "voice",
    isReady: (item) => item.ready !== false,
    getId: (item) => item.id,
  });
}

const text = (id: number, t = "hello"): TestItem => ({ id, type: "text", text: t });
const reaction = (id: number): TestItem => ({ id, type: "reaction" });
const callback = (id: number): TestItem => ({ id, type: "callback" });
const voicePending = (id: number): TestItem => ({ id, type: "voice", ready: false });
const voiceReady = (id: number, t = "transcript"): TestItem => ({ id, type: "voice", text: t });

// ---------------------------------------------------------------------------
// Required Scenarios (Task 100)
// ---------------------------------------------------------------------------

describe("TemporalQueue — required batch scenarios", () => {
  let q: TemporalQueue<TestItem>;
  beforeEach(() => { q = makeQueue(); });

  // Scenario 1: [R, R, R, T] → batch [R, R, R, T]
  it("sc1: reactions then text arrive in one batch", () => {
    q.enqueue(reaction(1));
    q.enqueue(reaction(2));
    q.enqueue(reaction(3));
    q.enqueue(text(4));
    const batch = q.dequeueBatch();
    expect(batch.map((i) => i.id)).toEqual([1, 2, 3, 4]);
    expect(q.pendingCount()).toBe(0);
  });

  // Scenario 2: [T, R, R] → batch [T], then [R, R]
  it("sc2: text then reactions — text delimits first batch", () => {
    q.enqueue(text(1));
    q.enqueue(reaction(2));
    q.enqueue(reaction(3));
    expect(q.dequeueBatch().map((i) => i.id)).toEqual([1]);
    expect(q.dequeueBatch().map((i) => i.id)).toEqual([2, 3]);
    expect(q.dequeueBatch()).toEqual([]);
  });

  // Scenario 3: [T₁, T₂, T₃] → three separate batches
  it("sc3: consecutive texts yield one per batch", () => {
    q.enqueue(text(1));
    q.enqueue(text(2));
    q.enqueue(text(3));
    expect(q.dequeueBatch().map((i) => i.id)).toEqual([1]);
    expect(q.dequeueBatch().map((i) => i.id)).toEqual([2]);
    expect(q.dequeueBatch().map((i) => i.id)).toEqual([3]);
    expect(q.dequeueBatch()).toEqual([]);
  });

  // Scenario 4: [R₁, T₁, R₂, T₂] → [R₁, T₁], then [R₂, T₂]
  it("sc4: reactions between texts form two batches", () => {
    q.enqueue(reaction(1));
    q.enqueue(text(2));
    q.enqueue(reaction(3));
    q.enqueue(text(4));
    expect(q.dequeueBatch().map((i) => i.id)).toEqual([1, 2]);
    expect(q.dequeueBatch().map((i) => i.id)).toEqual([3, 4]);
  });

  // Scenario 5: [R, V(pending)] → held, after transcript → [R, V]
  it("sc5: voice pending holds entire batch; released after transcript", () => {
    q.enqueue(reaction(1));
    const voice = voicePending(2);
    q.enqueue(voice);
    // Both enqueued; voice not ready → batch held
    expect(q.dequeueBatch()).toEqual([]);
    expect(q.pendingCount()).toBe(2);
    // Simulate patchVoiceText:
    voice.ready = true;
    voice.text = "words";
    q.notifyWaiters();
    const batch = q.dequeueBatch();
    expect(batch.map((i) => i.id)).toEqual([1, 2]);
    expect(q.pendingCount()).toBe(0);
  });

  // Scenario 6: [R, V(pending), R₂] → held; after transcript → [R, V], then [R₂]
  it("sc6: voice hold blocks later lightweight events too", () => {
    q.enqueue(reaction(1));
    const voice = voicePending(2);
    q.enqueue(voice);
    q.enqueue(reaction(3));
    // Nothing released while voice pending
    expect(q.dequeueBatch()).toEqual([]);
    // Transcription arrives
    voice.ready = true;
    const first = q.dequeueBatch();
    expect(first.map((i) => i.id)).toEqual([1, 2]);
    const second = q.dequeueBatch();
    expect(second.map((i) => i.id)).toEqual([3]);
  });

  // Scenario 7: [R₁, C, R₂] — all lightweight, drain all
  it("sc7: all-lightweight batch drains everything at once", () => {
    q.enqueue(reaction(1));
    q.enqueue(callback(2));
    q.enqueue(reaction(3));
    const batch = q.dequeueBatch();
    expect(batch.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  // Scenario 8: callback from old button enters at current temporal position
  it("sc8: late callback enters queue at arrival time, not original message time", () => {
    // T₁ arrives and is consumed. Then R₁ arrives. Then old-button callback C.
    // T₂ arrives after. Queue at this point: [R₁, C, T₂].
    q.enqueue(text(1));
    q.dequeueBatch(); // consume T₁
    q.enqueue(reaction(2));
    q.enqueue(callback(3)); // press old button — arrives NOW
    q.enqueue(text(4));
    // dequeueBatch: R₂(reaction) and C(callback) are lightweight, T₂ is heavy
    // → [R₁, C, T₂]
    const batch = q.dequeueBatch();
    expect(batch.map((i) => i.id)).toEqual([2, 3, 4]);
  });

  // Scenario 9: empty queue → []
  it("sc9: empty queue returns empty batch", () => {
    expect(q.dequeueBatch()).toEqual([]);
  });

  // Scenario 10: single heavyweight [T] → [T]
  it("sc10: single heavyweight yields one-item batch", () => {
    q.enqueue(text(1));
    expect(q.dequeueBatch().map((i) => i.id)).toEqual([1]);
    expect(q.pendingCount()).toBe(0);
  });

  // Scenario 11: [R, V(ready)] → [R, V] no hold
  it("sc11: voice already ready is not held", () => {
    q.enqueue(reaction(1));
    q.enqueue(voiceReady(2));
    const batch = q.dequeueBatch();
    expect(batch.map((i) => i.id)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Infrastructure tests
// ---------------------------------------------------------------------------

describe("TemporalQueue — infrastructure", () => {
  let q: TemporalQueue<TestItem>;
  beforeEach(() => { q = makeQueue(); });

  // dequeue (single-item mode)
  describe("dequeue", () => {
    it("returns undefined when empty", () => {
      expect(q.dequeue()).toBeUndefined();
    });

    it("returns first ready item in FIFO order", () => {
      q.enqueue(text(1));
      q.enqueue(text(2));
      expect(q.dequeue()?.id).toBe(1);
      expect(q.dequeue()?.id).toBe(2);
    });

    it("skips not-ready items and returns next ready", () => {
      const vp = voicePending(1);
      q.enqueue(vp);
      q.enqueue(text(2));
      expect(q.dequeue()?.id).toBe(2);
      // pending voice still in queue
      expect(q.pendingCount()).toBe(1);
    });

    it("returns pending item once ready", () => {
      const vp = voicePending(1);
      q.enqueue(vp);
      expect(q.dequeue()).toBeUndefined();
      vp.ready = true;
      vp.text = "words";
      expect(q.dequeue()?.text).toBe("words");
    });
  });

  // dequeueMatch
  describe("dequeueMatch", () => {
    it("extracts first matching item", () => {
      q.enqueue(reaction(1));
      q.enqueue(callback(2));
      const result = q.dequeueMatch((item) =>
        item.type === "callback" ? item : undefined,
      );
      expect(result?.id).toBe(2);
      expect(q.pendingCount()).toBe(1);
    });

    it("returns undefined when nothing matches", () => {
      q.enqueue(reaction(1));
      expect(q.dequeueMatch((): undefined => undefined)).toBeUndefined();
      expect(q.pendingCount()).toBe(1);
    });

    it("transforms match result", () => {
      q.enqueue(text(5, "greet"));
      const result = q.dequeueMatch((item) =>
        item.text === "greet" ? `id=${item.id}` : undefined,
      );
      expect(result).toBe("id=5");
    });

    it("wakes waiters on match", async () => {
      q.enqueue(reaction(1));
      const p = q.waitForEnqueue();
      q.dequeueMatch((item) => (item.id === 1 ? true : undefined));
      await p;
    });

    it("does not wake waiters on miss", () => {
      q.enqueue(reaction(1));
      void q.waitForEnqueue();
      q.dequeueMatch((): undefined => undefined);
      expect(q.hasPendingWaiters()).toBe(true);
    });
  });

  // pendingCount
  describe("pendingCount", () => {
    it("starts at 0", () => { expect(q.pendingCount()).toBe(0); });

    it("increments on enqueue", () => {
      q.enqueue(reaction(1));
      q.enqueue(text(2));
      expect(q.pendingCount()).toBe(2);
    });

    it("decrements on dequeue", () => {
      q.enqueue(text(1));
      q.dequeue();
      expect(q.pendingCount()).toBe(0);
    });

    it("decrements on dequeueBatch", () => {
      q.enqueue(reaction(1));
      q.enqueue(text(2));
      q.dequeueBatch();
      expect(q.pendingCount()).toBe(0);
    });
  });

  // consumed tracking
  describe("isConsumed", () => {
    it("returns false before dequeue", () => {
      q.enqueue(text(42));
      expect(q.isConsumed(42)).toBe(false);
    });

    it("returns true after dequeue", () => {
      q.enqueue(text(42));
      q.dequeue();
      expect(q.isConsumed(42)).toBe(true);
    });

    it("returns true after dequeueBatch", () => {
      q.enqueue(reaction(10));
      q.enqueue(text(20));
      q.dequeueBatch();
      expect(q.isConsumed(10)).toBe(true);
      expect(q.isConsumed(20)).toBe(true);
    });

    it("returns true after dequeueMatch", () => {
      q.enqueue(callback(7));
      q.dequeueMatch((item) => (item.id === 7 ? true : undefined));
      expect(q.isConsumed(7)).toBe(true);
    });

    it("does not track ID 0", () => {
      const noId = new TemporalQueue<TestItem>({ getId: () => 0 });
      noId.enqueue(text(1));
      noId.dequeue();
      expect(noId.isConsumed(0)).toBe(false);
    });

    it("is reset by clear()", () => {
      q.enqueue(text(1));
      q.dequeue();
      q.clear();
      expect(q.isConsumed(1)).toBe(false);
    });
  });

  // waiters
  describe("waiters", () => {
    it("resolves on enqueue", async () => {
      const p = q.waitForEnqueue();
      q.enqueue(text(1));
      await p;
    });

    it("resolves on notifyWaiters()", async () => {
      const p = q.waitForEnqueue();
      q.notifyWaiters();
      await p;
    });

    it("hasPendingWaiters reflects blocked callers", () => {
      expect(q.hasPendingWaiters()).toBe(false);
      void q.waitForEnqueue();
      expect(q.hasPendingWaiters()).toBe(true);
    });

    it("is one-shot", async () => {
      const p = q.waitForEnqueue();
      q.enqueue(text(1));
      await p;
      expect(q.hasPendingWaiters()).toBe(false);
    });
  });

  // capacity
  describe("capacity", () => {
    it("evicts oldest when full", () => {
      const small = makeQueue({ maxSize: 3 });
      small.enqueue(text(1));
      small.enqueue(text(2));
      small.enqueue(text(3));
      small.enqueue(text(4)); // evicts text(1)
      expect(small.pendingCount()).toBe(3);
      expect(small.dequeue()?.id).toBe(2);
    });
  });

  // clear
  describe("clear", () => {
    it("empties queue and consumed IDs", () => {
      q.enqueue(text(1));
      q.dequeue();
      q.enqueue(reaction(2));
      q.clear();
      expect(q.pendingCount()).toBe(0);
      expect(q.isConsumed(1)).toBe(false);
    });

    it("wakes pending waiters is not needed after clear (new items required)", () => {
      q.clear();
      expect(q.pendingCount()).toBe(0);
    });
  });

  // deprecated aliases
  describe("enqueueResponse / enqueueMessage aliases", () => {
    it("enqueueResponse adds item to temporal queue", () => {
      q.enqueueResponse(reaction(1));
      expect(q.pendingCount()).toBe(1);
      expect(q.dequeue()?.id).toBe(1);
    });

    it("enqueueMessage adds item to temporal queue", () => {
      q.enqueueMessage(text(2));
      expect(q.pendingCount()).toBe(1);
      expect(q.dequeue()?.id).toBe(2);
    });

    it("temporal order is preserved between the two alias methods", () => {
      q.enqueueMessage(text(1)); // enqueued first
      q.enqueueResponse(reaction(2)); // enqueued second
      // temporal: text(1) comes out first (not response-priority)
      expect(q.dequeue()?.id).toBe(1);
      expect(q.dequeue()?.id).toBe(2);
    });
  });

  // no options
  describe("default options", () => {
    it("works with no options specified (all lightweight, all ready)", () => {
      const bare = new TemporalQueue<{ v: number }>();
      bare.enqueue({ v: 1 });
      bare.enqueue({ v: 2 });
      expect(bare.dequeueBatch()).toEqual([{ v: 1 }, { v: 2 }]);
    });
  });
});
