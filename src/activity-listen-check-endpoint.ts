/**
 * HTTP endpoint: GET /activity/listen/check?token=<num>
 *
 * Returns the current SSE subscription status for the authenticated agent.
 * Unlike POST /activity/poke, this is a pure read — it does not inject
 * any notification.
 *
 * Auth: session token integer via ?token=<num> query param.
 *
 * Responses:
 *   200  { subscribed: true }   — caller has an active SSE connection open
 *   200  { subscribed: false }  — no active SSE connection for this session
 *   401  { ok: false, error: "<reason>" }  — missing / invalid token
 */
import type { Request, Response, NextFunction, Express } from "express";
import { decodeToken } from "./tools/identity-schema.js";
import { validateSession } from "./session-manager.js";
import { hasSseConnection } from "./sse-endpoint.js";
import { DIGITS_ONLY } from "./utils/patterns.js";

/** Parse a value that may be a number or a digit-string. Returns NaN on invalid input. */
function parseIntParam(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string" && DIGITS_ONLY.test(val)) return parseInt(val, 10);
  return NaN;
}

/**
 * Core logic for GET /activity/listen/check.
 * Returns a tuple [statusCode, responseBody].
 * Exported for unit testing without spinning up HTTP.
 */
export function handleHttpActivityListenCheck(
  rawToken: unknown,
): [number, Record<string, unknown>] {
  if (rawToken === undefined || rawToken === null || rawToken === "") {
    return [401, { ok: false, error: "token is required" }];
  }
  const tokenNum = parseIntParam(rawToken);
  if (!Number.isInteger(tokenNum) || tokenNum <= 0) {
    return [401, { ok: false, error: "invalid token" }];
  }

  const { sid, suffix } = decodeToken(tokenNum);
  if (!validateSession(sid, suffix)) {
    return [401, { ok: false, error: "AUTH_FAILED" }];
  }

  return [200, { subscribed: hasSseConnection(sid) }];
}

export function attachActivityListenCheckRoute(app: Express): void {
  app.get(
    "/activity/listen/check",
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const rawToken = req.query["token"];
        const [status, payload] = handleHttpActivityListenCheck(rawToken);
        res.status(status).json(payload);
      } catch (err) {
        next(err);
      }
    },
  );
}
