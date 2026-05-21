import { z } from "zod";
import { toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";
import { getCallerSid, runInSessionContext } from "../../session-context.js";
import { setSessionParentSid, setSessionCapability } from "../../session-manager.js";
import { setTopic } from "../../topic-state.js";
import { handleSessionStart } from "./start.js";
import { registerChild } from "./child-registry.js";

export async function handleSpawnChild({
  token,
  name,
  color,
  child_capability,
}: {
  token?: number;
  name: string;
  color?: string;
  child_capability?: "read-only" | "gather" | "full";
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const parentSid = _sid;

  // Verify token belongs to the authenticated caller's session context.
  const callerSid = getCallerSid();
  if (callerSid > 0 && parentSid !== callerSid) {
    return toError({
      code: "UNAUTHORIZED",
      message: "The supplied token does not match your current session. Use your own session token.",
    });
  }

  const cap = child_capability ?? "gather";

  const result = await handleSessionStart({ name, color });
  if ("isError" in result && result.isError) return result;

  const data = JSON.parse(result.content[0].text) as { token: number; sid: number };
  registerChild(parentSid, data.sid);
  setSessionParentSid(data.sid, parentSid);
  setSessionCapability(data.sid, cap);
  runInSessionContext(data.sid, () => { setTopic(name); });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ token: data.token, sid: data.sid, parent_sid: parentSid }),
      },
    ],
  };
}

export const SPAWN_CHILD_SCHEMA = {
  token: TOKEN_SCHEMA,
  name: z
    .string()
    .min(1)
    .describe(
      "Name for the child session. Must be unique and alphanumeric. " +
        "Passed directly to session/start — the operator approval dialog will appear.",
    ),
  color: z
    .string()
    .optional()
    .describe(
      "Preferred color square emoji hint for the child session. " +
        "The operator makes the final choice via the approval dialog.",
    ),
  child_capability: z
    .enum(["read-only", "gather", "full"])
    .optional()
    .describe(
      "Capability level for the child session (default: 'gather'). " +
        "'gather' — may dequeue and send but cannot spawn further children or call commit-class actions. " +
        "'read-only' — may only call dequeue. " +
        "'full' — no capability restrictions.",
    ),
};
