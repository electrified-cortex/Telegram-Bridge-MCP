import { describe, it, expect, beforeEach } from "vitest";
import type { Update } from "grammy/types";
import {
  recordInbound,
  recordOutgoing,
  recordOutgoingEdit,
  recordBotReaction,
  dequeue,
  dequeueMatch,
  pendingCount,
  waitForEnqueue,
  getMessage,
  getVersions,
  dumpTimeline,
  timelineSize,
  storeSize,
  resetStoreForTest,
  patchVoiceText,
  CURRENT,
} from "./message-store.js";

// ---------------------------------------------------------------------------
// Helpers — minimal Telegram Update factories
// ---------------------------------------------------------------------------

let nextUpdateId = 1;

function textUpdate(msgId: number, text: string): Update {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: msgId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 100, type: "private" },
      from: { id: 1, is_bot: false, first_name: "User" },
      text,
    },
  } as Update;
}

function editedUpdate(msgId: number, text: string): Update {
  return {
    update_id: nextUpdateId++,
    edited_message: {
      message_id: msgId,
      date: Math.floor(Date.now() / 1000),
      edit_date: Math.floor(Date.now() / 1000),
      chat: { id: 100, type: "private" },
      from: { id: 1, is_bot: false, first_name: "User" },
      text,
    },
  } as Update;
}

function callbackUpdate(targetMsgId: number, data: string): Update {
  return {
    update_id: nextUpdateId++,
    callback_query: {
      id: `cq_${nextUpdateId}`,
      chat_instance: "inst",
      from: { id: 1, is_bot: false, first_name: "User" },
      data,
      message: {
        message_id: targetMsgId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 100, type: "private" },
      },
    },
  } as Update;
}

function reactionUpdate(msgId: number, added: string[], removed: string[] = []): Update {
  return {
    update_id: nextUpdateId++,
    message_reaction: {
      message_id: msgId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 100, type: "private" },
      user: { id: 1, is_bot: false, first_name: "User" },
      new_reaction: added.map((e) => ({ type: "emoji" as const, emoji: e })),
      old_reaction: removed.map((e) => ({ type: "emoji" as const, emoji: e })),
    },
  } as Update;
}

function voiceUpdate(msgId: number): Update {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: msgId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 100, type: "private" },
      from: { id: 1, is_bot: false, first_name: "User" },
      voice: { file_id: "voice123", file_unique_id: "vu123", duration: 5 },
    },
  } as Update;
}

function commandUpdate(msgId: number, command: string, args?: string): Update {
  const text = args ? `/${command} ${args}` : `/${command}`;
  return textUpdate(msgId, text);
}

function documentUpdate(msgId: number, fileName: string): Update {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: msgId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 100, type: "private" },
      from: { id: 1, is_bot: false, first_name: "User" },
      document: { file_id: "doc123", file_unique_id: "du123", file_name: fileName, mime_type: "application/pdf" },
    },
  } as Update;
}

function photoUpdate(msgId: number, caption?: string): Update {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: msgId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 100, type: "private" },
      from: { id: 1, is_bot: false, first_name: "User" },
      photo: [
        { file_id: "photo_sm", file_unique_id: "pu1", width: 90, height: 90 },
        { file_id: "photo_lg", file_unique_id: "pu2", width: 800, height: 600 },
      ],
      caption,
    },
  } as Update;
}

function videoUpdate(msgId: number): Update {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: msgId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 100, type: "private" },
      from: { id: 1, is_bot: false, first_name: "User" },
      video: {
        file_id: "vid123", file_unique_id: "vu123",
        width: 1920, height: 1080, duration: 30,
        file_name: "clip.mp4", mime_type: "video/mp4",
      },
    },
  } as Update;
}

function audioUpdate(msgId: number): Update {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: msgId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 100, type: "private" },
      from: { id: 1, is_bot: false, first_name: "User" },
      audio: {
        file_id: "aud123", file_unique_id: "au123",
        duration: 180, title: "Song", file_name: "song.mp3",
        mime_type: "audio/mpeg",
      },
    },
  } as Update;
}

function animationUpdate(msgId: number): Update {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: msgId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 100, type: "private" },
      from: { id: 1, is_bot: false, first_name: "User" },
      animation: {
        file_id: "anim123", file_unique_id: "anu123",
        width: 320, height: 240, duration: 5,
        file_name: "funny.gif",
      },
    },
  } as Update;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStoreForTest();
  nextUpdateId = 1;
});

describe("recordInbound — text messages", () => {
  it("records a text message and enqueues to message lane", () => {
    recordInbound(textUpdate(1, "hello"));

    expect(timelineSize()).toBe(1);
    expect(storeSize()).toBe(1);
    expect(pendingCount()).toBe(1);

    const evt = dequeue();
    expect(evt).toBeDefined();
    expect(evt!.id).toBe(1);
    expect(evt!.event).toBe("message");
    expect(evt!.from).toBe("user");
    expect(evt!.content.type).toBe("text");
    expect(evt!.content.text).toBe("hello");
  });

  it("parses slash commands correctly", () => {
    recordInbound(commandUpdate(2, "status", "all"));

    const evt = dequeue();
    expect(evt!.content.type).toBe("command");
    expect(evt!.content.text).toBe("status");
    expect(evt!.content.data).toBe("all");
  });

  it("parses slash commands without args", () => {
    recordInbound(commandUpdate(3, "help"));

    const evt = dequeue();
    expect(evt!.content.type).toBe("command");
    expect(evt!.content.text).toBe("help");
    expect(evt!.content.data).toBeUndefined();
  });

  it("captures reply_to from reply_to_message", () => {
    const update = textUpdate(5, "replying to you");
    (update.message as Record<string, unknown>).reply_to_message = {
      message_id: 3,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 100, type: "private" },
    };
    recordInbound(update);

    const evt = dequeue();
    expect(evt!.content.reply_to).toBe(3);
  });

  it("omits reply_to when not a reply", () => {
    recordInbound(textUpdate(6, "standalone message"));

    const evt = dequeue();
    expect(evt!.content.reply_to).toBeUndefined();
  });
});

describe("recordInbound — voice messages", () => {
  it("records pre-transcribed voice as text content", () => {
    recordInbound(voiceUpdate(10), "Hello from voice");

    const evt = dequeue();
    expect(evt!.content.type).toBe("voice");
    expect(evt!.content.text).toBe("Hello from voice");
  });

  it("skips voice event without text in dequeue (waits for transcription)", () => {
    recordInbound(voiceUpdate(11));

    // Voice without text is not ready — dequeue should skip it
    const evt = dequeue();
    expect(evt).toBeUndefined();
  });
});

describe("patchVoiceText — two-phase voice recording", () => {
  it("sets text on a recorded voice event", () => {
    recordInbound(voiceUpdate(20));
    const before = getMessage(20);
    expect(before!.content.text).toBeUndefined();

    patchVoiceText(20, "transcribed now");
    const after = getMessage(20);
    expect(after!.content.text).toBe("transcribed now");
  });

  it("updates the queued event in-place (same object reference)", () => {
    recordInbound(voiceUpdate(21));
    // Predicate only matches voice events that have text — so this should miss
    const queued = dequeueMatch((e) => e.id === 21 && e.content.type === "voice" && e.content.text ? e : undefined);
    // Can't consume yet — text is undefined
    expect(queued).toBeUndefined();

    patchVoiceText(21, "after transcription");
    const consumed = dequeueMatch((e) => e.id === 21 && e.content.type === "voice" && e.content.text ? e : undefined);
    expect(consumed!.content.text).toBe("after transcription");
  });

  it("is a no-op when message_id is unknown", () => {
    // Should not throw
    expect(() => patchVoiceText(999, "text")).not.toThrow();
  });

  it("is a no-op when event is not a voice type", () => {
    recordInbound(textUpdate(22, "hello"));
    patchVoiceText(22, "should not apply");
    const evt = getMessage(22);
    // Text message unchanged
    expect(evt!.content.text).toBe("hello");
  });
});

describe("recordInbound — documents", () => {
  it("extracts file metadata", () => {
    recordInbound(documentUpdate(20, "report.pdf"));

    const evt = dequeue();
    expect(evt!.content.type).toBe("doc");
    expect(evt!.content.name).toBe("report.pdf");
    expect(evt!.content.mime).toBe("application/pdf");
  });
});

describe("recordInbound — callback queries (response lane)", () => {
  it("enqueues to response lane and drains before messages", () => {
    // Enqueue a message first, then a callback
    recordInbound(textUpdate(1, "message first"));
    recordInbound(callbackUpdate(1, "approve"));

    expect(pendingCount()).toBe(2);

    // Response lane should drain first
    const first = dequeue();
    expect(first!.event).toBe("callback");
    expect(first!.content.data).toBe("approve");

    const second = dequeue();
    expect(second!.event).toBe("message");
    expect(second!.content.text).toBe("message first");
  });
});

describe("recordInbound — reactions (response lane)", () => {
  it("enqueues reactions to response lane", () => {
    recordInbound(textUpdate(1, "some text"));
    recordInbound(reactionUpdate(1, ["👍"]));

    // Reaction drains first (response lane)
    const first = dequeue();
    expect(first!.event).toBe("reaction");
    expect(first!.content.added).toEqual(["👍"]);

    const second = dequeue();
    expect(second!.event).toBe("message");
  });
});

describe("recordInbound — edited messages (silent update)", () => {
  it("does not enqueue edited messages", () => {
    recordInbound(textUpdate(1, "original"));
    dequeue(); // consume the original

    recordInbound(editedUpdate(1, "edited text"));

    expect(pendingCount()).toBe(0);
    expect(timelineSize()).toBe(2); // both original + edit logged
  });

  it("updates CURRENT version in index", () => {
    recordInbound(textUpdate(1, "original"));
    recordInbound(editedUpdate(1, "edited"));

    const current = getMessage(1);
    expect(current!.content.text).toBe("edited");
    expect(current!.event).toBe("user_edit");
  });
});

describe("Two-lane priority queue", () => {
  it("drains response lane before message lane", () => {
    recordInbound(textUpdate(1, "msg1"));
    recordInbound(textUpdate(2, "msg2"));
    recordInbound(callbackUpdate(1, "cb1"));
    recordInbound(reactionUpdate(2, ["❤"]));

    const order = [];
    let evt;
    while ((evt = dequeue())) order.push(evt.event);

    expect(order[0]).toBe("callback");
    expect(order[1]).toBe("reaction");
    expect(order[2]).toBe("message");
    expect(order[3]).toBe("message");
  });

  it("returns undefined when both lanes empty", () => {
    expect(dequeue()).toBeUndefined();
  });
});

describe("dequeueMatch", () => {
  it("extracts a matching callback from response lane", () => {
    recordInbound(callbackUpdate(10, "yes"));
    recordInbound(callbackUpdate(10, "no"));

    const result = dequeueMatch((evt) =>
      evt.content.data === "no" ? evt.content.data : undefined
    );

    expect(result).toBe("no");
    expect(pendingCount()).toBe(1);

    // The remaining item should be the "yes" callback
    const remaining = dequeue();
    expect(remaining!.content.data).toBe("yes");
  });

  it("returns undefined when nothing matches", () => {
    recordInbound(textUpdate(1, "hello"));

    const result = dequeueMatch((evt) =>
      evt.content.data === "nope" ? true : undefined
    );

    expect(result).toBeUndefined();
    expect(pendingCount()).toBe(1); // item re-enqueued
  });

  it("checks response lane before message lane", () => {
    recordInbound(textUpdate(1, "msg"));
    recordInbound(callbackUpdate(1, "target"));

    const result = dequeueMatch((evt) =>
      evt.event === "callback" ? "found" : undefined
    );

    expect(result).toBe("found");
    expect(pendingCount()).toBe(1);
  });
});

describe("pendingCount", () => {
  it("reflects items across both lanes", () => {
    expect(pendingCount()).toBe(0);
    recordInbound(textUpdate(1, "a"));
    recordInbound(callbackUpdate(1, "b"));
    expect(pendingCount()).toBe(2);
    dequeue(); // response lane item
    expect(pendingCount()).toBe(1);
    dequeue(); // message lane item
    expect(pendingCount()).toBe(0);
  });
});

describe("waitForEnqueue", () => {
  it("resolves when a new item is enqueued", async () => {
    const promise = waitForEnqueue();

    // Enqueue after a tick
    setTimeout(() => { recordInbound(textUpdate(1, "wake up")); }, 10);

    await promise; // should resolve
    expect(pendingCount()).toBe(1);
  });
});

describe("recordOutgoing", () => {
  it("records bot message to timeline and index", () => {
    recordOutgoing(100, "text", "Hi there");

    expect(timelineSize()).toBe(1);
    expect(storeSize()).toBe(1);
    expect(pendingCount()).toBe(0); // NOT enqueued

    const msg = getMessage(100);
    expect(msg!.from).toBe("bot");
    expect(msg!.event).toBe("sent");
    expect(msg!.content.text).toBe("Hi there");
  });
});

describe("recordOutgoingEdit — version tracking", () => {
  it("creates version history for bot edits", () => {
    recordOutgoing(200, "text", "original");
    recordOutgoingEdit(200, "text", "edited once");

    const current = getMessage(200);
    expect(current!.content.text).toBe("edited once");

    const original = getMessage(200, 0);
    expect(original!.content.text).toBe("original");
  });

  it("tracks multiple edit versions", () => {
    recordOutgoing(300, "text", "v0");
    recordOutgoingEdit(300, "text", "v1");
    recordOutgoingEdit(300, "text", "v2");

    expect(getMessage(300)!.content.text).toBe("v2");
    expect(getMessage(300, 0)!.content.text).toBe("v0");
    expect(getMessage(300, 1)!.content.text).toBe("v1");

    const versions = getVersions(300);
    expect(versions).toContain(CURRENT);
    expect(versions).toContain(0);
    expect(versions).toContain(1);
  });

  it("handles edit of evicted message gracefully", () => {
    // Don't record original — simulate eviction
    recordOutgoingEdit(999, "text", "orphan edit");

    // Should create a new entry rather than crash
    expect(getMessage(999)!.content.text).toBe("orphan edit");
  });
});

describe("recordBotReaction", () => {
  it("logs reaction to timeline but does not enqueue", () => {
    recordBotReaction(50, "👍");

    expect(timelineSize()).toBe(1);
    expect(pendingCount()).toBe(0);

    const dump = dumpTimeline();
    expect(dump[0].event).toBe("reaction");
    expect(dump[0].from).toBe("bot");
    expect(dump[0].content.added).toEqual(["👍"]);
  });
});

describe("getMessage — random access lookup", () => {
  it("returns CURRENT version by default", () => {
    recordInbound(textUpdate(1, "hello"));
    const msg = getMessage(1);
    expect(msg!.content.text).toBe("hello");
  });

  it("returns undefined for non-existent message", () => {
    expect(getMessage(9999)).toBeUndefined();
  });

  it("returns undefined for non-existent version", () => {
    recordInbound(textUpdate(1, "hello"));
    expect(getMessage(1, 5)).toBeUndefined();
  });
});

describe("getVersions", () => {
  it("returns empty array for unknown message", () => {
    expect(getVersions(9999)).toEqual([]);
  });

  it("returns sorted version keys", () => {
    recordOutgoing(100, "text", "v0");
    recordOutgoingEdit(100, "text", "v1");
    recordOutgoingEdit(100, "text", "v2");

    const versions = getVersions(100);
    expect(versions[0]).toBe(CURRENT); // -1
    expect(versions[1]).toBe(0);
    expect(versions[2]).toBe(1);
  });
});

describe("dumpTimeline", () => {
  it("strips _update from dump output", () => {
    recordInbound(textUpdate(1, "hello"));
    const dump = dumpTimeline();
    expect(dump).toHaveLength(1);
    expect("_update" in dump[0]).toBe(false);
    expect(dump[0].content.text).toBe("hello");
  });

  it("returns events in chronological order", () => {
    recordInbound(textUpdate(1, "first"));
    recordOutgoing(100, "text", "second");
    recordInbound(textUpdate(2, "third"));

    const dump = dumpTimeline();
    expect(dump).toHaveLength(3);
    expect(dump[0].content.text).toBe("first");
    expect(dump[1].content.text).toBe("second");
    expect(dump[2].content.text).toBe("third");
  });
});

describe("Eviction", () => {
  it("evicts timeline events beyond MAX_TIMELINE (1000)", () => {
    for (let i = 1; i <= 1050; i++) {
      recordInbound(textUpdate(i, `msg ${i}`));
    }

    expect(timelineSize()).toBeLessThanOrEqual(1000);
  });

  it("evicts index entries beyond MAX_MESSAGES (500)", () => {
    for (let i = 1; i <= 550; i++) {
      recordInbound(textUpdate(i, `msg ${i}`));
    }

    expect(storeSize()).toBeLessThanOrEqual(500);
    // Oldest messages should be evicted
    expect(getMessage(1)).toBeUndefined();
    // Newest should still be there
    expect(getMessage(550)).toBeDefined();
  });
});

describe("Mixed inbound/outbound scenario", () => {
  it("handles a realistic conversation flow", () => {
    // User sends a message
    recordInbound(textUpdate(1, "Fix the login bug"));

    // Agent dequeues and processes
    const task = dequeue();
    expect(task!.content.text).toBe("Fix the login bug");
    expect(pendingCount()).toBe(0);

    // Agent sends a response
    recordOutgoing(100, "text", "Looking into it...");

    // Agent edits the response
    recordOutgoingEdit(100, "text", "Found the bug in auth.ts");

    // User reacts
    recordInbound(reactionUpdate(100, ["👍"]));

    // User sends follow-up
    recordInbound(textUpdate(2, "Thanks!"));

    // Reaction (response lane) drains first
    const reaction = dequeue();
    expect(reaction!.event).toBe("reaction");

    const thanks = dequeue();
    expect(thanks!.content.text).toBe("Thanks!");

    // Timeline has everything
    const dump = dumpTimeline();
    expect(dump.length).toBe(5); // msg, sent, edit, reaction, msg

    // Version history works
    expect(getMessage(100)!.content.text).toBe("Found the bug in auth.ts");
    expect(getMessage(100, 0)!.content.text).toBe("Looking into it...");
  });
});

// ===========================================================================
// Issue #1 — file_id must be populated in EventContent for media messages
// ===========================================================================

describe("file_id in EventContent (#1)", () => {
  it("includes file_id for documents", () => {
    recordInbound(documentUpdate(20, "report.pdf"));
    const evt = dequeue();
    expect(evt!.content.file_id).toBe("doc123");
  });

  it("includes file_id for photos (largest size)", () => {
    recordInbound(photoUpdate(21, "nice pic"));
    const evt = dequeue();
    expect(evt!.content.file_id).toBe("photo_lg");
  });

  it("includes file_id for videos", () => {
    recordInbound(videoUpdate(22));
    const evt = dequeue();
    expect(evt!.content.file_id).toBe("vid123");
  });

  it("includes file_id for audio", () => {
    recordInbound(audioUpdate(23));
    const evt = dequeue();
    expect(evt!.content.file_id).toBe("aud123");
  });

  it("includes file_id for voice", () => {
    recordInbound(voiceUpdate(24), "transcribed");
    const evt = dequeue();
    expect(evt!.content.file_id).toBe("voice123");
  });

  it("includes file_id for animations", () => {
    recordInbound(animationUpdate(25));
    const evt = dequeue();
    expect(evt!.content.file_id).toBe("anim123");
  });
});

// ===========================================================================
// Issue #3 — scanAndRemove should NOT wake waiters when nothing matched
// ===========================================================================

describe("scanAndRemove notify behavior (#3)", () => {
  it("does not wake waiters when scan finds nothing", async () => {
    // Enqueue an item that won't match
    recordInbound(textUpdate(1, "hello"));

    // Register a waiter
    let woken = false;
    const waiterPromise = waitForEnqueue().then(() => { woken = true; });

    // Scan with a predicate that matches nothing
    const result = dequeueMatch((_evt) =>
      _evt.content.data === "impossible" ? true : undefined
    );
    expect(result).toBeUndefined();

    // Give microtasks a chance to resolve
    await new Promise((r) => setTimeout(r, 10));

    // Waiter should NOT have been woken — nothing was found
    expect(woken).toBe(false);

    // Clean up: enqueue something to release the waiter
    recordInbound(textUpdate(2, "unblock"));
    await waiterPromise;
  });

  it("wakes waiters when a match was found and items remain", async () => {
    recordInbound(textUpdate(1, "keep"));
    recordInbound(textUpdate(2, "target"));

    let woken = false;
    const waiterPromise = waitForEnqueue().then(() => { woken = true; });

    // Match the second item — first should be re-enqueued
    dequeueMatch((evt) =>
      evt.content.text === "target" ? true : undefined
    );

    await new Promise((r) => setTimeout(r, 10));
    // Should wake because a match was found and items remain
    expect(woken).toBe(true);
    await waiterPromise;
  });
});

// ===========================================================================
// Issue #5 — Queue lanes should have capacity limits
// ===========================================================================

describe("queue lane capacity limits (#5)", () => {
  it("caps message lane at MAX_QUEUE_SIZE", () => {
    // Enqueue more than the cap — older items should be dropped
    for (let i = 1; i <= 5100; i++) {
      recordInbound(textUpdate(i, `msg ${i}`));
    }
    // Should not exceed the cap
    expect(pendingCount()).toBeLessThanOrEqual(5000);
  });
});

// ===========================================================================
// Issue #6 — recordOutgoingEdit fallback should use event: "edit"
// ===========================================================================

describe("recordOutgoingEdit fallback (#6)", () => {
  it("uses event 'edit' when falling back for evicted messages", () => {
    // Don't record original — simulate eviction
    recordOutgoingEdit(999, "text", "orphan edit");

    const evt = getMessage(999);
    expect(evt).toBeDefined();
    // Should be "edit", not "sent" — the edit event type must be preserved
    expect(evt!.event).toBe("edit");
  });
});
