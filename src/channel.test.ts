import { vi, describe, it, expect, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerChannelSubscriber,
  unregisterChannelSubscriber,
  notifyChannelSubscriber,
  resetChannelCooldown,
  isChannelActive,
  INBOX_URI_RE,
} from "./channel.js";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getDequeueDefault: vi.fn(() => 300),
  setDequeueDefault: vi.fn(),
  getKickLockoutMs: vi.fn(() => 500),
  isDequeueActive: vi.fn(() => false),
}));

vi.mock("./session-manager.js", () => ({
  getDequeueDefault: (sid: number) => mocks.getDequeueDefault(sid),
  setDequeueDefault: (sid: number, val: number) => mocks.setDequeueDefault(sid, val),
  getKickLockoutMs: (sid: number) => mocks.getKickLockoutMs(sid),
}));

vi.mock("./tools/activity/file-state.js", () => ({
  isDequeueActive: (sid: number) => mocks.isDequeueActive(sid),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const SID = 1;
const TOKEN = 1_000_001;

/** Flush the microtask queue so Promise .then()/.catch() callbacks complete. */
const flushPromises = () => new Promise<void>(r => setTimeout(r, 0));

function makeServer() {
  const notify = vi.fn(() => Promise.resolve());
  const server = { server: { notification: notify } } as unknown as McpServer;
  return { server, notify };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("channel", () => {
  beforeEach(() => {
    unregisterChannelSubscriber(SID); // clean up first — may call setDequeueDefault
    vi.clearAllMocks();               // wipe any calls from the cleanup above
    mocks.getDequeueDefault.mockReturnValue(300);
    mocks.getKickLockoutMs.mockReturnValue(500);
    mocks.isDequeueActive.mockReturnValue(false);
  });

  // ── INBOX_URI_RE ─────────────────────────────────────────────────────────

  describe("INBOX_URI_RE", () => {
    it("matches a valid inbox URI and captures the numeric token", () => {
      const m = INBOX_URI_RE.exec(`telegram://inbox/${TOKEN}`);
      expect(m).not.toBeNull();
      expect(m![1]).toBe(String(TOKEN));
    });

    it("rejects an inbox URI with no token", () => {
      expect(INBOX_URI_RE.exec("telegram://inbox/")).toBeNull();
    });

    it("rejects a non-inbox telegram URI", () => {
      expect(INBOX_URI_RE.exec("telegram://other/123")).toBeNull();
    });

    it("rejects a non-numeric token", () => {
      expect(INBOX_URI_RE.exec("telegram://inbox/abc")).toBeNull();
    });
  });

  // ── isChannelActive ──────────────────────────────────────────────────────

  describe("isChannelActive", () => {
    it("returns false before any registration", () => {
      expect(isChannelActive(SID)).toBe(false);
    });

    it("returns true after registration", () => {
      const { server } = makeServer();
      registerChannelSubscriber(SID, TOKEN, server);
      expect(isChannelActive(SID)).toBe(true);
    });

    it("returns false after unregistration", () => {
      const { server } = makeServer();
      registerChannelSubscriber(SID, TOKEN, server);
      unregisterChannelSubscriber(SID);
      expect(isChannelActive(SID)).toBe(false);
    });
  });

  // ── registerChannelSubscriber ────────────────────────────────────────────

  describe("registerChannelSubscriber", () => {
    it("caps the dequeue default to 90 s when prior exceeds 90 s", () => {
      mocks.getDequeueDefault.mockReturnValue(300);
      const { server } = makeServer();
      registerChannelSubscriber(SID, TOKEN, server);
      expect(mocks.setDequeueDefault).toHaveBeenCalledWith(SID, 90);
    });

    it("does not change the dequeue default when prior is already ≤ 90 s", () => {
      mocks.getDequeueDefault.mockReturnValue(60);
      const { server } = makeServer();
      registerChannelSubscriber(SID, TOKEN, server);
      expect(mocks.setDequeueDefault).not.toHaveBeenCalled();
    });

    it("does not change the dequeue default when prior is exactly 90 s", () => {
      mocks.getDequeueDefault.mockReturnValue(90);
      const { server } = makeServer();
      registerChannelSubscriber(SID, TOKEN, server);
      expect(mocks.setDequeueDefault).not.toHaveBeenCalled();
    });
  });

  // ── unregisterChannelSubscriber ──────────────────────────────────────────

  describe("unregisterChannelSubscriber", () => {
    it("is a no-op when no subscriber is registered", () => {
      unregisterChannelSubscriber(SID);
      expect(mocks.setDequeueDefault).not.toHaveBeenCalled();
    });

    it("restores the prior dequeue default when capping occurred", () => {
      mocks.getDequeueDefault.mockReturnValue(300);
      const { server } = makeServer();
      registerChannelSubscriber(SID, TOKEN, server);
      vi.clearAllMocks();
      unregisterChannelSubscriber(SID);
      expect(mocks.setDequeueDefault).toHaveBeenCalledWith(SID, 300);
    });

    it("restores the prior dequeue default even when capping did not occur", () => {
      mocks.getDequeueDefault.mockReturnValue(30);
      const { server } = makeServer();
      registerChannelSubscriber(SID, TOKEN, server);
      vi.clearAllMocks();
      unregisterChannelSubscriber(SID);
      expect(mocks.setDequeueDefault).toHaveBeenCalledWith(SID, 30);
    });
  });

  // ── notifyChannelSubscriber ──────────────────────────────────────────────

  describe("notifyChannelSubscriber", () => {
    it("is a no-op when no subscriber is registered", () => {
      const { notify } = makeServer();
      notifyChannelSubscriber(SID);
      expect(notify).not.toHaveBeenCalled();
    });

    it("skips the notification when a dequeue is in flight", () => {
      const { server, notify } = makeServer();
      registerChannelSubscriber(SID, TOKEN, server);
      mocks.isDequeueActive.mockReturnValue(true);
      notifyChannelSubscriber(SID);
      expect(notify).not.toHaveBeenCalled();
    });

    it("sends a notification immediately when no cooldown is active", () => {
      const { server, notify } = makeServer();
      registerChannelSubscriber(SID, TOKEN, server);
      notifyChannelSubscriber(SID);
      expect(notify).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledWith({
        method: "notifications/resources/updated",
        params: { uri: `telegram://inbox/${TOKEN}` },
      });
    });

    it("suppresses duplicate notifications while the cooldown is active", async () => {
      const { server, notify } = makeServer();
      registerChannelSubscriber(SID, TOKEN, server);
      notifyChannelSubscriber(SID);    // fires; arms cooldown after .then()
      await flushPromises();
      notifyChannelSubscriber(SID);    // blocked by cooldown
      expect(notify).toHaveBeenCalledOnce();
    });

    it("retries immediately after a failed send (cooldown not armed on rejection)", async () => {
      const { server, notify } = makeServer();
      notify.mockReturnValueOnce(Promise.reject(new Error("transport error")));
      registerChannelSubscriber(SID, TOKEN, server);
      notifyChannelSubscriber(SID);
      await flushPromises();           // .catch() runs; cooldownUntil stays null
      notifyChannelSubscriber(SID);   // no cooldown → fires again
      expect(notify).toHaveBeenCalledTimes(2);
    });

    it("fires again once the cooldown window has expired", async () => {
      // Return a negative lockout so cooldownUntil lands in the past immediately
      mocks.getKickLockoutMs.mockReturnValue(-1000);
      const { server, notify } = makeServer();
      registerChannelSubscriber(SID, TOKEN, server);
      notifyChannelSubscriber(SID);
      await flushPromises();           // cooldownUntil = Date.now() - 1000 (already past)
      notifyChannelSubscriber(SID);   // expired → fires again
      expect(notify).toHaveBeenCalledTimes(2);
    });
  });

  // ── resetChannelCooldown ─────────────────────────────────────────────────

  describe("resetChannelCooldown", () => {
    it("is a no-op when no subscriber is registered", () => {
      resetChannelCooldown(SID); // must not throw
    });

    it("allows an immediate re-notification after resetting an active cooldown", async () => {
      const { server, notify } = makeServer();
      registerChannelSubscriber(SID, TOKEN, server);
      notifyChannelSubscriber(SID);
      await flushPromises();           // cooldown armed
      resetChannelCooldown(SID);      // clear it
      notifyChannelSubscriber(SID);   // should fire again
      expect(notify).toHaveBeenCalledTimes(2);
    });
  });
});
