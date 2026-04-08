import type { RegisteredTool, McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { isDelegationEnabled, getPendingApproval, clearPendingApproval } from "../agent-approval.js";
import { getAvailableColors, COLOR_PALETTE } from "../session-manager.js";

const DESCRIPTION =
  "Approve a pending session_start request by name. " +
  "Only available when agent delegation is enabled by the operator via the /approve panel. " +
  "Call with the target_name matching the session name used in the pending session_start call. " +
  "Optionally specify a color to assign; falls back to the least-recently-used available color.";

export function register(server: McpServer): RegisteredTool {
  return server.registerTool(
    "approve_agent",
    {
      description: DESCRIPTION,
      inputSchema: {
        token: TOKEN_SCHEMA,
        target_name: z
          .string()
          .describe("Name of the pending session to approve — must match the name used in session_start."),
        color: z
          .string()
          .optional()
          .describe(
            "Color to assign to the approved session (emoji from the color palette). " +
            "Falls back to the first available color if omitted or invalid.",
          ),
      },
    },
    ({ token, target_name, color }) => {
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

      const pending = getPendingApproval(target_name);
      if (!pending) {
        return toError({
          code: "UNKNOWN",
          message:
            `NOT_PENDING: No pending session_start request found for name "${target_name}". ` +
            "The request may have already been resolved, timed out, or the name is incorrect.",
        });
      }

      // Validate color if provided; fall back to first available if omitted.
      if (color && !(COLOR_PALETTE as readonly string[]).includes(color)) {
        return toError({
          code: "UNKNOWN",
          message:
            `INVALID_COLOR: "${color}" is not a valid color. ` +
            `Valid options: ${COLOR_PALETTE.join(", ")}`,
        });
      }
      const resolvedColor: string = color && (COLOR_PALETTE as readonly string[]).includes(color)
        ? color
        : (pending.colorHint && (COLOR_PALETTE as readonly string[]).includes(pending.colorHint)
            ? pending.colorHint
            : (getAvailableColors()[0] ?? COLOR_PALETTE[0]));

      clearPendingApproval(target_name);
      pending.resolve({ approved: true, color: resolvedColor, forceColor: true });

      process.stderr.write(
        `[agent-approval] approved name=${target_name} by_sid=${sid} color=${resolvedColor} at=${new Date().toISOString()}\n`,
      );

      return toResult({ approved: true, target_name, color: resolvedColor });
    },
  );
}
