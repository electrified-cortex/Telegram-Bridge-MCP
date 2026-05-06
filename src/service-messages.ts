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
    text: "Loop pattern — dequeue(max_wait: 300) IS the loop. Long-poll; re-call on timed_out. If you are Claude Code (or have a file-watcher harness), you should also wire up the activity-file watcher: action(type: 'activity/file/create') returns {path}; watch that path (bash: while inotifywait -qq -e close_write <path>; do <call-dequeue>; done | PS: $w=New-Object IO.FileSystemWatcher '<dir>'; $w.Filter='<file>'; Register-ObjectEvent $w Changed -Action { <call-dequeue> }); on change call dequeue(max_wait: 0). TMCP bumps mtime on every inbound. Watcher is additive — long-poll still runs alongside it. No-Monitor runtimes (VS Code Copilot, etc.): skip watcher; long-poll works fine.",
  },

  ONBOARDING_ROLE_GOVERNOR: {
    eventType: "onboarding_role" as const,
    text: "You are the governor. Ambiguous messages route to you. Forward to the correct session via DM with message ID — recipient calls message/get to read it. help('guide') for routing protocol.",
  },

  ONBOARDING_PROTOCOL: {
    eventType: "onboarding_protocol" as const,
    text: "Show-typing before every reply. For longer work, use animations. Reactions are acknowledgments, not action triggers. Voice messages are auto-saluted on dequeue — add a reaction only to convey meaning beyond receipt. help('reactions') for full protocol.",
  },

  ONBOARDING_BUTTONS_TEXT: {
    eventType: "onboarding_buttons" as const,
    text: `Buttons over typing. action(type: "confirm/ok"), action(type: "confirm/ok-cancel"), action(type: "confirm/yn") for standard prompts. send(type: "question", choose: [...]) for custom options. Free-text ask only when needed. For voice+caption, use type: "text" with audio: "..." — not a separate type. help('send') for full reference.`,
  },

  ONBOARDING_HYBRID_MESSAGING: {
    eventType: "onboarding_hybrid_messaging" as const,
    text: "Hybrid send rules: long audio + brief topic label OR short audio + long structured payload. Never restate audio content in the text caption — pick one register, not both. For voice+structured, keep caption to a topic tag only. Reference help('audio') for full hybrid protocol.",
  },

  ONBOARDING_MODALITY_PRIORITY: {
    eventType: "onboarding_modality_priority" as const,
    text: "Default modality priority: buttons > text > audio. Mirror operator modality — if they use voice, prefer voice in reply. Match the user's modality — if operator sends voice, prefer voice reply; if text, prefer text. Audio is presence and nuance, not primary information delivery. Reference help('modality') for the full priority model.",
  },

  ONBOARDING_PRESENCE_SIGNALS: {
    eventType: "onboarding_presence_signals" as const,
    text: "Presence cascade: react on receipt → show-typing for short work → animation for work exceeding show-typing's window (~20 s) or with no clear ETA. >30 s silence with no escalation is a protocol violation. Escalate to animation BEFORE show-typing's timeout expires — do not wait for it to lapse. Reference help('presence') for thresholds and presets.",
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
    text: "Show-typing after receiving messages. help('show-typing')",
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
