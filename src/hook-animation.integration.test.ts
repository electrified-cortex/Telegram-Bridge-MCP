/**
 * Integration tests for POST /hook/animation.
 *
 * NO vi.mock for validateSession or handleShowAnimation.
 * The real session-manager and show_animation modules are exercised
 * through their actual module resolution chains.
 *
 * Only mocked:
 *   - startAnimation  (animation-state.js) — avoids real Telegram bot API calls
 *   - resolveChat     (telegram.js)         — avoids reading real Telegram state
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "node:http";

// ── Module-level mocks (only Telegram API surface) ───────────────────────────

vi.mock("./animation-state.js", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, startAnimation: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("./telegram.js", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, resolveChat: vi.fn().mockReturnValue(12345) };
});

// ── Imports (real modules, no mocks for session-manager or show_animation) ───

import { attachHookRoutes } from "./hook-animation.js";
import { createSession, resetSessions } from "./session-manager.js";
import { startAnimation } from "./animation-state.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function startServer(app: Parameters<typeof http.createServer>[0]): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /hook/animation — integration", () => {
  let server: http.Server;
  let port: number;
  let token: number;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset the real session store so tests are independent
    resetSessions();

    // Create a real session and compute the real token
    const { sid, suffix } = createSession("integration-test");
    token = sid * 1_000_000 + suffix;

    // Create a real Express app (with JSON body-parser) and attach the hook route
    const { createMcpExpressApp } = await import("@modelcontextprotocol/sdk/server/express.js");
    const app = createMcpExpressApp({ host: "127.0.0.1" });
    attachHookRoutes(app);

    // Start the HTTP server on an ephemeral port
    ({ server, port } = await startServer(app));
  });

  afterEach(async () => {
    await closeServer(server);
    resetSessions();
  });

  it("fires compacting preset end-to-end via real handler chain", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/hook/animation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, preset: "compacting" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    // Confirm the full chain reached startAnimation (real session → real
    // handleShowAnimation → mocked startAnimation to avoid Telegram API)
    expect(startAnimation).toHaveBeenCalled();
  });

  it("rejects invalid token with 401 via real session store", async () => {
    const bogusToken = 9_999_999;
    const res = await fetch(`http://127.0.0.1:${port}/hook/animation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: bogusToken, preset: "compacting" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);

    // startAnimation must NOT have been reached
    expect(startAnimation).not.toHaveBeenCalled();
  });
});
