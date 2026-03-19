/**
 * Temporal queue + interactive event integration tests.
 *
 * Verifies that callback and reaction events (lightweight) flow correctly
 * through TemporalQueue's batch-delivery semantics alongside text/voice
 * events (heavyweight delimiters).
 *
 * SC-1 through SC-3: Pure TemporalQueue unit tests — no Telegram wiring.
 * SC-4 and SC-5: Integration tests using recordInbound to verify that hooked
 * callbacks fire inline AND still route to session queues.
 */
import type { Update } from "grammy/types";
import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// SC-4/SC-5 need the Telegram transport mocked (recordInbound calls answerCbQ)
// ---------------------------------------------------------------------------

vi.mock("./telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getApi: () => ({
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
      editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
    }),
    resolveChat: () => 42,
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { TemporalQueue } from "./temporal-queue.js";
import type { TimelineEvent } from "./message-store.js";
import {
  recordInbound,
  registerCallbackHook,
  resetStoreForTest,
} from "./message-store.js";
import {
  createSessionQueue,
  getSessionQueue,
  resetSessionQueuesForTest,
} from "./session-queue.js";
import { createSession, resetSessions } from "./session-manager.js";
import { resetRoutingModeForTest } from "./routing-mode.js";
import { resetDmPermissionsForTest } from "./dm-permissions.js";

// ---------------------------------------------------------------------------
// Predicates (mirrors session-queue.ts internal logic exactly)
// ---------------------------------------------------------------------------

function isHeavyweightEvent(event: TimelineEvent): boolean {
  return event.event === "message" &&
    (event.content.type === "text" || event.content.type === "voice");
}

function isEventReady(event: TimelineEvent): boolean {
  const c = event.content;
  return !(c.type === "voice" && c.text === undefined);
}

// ---------------------------------------------------------------------------
// Event factories
// ---------------------------------------------------------------------------

function textEvt(id: number): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "text", text: `msg-${id}` },
  };
}

function voiceEvt(id: number, transcribed?: string): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "voice", file_id: `file-${id}`, text: transcribed },
  };
}

function callbackEvt(id: number, data = "cb_data"): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "callback",
    from: "user",
    content: { type: "cb", data, qid: `qid-${id}`, target: id },
  };
}

function reactionEvt(id: number): TimelineEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    event: "reaction",
    from: "user",
    content: { type: "reaction", target: id, added: ["👍"], removed: [] },
  };
}

/** Build a raw callback_query update for recordInbound. */
function cbUpdate(targetMsgId: number, data = "cb_data", qid = "qid1") {
  return { update_id: 0, callback_query: {
      id: qid,
      from: { id: 999, first_name: "User", is_bot: false },
      message: { message_id: targetMsgId, chat: { id: 42 } },
      chat_instance: "ci1",
      data,
    },
  } as unknown as Update;
}

// ---------------------------------------------------------------------------
// SC-1 through SC-3: Pure TemporalQueue unit tests
// ---------------------------------------------------------------------------

describe("TemporalQueue — interactive event scenarios", () => {
  let q: TemporalQueue<TimelineEvent>;

  beforeEach(() => {
    q = new TemporalQueue<TimelineEvent>({
      isHeavyweight: isHeavyweightEvent,
      isReady: isEventReady,
    });
  });

  // -------------------------------------------------------------------------
  // SC-1: Callback between text messages
  // -------------------------------------------------------------------------

  it("SC-1: callback between text messages batches correctly", () => {
    // Enqueue: text₁, callback₁, text₂
    const t1 = textEvt(1);
    const cb1 = callbackEvt(2);
    const t2 = textEvt(3);
    q.enqueue(t1);
    q.enqueue(cb1);
    q.enqueue(t2);

    // Batch 1: [text₁] — stops inclusive at first heavyweight
    expect(q.dequeueBatch()).toEqual([t1]);

    // Batch 2: [callback₁, text₂] — cb is lightweight, text₂ is delimiter
    expect(q.dequeueBatch()).toEqual([cb1, t2]);

    // Batch 3: [] — empty
    expect(q.dequeueBatch()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // SC-2: Callback after pending voice (voice hold semantics)
  // -------------------------------------------------------------------------

  it("SC-2: pending voice holds the batch; transcription completes → batch releases", () => {
    const reaction = reactionEvt(10);
    const voice = voiceEvt(11); // text=undefined → not ready
    const cb = callbackEvt(12);
    q.enqueue(reaction);
    q.enqueue(voice);
    q.enqueue(cb);

    // Voice is not ready — entire batch held
    expect(q.dequeueBatch()).toEqual([]);

    // Simulate transcription completing
    (voice.content as { text: string | undefined }).text = "transcribed";

    // Batch 1: [reaction, voice] — reaction (lightweight) + voice (delimiter, now ready)
    expect(q.dequeueBatch()).toEqual([reaction, voice]);

    // Batch 2: [callback] — lightweight-only remainder → drain all
    expect(q.dequeueBatch()).toEqual([cb]);

    // Empty
    expect(q.dequeueBatch()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // SC-3: Only callbacks — lightweight-only batch drains everything at once
  // -------------------------------------------------------------------------

  it("SC-3: queue containing only callbacks drains entirely in one batch", () => {
    const cb1 = callbackEvt(1);
    const cb2 = callbackEvt(2);
    const cb3 = callbackEvt(3);
    q.enqueue(cb1);
    q.enqueue(cb2);
    q.enqueue(cb3);

    expect(q.dequeueBatch()).toEqual([cb1, cb2, cb3]);
    expect(q.dequeueBatch()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SC-4 and SC-5: Integration tests using recordInbound
// ---------------------------------------------------------------------------

describe("recordInbound — callback hook interception + session queue routing", () => {
  let sid: number;

  beforeEach(() => {
    vi.clearAllMocks();
    resetStoreForTest();
    resetSessions();
    resetSessionQueuesForTest();
    resetRoutingModeForTest();
    resetDmPermissionsForTest();

    sid = createSession("test").sid;
    createSessionQueue(sid);
  });

  // -------------------------------------------------------------------------
  // SC-4: Hooked callback fires hook AND still enters session queue
  // -------------------------------------------------------------------------

  it("SC-4: registered callback hook fires once, is one-shot, and event still routes to session queue", () => {
    const hook = vi.fn();
    registerCallbackHook(100, hook, sid);

    // Fire the callback via recordInbound
    recordInbound(cbUpdate(100));

    // Hook fires exactly once
    expect(hook).toHaveBeenCalledOnce();
    const [evt] = hook.mock.calls[0] as [TimelineEvent];
    expect(evt.event).toBe("callback");
    expect(evt.content.target).toBe(100);

    // Hook is one-shot — second callback for the same message_id does NOT re-fire
    recordInbound(cbUpdate(100, "second", "qid2"));
    expect(hook).toHaveBeenCalledOnce();

    // Event still routed to session queue — dequeueBatch returns both callbacks
    const sq = getSessionQueue(sid)!;
    const batch = sq.dequeueBatch();
    // Both callbacks are lightweight — all drain in one batch
    expect(batch).toHaveLength(2);
    expect(batch[0].event).toBe("callback");
    expect(batch[0].content.target).toBe(100);
    expect(batch[1].event).toBe("callback");
    expect(batch[1].content.target).toBe(100);
  });

  // -------------------------------------------------------------------------
  // SC-5: Unhooked callback enters queue directly (no hook registered)
  // -------------------------------------------------------------------------

  it("SC-5: callback with no registered hook routes directly to session queue", () => {
    // No registerCallbackHook call — queue receives it directly
    recordInbound(cbUpdate(200, "some_data", "qid_5"));

    const sq = getSessionQueue(sid)!;
    const batch = sq.dequeueBatch();
    expect(batch).toHaveLength(1);
    expect(batch[0].event).toBe("callback");
    expect(batch[0].content.target).toBe(200);
    expect(batch[0].content.data).toBe("some_data");
  });
});
