import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { listSessions, renameSession } from "../session-manager.js";
import { requireAuth } from "../session-gate.js";
import { IDENTITY_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Rename the current session. The new name must not be taken " +
  "by another active session (checked case-insensitively). " +
  "Returns { sid, old_name, new_name }. Requires session credentials.";

export function register(server: McpServer) {
  server.registerTool(
    "rename_session",
    {
      description: DESCRIPTION,
      inputSchema: {
        identity: IDENTITY_SCHEMA,
        new_name: z
          .string()
          .describe("New session name. Must be alphanumeric (letters, digits, spaces only)."),
      },
    },
    ({ identity, new_name }) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);
      const sid = _sid;

      const trimmed = new_name.trim();

      if (!trimmed) {
        return toError({
          code: "INVALID_NAME",
          message: "Name cannot be empty or whitespace.",
        });
      }

      const VALID_NAME_RE = /^[a-zA-Z0-9 ]+$/;
      if (!VALID_NAME_RE.test(trimmed)) {
        return toError({
          code: "INVALID_NAME",
          message: "Session names must be alphanumeric (letters, digits, spaces only).",
        });
      }

      // Collision guard: reject if another active session already has this name
      const collision = listSessions().find(
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

      const result = renameSession(sid, trimmed);
      if (!result) {
        return toError({
          code: "SESSION_NOT_FOUND",
          message: `Session ${sid} not found.`,
        });
      }

      return toResult({ sid, old_name: result.old_name, new_name: result.new_name });
    },
  );
}
