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
    text: `Buttons over typing. action(type: "confirm/ok"), action(type: "confirm/ok-cancel"), action(type: "confirm/yn") for standard prompts. send(type: "question", choose: [...]) for custom options. Free-text ask only when needed. Hybrid (text + audio) for important updates. help('send') for full reference.`,
  },

  // ── Governor change notifications ─────────────────────────────────────────

  /** @param sid SID of the new governor, @param name name of the new governor */
  GOVERNOR_CHANGED: {
    eventType: "governor_changed" as const,
    /** @param sid SID of the new governor, @param name name of the new governor */
    text: (sid: number, name: string) =>
      `Governor is now SID ${sid} (${name}).`,
  },

  // ── Governor promotion (after governor session closes) ───────────────────

  /** @param sessionName name of the session that closed, single-session variant */
  GOVERNOR_PROMOTED_SINGLE: {
    eventType: "governor_promoted" as const,
    /** @param sessionName name of the session that closed */
    text: (sessionName: string) =>
      `You are now the governor (${sessionName} closed). Single-session mode restored.`,
  },

  /** @param sessionName name of the session that closed, multi-session variant */
  GOVERNOR_PROMOTED_MULTI: {
    eventType: "governor_promoted" as const,
    /** @param sessionName name of the session that closed */
    text: (sessionName: string) =>
      `You are now the governor (${sessionName} closed). Ambiguous messages will be routed to you.`,
  },

  // ── Session lifecycle notifications ───────────────────────────────────────

  /** @param name display name of the joining session, @param sid SID of the joining session */
  SESSION_JOINED: {
    eventType: "session_joined" as const,
    /** @param name display name of the joining session, @param sid SID of the joining session */
    text: (name: string, sid: number) =>
      `${name} (SID ${sid}) joined. You are the governor — route ambiguous messages.`,
  },

  SESSION_CLOSED: {
    eventType: "session_closed" as const,
    /**
     * @param sessionName name of the closed session
     * @param sid SID of the closed session
     */
    text: (sessionName: string, sid: number) =>
      `${sessionName} (SID ${sid}) closed.`,
  },

  /** @param name name of the closed session, @param newSid SID of the new governor, @param newName name of the new governor */
  SESSION_CLOSED_NEW_GOVERNOR: {
    eventType: "session_closed_new_governor" as const,
    /** @param name name of the closed session, @param newSid SID of the new governor, @param newName name of the new governor */
    text: (name: string, newSid: number, newName: string) =>
      `${name} closed. Governor is now SID ${newSid} (${newName}).`,
  },

  // ── Shutdown ──────────────────────────────────────────────────────────────

  SHUTDOWN: {
    eventType: "shutdown" as const,
    text: "⛔ Server shutting down. Your session will be invalidated on restart.",
  },

  // ── Behavior nudges ───────────────────────────────────────────────────────

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
      `Still silent after ${elapsedSeconds}s. Strongly consider starting a persistent animation ` +
      `(preset: 'working' or 'thinking') or sending a brief status message. ` +
      `The operator cannot distinguish working from stuck. help('presence')`,
  },
});
