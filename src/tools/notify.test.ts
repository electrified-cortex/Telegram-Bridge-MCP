/**
 * AC-0: notifySession gates notifySseSubscriber behind notifyIfAllowed.
 *
 * Mocks both dependencies so no real file I/O or network occurs.
 * Verifies:
 *   - notifyIfAllowed is called on every notifySession call
 *   - notifySseSubscriber is called exactly once (only when notifyIfAllowed returns true)
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// Hoisted mock state so vi.mock factories can reference them
const sseMocks = vi.hoisted(() => ({
  notifySseSubscriber: vi.fn(),
}));

const fileStateMocks = vi.hoisted(() => ({
  notifyIfAllowed: vi.fn(),
}));

vi.mock("../sse-endpoint.js", () => ({
  notifySseSubscriber: sseMocks.notifySseSubscriber,
}));

vi.mock("./activity/file-state.js", () => ({
  notifyIfAllowed: fileStateMocks.notifyIfAllowed,
}));

import { notifySession } from "./notify.js";

describe("notifySession (AC-0)", () => {
  const SID = 99;

  beforeEach(() => {
    vi.clearAllMocks();
    // First call returns true (fires SSE); remaining calls return false (suppressed)
    fileStateMocks.notifyIfAllowed.mockReturnValueOnce(true).mockReturnValue(false);
  });

  it("calls notifyIfAllowed on every notifySession call", () => {
    for (let i = 0; i < 10; i++) {
      notifySession(SID, "operator", false);
    }
    expect(fileStateMocks.notifyIfAllowed).toHaveBeenCalledTimes(10);
  });

  it("calls notifySseSubscriber exactly once regardless of call count", () => {
    for (let i = 0; i < 10; i++) {
      notifySession(SID, "operator", false);
    }
    expect(sseMocks.notifySseSubscriber).toHaveBeenCalledTimes(1);
  });

  it("does not call notifySseSubscriber when notifyIfAllowed always returns false", () => {
    fileStateMocks.notifyIfAllowed.mockReset();
    fileStateMocks.notifyIfAllowed.mockReturnValue(false);
    for (let i = 0; i < 5; i++) {
      notifySession(SID, "operator", false);
    }
    expect(sseMocks.notifySseSubscriber).not.toHaveBeenCalled();
  });
});
