import type { RegisteredTool, McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../../telegram.js";
import { requireAuth } from "../../session-gate.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";
import { isDelegationEnabled, getPendingApproval, clearPendingApproval } from "../../agent-approval.js";
import { getAvailableColors, COLOR_PALETTE } from "../../session-manager.js";
import { getGovernorSid } from "../../routing-mode.js";

const DESCRIPTION =
  "Approve a pending session_start request by ticket. " +
  "Only available when agent delegation is enabled by the operator via the /approve panel. " +
  "The one-time ticket is delivered to the governor via the dequeue service message when the session requests approval. " +
  "Optionally specify a color to assign; falls back to the agent's requested color, or the least-recently-used color if no color was requested.";

export function handleApproveAgent({ token, ticket, color }: { token: number; ticket: string; color?: string }) {
  const sid = requireAuth(token);
  if (typeof sid !== "number") return toError(sid);

  if (!isDelegationEnabled()) {
    return toError({
      code: "BLOCKED",
      message:
        "DELEGATION_DISABLED: Agent delegation is not currently enabled. " +
        "The operator must enable it via the /approve panel.",
    });
  }

  const governorSid = getGovernorSid();
  if (governorSid !== 0 && sid !== governorSid) {
    return toError({
      code: "UNAUTHORIZED_SENDER",
      message:
        `GOVERNOR_ONLY: Only the governor session (SID ${governorSid}) can approve agents.`,
    });
  }

  const pending = getPendingApproval(ticket);
  if (!pending) {
    return toError({
      code: "NOT_PENDING",
      message:
        `No pending session_start request found for ticket "${ticket}". ` +
        "The request may have already been resolved, timed out, or the ticket is incorrect.",
    });
  }

  // Validate color if provided; fall back to first available if omitted.
  if (color && !(COLOR_PALETTE as readonly string[]).includes(color)) {
    return toError({
      code: "INVALID_COLOR",
      message:
        `"${color}" is not a valid color. ` +
        `Valid options: ${COLOR_PALETTE.join(", ")}`,
    });
  }
  // Use colorHint directly — multiple sessions may share a color.
  // Only fall back to LRU auto-assign when no hint was requested.
  const resolvedColor: string = color
    ? color
    : pending.colorHint && (COLOR_PALETTE as readonly string[]).includes(pending.colorHint)
        ? pending.colorHint
        : (getAvailableColors()[0] ?? COLOR_PALETTE[0]);

  clearPendingApproval(ticket);
  pending.resolve({ approved: true, color: resolvedColor, forceColor: true });

  const safeName = pending.name.replace(/[\x00-\x1F\x7F-\x9F]/g, "?");
  process.stderr.write(
    `[agent-approval] approved name=${safeName} by_sid=${sid} color=${resolvedColor} at=${new Date().toISOString()}\n`,
  );

  return toResult({ name: pending.name, color: resolvedColor });
}

export function register(server: McpServer): RegisteredTool {
  return server.registerTool(
    "approve_agent",
    {
      description: DESCRIPTION,
      inputSchema: {
        token: TOKEN_SCHEMA,
        ticket: z
          .string()
          .describe("One-time approval ticket delivered to the governor via dequeue when the session requested approval."),
        color: z
          .string()
          .optional()
          .describe(
            "Color to assign to the approved session (emoji from the color palette). " +
            "Falls back to the agent's requested color (colorHint), or the least-recently-used color if no color was requested. Invalid colors return an error.",
          ),
      },
    },
    handleApproveAgent,
  );
}
