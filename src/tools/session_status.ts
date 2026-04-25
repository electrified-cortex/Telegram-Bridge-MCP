import { toResult, toError } from "../telegram.js";
import { listSessions, getSession } from "../session-manager.js";
import { getGovernorSid } from "../routing-mode.js";
import { requireAuth } from "../session-gate.js";

export function handleSessionStatus({ token }: { token: number }) {
  const sid = requireAuth(token);
  if (typeof sid !== "number") return toError(sid);

  const governorSid = getGovernorSid();
  // governorSid is 0 when no governor is elected; SIDs start at 1, so this
  // safely evaluates to false and non-governor scoping applies.
  const isGovernor = governorSid !== 0 && sid === governorSid;

  const allSessions = listSessions();
  const targets = isGovernor ? allSessions : allSessions.filter(s => s.sid === sid);

  const now = Date.now();
  const sessions = targets
    .map(info => {
      const full = getSession(info.sid);
      if (!full) return null; // session removed between listSessions() and getSession()
      const createdAt = info.createdAt;
      const createdMs = new Date(createdAt).getTime();
      const uptime_s = isNaN(createdMs) ? 0 : Math.floor((now - createdMs) / 1000);
      const last_poll_s = full.lastPollAt !== undefined
        ? Math.floor((now - full.lastPollAt) / 1000)
        : null;
      const idleAt = full.dequeueIdleAt ?? null;
      const is_waiting = idleAt !== null;
      const waiting_s = idleAt !== null ? Math.floor((now - idleAt) / 1000) : null;
      const healthy = full.healthy ?? false;

      return {
        sid: info.sid,
        name: info.name,
        color: info.color,
        is_governor: info.sid === governorSid,
        createdAt,
        uptime_s,
        last_poll_s,
        is_waiting,
        waiting_s,
        healthy,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return toResult({ sessions });
}
