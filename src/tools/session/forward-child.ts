import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getSession } from "../../session-manager.js";
import { getParent } from "./child-registry.js";
import { deliverServiceMessage } from "../../session-queue.js";

export function handleChildForward({
  token,
  child_sid,
  message,
}: {
  token?: number;
  child_sid: number;
  message: string;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const callerSid = _sid;

  const childSession = getSession(child_sid);
  if (!childSession) {
    return toError({
      code: "SESSION_NOT_FOUND",
      message: `Session ${child_sid} not found.`,
    });
  }

  // Use parent_sid on session record (v0.2); fall back to child-registry for older sessions.
  const parentSid = childSession.parent_sid ?? getParent(child_sid);
  if (parentSid !== callerSid) {
    return toError({
      code: "UNAUTHORIZED",
      message: `Session ${child_sid} is not a child of your session (SID ${callerSid}).`,
    });
  }

  const delivered = deliverServiceMessage(child_sid, message, "parent_forward", {
    from_sid: callerSid,
  });
  if (!delivered) {
    return toError({
      code: "SESSION_NOT_FOUND",
      message: `Session ${child_sid} queue is not active.`,
    });
  }

  return toResult({ forwarded: true, child_sid });
}
