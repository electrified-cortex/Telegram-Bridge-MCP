/**
 * HTTP endpoint: GET /dequeue?token=<num>[&max_wait=<0..300>][&connection_token=<uuid>]
 *                POST /dequeue  with JSON body { token, max_wait?, connection_token? }
 *
 * Returns the same JSON payload as the MCP dequeue tool.
 * Auth: session token integer via query param or JSON body field.
 *
 * Responses:
 *   200  <dequeue payload>  — updates[], timed_out, empty, error: "session_closed"
 *   401  { "ok": false, "error": "<reason>" }  — missing/invalid token
 *   400  { "ok": false, "error": "<reason>" }  — bad max_wait value
 */
import type { Request, Response, Express } from "express";
import { decodeToken } from "./tools/identity-schema.js";
import { validateSession, getDequeueDefault } from "./session-manager.js";
import { runDrainLoop } from "./tools/dequeue.js";
import { DIGITS_ONLY } from "./utils/patterns.js";

interface DequeueBody {
  token?: unknown;
  max_wait?: unknown;
  connection_token?: unknown;
}

/**
 * Core logic for GET|POST /dequeue.
 * Returns a tuple [statusCode, responseBody].
 * Exported for unit testing without spinning up HTTP.
 */
export async function handleHttpDequeue(
  rawToken: unknown,
  body: DequeueBody,
  signal: AbortSignal,
): Promise<[number, Record<string, unknown>]> {
  // Token resolution (query param takes precedence over body)
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

  // max_wait: optional, 0–300, default to session default
  const sessionDefault = getDequeueDefault(sid);
  let effectiveTimeout = sessionDefault;
  if (body.max_wait !== undefined) {
    const mw =
      typeof body.max_wait === "number"
        ? body.max_wait
        : typeof body.max_wait === "string" && DIGITS_ONLY.test(body.max_wait)
          ? parseInt(body.max_wait, 10)
          : NaN;
    if (!Number.isFinite(mw) || mw < 0 || mw > 300 || !Number.isInteger(mw)) {
      return [400, { ok: false, error: "max_wait must be an integer 0–300" }];
    }
    effectiveTimeout = mw;
  }

  const result = await runDrainLoop(sid, effectiveTimeout, signal);
  return [200, result];
}

export function attachDequeueRoute(app: Express): void {
  const handler = async (req: Request, res: Response): Promise<void> => {
    const controller = new AbortController();
    req.on("close", () => controller.abort());

    const rawToken = typeof req.query["token"] === "string" ? req.query["token"] : undefined;
    const rawBody = (req.body ?? {}) as DequeueBody;

    // For GET requests, overlay query params onto a fresh body object (never mutate req.body).
    const body: DequeueBody = {
      ...rawBody,
      ...(req.method === "GET" && req.query["max_wait"] !== undefined
        ? { max_wait: req.query["max_wait"] }
        : {}),
      ...(req.method === "GET" && req.query["connection_token"] !== undefined
        ? { connection_token: req.query["connection_token"] }
        : {}),
    };

    const [status, payload] = await handleHttpDequeue(rawToken, body, controller.signal);
    if (!res.headersSent) {
      res.status(status).json(payload);
    }
  };

  app.get("/dequeue", handler);
  app.post("/dequeue", handler);
}
