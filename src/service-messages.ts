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
 *   // Static:
 *   deliverServiceMessage(sid, SERVICE_MESSAGES.ONBOARDING_TOKEN_SAVE.text, SERVICE_MESSAGES.ONBOARDING_TOKEN_SAVE.eventType)
 *   // Dynamic:
 *   deliverServiceMessage(sid, SERVICE_MESSAGES.GOVERNOR_CHANGED.text(newSid, newName), SERVICE_MESSAGES.GOVERNOR_CHANGED.eventType)
 */

export const SERVICE_MESSAGES = Object.freeze({
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
    text: `Buttons over typing. confirm/ok, confirm/ok-cancel, confirm/yn for standard prompts. send(type: "question", choose: [...]) for custom options. Free-text ask only when needed. Hybrid (text + audio) for important updates. help('send') for full reference.`,
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
    text: "Show-typing after receiving messages. help('send')",
  },

  NUDGE_QUESTION_HINT: {
    eventType: "behavior_nudge_question_hint" as const,
    text: `Use confirm/yn or choose() for finite-choice questions. help('send')`,
  },

  NUDGE_QUESTION_ESCALATION: {
    eventType: "behavior_nudge_question_escalation" as const,
    text: "You've sent 10+ questions without buttons. Use action(type: \"confirm/ok-cancel\"), action(type: \"confirm/yn\"), or choose() for any predictable-answer question.",
  },
} as const);
