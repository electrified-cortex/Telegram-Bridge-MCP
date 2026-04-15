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
import { handleSessionStart, handleSessionReconnect } from "./session_start.js";
import { handleRenameSession } from "./rename_session.js";
import { handleSessionIdle } from "./session_idle.js";
import { handleEditMessage } from "./edit_message.js";

// Phase 2 imports — message/*
import { handleDeleteMessage } from "./delete_message.js";
import { handlePinMessage } from "./pin_message.js";
import { handleSetReaction } from "./set_reaction.js";
import { handleAnswerCallbackQuery } from "./answer_callback_query.js";
import { handleRouteMessage } from "./route_message.js";
// Phase 2 imports — profile/*, reminder/*, etc.
import { handleSetTopic } from "./set_topic.js";
import { handleSaveProfile } from "./save_profile.js";
import { handleLoadProfile } from "./load_profile.js";
import { handleImportProfile } from "./import_profile.js";
import { handleSetReminder } from "./set_reminder.js";
import { handleCancelReminder } from "./cancel_reminder.js";
import { handleListReminders } from "./list_reminders.js";
import { handleSetDequeueDefault } from "./set_dequeue_default.js";
import { handleSetDefaultAnimation } from "./set_default_animation.js";
import { handleToggleLogging } from "./toggle_logging.js";
// Phase 2 imports — message/history, message/get
import { handleGetChatHistory } from "./get_chat_history.js";
import { handleGetChat } from "./get_chat.js";
import { handleGetMessage } from "./get_message.js";
// Phase 2 imports — log/*
import { handleGetLog } from "./get_log.js";
import { handleListLogs } from "./list_logs.js";
import { handleRollLog } from "./roll_log.js";
import { handleDeleteLog } from "./delete_log.js";
import { handleGetDebugLog } from "./get_debug_log.js";
// Phase 2 imports — animation/*
import { handleCancelAnimation } from "./cancel_animation.js";
// Phase 2 imports — standalone
import { handleShowTyping } from "./show_typing.js";
import { handleConfirm } from "./confirm.js";
import { handleApproveAgent } from "./approve_agent.js";
import { handleShutdown } from "./shutdown.js";
import { handleNotifyShutdownWarning } from "./notify_shutdown_warning.js";
import { handleTranscribeVoice } from "./transcribe_voice.js";
import { handleDownloadFile } from "./download_file.js";
import { handleUpdateChecklist } from "./send_new_checklist.js";
import { handleUpdateProgress } from "./update_progress.js";
import { handleSetCommands } from "./set_commands.js";

type ToolResult = ReturnType<typeof toResult>;

/** Returns the closest string in `candidates` to `input`, or null if no reasonable match. */
function findClosestMatch(input: string, candidates: readonly string[]): string | null {
  if (candidates.length === 0 || input.length === 0) return null;
  const lower = input.toLowerCase();
  const sub = candidates.find(c => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase()));
  if (sub) return sub;
  const withDist = candidates.map(c => ({ c, d: levenshtein(lower, c.toLowerCase()) }));
  const best = withDist.reduce((a, b) => (a.d < b.d ? a : b));
  return best.d <= 3 ? best.c : null;
}

/** Simple Levenshtein distance. */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

/**
 * Register all Phase 1 action paths. Called once at server startup.
 * Idempotent — can safely be called multiple times (last write wins).
 */
export function setupActionRegistry(): void {
  registerAction("session/start", handleSessionStart as unknown as ActionHandler);
  registerAction("session/reconnect", handleSessionReconnect as unknown as ActionHandler);
  registerAction("session/close", handleCloseSession as unknown as ActionHandler);
  registerAction("session/list", handleListSessions as unknown as ActionHandler);
  registerAction("session/idle", handleSessionIdle as unknown as ActionHandler);
  registerAction("session/rename", handleRenameSession as unknown as ActionHandler);
  registerAction("profile/voice", handleSetVoice as unknown as ActionHandler);
  registerAction("message/edit", handleEditMessage as unknown as ActionHandler);

  // message/*
  registerAction("message/delete", handleDeleteMessage as unknown as ActionHandler);
  registerAction("message/pin", handlePinMessage as unknown as ActionHandler);
  registerAction("react", handleSetReaction as unknown as ActionHandler);
  registerAction("acknowledge", handleAnswerCallbackQuery as unknown as ActionHandler);
  registerAction("message/route", handleRouteMessage as unknown as ActionHandler, { governor: true });

  // profile/*, reminder/*, logging/*, commands/*
  registerAction("profile/topic", handleSetTopic as unknown as ActionHandler);
  registerAction("profile/save", handleSaveProfile as unknown as ActionHandler);
  registerAction("profile/load", handleLoadProfile as unknown as ActionHandler);
  registerAction("profile/import", handleImportProfile as unknown as ActionHandler);
  registerAction("reminder/set", handleSetReminder as unknown as ActionHandler);
  registerAction("reminder/cancel", handleCancelReminder as unknown as ActionHandler);
  registerAction("reminder/list", handleListReminders as unknown as ActionHandler);
  registerAction("profile/dequeue-default", handleSetDequeueDefault as unknown as ActionHandler);
  registerAction("animation/default", handleSetDefaultAnimation as unknown as ActionHandler);
  registerAction("logging/toggle", handleToggleLogging as unknown as ActionHandler);

  // message/history
  registerAction("message/history", ((args: Record<string, unknown>) => {
    if (args.count !== undefined || args.before_id !== undefined) {
      return handleGetChatHistory(args as Parameters<typeof handleGetChatHistory>[0]);
    }
    return handleGetChat(args as Parameters<typeof handleGetChat>[0]);
  }) as unknown as ActionHandler);
  registerAction("message/get", handleGetMessage as unknown as ActionHandler);

  // chat/*
  registerAction("chat/info", handleGetChat as unknown as ActionHandler);

  // log/* (governor-only)
  registerAction("log/get", handleGetLog as unknown as ActionHandler, { governor: true });
  registerAction("log/list", handleListLogs as unknown as ActionHandler, { governor: true });
  registerAction("log/roll", handleRollLog as unknown as ActionHandler, { governor: true });
  registerAction("log/delete", handleDeleteLog as unknown as ActionHandler, { governor: true });
  registerAction("log/debug", handleGetDebugLog as unknown as ActionHandler, { governor: true });
  // animation/*
  registerAction("animation/cancel", handleCancelAnimation as unknown as ActionHandler);

  // standalone
  registerAction("show-typing", handleShowTyping as unknown as ActionHandler);
  // confirm/* presets (preset buttons, caller only needs to supply `text`)
  const makeConfirmHandler = (yesText: string, noText: string, yesStyle?: "success" | "primary" | "danger") =>
    ((args: Record<string, unknown>) => handleConfirm({
      text: (args.text as string | undefined) ?? "",
      yes_text: yesText,
      no_text: noText,
      yes_data: "confirm_yes",
      no_data: "confirm_no",
      yes_style: (args.yes_style as "success" | "primary" | "danger" | undefined) ?? yesStyle,
      timeout_seconds: (args.timeout_seconds as number | undefined) ?? 600,
      ignore_pending: args.ignore_pending as boolean | undefined,
      token: args.token as number,
    }, undefined as unknown as AbortSignal)) as unknown as ActionHandler;
  registerAction("confirm/ok", makeConfirmHandler("OK", "", "primary"));
  registerAction("confirm/ok-cancel", makeConfirmHandler("OK", "Cancel", "primary"));
  registerAction("confirm/yn", makeConfirmHandler("🟢 Yes", "🔴 No"));
  registerAction("approve", handleApproveAgent as unknown as ActionHandler, { governor: true });
  registerAction("shutdown", handleShutdown as unknown as ActionHandler, { governor: true });
  registerAction("shutdown/warn", handleNotifyShutdownWarning as unknown as ActionHandler, { governor: true });
  registerAction("transcribe", handleTranscribeVoice as unknown as ActionHandler);
  registerAction("download", handleDownloadFile as unknown as ActionHandler);
  registerAction("checklist/update", handleUpdateChecklist as unknown as ActionHandler);
  registerAction("progress/update", handleUpdateProgress as unknown as ActionHandler);
  registerAction("commands/set", ((args: Record<string, unknown>) =>
    handleSetCommands({
      commands: (args.commands ?? []) as Parameters<typeof handleSetCommands>[0]["commands"],
      scope: args.scope as "chat" | "default" | undefined,
      token: args.token as number,
    })
  ) as unknown as ActionHandler);
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
            "Action path to dispatch (e.g. 'session/list', 'profile/voice'). " +
            "Omit to list all categories. Pass a category name to list sub-paths.",
          ),
        // Auth token — required for all paths except session/start and session/reconnect
        token: TOKEN_SCHEMA.optional().describe(
          "Session token (sid * 1_000_000 + pin). Required for all paths except `session/start` and `session/reconnect`.",
        ),
        // session/start and session/reconnect params
        name: z
          .string()
          .default("")
          .describe("session/start, session/reconnect: Human-friendly session name."),
        color: z
          .string()
          .optional()
          .describe("session/start: Preferred color square emoji hint."),
        // session/rename params
        new_name: z
          .string()
          .optional()
          .describe("session/rename: New alphanumeric name for the session."),
        // profile/voice params
        voice: z
          .string()
          .optional()
          .describe("profile/voice: Voice name to set. Pass empty string to clear."),
        speed: z
          .number()
          .min(0.25)
          .max(4.0)
          .optional()
          .describe("profile/voice: TTS speed multiplier (0.25–4.0)."),
        // message/edit params
        message_id: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("message/edit, message/delete, message/pin, react, message/get, checklist/update, progress/update, acknowledge: Target message ID."),
        text: z
          .string()
          .optional()
          .describe("message/edit: New text content. reminder/set: Reminder message text. animation/cancel: Replacement text. confirm/*: Prompt shown to user."),
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
          .default("Markdown")
          .describe(
            "message/edit, animation/cancel: Parse mode for text. " +
            "'Markdown' (default) — standard markdown auto-converted; " +
            "'MarkdownV2' — raw Telegram MarkdownV2 pass-through (special chars must be manually escaped); " +
            "'HTML' — HTML tags.",
          ),
        // message/pin params
        disable_notification: z
          .boolean()
          .optional()
          .describe("message/pin: Pin without notifying members."),
        unpin: z
          .boolean()
          .optional()
          .describe("message/pin: If true, unpin instead of pin."),
        // react params
        emoji: z
          .string()
          .optional()
          .describe("react: Emoji or semantic alias (e.g. 'thinking', 'done'). Omit to remove reaction."),
        is_big: z
          .boolean()
          .optional()
          .describe("react: Use big animation (permanent reactions only)."),
        temporary: z
          .boolean()
          .optional()
          .describe("react: Auto-reverts reaction on next outbound action or timeout."),
        restore_emoji: z
          .string()
          .optional()
          .describe("react: Emoji/alias to revert to when temporary reaction expires."),
        timeout_seconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("react: Deadline before auto-restore fires. show-typing: Duration (1–300s, default 20). confirm/*: Seconds to wait for user response before timing out (default 600)."),
        ignore_pending: z
          .boolean()
          .optional()
          .describe("confirm/*: Proceed even if there are unread pending updates (skips the pending check)."),
        // acknowledge params
        callback_query_id: z
          .string()
          .optional()
          .describe("acknowledge: ID from the callback_query update."),
        show_alert: z
          .boolean()
          .optional()
          .describe("acknowledge: Show as dialog alert instead of toast."),
        url: z
          .string()
          .optional()
          .describe("acknowledge: URL to open in the user's browser (for games)."),
        cache_time: z
          .number()
          .int()
          .optional()
          .describe("acknowledge: Seconds the result may be cached client-side."),
        remove_keyboard: z
          .boolean()
          .optional()
          .describe("acknowledge: Clear the inline keyboard on message_id after answering. Returns MISSING_MESSAGE_ID error if message_id is absent."),
        // message/route params
        target_sid: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("message/route: Session ID to route the message to."),
        // profile/topic params
        topic: z
          .string()
          .max(32)
          .optional()
          .describe("profile/topic: Short label to prepend to all outbound messages. Pass empty string to clear."),
        // profile/* params
        key: z
          .string()
          .optional()
          .describe("profile/save, profile/load: Profile key (bare name e.g. 'Overseer')."),
        // profile/import params
        voice_speed: z
          .number()
          .min(0.25)
          .max(4.0)
          .optional()
          .describe("profile/import: TTS playback speed multiplier (0.25–4.0)."),
        animation_default: z
          .array(z.string())
          .optional()
          .describe("profile/import: Default animation frame sequence."),
        animation_presets: z
          .record(z.string(), z.array(z.string()))
          .optional()
          .describe("profile/import: Named animation presets."),
        reminders: z
          .array(
            z.object({
              text: z.string(),
              delay_seconds: z.number(),
              recurring: z.boolean().default(false),
            }),
          )
          .optional()
          .describe("profile/import: Reminders to register for this session."),
        // reminder/set params
        trigger: z
          .enum(["time", "startup"])
          .optional()
          .describe("reminder/set: When to fire (default: 'time')."),
        delay_seconds: z
          .number()
          .int()
          .min(0)
          .max(86400)
          .optional()
          .describe("reminder/set: Seconds to wait before reminder becomes active (default 0)."),
        recurring: z
          .boolean()
          .optional()
          .describe("reminder/set: Re-arm after firing (default false)."),
        id: z
          .string()
          .optional()
          .describe("reminder/set: Optional ID for dedup. reminder/cancel: Reminder ID to cancel."),
        // profile/dequeue-default params
        timeout: z
          .number()
          .int()
          .min(0)
          .max(3600)
          .optional()
          .describe("profile/dequeue-default: Default dequeue timeout in seconds (0–3600)."),
        // animation/default params
        frames: z
          .array(z.string())
          .optional()
          .describe("animation/default: Animation frames to set as default or register as preset."),
        preset: z
          .string()
          .optional()
          .describe("animation/default: Named preset key for registration or recall."),
        reset: z
          .boolean()
          .optional()
          .describe("animation/default: Reset to built-in default animation."),
        // logging/toggle params
        enabled: z
          .boolean()
          .optional()
          .describe("logging/toggle: true to enable logging, false to disable."),
        // message/history params
        count: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("message/history: Number of events to return (default 20, max 50)."),
        before_id: z
          .number()
          .int()
          .optional()
          .describe("message/history: Return events older than this event ID (page backwards)."),
        // message/get params
        version: z
          .number()
          .int()
          .optional()
          .describe("message/get: Version (-1 = current, 0 = original, 1+ = edit history)."),
        // log/* params
        filename: z
          .string()
          .optional()
          .describe("log/get: Log filename to read. log/delete: Log filename to delete. Omit log/get to list files."),
        // log/debug params
        category: z
          .string()
          .optional()
          .describe("log/debug: Filter to a single debug category. Valid values: session, route, queue, cascade, dm, animation, tool, health."),
        since: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("log/debug: Only return entries with id > since (cursor-based pagination)."),
        enable: z
          .boolean()
          .optional()
          .describe("log/debug: Toggle debug logging on/off."),
        // show-typing params
        cancel: z
          .boolean()
          .optional()
          .describe("show-typing: If true, immediately stop the typing indicator."),
        // approve params
        target_name: z
          .string()
          .optional()
          .describe("approve: Name of the pending session to approve."),
        // shutdown params
        force: z
          .boolean()
          .optional()
          .describe("shutdown: Bypass the pending-message safety guard."),
        // shutdown/warn params
        reason: z
          .string()
          .optional()
          .describe("shutdown/warn: Optional reason for the restart."),
        wait_seconds: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("shutdown/warn: Optional estimated wait time in seconds before restart."),
        // transcribe / download params
        file_id: z
          .string()
          .optional()
          .describe("transcribe: Telegram file_id of voice message. download: Telegram file_id to download."),
        file_name: z
          .string()
          .optional()
          .describe("download: Suggested file name."),
        mime_type: z
          .string()
          .optional()
          .describe("download: MIME type hint from the message."),
        // checklist/update params
        title: z
          .string()
          .optional()
          .describe("checklist/update: Bold heading for the status block."),
        steps: z
          .array(
            z.object({
              label: z.string().describe("Step description."),
              status: z.enum(["pending", "running", "done", "failed", "skipped"]).describe("Current status."),
              detail: z.string().optional().describe("Optional short italicized detail."),
            }),
          )
          .optional()
          .describe("checklist/update: Ordered list of steps with their current statuses."),
        // progress/update params
        percent: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe("progress/update: Progress percentage (0–100)."),
        subtext: z
          .string()
          .optional()
          .describe("progress/update: Optional italicized detail line below the bar."),
        width: z
          .number()
          .int()
          .min(1)
          .max(40)
          .optional()
          .describe("progress/update: Bar width in characters (default 10)."),
        // commands/set params
        commands: z
          .array(z.object({
            command: z.string().min(1).max(32).regex(/^[a-z0-9_]+$/, "Command must be lowercase letters, digits, or underscores — no slash prefix"),
            description: z.string().min(1).max(256),
          }))
          .optional()
          .default([])
          .describe("commands/set: Slash commands to register. Pass [] to clear the menu."),
        scope: z
          .enum(["chat", "default"])
          .optional()
          .describe('commands/set: "chat" scopes commands to active chat (default). "default" sets globally.'),
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
              hint: "Only the governor session can call this action. Use action(token: <governor_token>, ...).",
            });
          }
        }

        // Dispatch to handler — pass all args; handler extracts what it needs
        try {
          return (await Promise.resolve(entry.handler(args, undefined))) as ToolResult;
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
      const allCategories = listCategories();
      const suggestion = findClosestMatch(type, allCategories);
      return toError({
        code: "UNKNOWN_ACTION",
        message:
          `Unknown action path: "${type}". ` +
          `Use action() with no params to see available categories, ` +
          `or action(type: "<category>") to list sub-paths.`,
        hint: suggestion
          ? `Did you mean "${suggestion}"? Call help(topic: 'action') for all paths.`
          : `Call help(topic: 'action') to see all available action paths.`,
      });
    },
  );
}
