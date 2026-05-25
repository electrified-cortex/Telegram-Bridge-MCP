import { z } from "zod";
import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getSession } from "../../session-manager.js";
import { TOKEN_SCHEMA, decodeToken } from "../identity-schema.js";
import { getParent, unregisterChild } from "./child-registry.js";
import { closeSessionById } from "../../session-teardown.js";
import { deliverServiceMessage } from "../../session-queue.js";
import { SERVICE_MESSAGES } from "../../service-messages.js";

export function handleRevokeChild({
  token,
  child_token,
}: {
  token?: number;
  child_token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const callerSid = _sid;

  // Decode child_token (dispatch token) to get the child session SID.
  const { sid: childSid } = decodeToken(child_token);
  const childSession = getSession(childSid);
  if (!childSession) {
    return toError({
      code: "SESSION_NOT_FOUND",
      message: `Child session ${childSid} not found. It may have already been closed.`,
    });
  }

  // Use parent_sid on session record (v0.2); fall back to child-registry for older sessions.
  const registeredParent = childSession.parent_sid ?? getParent(childSid);

  // Auth: caller must be either the registered parent OR the child itself (self-revocation).
  if (callerSid !== registeredParent && callerSid !== childSid) {
    return toError({
      code: "UNAUTHORIZED",
      message:
        `Session ${childSid} can only be revoked by its spawning parent (SID ${registeredParent}) ` +
        `or by the child session itself. Caller SID: ${callerSid}.`,
    });
  }

  // Fire CHILD_SESSION_RESOLVED to parent before closing (while childSession is still available).
  if (registeredParent !== undefined) {
    const exitStatus = childSession.exit_status ?? "";
    deliverServiceMessage(
      registeredParent,
      SERVICE_MESSAGES.CHILD_SESSION_RESOLVED.text(childSid, childSession.name, exitStatus),
      SERVICE_MESSAGES.CHILD_SESSION_RESOLVED.eventType,
      { child_sid: childSid, child_name: childSession.name, exit_status: exitStatus },
    );
  }

  const result = closeSessionById(childSid);
  unregisterChild(childSid);
  return toResult(result);
}

export const REVOKE_CHILD_SCHEMA = {
  token: TOKEN_SCHEMA,
  child_token: z
    .number()
    .int()
    .positive()
    .describe(
      "Dispatch token of the child session to revoke — the `token` field returned by session/spawn-child. " +
        "Either the spawning parent session OR the child session itself may call this to revoke. " +
        "Self-revocation is the preferred exit path: the sub-agent emits EXIT_STATUS: then calls this with its own dispatch token.",
    ),
};
