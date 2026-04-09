import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { getSession } from "../session-manager.js";
import { getGovernorSid } from "../routing-mode.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { refreshGovernorCommand, requestOperatorApproval } from "../built-in-commands.js";
import { closeSessionById } from "../session-teardown.js";

const DESCRIPTION =
  "Close the current session, or (if target_sid is provided) close another " +
  "session — governor only. Removes the session from the active session list " +
  "and cleans up resources. The session ID cannot be reclaimed after closure. " +
  "When target_sid is given, the operator is asked to confirm before the close " +
  "takes effect.";

export function register(server: McpServer) {
  server.registerTool(
    "close_session",
    {
      description: DESCRIPTION,
      inputSchema: {
        token: TOKEN_SCHEMA,
        target_sid: z
          .number()
          .int()
          .optional()
          .describe(
            "SID of the session to close. Only the current governor may supply this. " +
            "Omit to close your own session.",
          ),
      },
    },
    async ({ token, target_sid }) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);
      const callerSid = _sid;

      // ── Self-close path (no target_sid) ───────────────────────────────────
      if (target_sid === undefined) {
        const result = closeSessionById(callerSid);
        void refreshGovernorCommand();
        return toResult(result);
      }

      // ── Governor-close path (target_sid provided) ─────────────────────────

      // 1. Caller must be the current governor
      if (getGovernorSid() !== callerSid) {
        return toError({
          code: "PERMISSION_DENIED",
          message: "Only the governor can close another session.",
        });
      }

      // 2. Governor cannot close itself via this path
      if (target_sid === callerSid) {
        return toError({
          code: "INVALID_TARGET",
          message: "Use close_session without target_sid to close your own session.",
        });
      }

      // 3. Target session must exist
      const targetInfo = getSession(target_sid);
      if (!targetInfo) {
        return toError({
          code: "SESSION_NOT_FOUND",
          message: `Session ${target_sid} not found.`,
        });
      }

      const targetName = targetInfo.name || `Session ${target_sid}`;

      // 4. Operator confirmation
      const decision = await requestOperatorApproval(
        `🔒 *Close Session Request*\n\nClose session *${targetName}* (SID ${target_sid})? This cannot be undone.`,
        30_000,
      );

      if (decision !== "approved") {
        return toResult({ closed: false, sid: target_sid, reason: "cancelled" });
      }

      // 5. Re-check governor role — could have changed during the approval wait
      if (getGovernorSid() !== callerSid) {
        return toError({
          code: "GOVERNOR_CHANGED",
          message: "Governor role changed during confirmation — close aborted.",
        });
      }

      // 6. Execute close
      const result = closeSessionById(target_sid);
      void refreshGovernorCommand();
      return toResult(result);
    },
  );
}
