/**
 * HTTP endpoint: POST /activity/selftest
 *
 * Injects a synthetic `data: notify` event into the caller's open SSE stream.
 * Lets an agent verify its own SSE registration is working solo — no operator
 * message required. Bypasses the AC-1 self-notify filter intentionally; this
 * is a health-check, not a content notification.
 *
 * Auth: session token via ?token=<num> query param OR JSON body { token }.
 *
 * Responses:
 *   200  { ok: true }                                — notify injected
 *   200  { ok: false, error: "NO_SSE_CONNECTION" }  — no SSE stream is armed
 *   401  { ok: false, error: "<reason>" }           — missing / invalid token
 */
import type { Request, Response, NextFunction, Express } from "express";
import { decodeToken } from "./tools/identity-schema.js";
import { validateSession } from "./session-manager.js";
import { hasSseConnection, notifySseSubscriber } from "./sse-endpoint.js";
import { DIGITS_ONLY } from "./utils/patterns.js";

interface SelftestBody {
  token?: unknown;
}

/** Parse a value that may be a number or a digit-string. Returns NaN on invalid input. */
function parseIntParam(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string" && DIGITS_ONLY.test(val)) return parseInt(val, 10);
  return NaN;
}

/**
 * Core logic for POST /activity/selftest.
 * Returns a tuple [statusCode, responseBody].
 * Exported for unit testing without spinning up HTTP.
 */
export function handleActivitySelftest(
  rawToken: unknown,
  body: SelftestBody,
): [number, Record<string, unknown>] {
  // Token resolution: query param takes precedence over body
  const tokenRaw = rawToken !== undefined ? rawToken : body.token;
  if (tokenRaw === undefined || tokenRaw === null || tokenRaw === "") {
    return [401, { ok: false, error: "token is required" }];
  }
  const tokenNum = parseIntParam(tokenRaw);
  if (!Number.isInteger(tokenNum) || tokenNum <= 0) {
    return [401, { ok: false, error: "invalid token" }];
  }

  const { sid, suffix } = decodeToken(tokenNum);
  if (!validateSession(sid, suffix)) {
    return [401, { ok: false, error: "AUTH_FAILED" }];
  }

  if (!hasSseConnection(sid)) {
    return [200, { ok: false, error: "NO_SSE_CONNECTION" }];
  }

  // Bypass AC-1: call notifySseSubscriber directly (not through the notify gate)
  // so the health-check always fires regardless of debounce / self-notify filter.
  notifySseSubscriber(sid);
  return [200, { ok: true }];
}

export function attachActivitySelftestRoute(app: Express): void {
  const handler = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const rawToken = typeof req.query["token"] === "string" ? req.query["token"] : undefined;
      const rawBody = (req.body ?? {}) as SelftestBody;
      const [status, payload] = handleActivitySelftest(rawToken, rawBody);
      res.status(status).json(payload);
    } catch (err) {
      next(err);
    }
  };

  app.post("/activity/selftest", handler);
}
