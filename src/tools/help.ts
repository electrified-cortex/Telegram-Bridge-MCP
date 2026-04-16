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
  "Pass topic: 'index' for a categorized skill index and navigation menu. " +
  "Pass topic: 'guide' for the full agent communication guide. " +
  "Pass topic: 'start' for the post-session-start checklist (profile load, dequeue loop, send basics). " +
  "Pass topic: 'compression' for the compression cheat sheet. " +
  "Pass topic: 'compacted' for post-compaction recovery steps. " +
  "Pass topic: 'dequeue' for dequeue loop rules and flow. " +
  "Pass topic: 'shutdown' for graceful shutdown procedure. " +
  "Pass topic: 'forced-stop' for forced-stop detection and recovery. " +
  "Pass topic: 'reminders' for reminder-driven delegation pattern. " +
  "Pass topic: 'dump' for session dump filing procedure. " +
  "Pass topic: 'orphaned' for closing an orphaned session. " +
  "Pass topic: 'stop-hook' for VS Code stop hook recovery. " +
  "Pass topic: '<tool_name>' for detailed docs on a specific tool.";

/**
 * Static tool index: name → one-line description.
 *
 * This list is built from the registered tools in server.ts. If new tools are
 * added in the future, this list should be updated to match.
 */
const TOOL_INDEX: Record<string, string> = {
  help: "Discovery tool — overview, communication guide, and per-tool docs. Specialized topics: 'index' (categorized skill menu), 'start' (post-session checklist: profile, dequeue loop, send basics), 'guide' (agent comms guide), 'compression' (compression cheat sheet), 'checklist' (step statuses), 'animation' (frame guide), 'dequeue' (loop rules), 'shutdown' (graceful shutdown), 'forced-stop' (context-limit recovery), 'reminders' (delegation follow-up), 'dump' (session dump filing), 'orphaned' (close dangling session), 'stop-hook' (VS Code stop hook). No auth required for most topics; topic: 'identity' requires a session token.",
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

      // topic: "start" (also aliased from "startup" and "quick_start") → post-session-start operational guide
      if (topic === "start" || topic === "startup" || topic === "quick_start") {
        return toResult({
          content: [
            "Start — Post-Session Operational Guide",
            "",
            "## Profile",
            "If you have a saved profile: action(type: 'profile/load', key: 'YourProfileKey', token)",
            "Restores voice, animation presets, reminders. Skip if no profile exists.",
            "",
            "## Dequeue Loop",
            "Call dequeue() with no parameters. Default timeout is 5 minutes. This is intentional — blocking reduces token use.",
            "Returns { timed_out: true } on timeout → call again. Returns { empty: true } on instant poll.",
            "Pattern: drain → block → handle → drain again. When pending > 0: dequeue(timeout: 0) until pending == 0, then block.",
            "Claude Code sessions (long-lived): action(type: 'profile/dequeue-default', timeout: N, token) to increase timeout.",
            "",
            "## Send Basics",
            "send(type: 'text', token, text: 'Hello') → text message",
            "send(type: 'notification', token, title: 'Done', text: 'Task complete', severity: 'success') → formatted alert",
            "",
            "## DM Pattern",
            "send(type: 'dm', token, target: 'SessionName', text: '...') → private message to another session",
            "action(type: 'react', token, message_id: <id>, emoji: '👍') → silent receipt ack",
            "",
            "## Help",
            "All tools: help(). Specific tool: help('tool_name'). Full guide: help('guide').",
            "help('guide') → full comms guide (optional reference, not required reading)",
            "help('dequeue') → dequeue loop rules · help('compression') → message brevity tiers",
          ].join("\n"),
        });
      }

      // topic: "compacted" → post-compaction recovery for any agent
      if (topic === "compacted") {
        return toResult({
          content: [
            "Post-Compaction Recovery",
            "",
            "You just lost conversational context. Follow these steps:",
            "",
            "1. Read your agent file (CLAUDE.md) — it has your identity and routing pointers.",
            "2. Read startup-context.md in your agent folder — full operating procedures.",
            "3. Read recovery-context.md in your agent folder — session state and invariants.",
            "4. Test Telegram: dequeue(timeout: 0) — drain any pending messages.",
            "5. Check session memory file for token and SID.",
            "6. If token is lost: action(type: 'session/reconnect', name: '<your_name>').",
            "7. Resume your dequeue loop or last task.",
            "",
            "Key: your agent file is the router. It tells you where everything else lives.",
          ].join("\n"),
        });
      }

      // topic: "dequeue" → dequeue loop rules and flow
      if (topic === "dequeue") {
        return toResult({
          content: [
            "Dequeue Loop — Heartbeat of every Telegram-enabled agent.",
            "",
            "Every code path ends with dequeue. No exceptions. Loop runs until shutdown signal.",
            "",
            "## Flow",
            "dequeue",
            "  → messages?  → handle → dequeue",
            "  → timeout    → scan for work → dequeue",
            "  → reminder   → handle reminder → dequeue",
            "  → error      → notify superior → dequeue",
            "",
            "## Rules",
            "1. Drain before acting. pending > 0 → call dequeue again before starting work.",
            "2. Stay responsive. Call dequeue between work chunks.",
            "3. After subagent returns: review result, DM superior, dequeue — do NOT stop.",
            "4. After error: notify superior, dequeue — do NOT stop.",
            "5. Default timeout always. Exception: timeout: 0 when draining pending after reconnect.",
            "6. Never assume silence = approval. Wait for explicit response.",
            "",
            "## Reactions",
            "- Voice messages: auto-saluted (🫡) by bridge on dequeue. Do not re-salute.",
            "- 👀 → 🫡 pattern encouraged: 👀 = reviewing, 🫡 = done.",
            "- Non-voice salute is optional — not required.",
            "",
            "## Idle",
            "No tasks ≠ done. Dequeue silently. On timeout, scan for work, dequeue again.",
            "No animations when idle — silence is correct signal.",
            "",
            "## Messaging",
            "- Voice by default: send(type: \"text\", audio: \"...\") for conversational replies.",
            "- send(type: \"text\", ...) for structured content (tables, code, lists).",
            "- send(type: \"question\", confirm: \"...\") for yes/no. choose: [...] for multi-option.",
            "",
            "Before exiting: DM superior \"Do you still need me?\" Only shutdown signal triggers",
            "action(type: \"session/close\"). Full procedure: help(topic: 'shutdown').",
            "",
            "Full reference: skills/telegram-mcp-dequeue-loop/SKILL.md",
          ].join("\n"),
        });
      }

      // topic: "shutdown" → graceful shutdown procedure
      if (topic === "shutdown") {
        return toResult({
          content: [
            "Graceful Shutdown — Clean exit for Telegram-enabled agents.",
            "",
            "Triggered by: operator stop command or action(type: \"shutdown/warn\") DM from governor.",
            "",
            "## Common Shutdown (All Agents)",
            "1. Drain queue. dequeue(timeout: 0) loop until pending = 0 and response = empty.",
            "   ALWAYS drain — unread messages lost when session ends.",
            "2. Finish current step. Don't drop mid-operation.",
            "3. DM superior with status:",
            "   - Worker → Overseer: \"Worker $Id shutting down.\"",
            "   - Overseer → Curator: \"Overseer shutting down — pipeline: [summary].\"",
            "   - Specialist → Governor: \"[Name] shutting down.\"",
            "4. Wipe session memory file. Overwrite with empty content.",
            "   Prevents next launch from offering resume on dead session.",
            "5. Write handoff (if applicable). Required: Overseer, Sentinel. Optional: Workers.",
            "6. action(type: \"session/close\") — closes YOUR session only. No target_sid.",
            "7. Stop. No more tool calls after session/close.",
            "",
            "## Governor Shutdown (Curator Only)",
            "1. Drain queue. dequeue(timeout: 0) until empty.",
            "2. Wipe session memory file.",
            "3. DM each session: \"Shutting down — close your session.\"",
            "4. Wait for session_closed events (brief timeout).",
            "5. Write session log: logs/session/YYYYMM/DD/HHmmss/summary.md",
            "6. Commit: git add session log + pending changes.",
            "7. Acknowledge operator (brief voice message).",
            "8. action(type: \"shutdown\") — triggers MCP bridge graceful shutdown.",
            "",
            "## Overseer: Worker Kill Procedure",
            "After Worker calls close_session:",
            "  Read .agents/agents/worker/<Worker-N>.pid → Stop-Process -Id $pid -Force",
            "  Delete PID file. Confirm gone.",
            "PID file absent → process already exited. No action needed.",
            "",
            "Safety: session/close closes YOUR session only. Never pass target_sid.",
            "",
            "Full reference: skills/telegram-mcp-graceful-shutdown/SKILL.md",
          ].join("\n"),
        });
      }

      // topic: "forced-stop" → forced-stop detection and recovery
      if (topic === "forced-stop") {
        return toResult({
          content: [
            "Forced-Stop Recovery — Detection and recovery after context-limit termination.",
            "",
            "Distinct from compaction. Agent had zero tokens — no handoff, no session/close, no DM.",
            "",
            "## Scenario Comparison",
            "| Scenario      | Signal                            | Recovery topic   |",
            "| compaction    | Context truncated, session alive  | compacted        |",
            "| graceful      | Operator says stop, handoff written | shutdown        |",
            "| forced stop   | Context limit hit, hook passes through | forced-stop  |",
            "",
            "## Periodic Checkpoint (Dead Man's Switch)",
            "Every 10 dequeue cycles, write checkpoint to session memory file:",
            "",
            "  ## Checkpoint",
            "  Written: <ISO 8601 timestamp>",
            "  Cycle: <loop cycle count>",
            "  SID: <your SID>",
            "  Status: <idle | in-progress: task-id>",
            "",
            "Write checkpoint BEFORE processing messages on 10th cycle.",
            "Silent failure OK — never let checkpoint failure interrupt dequeue loop.",
            "Write in addition to token block — never replace it.",
            "",
            "## Forced-Stop Detection on Startup",
            "Read session memory file before testing session:",
            "| Condition                                    | Interpretation        |",
            "| Empty or missing                             | Fresh start           |",
            "| Token present, no checkpoint                 | Clean start (<10 cycles) |",
            "| Checkpoint + handoff non-blank               | Clean shutdown        |",
            "| Checkpoint + handoff blank/missing           | Forced stop           |",
            "| Checkpoint + no handoffs used (e.g. Worker)  | Compare timestamp → if gap >30 min, forced stop |",
            "",
            "## Announcing Forced-Stop Recovery",
            "DM Curator immediately after reconnecting (before drain, before profile):",
            "  \"⚠️ Forced-stop recovery: terminated uncleanly (context limit or hard stop).",
            "   Last checkpoint: <timestamp>, Cycle: <N>, Status: <idle|task-id>.",
            "   Resuming now.\"",
            "",
            "Use ⚠️ Forced-stop recovery prefix — distinct from compaction recovery phrasing.",
            "",
            "## Fleet Detection (Curator/Overseer)",
            "Orphan signs: session in list, no recent DM, no session/close observed, stale checkpoint.",
            "Action: DM SID → wait one timeout → no reply → DM Curator → on confirmation, respawn.",
            "Do NOT close another agent's session. Bridge cleans up orphaned token on replacement start.",
            "",
            "Full reference: skills/telegram-mcp-forced-stop-recovery/SKILL.md",
          ].join("\n"),
        });
      }

      // topic: "reminders" → reminder-driven delegation pattern
      if (topic === "reminders") {
        return toResult({
          content: [
            "Reminder-Driven Follow-Up — Primary async tracking tool for delegation and async ops.",
            "",
            "Every delegation or async dispatch should have a corresponding reminder.",
            "",
            "## Core Pattern",
            "1. Create reminder FIRST (before dispatch).",
            "2. Dispatch work (DM, task, subagent).",
            "3. On reminder fire → check status.",
            "   - Done → cancel reminder.",
            "   - Not done → follow up with agent.",
            "4. On agent confirmation → cancel reminder.",
            "",
            "## Why Reminder First",
            "Guarantees follow-up exists even if:",
            "- Dispatch fails silently.",
            "- Context compaction drops delegation from memory.",
            "- Session restarts before confirmation arrives.",
            "",
            "## API",
            "action(type: \"reminder/set\", text: \"Verify Deputy completed [task]\", delay_seconds: 600)",
            "action(type: \"reminder/set\", text: \"Check Worker [task]\", delay_seconds: 1800, recurring: true)",
            "action(type: \"reminder/cancel\", id: \"<reminder_id>\")",
            "action(type: \"reminder/list\")",
            "",
            "## Timing Reference",
            "| Delegate              | Delay     | Rationale                     |",
            "| Deputy                | 10 min    | Fast turnaround, local context |",
            "| Worker (small task)   | 15–30 min | Claim + execute                |",
            "| Worker (large task)   | 60 min    | Multi-file changes, builds     |",
            "| Overseer              | 30 min    | Pipeline coordination          |",
            "",
            "Adjust based on complexity. Use recurring: true for long-running work.",
            "",
            "## Who Benefits Most",
            "- Curator — primary beneficiary. Delegates constantly, must verify everything.",
            "- Overseer — Worker management.",
            "- Any agent waiting on builds, external processes, or operator input.",
            "",
            "Full reference: skills/reminder-driven-followup/SKILL.md",
          ].join("\n"),
        });
      }

      // topic: "dump" → session dump filing procedure
      if (topic === "dump") {
        return toResult({
          content: [
            "Session Dump Handling — Filing Telegram session dump documents.",
            "",
            "Session dumps = conversation history as JSON. File promptly — no data lost between sessions.",
            "",
            "## Reaction Protocol",
            "✍ (pencil) — set immediately when processing begins.",
            "🫡 (salute) — set when fully filed (replaces ✍).",
            "",
            "## Inline (Reactive) Filing",
            "When dump document event appears in dequeue:",
            "1. React ✍ on dump message.",
            "2. download_file the document.",
            "3. Save to logs/telegram/YYYYMM/DD/HHmmss/dump.json",
            "   Use dump's own timestamp (real seconds, not message ID).",
            "4. Stage and commit: git add logs/telegram/<path>",
            "   Commit message: docs: file telegram dump YYYY-MM-DD",
            "5. React 🫡 on dump message.",
            "",
            "Pre-approved operation — non-destructive, no confirmation needed.",
            "",
            "## Periodic (Proactive) Filing",
            "On recurring dump-check reminder:",
            "1. List logs/telegram/ → find most recent filed dump.",
            "2. get_chat_history → scan for document messages newer than last filed dump.",
            "3. Download and file unfiled dumps (✍ → 🫡 on each).",
            "4. Single commit for all new dumps:",
            "   docs: file N telegram dumps from YYYY-MM-DD",
            "",
            "Catches dumps missed while agent was dead, compacted, or offline.",
            "",
            "## Path Convention",
            "logs/telegram/YYYYMM/DD/HHmmss/dump.json",
            "Use dump's creation timestamp, not current time.",
            "",
            "Full reference: skills/telegram-mcp-dump-handling/SKILL.md",
          ].join("\n"),
        });
      }

      // topic: "orphaned" → closing an orphaned session
      if (topic === "orphaned") {
        return toResult({
          content: [
            "Close Orphaned Session — Clean up a registered session with no active agent.",
            "",
            "Use when: session appears in list but agent is unresponsive (terminal exit, forced kill,",
            "operator-denied reconnect).",
            "",
            "## When to Use",
            "- list_sessions shows a Worker session, Worker unresponsive to DMs.",
            "- Operator asks to clean up a dangling session.",
            "- Worker terminal exited and operator denied reconnect.",
            "",
            "## Procedure",
            "1. Get orphaned session name and SID from action(type: \"session/list\") or memory.",
            "2. Reconnect as that session:",
            "     action(type: \"session/start\", name: \"<WorkerName>\", reconnect: true)",
            "   Triggers operator approval dialog. Wait for approval.",
            "3. session/start returns { token, sid, ... }.",
            "4. Immediately close:",
            "     action(type: \"session/close\", token: <token>)",
            "5. Confirm to operator that session is closed.",
            "",
            "## Notes",
            "- Only close sessions where no active agent is running.",
            "  Closing an active agent's session mid-task corrupts their work.",
            "- Operator must approve reconnect — intentional, prevents unauthorized closure.",
            "- After close, SID is gone. Fresh Worker spawn gets new SID.",
            "- reconnect: true bypasses token knowledge — old token not needed.",
            "",
            "Full reference: skills/telegram-mcp-close-orphaned-session/SKILL.md",
          ].join("\n"),
        });
      }

      // topic: "stop-hook" → VS Code stop hook recovery
      if (topic === "stop-hook") {
        return toResult({
          content: [
            "Stop Hook Recovery — Action when VS Code Stop hook fires during active Telegram session.",
            "",
            "Stop hook fires → active Telegram loop detected → FIRST AND ONLY action: call dequeue.",
            "",
            "## Rules",
            "- No text output.",
            "- No explanation.",
            "- No analysis.",
            "- Just: dequeue (re-enters dequeue loop).",
            "",
            "## Why",
            "Stop hook fires when VS Code terminates agent conversation. Session memory file signals",
            "active Telegram session → should not terminate. Hook catches this, gives one more turn —",
            "use it to re-enter loop.",
            "",
            "## \"No Tokens Left\" Edge Case",
            "Sequence:",
            "1. Stop hook fires (first time). stop_hook_active = false → hook blocks. Agent gets one more turn.",
            "2. Agent near-zero tokens. Can't run full dequeue, write handoff, or DM fleet.",
            "3. Stop hook fires again. stop_hook_active = true → hook passes through. Process terminates.",
            "",
            "Result: session/close never called, no handoff, session file still has token → orphaned.",
            "",
            "## Minimal Tokens Remaining — Priority Order",
            "1. Write checkpoint to session memory immediately (don't wait for 10-cycle interval):",
            "     ## Checkpoint",
            "     Written: <ISO 8601>",
            "     Cycle: <count>",
            "     SID: <your SID>",
            "     Status: <idle | in-progress: task-id>",
            "     Note: forced-stop imminent — checkpoint written at hook boundary",
            "2. Call dequeue — re-enters loop, may give more time.",
            "3. If tokens remain after dequeue, DM Overseer:",
            "     \"⚠️ Context near-exhaustion. Checkpoint written. May stop uncleanly.\"",
            "",
            "## Recovery Path",
            "Next session: reads session memory → finds checkpoint → compares to handoff →",
            "checkpoint newer than handoff (or handoff blank) → follow forced-stop topic →",
            "announce unclean stop to Curator → proceed with normal startup.",
            "",
            "Full reference: skills/telegram-mcp-stop-hook-recovery/SKILL.md",
          ].join("\n"),
        });
      }

      // topic: "index" → categorized skill index and navigation menu
      if (topic === "index") {
        return toResult({
          content: [
            "Telegram Bridge MCP — Skill Index",
            "",
            "Categorized routing menu. Call help(topic: '<name>') to navigate.",
            "Call help() for tool index. Call help(topic: 'index') to return here.",
            "",
            "GETTING STARTED",
            "  help(topic: 'start')       — Post-session-start guide (profile, dequeue loop, send basics)",
            "  help(topic: 'guide')       — Full agent communication guide",
            "",
            "CORE OPERATIONS",
            "  help(topic: 'dequeue')     — Dequeue loop: heartbeat, drain, block, react rules",
            "  help(topic: 'reminders')   — Reminder-first delegation and async follow-up",
            "  help(topic: 'animation')   — Animation frames and named presets",
            "  help(topic: 'checklist')   — Checklist step status values",
            "",
            "RECOVERY",
            "  help(topic: 'compacted')   — Post-compaction recovery (token lost, context reset)",
            "  help(topic: 'forced-stop') — Forced stop detection, checkpoint pattern, restart",
            "  help(topic: 'stop-hook')   — VS Code stop hook fires — immediate action",
            "",
            "SESSION LIFECYCLE",
            "  help(topic: 'shutdown')    — Graceful shutdown (common + governor + Worker kill)",
            "  help(topic: 'orphaned')    — Close orphaned session (no active agent, SID dangling)",
            "  help(topic: 'dump')        — Session dump filing (inline + periodic)",
            "",
            "REFERENCE",
            "  help(topic: 'compression') — Message brevity tiers (None/Lite/Full/Ultra)",
            "  help(topic: 'identity')    — Bot info + MCP server version (requires token)",
            "",
            "PER-TOOL DOCS",
            "  help(topic: '<tool_name>') — Detailed docs for any registered tool (see tool index)",
            "",
            "DEEP REFERENCE",
            "  Each topic includes: Full reference: skills/<skill-name>/SKILL.md",
            "  Agents can bootstrap entirely from help() — no external skill files required on startup.",
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
