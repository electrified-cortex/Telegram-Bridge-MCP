/**
 * profile/tier — breadcrumb-suppression-only tier signal for root sessions.
 *
 * A root session calling action(type: 'profile/tier', tier: 'skilled-router')
 * signals to the bridge that it is a skilled orchestrator — the bridge will
 * suppress R1/R2/R3 breadcrumb injection for this session's lifetime.
 *
 * Precedence rule:
 *   The tier flag is orthogonal to the durable subsession_guidance_delivered flag.
 *   If a session previously received R1/R2 (durable flag set) and later sets
 *   skilled-router tier, the tier flag takes effect immediately — no new breadcrumbs
 *   are sent for the current session, and the durable flag remains on disk.
 *
 * This is a breadcrumb-suppression-only signal (subset of PRD 10-2100 capability model).
 * It does not grant additional permissions or capabilities beyond suppressing breadcrumbs.
 *
 * Gated to root sessions only (parent_sid === undefined). Child sessions calling this
 * action receive PERMISSION_DENIED (AC7).
 */

import { z } from "zod";
import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getSession, setSessionTier } from "../../session-manager.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";

const SKILLED_ROUTER = "skilled-router" as const;

export function handleProfileTier({
  token,
  tier,
}: {
  token?: number;
  tier: string;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  // Only 'skilled-router' is supported
  if (tier !== SKILLED_ROUTER) {
    return toError({
      code: "UNKNOWN_TIER",
      message:
        `Unknown tier: "${tier}". ` +
        `Supported values: "${SKILLED_ROUTER}".`,
    });
  }

  // Gate: root sessions only — child sessions cannot set their tier (AC7)
  const session = getSession(sid);
  if (session?.parent_sid !== undefined) {
    return toError({
      code: "PERMISSION_DENIED",
      message:
        "profile/tier may only be called by root sessions. " +
        "Child sessions cannot set their routing tier.",
    });
  }

  setSessionTier(sid, SKILLED_ROUTER);

  return toResult({
    tier: SKILLED_ROUTER,
    sid,
    breadcrumbs_suppressed: true,
    note: "Breadcrumb injection (R1/R2/R3) is suppressed for this session lifetime. " +
      "This is a breadcrumb-suppression-only signal — no capability changes apply.",
  });
}

export const PROFILE_TIER_SCHEMA = {
  token: TOKEN_SCHEMA,
  tier: z
    .string()
    .describe(
      "Routing tier for this session. Only 'skilled-router' is accepted.\n" +
        "Calling this action suppresses breadcrumb injection (R1/R2/R3) for the current " +
        "session lifetime — the bridge will not send sub-session guidance messages even " +
        "if session/request-guidance is called.\n" +
        "Gated to root sessions only; child sessions receive PERMISSION_DENIED.\n" +
        "Note: breadcrumb-suppression-only — no additional capabilities granted " +
        "(see PRD 10-2100 for the full capability model).",
    ),
};
