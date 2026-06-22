import { z } from "zod";
import { toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";
import { getCallerSid, runInSessionContext } from "../../session-context.js";
import { setSessionParentSid, setSessionCapability, getSession } from "../../session-manager.js";
import { setTopic } from "../../topic-state.js";
import { handleSessionStart } from "./start.js";
import { registerChild, getChildren } from "./child-registry.js";
import { deliverServiceMessage } from "../../session-queue.js";
import { SERVICE_MESSAGES } from "../../service-messages.js";

export async function handleSpawnChild({
  token,
  name,
  color: _color,  // ignored — color is always inherited from parent
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

  const parentSession = getSession(parentSid);

  // Recursive spawn gate: sessions with parent_sid cannot spawn children.
  if (parentSession?.parent_sid !== undefined) {
    return toError({
      code: "CAPABILITY_DENIED",
      message: "Sub-sessions cannot spawn further children. Only root sessions may call session/spawn-child.",
    });
  }

  // R8: Capability gate — spawn-child requires full capability.
  // This guard lives here (not only in action.ts) to cover direct MCP tool calls.
  const callerCap = parentSession?.child_capability;
  if (callerCap !== undefined && callerCap !== "full") {
    return toError({
      code: "CAPABILITY_DENIED",
      message: `session/spawn-child is not permitted for ${callerCap} sessions. Full capability is required.`,
    });
  }

  // SUB_SESSION_LIMIT: enforce 9-concurrent-children cap per parent (gap-fill, 1-9).
  const occupiedSlots = getChildren(parentSid);
  if (occupiedSlots.length >= 9) {
    return toError({
      code: "SUB_SESSION_LIMIT",
      message: `Parent session ${parentSid} already has 9 active sub-sessions. Revoke a child before spawning another.`,
      limit: 9,
      current: occupiedSlots.length,
      parent_sid: parentSid,
    });
  }

  const cap = child_capability ?? "gather";

  // Inherit parent's name and color. Sub-sessions present as the parent so the
  // operator sees one participant with multiple topic chips.
  const inheritedName = parentSession?.name ?? name;
  const inheritedColor = parentSession?.color;

  // Create the child session (bypasses approval, announcement, pin, SESSION_JOINED, host onboarding).
  const result = await handleSessionStart({ name: inheritedName, color: inheritedColor, parentSid });
  if ("isError" in result && result.isError) return result;

  const data = JSON.parse(result.content[0].text) as { token: number; sid: number };
  const childSid = data.sid;

  // Register and assign gap-fill display slot (1-9). Returns the assigned slot.
  const displayIndex = registerChild(parentSid, childSid);
  setSessionParentSid(childSid, parentSid);
  setSessionCapability(childSid, cap);

  // Set the topic chip: "TopicName ①" — visible as **[TopicName ①]** in Telegram.
  const circleDigit = String.fromCodePoint(0x245F + displayIndex);
  runInSessionContext(childSid, () => { setTopic(`${name} ${circleDigit}`); });

  // Apply the slot index marker to the subsession's session-list display name
  // and inherit the parent's name_tag so the child presents identically in Telegram.
  const childSession = getSession(childSid);
  if (childSession) {
    childSession.name = `${inheritedName} ${circleDigit}`;
    if (parentSession?.name_tag !== undefined) {
      childSession.name_tag = parentSession.name_tag;
    }
  }

  // Guide the parent (host) toward dispatching a background sub-agent for the
  // new sub-session. Lands in the parent's next dequeue, not the child's.
  deliverServiceMessage(
    parentSid,
    SERVICE_MESSAGES.SPAWN_CHILD_SUBAGENT_HINT.text(childSid, name, data.token),
    SERVICE_MESSAGES.SPAWN_CHILD_SUBAGENT_HINT.eventType,
    { child_sid: childSid, child_name: name },
  );

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          token: data.token,
          sid: childSid,
          parent_sid: parentSid,
          display_index: displayIndex,
          hint: `call dequeue(token: ${data.token}) for next-step instructions`,
        }),
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
      "Topic name for the child session (e.g. 'Refactor', 'Research'). " +
        "Used as the topic chip label in Telegram: **[TopicName ①]**. " +
        "The sub-session presents as the parent — no separate approval dialog.",
    ),
  color: z
    .string()
    .optional()
    .describe(
      "Ignored — color is always inherited from the parent session.",
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
