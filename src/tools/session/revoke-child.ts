import { z } from "zod";
import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getSession } from "../../session-manager.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";
import { getParent, unregisterChild } from "./child-registry.js";
import { closeSessionById } from "../../session-teardown.js";

export function handleRevokeChild({
  token,
  child_token,
}: {
  token?: number;
  child_token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const parentSid = _sid;

  const childSession = getSession(child_token);
  if (!childSession) {
    return toError({
      code: "SESSION_NOT_FOUND",
      message: `Child session ${child_token} not found. It may have already been closed.`,
    });
  }

  // Use parent_sid on session record (v0.2); fall back to child-registry for older sessions.
  const registeredParent = childSession.parent_sid ?? getParent(child_token);
  if (registeredParent !== parentSid) {
    return toError({
      code: "UNAUTHORIZED",
      message:
        `Session ${child_token} is not a child of your session (SID ${parentSid}). ` +
        `Only the spawning parent can revoke a child session.`,
    });
  }

  const result = closeSessionById(child_token);
  unregisterChild(child_token);
  return toResult(result);
}

export const REVOKE_CHILD_SCHEMA = {
  token: TOKEN_SCHEMA,
  child_token: z
    .number()
    .int()
    .positive()
    .describe(
      "SID of the child session to revoke. The SID is the `sid` field returned by session/spawn-child. " +
        "Only the spawning parent session can revoke its children.",
    ),
};
