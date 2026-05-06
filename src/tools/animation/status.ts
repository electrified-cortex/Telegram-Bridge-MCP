import { toResult, toError } from "../../telegram.js";
import { getAnimationStatus, getAllActiveAnimations } from "../../animation-state.js";
import { requireAuth } from "../../session-gate.js";
import { getGovernorSid } from "../../routing-mode.js";

export function handleAnimationStatus({ token, sid }: {
  token: number;
  sid?: number;
}) {
  const callSid = requireAuth(token);
  if (typeof callSid !== "number") return toError(callSid);

  const isGovernor = callSid === getGovernorSid() && getGovernorSid() > 0;

  // Cross-session request: sid provided and differs from caller
  if (sid !== undefined && sid !== callSid) {
    if (!isGovernor) {
      return toError({ code: "UNAUTHORIZED", message: "Cross-session status requires governor privileges" });
    }
    // Governor requesting a specific other session
    return toResult(getAnimationStatus(sid));
  }

  // Governor with no sid → return all active sessions
  if (sid === undefined && isGovernor) {
    return toResult(getAllActiveAnimations());
  }

  // Default: return status for the caller's own session
  return toResult(getAnimationStatus(callSid));
}
