import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DESCRIPTION =
  "Returns discovery information about this MCP server. " +
  "Call with no arguments for an overview and full tool index. " +
  "Pass topic: 'guide' for the full agent communication guide. " +
  "Pass topic: '<tool_name>' for detailed docs on a specific tool.";

/**
 * Static tool index: name → one-line description.
 *
 * This list is built from the registered tools in server.ts. If new tools are
 * added in the future, this list should be updated to match.
 */
const TOOL_INDEX: Record<string, string> = {
  help: "Discovery tool — overview, communication guide, and per-tool docs. No auth required.",
  get_agent_guide: "[DEPRECATED: use help(topic: 'guide') instead] Returns the full agent communication guide from docs/behavior.md.",
  session_start: "Authenticate and start a named agent session. Returns a token for all subsequent calls.",
  close_session: "End the current agent session and release its slot.",
  list_sessions: "List all active sessions with their SIDs and display names.",
  rename_session: "Rename the current session's display name.",
  dequeue_update: "Poll for new Telegram messages and events. Core loop — call repeatedly.",
  set_dequeue_default: "Set the default timeout for dequeue_update calls.",
  get_message: "Retrieve a specific Telegram message by ID.",
  get_chat_history: "Fetch recent chat history (messages before a given ID).",
  notify: "Send a formatted notification with severity styling (info/success/warning/error).",
  ask: "Send a message and wait for the user's reply in a single call.",
  choose: "Send a multiple-choice prompt and return the user's selection.",
  send_choice: "Send an inline-keyboard choice message without blocking.",
  confirm: "Send a yes/no confirmation prompt and return the user's answer.",
  send: "Send a message as text, voice, or both. text only → text message. voice only → TTS voice note. Both → voice note with text as caption.",
  send_file: "Upload and send a file to the Telegram chat.",
  edit_message: "Edit a previously sent message (replace entire message).",
  edit_message_text: "Edit only the text of a previously sent message.",
  append_text: "Append text to an existing message.",
  delete_message: "Delete a Telegram message by ID.",
  show_animation: "Show a looping animation/GIF in chat.",
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
  set_voice: "Configure TTS voice settings for use with send (voice param) and other TTS tools.",
  set_reminder: "Schedule a future reminder event delivered via dequeue_update.",
  cancel_reminder: "Cancel a scheduled reminder by ID.",
  list_reminders: "List all pending reminders for the current session.",
  get_me: "Return the bot's own Telegram user info.",
  get_chat: "Return info about the configured Telegram chat.",
  save_profile: "Save the current session's profile (name, color, voice) to disk.",
  load_profile: "Load a saved profile and apply it to the current session.",
  import_profile: "Import a profile definition from a JSON object.",
  dump_session_record: "Write a structured session record/timeline to disk.",
  roll_log: "Archive the current local log and start a fresh one.",
  get_log: "Read the current or a named local log file.",
  list_logs: "List all available local log files.",
  delete_log: "Delete a named local log file.",
  toggle_logging: "Enable or disable local event logging.",
  get_debug_log: "Read recent entries from the debug log.",
  send_direct_message: "Send a message directly to a specific session (bypasses routing).",
  route_message: "Route a message to a specific session or change routing mode.",
  approve_agent: "Approve a pending session_start request by name. Only available when agent delegation is enabled by the operator via the /approve panel.",
  shutdown: "Shut down the MCP server process.",
  notify_shutdown_warning: "Broadcast a shutdown warning to all active sessions.",
};

function buildOverview(): string {
  const lines: string[] = [
    "# Telegram Bridge MCP — Tool Overview",
    "",
    "This server bridges AI agents to Telegram. Call `help(topic: 'guide')` for the full",
    "communication guide, or `help(topic: '<tool_name>')` for docs on a specific tool.",
    "",
    "## Tool Index",
    "",
  ];
  for (const [name, desc] of Object.entries(TOOL_INDEX)) {
    lines.push(`**${name}** — ${desc}`);
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
            "Omit for overview. Pass 'guide' for full communication guide. Pass a tool name for detailed docs on that tool."
          ),
      },
    },
    ({ topic }) => {
      // No topic → full overview with tool index
      if (!topic) {
        return toResult({ content: buildOverview() });
      }

      // topic: "guide" → full agent communication guide
      if (topic === "guide") {
        try {
          const content = readFileSync(
            join(__dirname, "..", "..", "docs", "behavior.md"),
            "utf-8"
          );
          return toResult({ content: `# Agent Communication Guide\n\n${content}` });
        } catch {
          return toResult({
            content:
              "# Agent Communication Guide\n\nUnavailable: docs/behavior.md not found in distribution.",
          });
        }
      }

      // topic: "<tool_name>" → per-tool description
      const desc = TOOL_INDEX[topic];
      if (desc) {
        return toResult({ content: `# ${topic}\n\n${desc}` });
      }

      return toError({
        code: "UNKNOWN" as const,
        message: `Unknown topic: '${topic}'. Call help() for a list of available tools.`,
      });
    }
  );
}
