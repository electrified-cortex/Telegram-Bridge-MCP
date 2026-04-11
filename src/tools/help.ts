import { createRequire } from "module";
import { readFileSync } from "fs";
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

const DESCRIPTION =
  "Returns discovery information about this MCP server. " +
  "Call with no arguments for an overview and full tool index. " +
  "Pass topic: 'guide' for the full agent communication guide. " +
  "Pass topic: 'startup' for the post-session-start checklist. " +
  "Pass topic: 'compression' for the compression cheat sheet. " +
  "Pass topic: '<tool_name>' for detailed docs on a specific tool.";

/**
 * Static tool index: name → one-line description.
 *
 * This list is built from the registered tools in server.ts. If new tools are
 * added in the future, this list should be updated to match.
 */
const TOOL_INDEX: Record<string, string> = {
  help: "Discovery tool — overview, communication guide, and per-tool docs. Specialized topics: 'startup' (post-session checklist), 'guide' (agent comms guide), 'compression' (compression cheat sheet), 'checklist' (step statuses), 'animation' (frame guide). No auth required for most topics; topic: 'identity' requires a session token.",
  session_start: "Authenticate and start a named agent session. Returns a token for all subsequent calls.",
  close_session: "End the current agent session and release its slot.",
  list_sessions: "List all active sessions with their SIDs and display names.",
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
  get_chat: "Request operator approval to read the configured chat metadata. Sends an interactive Allow/Deny prompt — requires an active session token.",
  save_profile: "Save the current session's profile (name, color, voice) to disk.",
  load_profile: "Load a saved profile and apply it to the current session.",
  import_profile: "Import a profile definition from a JSON object.",
  dump_session_record: "Roll and return the current session log.",
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
    "Telegram Bridge MCP — Tool Overview",
    "",
    "Bridges AI agents to Telegram. help(topic: 'guide') for full comms guide.",
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
            "Omit for overview. Pass 'guide' for full communication guide. Pass 'identity' for bot info + server version. Pass a tool name for detailed docs on that tool."
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

      // topic: "guide" → full agent communication guide
      if (topic === "guide") {
        try {
          const content = readFileSync(
            join(__dirname, "..", "..", "docs", "behavior.md"),
            "utf-8"
          );
          return toResult({ content: `Agent Communication Guide\n\n${content}` });
        } catch {
          return toResult({
            content:
              "Agent Communication Guide\n\nUnavailable: docs/behavior.md not found in distribution.",
          });
        }
      }

      // topic: "checklist" → checklist step status values
      if (topic === "checklist") {
        return toResult({
          content: [
            "Checklist Step Statuses",
            "",
            "Valid status values for send(type: 'checklist') and action(type: 'checklist/update') steps:",
            "",
            "| Status | Meaning |",
            "| --- | --- |",
            "| pending | Not yet started (default — shows ⬜) |",
            "| running | In progress (shows 🔄) |",
            "| done | Completed successfully (shows ✅) |",
            "| failed | Completed with error (shows ❌) |",
            "| skipped | Intentionally skipped (shows ⏭️) |",
            "",
            "Common mistake: using 'in-progress' — not valid. Use 'running'.",
            "",
            "Example:",
            "```",
            "action(type: 'checklist/update', message_id: 123, steps: [",
            "  { label: 'Fetch data', status: 'done' },",
            "  { label: 'Process', status: 'running' },",
            "  { label: 'Save', status: 'pending' }",
            "])",
            "```",
          ].join("\n"),
        });
      }

      // topic: "animation" → animation frames guide
      if (topic === "animation") {
        return toResult({
          content: [
            "Animation Frames Guide",
            "",
            "Starting an animation:",
            "send(type: 'animation', frames: [...], interval: 1000, timeout: 600)",
            "Or a named preset: send(type: 'animation', preset: 'working')",
            "",
            "Single-emoji frames warning:",
            "Frames with only a single emoji render as large stickers on mobile (Telegram behavior).",
            "",
            "Fix: append \\u200b (zero-width space) to single-emoji frames:",
            "  frames: ['⏳\\u200b', '🔄\\u200b']",
            "Or use multi-character frames:",
            "  frames: ['`⏳ working`', '`🔄 thinking`']",
            "",
            "Built-in presets:",
            "| Preset | Description |",
            "| --- | --- |",
            "| bounce | Block-character bouncing bar (default) |",
            "| working | ⚙ Working… cycling dots |",
            "| thinking | 🤔 Thinking… cycling dots |",
            "| reviewing | 🔍 Reviewing… cycling dots |",
          ].join("\n"),
        });
      }

      // topic: "compression" → standalone compression cheat sheet
      if (topic === "compression") {
        return toResult({
          content: [
            "Compression Cheat Sheet",
            "",
            "Tiers:",
            "| Tier | Use when |",
            "| --- | --- |",
            "| None | Full English — audio msgs, spec files |",
            "| Lite | Drop filler/hedging, keep articles — operator text |",
            "| Full | Drop articles, fragments OK — general docs |",
            "| Ultra | Telegraphic, abbreviate, arrows — agent DMs, agent files |",
            "",
            "Surface Map:",
            "| Surface | Tier |",
            "| --- | --- |",
            "| Agent-to-agent DMs | Ultra |",
            "| Agent files (CLAUDE.md, .agent.md) | Ultra |",
            "| Skills (SKILL.md), instructions | Ultra |",
            "| Reminder text | Ultra |",
            "| Text to operator (Telegram) | Lite |",
            "| Audio captions | Lite |",
            "| Audio messages | None |",
            "| Spec files, code blocks | None |",
            "",
            "Ultra Rules:",
            "Drop: articles (a/an/the), filler (just/really/basically/actually), pleasantries, hedging.",
            "Keep: technical terms exact, code/paths/URLs verbatim.",
            "Pattern: [thing] [action] [reason]. [next step].",
            "Abbreviate: DB auth config req res fn impl msg sess conn dir env repo.",
            "Fragments OK. Arrows: X → Y.",
            "",
            "Examples:",
            "Bad: 'Sure! I'd be happy to help with that.'",
            "Good: 'Issue: token expiry, auth middleware.'",
            "",
            "Bad: 'The implementation could potentially involve adding a check...'",
            "Good: 'Impl: null-check before fn call.'",
          ].join("\n"),
        });
      }

      // topic: "startup" → post-session-start checklist
      if (topic === "startup") {
        return toResult({
          content: [
            "Startup — Post-Session-Start",
            "",
            "Token: token = sid * 1_000_000 + pin. Required for all calls. Save it now.",
            "Reconnect: session_start(name: '...', reconnect: true) if token is lost.",
            "Missed messages: action(type: 'message/history') after reconnect.",
            "",
            "Profile: action(type: 'profile/load', key: '<name>') to restore voice/animation/reminders.",
            "",
            "Discover: help() → tool index · help(topic: 'guide') → full comms guide · help(topic: '<tool>') → per-tool docs.",
            "Compression: help(topic: 'compression') → message brevity tiers.",
          ].join("\n"),
        });
      }

      // topic: "<tool_name>" → per-tool description
      const desc = TOOL_INDEX[topic];
      if (desc) {
        return toResult({ content: `${topic}\n\n${desc}` });
      }

      return toError({
        code: "UNKNOWN" as const,
        message: `Unknown topic: '${topic}'. Call help() for a list of available tools.`,
      });
    }
  );
}
