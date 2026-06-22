/**
 * session/request-guidance — unskilled host requests sub-session routing guidance.
 *
 * When a host receives an inbound message it cannot route (no thread match),
 * it calls this action to receive R1 (host-role explanation) and R2 (spawn-and-
 * forward sequence) as a paired batch in its next dequeue.
 *
 * Delivery rules:
 * - Skilled hosts (profile/tier: 'skilled-router'): acknowledged silently, no breadcrumbs.
 * - Unskilled hosts, first call: R1 + R2 delivered as a pair; durable flag set so they
 *   are not re-sent after a bridge restart.
 * - Unskilled hosts, subsequent calls (durable flag already set): acknowledged silently.
 */

import { z } from "zod";
import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getSession, getSessionTier } from "../../session-manager.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";
import { deliverServiceMessage } from "../../session-queue.js";
import { SERVICE_MESSAGES } from "../../service-messages.js";
import { hasDurableFlag, setDurableFlag } from "../../durable-flags.js";

const SUBSESSION_ROUTING = "subsession-routing" as const;
/** Durable flag name that marks R1+R2 as delivered for a given session name. */
export const SUBSESSION_GUIDANCE_FLAG = "subsession_guidance_delivered";
const BRIDGE_AUTH_DETAIL = { bridge_authoritative: true };

export function handleRequestGuidance({
  token,
  guidance_type,
}: {
  token?: number;
  guidance_type: string;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  if (guidance_type !== SUBSESSION_ROUTING) {
    return toError({
      code: "UNKNOWN_GUIDANCE_TYPE",
      message:
        `Unknown guidance_type: "${guidance_type}". ` +
        `Supported values: "${SUBSESSION_ROUTING}".`,
    });
  }

  // Skilled hosts: silent acknowledgment — no breadcrumbs (AC6)
  const tier = getSessionTier(sid);
  if (tier === "skilled-router") {
    return toResult({ acknowledged: true, guidance_type, tier: "skilled-router" });
  }

  // Unskilled host: check durable flag — deliver breadcrumbs exactly once per session name
  // (survives bridge restart, keyed by session name) (AC5, AC9)
  const session = getSession(sid);
  const sessionName = session?.name ?? "";
  if (hasDurableFlag(sessionName, SUBSESSION_GUIDANCE_FLAG)) {
    return toResult({ acknowledged: true, guidance_type, already_delivered: true });
  }

  // Deliver R1 + R2 as a pair in the same DQ batch.
  // Both are lightweight service messages — they batch together before any heavyweight. (AC2, AC3)
  // bridge_authoritative: true on all R1/R2 deliveries (AC8)
  deliverServiceMessage(
    sid,
    SERVICE_MESSAGES.ONBOARDING_SUBSESSION_HOST_ROLE,
    BRIDGE_AUTH_DETAIL,
  );
  deliverServiceMessage(
    sid,
    SERVICE_MESSAGES.ONBOARDING_SUBSESSION_SPAWN_BREADCRUMB,
    BRIDGE_AUTH_DETAIL,
  );

  // Persist the durable flag so this host name does not receive breadcrumbs again
  // after a bridge restart (AC5)
  setDurableFlag(sessionName, SUBSESSION_GUIDANCE_FLAG);

  return toResult({ acknowledged: true, guidance_type, delivered: true });
}

export const REQUEST_GUIDANCE_SCHEMA = {
  token: TOKEN_SCHEMA,
  guidance_type: z
    .string()
    .describe(
      "Type of guidance to request. Currently only 'subsession-routing' is supported.\n" +
        "Returns R1 (host role explanation) and R2 (spawn-and-forward action sequence) " +
        "as a paired batch in the next dequeue.\n" +
        "Delivered exactly once per session name — subsequent calls (including after " +
        "bridge restart) return acknowledged: true without re-sending breadcrumbs.\n" +
        "Skilled-router hosts receive silent acknowledgment only (no breadcrumbs).",
    ),
};
