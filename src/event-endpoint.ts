/**
 * REST hook: POST /event
 *
 * General-purpose external event endpoint. Any participant — agents, hooks,
 * scripts — POSTs an event. The bridge logs it to data/events.ndjson, fans
 * out a service message to all active sessions, and (for governor + known
 * kinds) triggers an animation.
 *
 * Auth:  session token (integer) via ?token=N  OR  JSON body field "token".
 *        Same pattern as /hook/animation.
 * Body:  { "kind": "compacting", "actor_sid": 3, "details": { ... } }
 *        — "kind" is required; other fields are optional.
 *
 * Responses:
 *   200  { "ok": true, "fanout": <count> }
 *   400  { "ok": false, "error": "<reason>" }   — validation failure
 *   401  { "ok": false, "error": "<reason>" }   — missing / invalid token
 */

import type { Request, Response, Express } from "express";
import { appendFile } from "fs/promises";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { decodeToken } from "./tools/identity-schema.js";
import { validateSession, listSessions, getSession, setHasCompacted } from "./session-manager.js";
import { deliverServiceMessage } from "./session-queue.js";
import { getGovernorSid } from "./routing-mode.js";
import { handleShowAnimation } from "./tools/animation/show.js";
import { handleCancelAnimation } from "./tools/animation/cancel.js";
import { DIGITS_ONLY } from "./utils/patterns.js";
import { handleSessionStopped, getActivityFile } from "./tools/activity/file-state.js";
import { SERVICE_MESSAGES } from "./service-messages.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Types ────────────────────────────────────────────────────────────────────

interface PostEventBody {
  token?: unknown;
  kind?: unknown;
  actor_sid?: unknown;
  details?: unknown;
}

const VALID_KINDS = new Set(["compacting", "compacted", "startup", "shutdown_warn", "shutdown_complete", "stopped"]);

// ── Internal handler (exported for testing) ──────────────────────────────────

/**
 * Core logic for POST /event.
 *
 * Returns a tuple [statusCode, responseBody] so it can be exercised in unit
 * tests without spinning up an HTTP server.
 */
export function handlePostEvent(
  rawToken: unknown,
  body: PostEventBody,
): [number, Record<string, unknown>] {
  // ── Token resolution ─────────────────────────────────────────────────────
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

  // kind: required, non-empty string
  const kind = body.kind;
  if (kind === undefined || kind === null || kind === "") {
    return [400, { ok: false, error: "kind is required" }];
  }
  if (typeof kind !== "string") {
    return [400, { ok: false, error: "kind must be a string" }];
  }
  if (!VALID_KINDS.has(kind)) {
    return [400, { ok: false, error: "unknown kind" }];
  }

  // actor_sid: optional integer; defaults to caller's SID
  let resolvedActorSid = sid;
  if (body.actor_sid !== undefined) {
    if (
      typeof body.actor_sid !== "number" ||
      !Number.isInteger(body.actor_sid) ||
      body.actor_sid <= 0
    ) {
      return [400, { ok: false, error: "actor_sid must be a positive integer" }];
    }
    resolvedActorSid = body.actor_sid;
  }

  // details: optional plain object; must not contain "token"
  let details: Record<string, unknown> | undefined;
  if (body.details !== undefined) {
    if (
      body.details === null ||
      typeof body.details !== "object" ||
      Array.isArray(body.details)
    ) {
      return [400, { ok: false, error: "details must be a plain object" }];
    }
    const detailsObj = body.details as Record<string, unknown>;
    if ("token" in detailsObj) {
      return [400, { ok: false, error: "details must not contain a token field" }];
    }
    details = detailsObj;
  }

  // ── 1. Resolve actor name ────────────────────────────────────────────────
  const actorSession = getSession(resolvedActorSid);
  const actorName = actorSession?.name ?? "unknown";

  // ── 2. Log (fire-and-forget) ─────────────────────────────────────────────
  const logEntry = {
    timestamp: new Date().toISOString(),
    kind,
    actor_sid: resolvedActorSid,
    actor_name: actorName,
    ...(details !== undefined && { details }),
  };

  const dataDir = resolve(__dirname, "..", "data");
  const logPath = resolve(dataDir, "events.ndjson");

  try {
    mkdirSync(dataDir, { recursive: true });
  } catch {
    // best effort
  }

  void appendFile(logPath, JSON.stringify(logEntry) + "\n").catch((err: unknown) => {
    process.stderr.write(`[event] log write error: ${String(err)}\n`);
  });

  // ── 3. Fan out ───────────────────────────────────────────────────────────
  // kind=stopped is suppressed from broadcast — high-frequency noise, no actionable signal.
  const sessions = listSessions();
  let fanout = 0;
  if (kind !== "stopped") {
    for (const session of sessions) {
      const delivered = deliverServiceMessage(
        session.sid,
        `[event] ${actorName}: ${kind}`,
        "agent_event",
        { kind, actor: actorName, actor_sid: resolvedActorSid, ...(details && { details }) },
      );
      if (delivered) fanout++;
    }
  }

  // ── 4. Governor side-effect ──────────────────────────────────────────────
  const governorSid = getGovernorSid();
  if (governorSid !== 0 && resolvedActorSid === governorSid) {
    if (kind === "compacted") {
      void handleCancelAnimation({ token: tokenNum }).finally(() => {
        void handleShowAnimation({ token: tokenNum, preset: "recovering", timeout: 60 });
      });
      setHasCompacted(governorSid);
    } else if (kind !== "stopped") {
      void handleShowAnimation({ token: tokenNum, preset: kind });
    }
  }

  // ── 5. "stopped" side-effect ─────────────────────────────────────────────
  // Agent-side wiring: TBD — likely a Stop hook analogous to PreCompact.
  if (kind === "stopped") {
    const { noOp } = handleSessionStopped(sid);
    if (noOp) {
      return [200, { ok: true, fanout, hint: "no-op" }];
    }
  }

  // ── 6. "compacting" side-effect — post-compact monitor recovery hint ──────
  if (kind === "compacting") {
    const activityState = getActivityFile(resolvedActorSid);
    if (activityState) {
      deliverServiceMessage(
        resolvedActorSid,
        SERVICE_MESSAGES.POST_COMPACT_MONITOR_RECOVERY.text(activityState.filePath),
        SERVICE_MESSAGES.POST_COMPACT_MONITOR_RECOVERY.eventType,
      );
    }
  }

  return [200, { ok: true, fanout }];
}

// ── Express route attachment ──────────────────────────────────────────────────

/**
 * Attach the POST /event route to an existing Express app.
 * Call this once after the Express app is created, before app.listen().
 */
export function attachEventRoute(app: Express): void {
  app.post("/event", (req: Request, res: Response) => {
    const rawToken = typeof req.query["token"] === "string" ? req.query["token"] : undefined;
    const body = (req.body ?? {}) as PostEventBody;
    const [status, payload] = handlePostEvent(rawToken, body);
    res.status(status).json(payload);
  });
}
