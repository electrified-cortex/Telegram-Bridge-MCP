import { describe, it, expect, beforeEach } from "vitest";
import {
  createSession,
  resetSessions,
  setTutorialEnabled,
} from "./session-manager.js";
import {
  getTutorialHint,
  getTutorialKey,
  getTutorialReactionHint,
} from "./tutorial-hints.js";

beforeEach(() => {
  resetSessions();
});

describe("getTutorialKey", () => {
  it("returns 'send:dm' for send with type dm", () => {
    expect(getTutorialKey("send", { type: "dm" })).toBe("send:dm");
  });

  it("returns tool name for send with other types", () => {
    expect(getTutorialKey("send", { type: "text" })).toBe("send");
    expect(getTutorialKey("send", {})).toBe("send");
  });

  it("returns tool name for other tools", () => {
    expect(getTutorialKey("dequeue", {})).toBe("dequeue");
    expect(getTutorialKey("confirm", { type: "dm" })).toBe("confirm");
  });
});

describe("getTutorialHint", () => {
  it("returns a hint on the first call for a known tool", () => {
    const { sid } = createSession("test");
    const hint = getTutorialHint(sid, "dequeue", {});
    expect(hint).toBeDefined();
    expect(typeof hint).toBe("string");
    expect(hint).toContain("Tip:");
  });

  it("returns undefined on the second call for the same tool", () => {
    const { sid } = createSession("test");
    getTutorialHint(sid, "dequeue", {}); // first call
    const hint = getTutorialHint(sid, "dequeue", {}); // second call
    expect(hint).toBeUndefined();
  });

  it("returns undefined for unknown tools", () => {
    const { sid } = createSession("test");
    const hint = getTutorialHint(sid, "unknown_tool", {});
    expect(hint).toBeUndefined();
  });

  it("returns undefined when tutorial is disabled", () => {
    const { sid } = createSession("test");
    setTutorialEnabled(sid, false);
    const hint = getTutorialHint(sid, "dequeue", {});
    expect(hint).toBeUndefined();
  });

  it("returns hints for different tools independently", () => {
    const { sid } = createSession("test");
    const hint1 = getTutorialHint(sid, "dequeue", {});
    const hint2 = getTutorialHint(sid, "send", {});
    expect(hint1).toBeDefined();
    expect(hint2).toBeDefined();
    expect(hint1).not.toBe(hint2);
  });

  it("treats send:dm as a separate key from send", () => {
    const { sid } = createSession("test");
    const sendHint = getTutorialHint(sid, "send", {});
    const dmHint = getTutorialHint(sid, "send", { type: "dm" });
    expect(sendHint).toBeDefined();
    expect(dmHint).toBeDefined();
    // Both should be present since they are separate keys
  });

  it("returns undefined for a session that does not exist", () => {
    const hint = getTutorialHint(9999, "dequeue", {});
    expect(hint).toBeUndefined();
  });

  it("tutorial is enabled by default for new sessions", () => {
    const { sid } = createSession("test");
    const hint = getTutorialHint(sid, "confirm", {});
    expect(hint).toBeDefined();
  });

  it("can be re-enabled after disabling", () => {
    const { sid } = createSession("test");
    setTutorialEnabled(sid, false);
    expect(getTutorialHint(sid, "dequeue", {})).toBeUndefined();
    setTutorialEnabled(sid, true);
    const hint = getTutorialHint(sid, "dequeue", {});
    expect(hint).toBeDefined();
  });
});

describe("getTutorialReactionHint", () => {
  it("returns a hint on the first call", () => {
    const { sid } = createSession("test");
    const hint = getTutorialReactionHint(sid);
    expect(hint).toBeDefined();
    expect(typeof hint).toBe("string");
    expect(hint).toContain("Tip:");
  });

  it("returns undefined on the second call", () => {
    const { sid } = createSession("test");
    getTutorialReactionHint(sid); // first call
    const hint = getTutorialReactionHint(sid); // second call
    expect(hint).toBeUndefined();
  });

  it("returns undefined when tutorial is disabled", () => {
    const { sid } = createSession("test");
    setTutorialEnabled(sid, false);
    const hint = getTutorialReactionHint(sid);
    expect(hint).toBeUndefined();
  });

  it("returns undefined for non-existent session", () => {
    const hint = getTutorialReactionHint(9999);
    expect(hint).toBeUndefined();
  });
});
