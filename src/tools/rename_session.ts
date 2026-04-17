import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { listSessions, renameSession, setSessionColor, COLOR_PALETTE } from "../session-manager.js";
import { requireAuth } from "../session-gate.js";
import { getGovernorSid } from "../routing-mode.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { requestOperatorApproval } from "../built-in-commands.js";

const VALID_NAME_RE = /^[a-zA-Z0-9 ]+$/;

const DESCRIPTION =
  "Rename the current session (or another session if governor). " +
  "The new name must not be taken by another active session (checked " +
  "case-insensitively). Requires operator approval via Telegram button before " +
  "taking effect. Optionally applies a color change in the same action. " +
  "Governor can target other sessions via target_sid. " +
  "Returns { sid, old_name, new_name, color? }. Requires session credentials.";

export async function handleRenameSession({ token, new_name, color, target_sid }: {
  token: number;
  new_name: string;
  color?: string;
  target_sid?: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const callerSid = _sid;

  // Validate color if provided
  if (color !== undefined && !(COLOR_PALETTE as readonly string[]).includes(color)) {
    return toError({
      code: "INVALID_COLOR",
      message: `"${color}" is not a valid session color. Valid colors: ${COLOR_PALETTE.join(" ")}.`,
    });
  }

  // Resolve which session to rename
  let sid: number;
  if (target_sid !== undefined) {
    // Governor-only path
    if (getGovernorSid() !== callerSid) {
      return toError({
        code: "PERMISSION_DENIED",
        message: "Only the governor can rename another session. Omit target_sid to rename your own session.",
      });
    }
    sid = target_sid;
  } else {
    sid = callerSid;
  }

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
  const colorNote = color ? ` and color to ${color}` : "";
  const targetNote = target_sid !== undefined ? ` (governor renaming SID ${sid})` : "";
  const decision = await requestOperatorApproval(
    `🔒 *Session Rename Request*\n\nSession *${currentName}* (SID ${sid}) wants to rename itself to *${trimmed}*${colorNote}.${targetNote}\n\nApprove?`,
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
      message: `Session ${sid} not found. Call action(type: 'session/list') to see active sessions.`,
    });
  }

  // Apply color change if provided
  let assignedColor: string | undefined;
  if (color !== undefined) {
    const colorResult = setSessionColor(sid, color);
    assignedColor = colorResult ?? undefined;
  }

  return toResult({
    sid,
    old_name: result.old_name,
    new_name: result.new_name,
    ...(assignedColor !== undefined ? { color: assignedColor } : {}),
  });
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
        color: z
          .string()
          .optional()
          .describe(`Optional color to apply in the same action. Must be a valid palette color: ${COLOR_PALETTE.join(" ")}.`),
        target_sid: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("SID of the session to rename. Governor only. Omit to rename your own session."),
      },
    },
    handleRenameSession,
  );
}
