/**
 * REST hook: POST /hook/animation
 *
 * Triggers a show_animation call via HTTP without going through the MCP tool
 * layer.  Intended for external automation (e.g. CI scripts) that need to
 * push an animation indicator into a live Telegram session.
 *
 * Auth:  session token (integer) via ?token=N  OR  JSON body field "token".
 * Body:  { "preset": "...", "timeout": 60, "persistent": false }
 *        — "preset" is required; other fields are optional.
 *
 * Responses:
 *   200  { "ok": true }
 *   400  { "ok": false, "error": "<reason>" }   — bad body / unknown preset
 *   401  { "ok": false, "error": "<reason>" }   — missing / invalid token
 */

import type { Request, Response, Express } from "express";
import { handleShowAnimation } from "./tools/show_animation.js";
import { decodeToken } from "./tools/identity-schema.js";
import { validateSession } from "./session-manager.js";
import { DIGITS_ONLY } from "./utils/patterns.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface HookAnimationBody {
  token?: unknown;
  preset?: unknown;
  timeout?: unknown;
  persistent?: unknown;
}

// ── Internal handler (exported for testing) ──────────────────────────────────

/**
 * Core logic for POST /hook/animation.
 *
 * Returns a tuple [statusCode, responseBody] so it can be exercised in unit
 * tests without spinning up an HTTP server.
 */
export async function handleHookAnimation(
  rawToken: unknown,
  body: HookAnimationBody,
): Promise<[number, Record<string, unknown>]> {
  // ── Token resolution ─────────────────────────────────────────────────────
  // Accept token from query param or body field; both may be string (URL param)
  // or number.
  const tokenRaw = rawToken !== undefined ? rawToken : body.token;
  if (tokenRaw === undefined || tokenRaw === null || tokenRaw === "") {
    return [401, { ok: false, error: "token is required" }];
  }
  const tokenNum =
    typeof tokenRaw === "number"
      ? tokenRaw
      : typeof tokenRaw === "string" && DIGITS_ONLY.test(tokenRaw)
        ? parseInt(tokenRaw, 10)
        : NaN;

  if (!Number.isInteger(tokenNum) || tokenNum <= 0) {
    return [401, { ok: false, error: "invalid token" }];
  }

  const { sid, suffix } = decodeToken(tokenNum);
  if (!validateSession(sid, suffix)) {
    return [401, { ok: false, error: "AUTH_FAILED" }];
  }

  // ── Body validation ──────────────────────────────────────────────────────
  const preset = body.preset;
  if (preset === undefined || preset === null || preset === "") {
    return [400, { ok: false, error: "preset is required" }];
  }
  if (typeof preset !== "string") {
    return [400, { ok: false, error: "preset must be a string" }];
  }

  let timeout: number | undefined;
  if (body.timeout !== undefined) {
    if (typeof body.timeout !== "number" || !Number.isInteger(body.timeout) || body.timeout < 5 || body.timeout > 300) {
      return [400, { ok: false, error: "timeout must be an integer between 5 and 300" }];
    }
    timeout = body.timeout;
  }

  let persistent: boolean | undefined;
  if (body.persistent !== undefined) {
    if (typeof body.persistent !== "boolean") {
      return [400, { ok: false, error: "persistent must be a boolean" }];
    }
    persistent = body.persistent;
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────
  try {
    const result = await handleShowAnimation({
      token: tokenNum,
      preset,
      ...(timeout !== undefined && { timeout }),
      ...(persistent !== undefined && { persistent }),
    });

    // handleShowAnimation returns a MCP toResult / toError object
    if ((result as { isError?: boolean }).isError === true) {
      const text = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
      let code = "";
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (typeof parsed.code === "string") code = parsed.code;
      } catch { /* use default */ }
      if (code === "UNKNOWN_PRESET") {
        return [400, { ok: false, error: "unknown preset" }];
      }
      if (code === "AUTH_FAILED") {
        return [401, { ok: false, error: "invalid token" }];
      }
      return [500, { ok: false, error: "internal error" }];
    }

    return [200, { ok: true }];
  } catch (err) {
    process.stderr.write(`[hook:animation] unexpected error: ${String(err)}\n`);
    return [500, { ok: false, error: "internal error" }];
  }
}

// ── Express route attachment ──────────────────────────────────────────────────

/**
 * Attach the POST /hook/animation route to an existing Express app.
 * Call this once after the Express app is created, before app.listen().
 */
export function attachHookRoutes(app: Express): void {
  app.post("/hook/animation", async (req: Request, res: Response) => {
    const rawToken = req.query["token"];
    const body = (req.body ?? {}) as HookAnimationBody;
    const [status, payload] = await handleHookAnimation(rawToken, body);
    res.status(status).json(payload);
  });
}
