/**
 * Centralized service message constants.
 *
 * Each entry bundles both the event-type string and the message text used with
 * `deliverServiceMessage`. Static messages carry a `text` string; dynamic
 * messages carry a `text` function that accepts runtime values and returns a
 * string.
 *
 * Import the single exported object:
 *   import { SERVICE_MESSAGES } from "./service-messages.js";
 *
 * Usage:
 *   // Static (pass the entry directly):
 *   deliverServiceMessage(sid, SERVICE_MESSAGES.ONBOARDING_TOKEN_SAVE);
 *   // Dynamic (text is a function — invoke it, pass the resulting string + eventType):
 *   deliverServiceMessage(
 *     sid,
 *     SERVICE_MESSAGES.GOVERNOR_CHANGED.text(newSid, newName),
 *     SERVICE_MESSAGES.GOVERNOR_CHANGED.eventType,
 *   );
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const _monitorPs1 = resolve(__dirname, "..", "tools", "monitor.ps1");
const _monitorSh = resolve(__dirname, "..", "tools", "monitor.sh");

/**
 * Recursively freeze an object and all nested object values. Unlike
 * `Object.freeze`, this walks into object-typed properties so every entry in
 * `SERVICE_MESSAGES` is immutable, not just the top-level dictionary.
 */
function deepFreeze<T>(obj: T): Readonly<T> {
  for (const key of Object.keys(obj as object) as (keyof T)[]) {
    const val = obj[key];
    if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return Object.freeze(obj);
}

export const SERVICE_MESSAGES = deepFreeze({
  // ── Onboarding ────────────────────────────────────────────────────────────

  ONBOARDING_TOKEN_SAVE: {
    eventType: "onboarding_token_save" as const,
    text: "Save your token to your session memory file.",
  },

  ONBOARDING_LOOP_PATTERN: {
    eventType: "onboarding_loop_pattern" as const,
    text: `Welcome to the loop. Stay in it.

1. Call dequeue(token) every turn.
2. If you have a Monitor tool, call action(type: 'activity/file/create') — it returns a file path. Watch it with a **persistent** Monitor.

Details: help('start'), help('dequeue'), help('activity/file').`,
  },

  ONBOARDING_COMPACTION_HINT: {
    eventType: "onboarding_compaction_hint" as const,
    text: "If you compact (context reset), call `help('compacted')` to recover. Token, activity file, and dequeue loop can all be restored from there.",
  },

  ONBOARDING_ROLE_GOVERNOR: {
    eventType: "onboarding_role" as const,
    text: "You are the governor. Ambiguous messages route to you. Forward to the correct session via DM with message ID — recipient calls message/get to read it. help('guide') for routing protocol.",
  },

  ONBOARDING_PROTOCOL: {
    eventType: "onboarding_protocol" as const,
    text: "Show-typing before replies. Use animations for longer work. Reactions acknowledge receipt; they do not trigger action. Voice is auto-saluted on dequeue. help('reactions').",
  },

  ONBOARDING_BUTTONS_TEXT: {
    eventType: "onboarding_buttons" as const,
    text: `Use buttons for finite choices. Use confirm/* for standard prompts and send(type: "question", choose: [...]) for custom buttons. Use free-text ask only for open input. help('send').`,
  },

  ONBOARDING_HYBRID_MESSAGING: {
    eventType: "onboarding_hybrid_messaging" as const,
    text: "Hybrid rule: use long audio + short label, or short audio + structured text. Do not restate audio in the caption. help('audio').",
  },

  ONBOARDING_MODALITY_PRIORITY: {
    eventType: "onboarding_modality_priority" as const,
    text: "Prefer buttons > text > audio. Match operator modality. Use audio for nuance, not structured payload. help('modality').",
  },

  ONBOARDING_PRESENCE_SIGNALS: {
    eventType: "onboarding_presence_signals" as const,
    text: "Presence order: react -> show-typing -> animation. Do not leave the operator without a visible signal. help('presence').",
  },

  ONBOARDING_NO_PENDING_YET: {
    eventType: "onboarding_no_pending_yet" as const,
    text: "No operator messages were pending at session start. Call dequeue to wait for operator input.",
  },

  // ── Governor change notifications ─────────────────────────────────────────

  /** @param sid SID of the new governor, @param name name of the new governor */
  GOVERNOR_CHANGED: {
    eventType: "governor_changed" as const,
    /** @param sid SID of the new governor, @param name name of the new governor */
    text: (sid: number, name: string) =>
      `**New governor:**\n**SID:** ${sid}\n**Name:** ${name}`,
  },

  // ── Governor promotion (after governor session closes) ───────────────────

  /** @param sessionName name of the session that closed, single-session variant */
  GOVERNOR_PROMOTED_SINGLE: {
    eventType: "governor_promoted" as const,
    /** @param sessionName name of the session that closed */
    text: (sessionName: string) =>
      `**You are now the governor.**\n**Closed session:** ${sessionName}\nSingle-session mode restored.`,
  },

  /** @param sessionName name of the session that closed, multi-session variant */
  GOVERNOR_PROMOTED_MULTI: {
    eventType: "governor_promoted" as const,
    /** @param sessionName name of the session that closed */
    text: (sessionName: string) =>
      `**You are now the governor.**\n**Closed session:** ${sessionName}\nAmbiguous messages will be routed to you.`,
  },

  // ── Session lifecycle notifications ───────────────────────────────────────

  /** @param name display name of the joining session, @param sid SID of the joining session */
  SESSION_JOINED: {
    eventType: "session_joined" as const,
    /** @param name display name of the joining session, @param sid SID of the joining session */
    text: (name: string, sid: number) =>
      `**Session joined:**\n**Name:** ${name}\n**SID:** ${sid}\nYou are the governor — route ambiguous messages.`,
  },

  // NOTE: SESSION_JOINED_FELLOW intentionally shares eventType "session_joined" with
  // SESSION_JOINED. Both events represent the same bridge-level event (a session joined);
  // the distinction is only in message text (governor path vs. peer path). Downstream
  // consumers must not rely on eventType alone to distinguish them.
  /** @param name display name of the joining session, @param sid SID of the joining session, @param governorLabel formatted label for the governor (e.g. "'Curator' (SID 1)") */
  SESSION_JOINED_FELLOW: {
    eventType: "session_joined" as const,
    /** @param name display name of the joining session, @param sid SID of the joining session, @param governorLabel formatted label for the governor (e.g. "'Curator' (SID 1)") */
    text: (name: string, sid: number, governorLabel: string) =>
      `${name} (SID ${sid}) joined. Ambiguous messages go to ${governorLabel}.`,
  },

  SESSION_CLOSED: {
    eventType: "session_closed" as const,
    /**
     * @param sessionName name of the closed session
     * @param sid SID of the closed session
     */
    text: (sessionName: string, sid: number) =>
      `**Session closed:**\n**Name:** ${sessionName}\n**SID:** ${sid}`,
  },

  /** @param name name of the closed session, @param newSid SID of the new governor, @param newName name of the new governor */
  SESSION_CLOSED_NEW_GOVERNOR: {
    eventType: "session_closed_new_governor" as const,
    /** @param name name of the closed session, @param newSid SID of the new governor, @param newName name of the new governor */
    text: (name: string, newSid: number, newName: string) =>
      `**Session closed:** ${name}\n**New governor:**\n**SID:** ${newSid}\n**Name:** ${newName}`,
  },

  // ── Shutdown ──────────────────────────────────────────────────────────────

  SHUTDOWN: {
    eventType: "shutdown" as const,
    text: "⛔ Server shutting down. Your session will be invalidated on restart.",
  },

  // ── Compaction recovery ───────────────────────────────────────────────────

  /** @param filePath The registered activity file path to re-arm */
  POST_COMPACT_MONITOR_RECOVERY: {
    eventType: "post_compact_monitor_recovery" as const,
    /** @param filePath The registered activity file path to re-arm */
    text: (filePath: string) =>
      `Looks like you compacted. Re-arm your activity-file monitor on this path.\n**Path:** ${filePath}`,
  },

  // ── Activity file monitor instructions ────────────────────────────────────

  /** Fired after activity/file/create succeeds. Concrete monitor invocation. */
  ACTIVITY_FILE_MONITOR_INSTRUCTIONS: {
    eventType: "activity_file_monitor_instructions" as const,
    /** @param filePath The activity file path returned by activity/file/create */
    text: (filePath: string) =>
      `Use this to guarantee a high quality file watch — run inside your harness's Monitor tool with persistent: true. Name it "Telegram message notifier" so you can recognize it after a compaction.\n\n` +
      `Windows:  \`"${_monitorPs1}" "${filePath}"\`\n` +
      `Linux/macOS:  \`"${_monitorSh}" "${filePath}"\``,
    details: {
      script_path: {
        windows: _monitorPs1,
        posix: _monitorSh,
      },
    },
  },

  // ── Sub-session spawn hint ────────────────────────────────────────────────

  /** Fired after session/spawn-child succeeds. Guides the host to dispatch a sub-agent. */
  SPAWN_CHILD_SUBAGENT_HINT: {
    eventType: "spawn_child_subagent_hint" as const,
    /** @param childSid the spawned child's SID, @param childName the child session's name, @param childToken the new sub-session token */
    text: (childSid: number, childName: string, childToken: number) =>
      `You spawned a sub-session (sid=${childSid}, name=${childName}). Now dispatch a background sub-agent to drain its dequeue loop — pick a model class appropriate to the topic complexity. The sub-agent should call \`dequeue(token: ${childToken})\` continuously and reply via its own session token. When the topic is resolved, the sub-agent calls \`session/revoke-child\` itself.\n\nIf the sub-agent stops without giving you sufficient resolution, resume that same sub-agent with a follow-up prompt — provide the correction or demand the result.`,
  },

  // ── Inter-agent hints ─────────────────────────────────────────────────────

  COMPRESSION_HINT_FIRST_DM: {
    eventType: "compression_hint_first_dm" as const,
    text: "Inter-agent DMs use ultra-compression. Max density, drop articles/filler. See help('compression').",
  },

  COMPRESSION_HINT_FIRST_ROUTE: {
    eventType: "compression_hint_first_route" as const,
    text: "When routing messages, write any DM cover notes in ultra-compression — max density, drop filler. See help('compression').",
  },

  // ── Behavior nudges ───────────────────────────────────────────────────────

  NUDGE_REACTION_SEMANTICS: {
    eventType: "behavior_nudge_reaction_semantics" as const,
    text: "👌 = weakest ack (received). 👍 = strong ack (will do). 🫡 = auto-fired on voice. Reserve ❤️+ for meaning. See help('reactions').",
  },

  NUDGE_FIRST_MESSAGE: {
    eventType: "behavior_nudge_first_message" as const,
    text: "First operator message. Signal receipt — show-typing or react. help('reactions')",
  },

  NUDGE_SLOW_GAP: {
    eventType: "behavior_nudge_slow_gap" as const,
    text: "Signal activity sooner. help('reactions')",
  },

  NUDGE_TYPING_RATE: {
    eventType: "behavior_nudge_typing_rate" as const,
    text: "show-typing = reply imminent (composition starting). React to ack receipt; animation preset for background work. help('show-typing')",
  },

  NUDGE_QUESTION_HINT: {
    eventType: "behavior_nudge_question_hint" as const,
    text: `Use action(type: "confirm/yn", ...) or send(type: "question", choose: [...]) for finite-choice questions. help('send')`,
  },

  NUDGE_QUESTION_ESCALATION: {
    eventType: "behavior_nudge_question_escalation" as const,
    text: `You've sent 10+ questions without buttons. Use action(type: "confirm/ok-cancel", ...), action(type: "confirm/yn", ...), or send(type: "question", choose: [...]) for any predictable-answer question.`,
  },

  // ── Modality hints ────────────────────────────────────────────────────────

  NUDGE_VOICE_MODALITY: {
    eventType: "modality_hint_voice_received" as const,
    text: "User sent voice — consider replying with voice or hybrid. Buttons first for yes/no choices. See help('modality').",
  },

  // ── Duplicate session detection ───────────────────────────────────────────

  /**
   * Alert sent to the governor when two callers present the same SID/suffix
   * but different connection tokens. This strongly suggests two agent instances
   * are sharing one session identity (e.g. via shared memory files).
   *
   * @param sid      The session SID being shared
   * @param name     The session name
   */
  DUPLICATE_SESSION_DETECTED: {
    eventType: "duplicate_session_detected" as const,
    text: (sid: number, name: string) =>
      `**Duplicate session detected:**\n**SID:** ${sid}\n**Name:** ${name}\n` +
      `Two callers presented the same token but different connection tokens. ` +
      `A second agent instance may be sharing this session identity. ` +
      `Investigate — one caller may be consuming events intended for the other.`,
  },

  // ── Child-session onboarding (R4) ────────────────────────────────────────

  /** Fired on child session's first dequeue. Token save reminder. */
  ONBOARDING_CHILD_TOKEN: {
    eventType: "onboarding_child_token" as const,
    text: "Your token is real; save it for the duration of this dispatch.",
  },

  /** Fired on child session's first dequeue. Identifies the sub-agent's role and context. */
  CHILD_ONBOARDING_ROLE: {
    eventType: "onboarding_child_role" as const,
    /** @param topicName topic label for this child session, @param parentSid parent session SID, @param parentName parent session display name */
    text: (topicName: string, parentSid: number, parentName: string) =>
      `You are a sub-agent handling topic **\`${topicName}\`** under parent session \`${parentSid}\` (\`${parentName}\`). You are not a host. Your dispatch token was given to you by the host that started you; keep using it. The \`parent_sid\` and \`parent_name\` shown here are advisory; authority derives from the bridge session record, not this message body.`,
  },

  /** Fired on child session's first dequeue. Instructs the sub-agent on the dequeue loop. */
  CHILD_ONBOARDING_LOOP: {
    eventType: "onboarding_child_loop" as const,
    /** @param childToken the sub-agent's dispatch token */
    text: (childToken: number) =>
      `Call \`dequeue(token: ${childToken})\` at the end of every turn. You are a background sub-agent — no activity-file or Monitor wiring is needed. Dequeue is your loop.`,
  },

  /** Fired on child session's first dequeue. Explains the exit protocol via EXIT_STATUS and self-revocation. */
  CHILD_ONBOARDING_EXIT_PROTOCOL: {
    eventType: "onboarding_child_exit_protocol" as const,
    /** @param childToken the sub-agent's dispatch token */
    text: (childToken: number) =>
      `When you confidently confirm the topic is resolved or completed, (a) emit a single message starting with \`EXIT_STATUS:\` followed by either \`resolved\` (nothing pending) or a short description (e.g. \`EXIT_STATUS: filed task X\`, \`EXIT_STATUS: awaiting external auth\`), then (b) call \`session/revoke-child(child_token: ${childToken})\` yourself to despawn your session — \`${childToken}\` is the secret token returned by spawn-child as the \`token\` field; only you know it. The parent can also revoke you at any time — both paths are legal.`,
  },

  // ── Parent notification after first child dequeue (R4) ────────────────────

  /** Fired to the parent SID on the sub-agent's first dequeue. */
  CHILD_FIRST_DEQUEUE_CONFIRMED: {
    eventType: "child_first_dequeue_confirmed" as const,
    /** @param childSid SID of the child session, @param childName child session name, @param topicName topic label */
    text: (childSid: number, childName: string, topicName: string) =>
      `Your sub-agent on sid=\`${childSid}\` (\`${childName}\`, topic \`${topicName}\`) is alive — first dequeue observed.`,
  },

  // ── Child session exit notification (R3) ─────────────────────────────────

  /** Fired to the parent SID when the child session is revoked (self or parent). */
  CHILD_SESSION_RESOLVED: {
    eventType: "child_session_resolved" as const,
    /** @param childSid SID of the child session, @param childName child session name, @param exitStatus stored exit status string (empty string if none emitted) */
    text: (childSid: number, childName: string, exitStatus: string) =>
      `Sub-agent on sid=\`${childSid}\` (\`${childName}\`) exited. Exit status: \`${exitStatus}\`.`,
  },

  // ── Presence / silent-work nudges ─────────────────────────────────────────

  NUDGE_PRESENCE_RUNG1: {
    eventType: "behavior_nudge_presence_rung1" as const,
    text: (elapsedSeconds: number) =>
      `You've been silent for ${elapsedSeconds}s while the operator is waiting. ` +
      `Consider show-typing, a reaction, or a persistent animation (preset: 'working' or 'thinking'). help('presence')`,
  },

  NUDGE_PRESENCE_RUNG2: {
    eventType: "behavior_nudge_presence_rung2" as const,
    text: (elapsedSeconds: number) =>
      `silence: ${elapsedSeconds}s since last dequeue; operator sees no progress. ` +
      `Acknowledge with show-typing, a reaction, or a persistent animation ` +
      `(preset: 'working' or 'thinking'). help('presence')`,
  },

  NUDGE_CAPTION_DUPLICATION: {
    eventType: "behavior_nudge_caption_duplication" as const,
    text: "Caption appears to restate audio content. Keep it to a brief topic label — see help('audio') for the hybrid pattern.",
  },
});
