import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { requireAuth } from "../session-gate.js";
import { getGovernorSid } from "../routing-mode.js";
import {
  registerAction,
  resolveAction,
  listCategories,
  listSubPaths,
  type ActionHandler,
} from "../action-registry.js";

import { handleSetVoice } from "./set_voice.js";
import { handleListSessions } from "./list_sessions.js";
import { handleCloseSession } from "./close_session.js";
import { handleSessionStart } from "./session_start.js";
import { handleRenameSession } from "./rename_session.js";
import { handleEditMessage } from "./edit_message.js";

/**
 * Register all Phase 1 action paths. Called once at server startup.
 * Idempotent — can safely be called multiple times (last write wins).
 */
export function setupActionRegistry(): void {
  registerAction("session/start", handleSessionStart as unknown as ActionHandler);
  registerAction("session/close", handleCloseSession as unknown as ActionHandler);
  registerAction("session/list", handleListSessions as unknown as ActionHandler);
  registerAction("session/rename", handleRenameSession as unknown as ActionHandler);
  registerAction("config/voice", handleSetVoice as unknown as ActionHandler);
  registerAction("message/edit", handleEditMessage as unknown as ActionHandler);
}

const DESCRIPTION =
  "Universal action dispatcher for v6 API. Uses `type` as a RESTful path " +
  "to route to existing handler logic, supporting progressive discovery. " +
  "Omit `type` to list all categories. Pass a category (e.g. `session`) " +
  "to list sub-paths. Pass a full path (e.g. `session/list`) to execute. " +
  "Use help(topic: 'action') for full documentation.";

export function register(server: McpServer): void {
  setupActionRegistry();

  server.registerTool(
    "action",
    {
      description: DESCRIPTION,
      inputSchema: {
        type: z
          .string()
          .optional()
          .describe(
            "Action path to dispatch (e.g. 'session/list', 'config/voice'). " +
            "Omit to list all categories. Pass a category name to list sub-paths.",
          ),
        // Auth token — required for all paths except session/start
        token: TOKEN_SCHEMA.optional().describe(
          "Session token (sid * 1_000_000 + pin). Required for all paths except session/start.",
        ),
        // session/start params
        name: z
          .string()
          .default("")
          .describe("session/start: Human-friendly session name."),
        reconnect: z
          .boolean()
          .default(false)
          .describe("session/start: Set true to reconnect after context loss."),
        color: z
          .string()
          .optional()
          .describe("session/start: Preferred color square emoji hint."),
        // session/rename params
        new_name: z
          .string()
          .optional()
          .describe("session/rename: New alphanumeric name for the session."),
        // config/voice params
        voice: z
          .string()
          .optional()
          .describe("config/voice: Voice name to set. Pass empty string to clear."),
        speed: z
          .number()
          .min(0.25)
          .max(4.0)
          .optional()
          .describe("config/voice: TTS speed multiplier (0.25–4.0)."),
        // message/edit params
        message_id: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("message/edit: ID of the message to edit."),
        text: z
          .string()
          .optional()
          .describe("message/edit: New text content."),
        keyboard: z
          .array(
            z.array(
              z.object({
                label: z.string().describe("Button label text."),
                value: z.string().describe("Callback data."),
                style: z
                  .enum(["success", "primary", "danger"])
                  .optional()
                  .describe("Button color."),
              }),
            ),
          )
          .nullable()
          .optional()
          .describe("message/edit: Inline keyboard rows. Pass null to remove all buttons."),
        parse_mode: z
          .enum(["Markdown", "HTML", "MarkdownV2"])
          .optional()
          .describe("message/edit: Parse mode for text (default: Markdown)."),
      },
    },
    async (args) => {
      const { type } = args;

      // ── Tier 1: No type → list all categories ───────────────────────────
      if (type === undefined) {
        const categories = listCategories();
        return toResult({
          categories,
          hint: "Use help(topic: 'action') for full documentation. Pass a category to list sub-paths.",
        });
      }

      // ── Check for full-path dispatch first ────────────────────────────
      const entry = resolveAction(type);
      if (entry) {
        // Governor-only gate
        if (entry.meta.governor) {
          const _sid = requireAuth(args.token as number);
          if (typeof _sid !== "number") return toError(_sid);
          if (_sid !== getGovernorSid()) {
            return toError({
              code: "NOT_GOVERNOR",
              message: "This action requires governor privileges. Only the governor session can call this path.",
            });
          }
        }

        // Dispatch to handler — pass all args; handler extracts what it needs
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (await Promise.resolve(entry.handler(args, undefined))) as any;
        } catch (err) {
          return toError(err);
        }
      }

      // ── Tier 2: Category-only → list sub-paths ───────────────────────
      const subPaths = listSubPaths(type);
      if (subPaths.length > 0) {
        return toResult({
          category: type,
          paths: subPaths,
          hint: `Pass one of these paths as \`type\` to execute. Example: action(type: "${subPaths[0]}", ...)`,
        });
      }

      // ── Unknown path ─────────────────────────────────────────────────
      return toError({
        code: "UNKNOWN_ACTION",
        message:
          `Unknown action path: "${type}". ` +
          `Use action() with no params to see available categories, ` +
          `or action(type: "<category>") to list sub-paths.`,
      });
    },
  );
}
