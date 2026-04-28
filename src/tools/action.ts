import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, resolveChat } from "../telegram.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { requireAuth } from "../session-gate.js";
import { getGovernorSid } from "../routing-mode.js";
import {
  registerAction,
  resolveAction,
  listCategories,
  listSubPaths,
  toActionHandler,
} from "../action-registry.js";

import { handleSetVoice } from "./profile/voice.js";
import { handleListSessions } from "./session/list.js";
import { handleCloseSession } from "./session/close.js";
import { handleSessionStart, handleSessionReconnect } from "./session/start.js";
import { handleRenameSession } from "./session/rename.js";
import { handleSessionIdle } from "./session/idle.js";
import { handleSessionStatus } from "./session/status.js";
import { handleEditMessage } from "./message/edit.js";

// Phase 2 imports — message/*
import { handleDeleteMessage } from "./message/delete.js";
import { handlePinMessage } from "./message/pin.js";
import { handleSetReaction, handleSetReactionPreset } from "./react/set.js";
import { handleAnswerCallbackQuery } from "./acknowledge/query.js";
import { handleRouteMessage } from "./message/route.js";
// Phase 2 imports — profile/*, reminder/*, etc.
import { handleSetTopic } from "./profile/topic.js";
import { handleSaveProfile } from "./profile/save.js";
import { handleLoadProfile } from "./profile/load.js";
import { handleImportProfile } from "./profile/import.js";
import { handleSetReminder } from "./reminder/set.js";
import { handleCancelReminder } from "./reminder/cancel.js";
import { handleListReminders } from "./reminder/list.js";
import { handleDisableReminder } from "./reminder/disable.js";
import { handleEnableReminder } from "./reminder/enable.js";
import { handleSleepReminder } from "./reminder/sleep.js";
import { handleSetDequeueDefault } from "./profile/dequeue-default.js";
import { handleSetDefaultAnimation } from "./animation/default.js";
import { handleToggleLogging } from "./logging/toggle.js";
// Phase 2 imports — message/history, message/get
import { handleGetChatHistory } from "./message/history.js";
import { handleGetChat } from "./chat/info.js";
import { handleGetMessage } from "./message/get.js";
// Phase 2 imports — log/*
import { handleGetLog } from "./log/get.js";
import { handleListLogs } from "./log/list.js";
import { handleRollLog } from "./log/roll.js";
import { handleDeleteLog } from "./log/delete.js";
import { handleGetDebugLog, handleGetTraceLog } from "./log/debug.js";
// Phase 2 imports — animation/*
import { handleCancelAnimation } from "./animation/cancel.js";
import { handleAnimationStatus } from "./animation/status.js";
// Phase 2 imports — standalone
import { handleShowTyping } from "./show-typing/show-typing.js";
import { handleConfirm } from "./confirm/handler.js";
import { handleApproveAgent } from "./approve/agent.js";
import { handleShutdown } from "./shutdown/handler.js";
import { handleNotifyShutdownWarning } from "./shutdown/warn.js";
import { handleCloseSessionSignal } from "./session/close-signal.js";
import { handleTranscribeVoice } from "./transcribe/voice.js";
import { handleDownloadFile } from "./download/file.js";
import { handleUpdateChecklist } from "./checklist/update.js";
import { handleUpdateProgress } from "./progress/update.js";
import { handleSetCommands } from "./commands/set.js";
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
  registerAction("session/start", toActionHandler(handleSessionStart));
  registerAction("session/reconnect", toActionHandler(handleSessionReconnect));
  registerAction("session/close", toActionHandler(handleCloseSession));
  registerAction("session/close/signal", toActionHandler(handleCloseSessionSignal), { governor: true });
  registerAction("session/list", toActionHandler(handleListSessions));
  registerAction("session/idle", toActionHandler(handleSessionIdle));
  registerAction("session/rename", toActionHandler(handleRenameSession));
  registerAction("session/status", toActionHandler(handleSessionStatus));
  registerAction("profile/voice", toActionHandler(handleSetVoice));
  registerAction("message/edit", toActionHandler(handleEditMessage));

  // message/*
  registerAction("message/delete", toActionHandler(handleDeleteMessage));
  registerAction("message/pin", toActionHandler(handlePinMessage));
  registerAction("react", toActionHandler(async (args: Record<string, unknown>) => {
    // Preset path: dispatch before single-emoji / array handling
    if (args.preset && typeof args.preset === "string" && !args.emoji && !args.reactions) {
      const _sid = requireAuth(args.token as number);
      if (typeof _sid !== "number") return toError(_sid);
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      return handleSetReactionPreset(_sid, chatId, args.message_id as number, args.preset);
    }
    return handleSetReaction(args as Parameters<typeof handleSetReaction>[0]);
  }));
  registerAction("acknowledge", toActionHandler(handleAnswerCallbackQuery));
  registerAction("message/route", toActionHandler(handleRouteMessage), { governor: true });

  // profile/*, reminder/*, logging/*, commands/*
  registerAction("profile/topic", toActionHandler(handleSetTopic));
  registerAction("profile/save", toActionHandler(handleSaveProfile));
  registerAction("profile/load", toActionHandler(handleLoadProfile));
  registerAction("profile/import", toActionHandler(handleImportProfile));
  registerAction("reminder/set", toActionHandler(handleSetReminder));
  registerAction("reminder/cancel", toActionHandler(handleCancelReminder));
  registerAction("reminder/list", toActionHandler(handleListReminders));
  registerAction("reminder/disable", toActionHandler(handleDisableReminder));
  registerAction("reminder/enable", toActionHandler(handleEnableReminder));
  registerAction("reminder/sleep", toActionHandler(handleSleepReminder));
  registerAction("profile/dequeue-default", toActionHandler(handleSetDequeueDefault));
  registerAction("animation/default", toActionHandler(handleSetDefaultAnimation));
  registerAction("logging/toggle", toActionHandler(handleToggleLogging));

  // message/history
  registerAction("message/history", toActionHandler((args: Record<string, unknown>) => {
    if (args.count !== undefined || args.before_id !== undefined) {
      return handleGetChatHistory(args as Parameters<typeof handleGetChatHistory>[0]);
    }
    return handleGetChat(args as Parameters<typeof handleGetChat>[0]);
  }));
  registerAction("message/get", toActionHandler(handleGetMessage));

  // chat/*
  registerAction("chat/info", toActionHandler(handleGetChat));

  // log/* (governor-only)
  registerAction("log/get", toActionHandler(handleGetLog), { governor: true });
  registerAction("log/list", toActionHandler(handleListLogs), { governor: true });
  registerAction("log/roll", toActionHandler(handleRollLog), { governor: true });
  registerAction("log/delete", toActionHandler(handleDeleteLog), { governor: true });
  registerAction("log/debug", toActionHandler(handleGetDebugLog), { governor: true });
  registerAction("log/trace", toActionHandler(handleGetTraceLog), { governor: true });
  // animation/*
  registerAction("animation/cancel", toActionHandler(handleCancelAnimation));
  registerAction("animation/status", toActionHandler((args: Record<string, unknown>) =>
    handleAnimationStatus({
      token: args.token as number,
      sid: args.sid as number | undefined,
    })
  ));

  // standalone
  registerAction("show-typing", toActionHandler(handleShowTyping));
  // confirm/* presets (preset buttons, caller only needs to supply `text`)
  const makeConfirmHandler = (yesText: string, noText: string, yesStyle?: "success" | "primary" | "danger") =>
    toActionHandler((args: Record<string, unknown>) => handleConfirm({
      text: (args.text as string | undefined) ?? "",
      yes_text: yesText,
      no_text: noText,
      yes_data: "confirm_yes",
      no_data: "confirm_no",
      yes_style: (args.yes_style as "success" | "primary" | "danger" | undefined) ?? yesStyle,
      timeout_seconds: (args.timeout_seconds as number | undefined) ?? 600,
      ignore_pending: args.ignore_pending as boolean | undefined,
      token: args.token as number,
    }, undefined as unknown as AbortSignal));
  registerAction("confirm/ok", makeConfirmHandler("OK", "", "primary"));
  registerAction("confirm/ok-cancel", makeConfirmHandler("OK", "Cancel", "primary"));
  registerAction("confirm/yn", makeConfirmHandler("🟢 Yes", "🔴 No"));
  registerAction("approve", toActionHandler(handleApproveAgent), { governor: true });
  registerAction("shutdown", toActionHandler(handleShutdown), { governor: true });
  registerAction("shutdown/warn", toActionHandler(handleNotifyShutdownWarning), { governor: true });
  registerAction("transcribe", toActionHandler(handleTranscribeVoice));
  registerAction("download", toActionHandler(handleDownloadFile));
  registerAction("checklist/update", toActionHandler(handleUpdateChecklist));
  registerAction("progress/update", toActionHandler(handleUpdateProgress));
  registerAction("commands/set", toActionHandler((args: Record<string, unknown>) =>
    handleSetCommands({
      commands: (args.commands ?? []) as Parameters<typeof handleSetCommands>[0]["commands"],
      scope: args.scope as "chat" | "default" | undefined,
      token: args.token as number,
    })
  ));

}

const DESCRIPTION =
  "Universal action dispatcher. Omit `type` to list all categories. " +
  "Pass a category (e.g. `session`) to list sub-paths. " +
  "Pass a full path (e.g. `session/list`) to execute. " +
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
        // Auth token — required for most paths; see exceptions below
        token: TOKEN_SCHEMA.optional().describe(
          "Session token from action(type: 'session/start'). " +
          "Token-optional paths: `session/start`, `session/reconnect`, and `session/list` (unauthenticated probe returns SIDs only). " +
          "Omitting `type` (discovery/category listing) also requires no token. " +
          "All other paths require a valid token.",
        ),
        // session/start and session/reconnect params
        name: z
          .string()
          .default("")
          .describe("session/start, session/reconnect: Human-friendly session name."),
        color: z
          .string()
          .optional()
          .describe("session/start: Preferred color square emoji hint. session/rename: Color to apply (must be a valid palette emoji)."),
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
        // message/route and session/rename params
        target_sid: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("message/route: Session ID to route the message to. session/rename: SID of session to rename (governor only)."),
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
              trigger: z.enum(["time", "startup"]).optional(),
              disabled: z.boolean().optional(),
            }),
          )
          .optional()
          .describe("profile/import: Reminders to register for this session."),
        nametag_emoji: z
          .string()
          .min(1)
          .max(10)
          .optional()
          .describe("profile/import: Custom emoji to replace the default 🤖 in the session name tag."),
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
          .describe("reminder/set: Optional ID for dedup. reminder/cancel, reminder/disable, reminder/enable, reminder/sleep: Reminder ID to operate on."),
        until: z
          .string()
          .optional()
          .describe("reminder/sleep: ISO-8601 datetime after which the reminder resumes firing (e.g. \"2026-06-01T09:00:00Z\")."),
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
          .describe("react: Named reaction preset (e.g. \"processing\"). animation/default: Named preset key for registration or recall."),
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
        // log/trace params
        session_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("log/trace: Filter to a specific session ID (governor-only for other sessions)."),
        tool: z
          .string()
          .optional()
          .describe("log/trace: Filter trace entries to a specific tool name."),
        since_ts: z
          .string()
          .optional()
          .describe("log/trace: Only return trace entries at or after this ISO timestamp."),
        // show-typing params
        cancel: z
          .boolean()
          .optional()
          .describe("show-typing: If true, immediately stop the typing indicator."),
        // approve params
        ticket: z
          .string()
          .optional()
          .describe("approve: One-time approval ticket delivered to the governor via dequeue when the session requested approval."),
        // shutdown / session/close params
        force: z
          .boolean()
          .optional()
          .describe("shutdown: Bypass the pending-message safety guard. session/close: Force-close the last remaining session (bypasses the last-session guard)."),
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
