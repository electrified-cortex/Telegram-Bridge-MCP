import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { listSessions, renameSession } from "../session-manager.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { requestOperatorApproval } from "../built-in-commands.js";

const VALID_NAME_RE = /^[a-zA-Z0-9 ]+$/;

const DESCRIPTION =
  "Rename the current session. The new name must not be taken " +
  "by another active session (checked case-insensitively). " +
  "Requires operator approval via Telegram button before taking effect. " +
  "Returns { sid, old_name, new_name }. Requires session credentials.";

export async function handleRenameSession({ token, new_name }: { token: number; new_name: string }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  const trimmed = new_name.trim();

  if (!trimmed) {
    return toError({
      code: "INVALID_NAME",
      message: "Name cannot be empty or whitespace.",
    });
  }

  if (!VALID_NAME_RE.test(trimmed)) {
    return toError({
      code: "INVALID_NAME",
      message: "Session names must be alphanumeric (letters, digits, spaces only).",
    });
  }

  // Collision guard: reject if another active session already has this name
  const sessions = listSessions();
  const current = sessions.find(s => s.sid === sid);
  const collision = sessions.find(
    s => s.sid !== sid && s.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (collision) {
    return toError({
      code: "NAME_CONFLICT",
      message:
        `A session named "${collision.name}" already exists (SID ${collision.sid}). ` +
        `Choose a different name.`,
    });
  }

  const currentName = current?.name ?? `SID ${sid}`;
  const decision = await requestOperatorApproval(
    `🔒 *Session Rename Request*\n\nSession *${currentName}* (SID ${sid}) wants to rename itself to *${trimmed}*.\n\nApprove?`,
  );

  if (decision === "denied" || decision === "send_failed") {
    return toError({
      code: "APPROVAL_DENIED",
      message: decision === "send_failed"
        ? "Failed to send the approval prompt to the operator."
        : "The operator denied the rename request.",
    });
  }
  if (decision === "timed_out") {
    return toError({
      code: "APPROVAL_TIMEOUT",
      message: "The rename request timed out waiting for operator approval.",
    });
  }

  const result = renameSession(sid, trimmed);
  if (!result) {
    return toError({
      code: "SESSION_NOT_FOUND",
      message: `Session ${sid} not found.`,
    });
  }

  return toResult({ sid, old_name: result.old_name, new_name: result.new_name });
}

export function register(server: McpServer) {
  server.registerTool(
    "rename_session",
    {
      description: DESCRIPTION,
      inputSchema: {
        token: TOKEN_SCHEMA,
        new_name: z
          .string()
          .describe("New session name. Must be alphanumeric (letters, digits, spaces only)."),
      },
    },
    handleRenameSession,
  );
}
