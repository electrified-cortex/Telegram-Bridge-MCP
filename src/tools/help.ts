import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const _require = createRequire(import.meta.url);
let MCP_VERSION = "unknown";
try {
  const pkg = _require("../../package.json") as { version: string };
  MCP_VERSION = pkg.version;
} catch {
  // package.json not found (deployment artifact without it)
}

let mcpCommit = "dev";
let mcpBuildTime = "unknown";
try {
  const info = _require("./build-info.json") as { BUILD_COMMIT: string; BUILD_TIME: string };
  mcpCommit = info.BUILD_COMMIT;
  mcpBuildTime = info.BUILD_TIME;
} catch {
  // build-info.json not generated yet (local dev without a build)
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to docs/help/ directory (resolved relative to this module). */
const HELP_DIR = join(__dirname, "..", "..", "docs", "help");

/**
 * Load a help topic from docs/help/<topic>.md.
 * Returns the file content, or null if the file does not exist.
 */
function loadTopic(topic: string): string | null {
  const filePath = join(HELP_DIR, `${topic}.md`);
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

const DESCRIPTION =
  "Returns discovery information about this MCP server. " +
  "Call with no arguments for an overview and full tool index. " +
  "Pass topic: 'index' for a categorized skill index and navigation menu. " +
  "Pass topic: 'guide' for the full agent communication guide. " +
  "Pass topic: 'start' for the post-session-start checklist (aliases: 'startup', 'quick_start'). " +
  "Pass topic: 'compression' for the compression cheat sheet. " +
  "Pass topic: 'compacted' for post-compaction recovery steps. " +
  "Pass topic: 'dequeue' for dequeue loop rules and flow. " +
  "Pass topic: 'shutdown' for graceful shutdown procedure. " +
  "Pass topic: 'forced-stop' for forced-stop detection and recovery. " +
  "Pass topic: 'reminders' for reminder-driven delegation pattern. " +
  "Pass topic: 'dump' for session dump filing procedure. " +
  "Pass topic: 'orphaned' for closing an orphaned session. " +
  "Pass topic: 'stop-hook' for VS Code stop hook recovery. " +
  "Pass topic: 'send' for full send tool reference including append mode. " +
  "Pass topic: 'append_text' for append_text tool reference (params, edge cases, examples). " +
  "Pass topic: 'reactions' for the full reaction protocol (priority queue, voice auto-salute, temporary vs permanent, DM rules). " +
  "Pass topic: 'presence' for presence signal hierarchy and silent-work detector thresholds. " +
  "Pass topic: 'behavior' for the behavioral-shaping rule registry and severity tier guidance. " +
  "Pass topic: 'modality' for the priority axis (buttons > text > audio) and modality-matching rules. " +
  "Pass topic: 'events' for the external event system docs (POST /event endpoint, kinds, metrics). " +
  "Pass topic: 'dequeue-http' for the REST /dequeue endpoint docs (curl-callable from watcher subprocesses). " +
  "Pass topic: 'guidance' for the guidance delivery reference (what fires when and why). " +
  "Pass topic: 'activity/file' for the activity-file wake-nudge integration guide (watcher patterns, lifecycle, error modes). " +
  "Pass topic: '<tool_name>' for detailed docs on a specific tool.";

/**
 * Static tool index: name → one-line description.
 *
 * This list is built from the registered tools in server.ts. If new tools are
 * added in the future, this list should be updated to match.
 */
const TOOL_INDEX: Record<string, string> = {
  help: "Discovery tool — overview, communication guide, and per-tool docs. Specialized topics: 'index' (categorized skill menu), 'startup' (post-session checklist), 'quick_start' (dequeue loop + send basics), 'guide' (agent comms guide), 'compression' (compression cheat sheet), 'checklist' (step statuses), 'animation' (frame guide), 'dequeue' (loop rules), 'shutdown' (graceful shutdown), 'forced-stop' (context-limit recovery), 'reminders' (delegation follow-up), 'dump' (session dump filing), 'orphaned' (close dangling session), 'stop-hook' (VS Code stop hook). No auth required for most topics; topic: 'identity' requires a session token.",
  session_start: "Authenticate and start a named agent session. Returns a token for all subsequent calls.",
  close_session: "End the current agent session and release its slot.",
  list_sessions: "List active sessions. Without a token: returns only SIDs — no auth required (use as a probe after a bridge restart). With a valid token: returns full session details (ID, name, color, createdAt) and the active SID.",
  rename_session: "Rename the current session's display name.",
  dequeue: "Poll for new Telegram messages and events. Core loop — call repeatedly.",
  set_dequeue_default: "Set the default timeout for dequeue calls.",
  get_message: "Retrieve a specific Telegram message by ID.",
  get_chat_history: "Fetch recent chat history (messages before a given ID).",
  notify: "Send a formatted notification with severity styling (info/success/warning/error).",
  ask: "Send a message and wait for the user's reply in a single call.",
  choose: "Send a multiple-choice prompt and return the user's selection. Accepts text + optional audio. Buttons are removed after selection (expected behavior — use send_choice if you want non-blocking buttons).",
  send_choice: "Send an inline-keyboard choice message without blocking. Note: buttons are removed once the user clicks (one-shot). Use update_checklist or a follow-up edit if you need persistent buttons.",
  confirm: "Send a yes/no confirmation prompt and return the user's answer. Accepts text + optional audio.",
  send: "Send a message as text, audio (TTS), or both. text → text message. audio → voice note. Both → voice note with text as caption.",
  send_file: "Upload and send a file to the Telegram chat.",
  edit_message: "Edit a previously sent message (replace entire message or update inline keyboard).",
  append_text: "Append text to an existing message.",
  delete_message: "Delete a Telegram message by ID.",
  show_animation: "Show a looping text-frame animation in chat. Caution: solo emoji frames render as large stickers on mobile — append \\u200b (zero-width space) to prevent this, or use multi-char frames. See help(topic: 'animation') for full guide.",
  cancel_animation: "Stop the currently running animation.",
  set_default_animation: "Set the animation used for long-running tasks.",
  show_typing: "Send a 'typing…' chat action indicator.",
  send_chat_action: "Send a Telegram chat action (typing, upload_document, etc.).",
  send_new_checklist: "Create and pin a new checklist message for tracking task steps.",
  update_checklist: "Update an existing live task checklist message in Telegram with the latest step statuses.",
  send_new_progress: "Create and pin a new progress bar message.",
  update_progress: "Update a previously created progress bar.",
  answer_callback_query: "Answer an inline keyboard callback query (dismiss spinner).",
  set_reaction: "Add an emoji reaction to a Telegram message.",
  pin_message: "Pin a message in the Telegram chat.",
  download_file: "Download a Telegram file by file_id.",
  transcribe_voice: "Transcribe a Telegram voice message to text via STT.",
  set_commands: "Register bot commands visible in the Telegram command menu.",
  set_topic: "Set a topic prefix appended to outgoing messages.",
  set_voice: "Configure session TTS voice and speed. Applied automatically when audio is used in send/confirm/choose.",
  set_reminder: "Schedule a future reminder event delivered via dequeue.",
  cancel_reminder: "Cancel a scheduled reminder by ID.",
  list_reminders: "List all pending reminders for the current session.",
  get_chat: "Request operator approval to read the configured chat metadata. Sends an interactive Allow/Deny prompt.",
  save_profile: "Save the current session's profile (name, color, voice) to disk.",
  load_profile: "Load a saved profile and apply it to the current session.",
  import_profile: "Import a profile definition from a JSON object.",
  roll_log: "Archive the current local log and start a fresh one.",
  get_log: "Read the current or a named local log file.",
  list_logs: "List all available local log files.",
  delete_log: "Delete a named local log file.",
  toggle_logging: "Enable or disable local event logging.",
  get_debug_log: "Read recent entries from the debug log.",
  send_direct_message: "Send a message directly to a specific session (bypasses routing).",
  route_message: "Route a message to a specific session or change routing mode.",
  approve_agent: "Approve a pending session_start request by ticket. Only available when agent delegation is enabled by the operator via the /approve panel. The one-time ticket is delivered to the governor via dequeue when the session requests approval.",
  shutdown: "Shut down the MCP server process.",
  notify_shutdown_warning: "Broadcast a shutdown warning to all active sessions.",
  events: "External HTTP event endpoint — POST /event for cross-participant signaling, metrics, and lifecycle awareness. help(topic: 'events') for full docs.",
};

function buildOverview(): string {
  const lines: string[] = [
    "Telegram Bridge MCP — Tool Overview",
    "",
    "Bridges AI agents to Telegram. help(topic: 'index') for categorized skill index. help(topic: 'guide') for full comms guide.",
    "help(topic: '<tool_name>') for docs on a specific tool.",
    "",
    "Tool Index:",
    "",
  ];
  for (const [name, desc] of Object.entries(TOOL_INDEX)) {
    lines.push(`${name} — ${desc}`);
  }
  return lines.join("\n");
}

export function register(server: McpServer) {
  server.registerTool(
    "help",
    {
      description: DESCRIPTION,
      inputSchema: {
        topic: z
          .string()
          .optional()
          .describe(
            "Omit for overview. Pass 'index' for a categorized skill index. Pass 'guide' for full communication guide. Pass 'identity' for bot info + server version. Pass a tool name for detailed docs on that tool."
          ),
        token: TOKEN_SCHEMA
          .optional()
          .describe("Session token — required only for topic: 'identity'. Omit for all other topics."),
      },
    },
    async ({ topic, token }) => {
      // No topic → full overview with tool index
      if (!topic) {
        return toResult({ content: buildOverview() });
      }

      // topic: "identity" → bot info + MCP server version/build fingerprint
      if (topic === "identity") {
        const _sid = requireAuth(token);
        if (typeof _sid !== "number") return toError(_sid);
        try {
          const botInfo = await getApi().getMe();
          return toResult({ mcp_version: MCP_VERSION, mcp_commit: mcpCommit, mcp_build_time: mcpBuildTime, ...botInfo });
        } catch (err) {
          return toError(err);
        }
      }

      // topic: "guide" → full agent communication guide (loaded from docs/help/guide.md)
      if (topic === "guide") {
        const content = loadTopic("guide");
        if (content !== null) {
          return toResult({ content: `Agent Communication Guide\n\n${content}` });
        }
        return toResult({
          content:
            "Agent Communication Guide\n\nUnavailable: docs/help/guide.md not found in distribution.",
        });
      }

      // Topics with rich file-based content — skip TOOL_INDEX even if present
      const RICH_TOPICS = new Set(["dequeue", "shutdown", "animation", "checklist", "compression", "startup", "start", "quick_start", "compacted", "dump", "forced-stop", "reminders", "orphaned", "stop-hook", "index", "guide", "send", "append_text", "reactions", "presence", "behavior", "audio", "modality", "events", "guidance", "activity/file", "dequeue-http"]);


      // topic: "<tool_name>" → per-tool description (checked before file lookup)
      // Skip for rich topics that have dedicated file-based content
      const desc = !RICH_TOPICS.has(topic) ? TOOL_INDEX[topic] : undefined;
      if (desc) {
        return toResult({ content: `${topic}\n\n${desc}` });
      }

      // Alias resolution: startup/quick_start → start
      const TOPIC_ALIASES: Record<string, string> = {
        startup: "start",
        quick_start: "start",
      };
      const resolvedTopic = TOPIC_ALIASES[topic] ?? topic;

      // All other named topics → load from docs/help/<topic>.md
      const fileContent = loadTopic(resolvedTopic);
      if (fileContent !== null) {
        return toResult({ content: fileContent });
      }

      return toError({
        code: "UNKNOWN" as const,
        message: `Unknown topic: '${topic}'. Call help() for a list of available tools.`,
      });
    }
  );
}
