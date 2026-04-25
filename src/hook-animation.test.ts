/**
 * Unit tests for the POST /hook/animation REST endpoint handler.
 *
 * Tests exercise handleHookAnimation() directly (no HTTP server required)
 * to cover: valid request, invalid token, missing/invalid preset.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "node:http";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  validateSession: vi.fn(() => true),
  handleShowAnimation: vi.fn(),
  startAnimation: vi.fn(),
  resolveChat: vi.fn((): number => 42),
}));

vi.mock("./session-manager.js", () => ({
  validateSession: (...args: unknown[]) => (mocks.validateSession as (...a: unknown[]) => boolean)(...args),
}));

vi.mock("./tools/show_animation.js", () => ({
  handleShowAnimation: (...args: unknown[]) => mocks.handleShowAnimation(...args),
}));

vi.mock("./animation-state.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    startAnimation: (...args: unknown[]) => mocks.startAnimation(...args),
  };
});

vi.mock("./telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    resolveChat: () => mocks.resolveChat(),
  };
});

import { handleHookAnimation, attachHookRoutes } from "./hook-animation.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a valid MCP toResult payload (no error). */
function makeOk(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify({ message_id: 42, ...extra }) }],
  };
}

/** Build a MCP toError payload (isError: true). */
function makeErr(code: string, message = "error"): Record<string, unknown> {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ code, message }) }],
  };
}

// Token: sid=1, suffix=123456 → token = 1_123_456
const VALID_TOKEN = 1_123_456;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /hook/animation handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    mocks.handleShowAnimation.mockResolvedValue(makeOk());
  });

  // ── 200 success ────────────────────────────────────────────────────────────

  it("returns 200 ok for valid token (query) + valid preset", async () => {
    const [status, body] = await handleHookAnimation(String(VALID_TOKEN), {
      preset: "bounce",
    });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mocks.handleShowAnimation).toHaveBeenCalledWith(
      expect.objectContaining({ token: VALID_TOKEN, preset: "bounce" }),
    );
  });

  it("returns 200 ok for valid token (body field) + valid preset", async () => {
    const [status, body] = await handleHookAnimation(undefined, {
      token: VALID_TOKEN,
      preset: "dots",
    });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("forwards optional timeout and persistent to handleShowAnimation", async () => {
    await handleHookAnimation(String(VALID_TOKEN), {
      preset: "working",
      timeout: 60,
      persistent: true,
    });
    expect(mocks.handleShowAnimation).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 60, persistent: true }),
    );
  });

  it("accepts numeric token from query (number type)", async () => {
    const [status] = await handleHookAnimation(VALID_TOKEN, { preset: "dots" });
    expect(status).toBe(200);
  });

  // ── 401 invalid / missing token ────────────────────────────────────────────

  it("returns 401 when token is absent from query and body", async () => {
    const [status, body] = await handleHookAnimation(undefined, { preset: "bounce" });
    expect(status).toBe(401);
    expect((body as { ok: boolean }).ok).toBe(false);
    expect(mocks.handleShowAnimation).not.toHaveBeenCalled();
  });

  it("returns 401 when token is empty string", async () => {
    const [status] = await handleHookAnimation("", { preset: "bounce" });
    expect(status).toBe(401);
  });

  it("returns 401 when token is non-numeric string", async () => {
    const [status] = await handleHookAnimation("notanumber", { preset: "bounce" });
    expect(status).toBe(401);
  });

  it("returns 401 when validateSession fails", async () => {
    mocks.validateSession.mockReturnValue(false);
    const [status, body] = await handleHookAnimation(String(VALID_TOKEN), {
      preset: "bounce",
    });
    expect(status).toBe(401);
    expect((body as { error: string }).error).toBe("AUTH_FAILED");
  });

  // ── 400 invalid body / preset ──────────────────────────────────────────────

  it("returns 400 when preset is missing", async () => {
    const [status, body] = await handleHookAnimation(String(VALID_TOKEN), {});
    expect(status).toBe(400);
    expect((body as { ok: boolean }).ok).toBe(false);
    expect(mocks.handleShowAnimation).not.toHaveBeenCalled();
  });

  it("returns 400 when preset is empty string", async () => {
    const [status] = await handleHookAnimation(String(VALID_TOKEN), { preset: "" });
    expect(status).toBe(400);
  });

  it("returns 400 when preset is not a string", async () => {
    const [status] = await handleHookAnimation(String(VALID_TOKEN), { preset: 42 });
    expect(status).toBe(400);
  });

  it("returns 400 when handleShowAnimation returns an error (unknown preset)", async () => {
    mocks.handleShowAnimation.mockResolvedValue(
      makeErr("UNKNOWN_PRESET", 'Unknown animation preset: "nonexistent"'),
    );
    const [status, body] = await handleHookAnimation(String(VALID_TOKEN), {
      preset: "nonexistent",
    });
    expect(status).toBe(400);
    expect((body as { ok: boolean }).ok).toBe(false);
  });

  it("returns 401 when handleShowAnimation returns AUTH_FAILED (race: session closed mid-request)", async () => {
    mocks.handleShowAnimation.mockResolvedValue(
      makeErr("AUTH_FAILED", "session closed"),
    );
    const [status, body] = await handleHookAnimation(String(VALID_TOKEN), {
      preset: "bounce",
    });
    expect(status).toBe(401);
    expect((body as { ok: boolean }).ok).toBe(false);
  });

  it("returns 500 when handleShowAnimation returns a server-side error (non-AUTH, non-UNKNOWN_PRESET)", async () => {
    mocks.handleShowAnimation.mockResolvedValue(
      makeErr("CHAT_UNAVAILABLE", "chat is not configured"),
    );
    const [status, body] = await handleHookAnimation(String(VALID_TOKEN), {
      preset: "bounce",
    });
    expect(status).toBe(500);
    expect((body as { ok: boolean }).ok).toBe(false);
  });

  it("returns 500 when handleShowAnimation throws an unexpected exception", async () => {
    mocks.handleShowAnimation.mockRejectedValue(new Error("unexpected internal failure"));
    const [status, body] = await handleHookAnimation(String(VALID_TOKEN), {
      preset: "bounce",
    });
    expect(status).toBe(500);
    expect((body as { ok: boolean }).ok).toBe(false);
  });

  it("returns 400 when timeout is out of range", async () => {
    const [status] = await handleHookAnimation(String(VALID_TOKEN), {
      preset: "bounce",
      timeout: 700,
    });
    expect(status).toBe(400);
  });

  it("returns 400 when persistent is not a boolean", async () => {
    const [status] = await handleHookAnimation(String(VALID_TOKEN), {
      preset: "bounce",
      persistent: "yes",
    });
    expect(status).toBe(400);
  });
});

// ── Integration: real Express app + real session ───────────────────────────────

describe("integration: real Express app + real session", () => {
  let server: http.Server;
  let baseUrl: string;
  let realToken: number;

  beforeEach(async () => {
    vi.clearAllMocks();

    // ── Wire validateSession to the real session-manager ──────────────────────
    // Import the real session-manager (bypassing the vi.mock shim) and use its
    // createSession / validateSession implementations directly.
    const realSM = await vi.importActual<typeof import("./session-manager.js")>("./session-manager.js");
    realSM.resetSessions();
    const { sid, suffix } = realSM.createSession("integration-test");
    realToken = sid * 1_000_000 + suffix;

    // Redirect the module-level mock so validateSession calls the real logic.
    mocks.validateSession.mockImplementation(
      (s: unknown, sfx: unknown) => realSM.validateSession(s as number, sfx as number),
    );

    // ── Wire handleShowAnimation to the real implementation ───────────────────
    // Import the real show_animation module and forward through the mock.
    // startAnimation is already shim-mocked (via vi.mock animation-state.js) so
    // no real Telegram API call will be made.
    const realSA = await vi.importActual<typeof import("./tools/show_animation.js")>("./tools/show_animation.js");
    mocks.handleShowAnimation.mockImplementation(
      (...args: unknown[]) => (realSA.handleShowAnimation as (...a: unknown[]) => unknown)(...args),
    );

    // ── Stub the Telegram API surface used by startAnimation ─────────────────
    mocks.resolveChat.mockReturnValue(42);
    mocks.startAnimation.mockResolvedValue(100); // fake message_id

    // ── Spin up a real Express HTTP server ────────────────────────────────────
    // Use createMcpExpressApp (re-exports express with json body-parser pre-wired)
    // to avoid a direct bare-specifier import of "express" which is a transitive
    // dependency only — not listed in package.json devDependencies.
    const { createMcpExpressApp } = await import("@modelcontextprotocol/sdk/server/express.js");
    const app = createMcpExpressApp({ host: "127.0.0.1" });
    attachHookRoutes(app);

    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", resolve);
    });

    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    // Clean up sessions created during this test.
    const realSM = await vi.importActual<typeof import("./session-manager.js")>("./session-manager.js");
    realSM.resetSessions();
  });

  it("returns 200 and reaches startAnimation with the compacting preset (real session token)", async () => {
    const res = await fetch(`${baseUrl}/hook/animation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: realToken, preset: "compacting" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    // startAnimation must have been called — confirming the request reached the
    // real handleShowAnimation → real startAnimation chain (not the unit-test mock).
    expect(mocks.startAnimation).toHaveBeenCalled();
  });

  it("returns 401 for an invalid token against the real session store", async () => {
    const bogusToken = 9_999_999;
    const res = await fetch(`${baseUrl}/hook/animation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: bogusToken, preset: "compacting" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});
