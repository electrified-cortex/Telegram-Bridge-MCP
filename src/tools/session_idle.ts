import { toResult, toError } from "../telegram.js";
import { getIdleSessions, listSessions } from "../session-manager.js";
import { getGovernorSid } from "../routing-mode.js";
import { requireAuth } from "../session-gate.js";

export function handleSessionIdle({ token }: { token: number }) {
  const sid = requireAuth(token);
  if (typeof sid !== "number") return toError(sid);

  const governorSid = getGovernorSid();
  const idle = getIdleSessions().map(s => ({
    ...s,
    is_governor: s.sid === governorSid,
  }));

  const total = listSessions().length;
  return toResult({
    idle_sessions: idle,
    idle_count: idle.length,
    total_sessions: total,
  });
}
