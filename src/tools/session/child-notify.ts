import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { getSession } from "../../session-manager.js";
import { deliverChildNotifyEvent } from "../../session-queue.js";

/** Max 64 chars, alphanumeric + '/' + '_' only. */
const EVENT_TYPE_RE = /^[a-zA-Z0-9/_]{1,64}$/;

export function handleChildNotify({
  token,
  event_type,
  payload,
}: {
  token?: number;
  event_type: string;
  payload?: Record<string, unknown>;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const callerSid = _sid;

  if (!EVENT_TYPE_RE.test(event_type)) {
    return toError({
      code: "INVALID_EVENT_TYPE",
      message: "event_type must be 1–64 characters: alphanumeric, '/', or '_' only.",
    });
  }

  const callerSession = getSession(callerSid);
  const parentSid = callerSession?.parent_sid;
  if (!parentSid) {
    return toError({
      code: "UNAUTHORIZED",
      message: "child/notify is only available to child sessions. Root sessions have no parent.",
    });
  }

  if (payload !== undefined) {
    try {
      JSON.stringify(payload);
    } catch {
      return toError({
        code: "INVALID_PAYLOAD",
        message: "payload must be JSON-serializable.",
      });
    }
  }

  if (!getSession(parentSid)) {
    return toError({
      code: "PARENT_SESSION_NOT_FOUND",
      message: `Parent session ${parentSid} no longer exists.`,
    });
  }

  const delivered = deliverChildNotifyEvent(parentSid, callerSid, event_type, payload);
  if (!delivered) {
    return toError({
      code: "PARENT_SESSION_NOT_FOUND",
      message: `Parent session ${parentSid} queue is not active.`,
    });
  }

  return toResult({ notified: true, parent_sid: parentSid });
}
