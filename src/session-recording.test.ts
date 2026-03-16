import { vi, describe, it, expect, beforeEach } from "vitest";

import {
  startRecording,
  stopRecording,
  isRecording,
  recordUpdate,
  recordBotMessage,
  getSessionEntries,
  recordedCount,
  clearRecording,
  getMaxUpdates,
  setAutoDump,
  getAutoDumpThreshold,
} from "./session-recording.js";

import type { Update } from "grammy/types";

function fakeUpdate(id: number): Update {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 0,
      chat: { id: 1, type: "private" },
      from: { id: 1, is_bot: false, first_name: "T" },
      text: `msg-${id}`,
    },
  } as unknown as Update;
}

describe("session-recording", () => {
  beforeEach(() => {
    stopRecording();
    clearRecording();
    setAutoDump(null, null);
  });

  // -- start / stop / isRecording ------------------------------------------

  it("starts inactive by default", () => {
    expect(isRecording()).toBe(false);
  });

  it("starts recording", () => {
    startRecording();
    expect(isRecording()).toBe(true);
  });

  it("stops recording", () => {
    startRecording();
    stopRecording();
    expect(isRecording()).toBe(false);
  });

  it("uses custom maxUpdates", () => {
    startRecording(200);
    expect(getMaxUpdates()).toBe(200);
  });

  it("defaults maxUpdates to 50", () => {
    startRecording();
    expect(getMaxUpdates()).toBe(50);
  });

  // -- recordUpdate --------------------------------------------------------

  it("records user updates when active", () => {
    startRecording();
    recordUpdate(fakeUpdate(1));
    expect(recordedCount()).toBe(1);
    const entries = getSessionEntries();
    expect(entries[0].direction).toBe("user");
  });

  it("ignores user updates when inactive", () => {
    recordUpdate(fakeUpdate(1));
    expect(recordedCount()).toBe(0);
  });

  // -- recordBotMessage ----------------------------------------------------

  it("records bot messages when active", () => {
    startRecording();
    recordBotMessage({ message_id: 10, content_type: "text", text: "hi" });
    expect(recordedCount()).toBe(1);
    const entries = getSessionEntries();
    expect(entries[0].direction).toBe("bot");
    if (entries[0].direction === "bot") {
      expect(entries[0].text).toBe("hi");
      expect(entries[0].timestamp).toBeDefined();
    }
  });

  it("ignores bot messages when inactive", () => {
    recordBotMessage({ message_id: 10, content_type: "text" });
    expect(recordedCount()).toBe(0);
  });

  // -- Rolling buffer ------------------------------------------------------

  it("evicts oldest entries when buffer exceeds maxUpdates", () => {
    startRecording(3);
    recordUpdate(fakeUpdate(1));
    recordUpdate(fakeUpdate(2));
    recordUpdate(fakeUpdate(3));
    recordUpdate(fakeUpdate(4));
    expect(recordedCount()).toBe(3);
    const entries = getSessionEntries();
    // Oldest (1) should be evicted
    if (entries[0].direction === "user") {
      expect(entries[0].update.update_id).toBe(2);
    }
  });

  // -- clearRecording ------------------------------------------------------

  it("clears buffer but keeps recording active", () => {
    startRecording();
    recordUpdate(fakeUpdate(1));
    clearRecording();
    expect(recordedCount()).toBe(0);
    expect(isRecording()).toBe(true);
  });

  // -- getSessionEntries returns a copy ------------------------------------

  it("returns a copy, not a reference", () => {
    startRecording();
    recordUpdate(fakeUpdate(1));
    const a = getSessionEntries();
    const b = getSessionEntries();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  // -- startRecording resets state -----------------------------------------

  it("startRecording resets auto-dump and buffer", () => {
    startRecording();
    setAutoDump(10, async () => {});
    recordUpdate(fakeUpdate(1));
    startRecording(100);
    expect(recordedCount()).toBe(0);
    expect(getAutoDumpThreshold()).toBeNull();
  });

  // -- Auto-dump -----------------------------------------------------------

  it("setAutoDump configures threshold", () => {
    setAutoDump(25, async () => {});
    expect(getAutoDumpThreshold()).toBe(25);
  });

  it("setAutoDump null disables auto-dump", () => {
    setAutoDump(25, async () => {});
    setAutoDump(null, null);
    expect(getAutoDumpThreshold()).toBeNull();
  });

  it("fires auto-dump callback when threshold reached", async () => {
    const dumpFn = vi.fn().mockResolvedValue(undefined);
    startRecording(100);
    setAutoDump(3, dumpFn);

    recordUpdate(fakeUpdate(1));
    recordUpdate(fakeUpdate(2));
    expect(dumpFn).not.toHaveBeenCalled();

    recordUpdate(fakeUpdate(3));
    // Callback fires asynchronously via Promise.resolve().then(...)
    await vi.waitFor(() => { expect(dumpFn).toHaveBeenCalledTimes(1); });
  });

  it("does not fire auto-dump while a dump is in-flight", async () => {
    let resolveDump: () => void;
    const dumpPromise = new Promise<void>((r) => { resolveDump = r; });
    const dumpFn = vi.fn().mockReturnValue(dumpPromise);

    startRecording(100);
    setAutoDump(2, dumpFn);

    recordUpdate(fakeUpdate(1));
    recordUpdate(fakeUpdate(2)); // triggers dump
    await vi.waitFor(() => { expect(dumpFn).toHaveBeenCalledTimes(1); });

    recordUpdate(fakeUpdate(3));
    recordUpdate(fakeUpdate(4)); // should NOT trigger second dump
    // Give microtask queue a chance to drain
    await Promise.resolve();
    expect(dumpFn).toHaveBeenCalledTimes(1);

    // Resolve the in-flight dump
    resolveDump!();
    await Promise.resolve();

    // Now adding more should trigger again
    recordUpdate(fakeUpdate(5));
    recordUpdate(fakeUpdate(6));
    await vi.waitFor(() => { expect(dumpFn).toHaveBeenCalledTimes(2); });
  });

  it("auto-dump resets _dumpInFlight even when callback throws", async () => {
    let callCount = 0;
    const dumpFn = vi.fn(() => {
      callCount++;
      return Promise.reject(new Error("dump failed"));
    });
    startRecording(100);
    setAutoDump(1, dumpFn);

    recordUpdate(fakeUpdate(1));
    await vi.waitFor(() => { expect(callCount).toBe(1); });

    // Should still fire again after the first error
    recordUpdate(fakeUpdate(2));
    await vi.waitFor(() => { expect(callCount).toBe(2); });
  });
});
