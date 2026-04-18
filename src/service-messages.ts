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
 *   deliverServiceMessage(sid, SERVICE_MESSAGES.GOVERNOR_CHANGED_MSG.text(newLabel), SERVICE_MESSAGES.GOVERNOR_CHANGED_MSG.eventType)
 */

export const SERVICE_MESSAGES = Object.freeze({
  // ── Onboarding ────────────────────────────────────────────────────────────

  ONBOARDING_TOKEN_SAVE: {
    eventType: "onboarding_token_save" as const,
    text: "Save your token. Write it to your session memory file now so you can reconnect after compaction or restart. Token = sid * 1_000_000 + pin. You already have it from session/start.",
  },

  ONBOARDING_ROLE_GOVERNOR: {
    eventType: "onboarding_role" as const,
    text: "You are the governor (primary session). The operator is aware of your presence. Announce yourself in chat if you wish — or stay silent until messaged. Use help('send') for communication options. Route ambiguous messages here; participant sessions DM you, not the operator.",
  },

  ONBOARDING_PROTOCOL: {
    eventType: "onboarding_protocol" as const,
    text: "Signal activity. Never go silent between receiving a message and responding. React immediately on receipt: 🫡 = salute/received (permanent), 👀 = reading/processing (5s temp), 🤔 = thinking/working (temp, clears on send), 👍 = on it (permanent). Use show-typing before every text send. Use animations for long operations. The operator judges responsiveness by what they see, not what you do internally.",
  },

  ONBOARDING_BUTTONS_TEXT: {
    eventType: "onboarding_buttons" as const,
    text:
      "Buttons first. Humans on Telegram prefer tapping over typing.\n" +
      "For yes/no and finite-choice questions, use button presets:\n" +
      "  action(type: \"confirm/ok\")        — single OK (acknowledgment/CTA)\n" +
      "  action(type: \"confirm/ok-cancel\") — OK + Cancel (destructive gate)\n" +
      "  action(type: \"confirm/yn\")        — 🟢 Yes / 🔴 No (binary decision)\n" +
      "  send(type: \"question\", choose: [...]) — custom labeled options\n" +
      "Only use send(type: \"question\", ask: \"...\") for truly free-text input.\n" +
      "Hybrid: send(type: \"text\", text: \"...\", audio: \"...\") — voice note + caption in one message. Use for important updates where the operator may be away from their phone.",
  },

  // ── Governor change notifications ─────────────────────────────────────────

  GOVERNOR_NOW_YOU: {
    eventType: "governor_changed" as const,
    text: "You are now the governor. Ambiguous messages will be routed to you.",
  },

  /** @param newLabel color+name label of the new governor session */
  GOVERNOR_NO_LONGER_YOU: {
    eventType: "governor_changed" as const,
    /** @param newLabel color+name label of the new governor session */
    text: (newLabel: string) =>
      `You are no longer the governor. ${newLabel} is now the governor.`,
  },

  /** @param newLabel color+name label of the new governor session */
  GOVERNOR_CHANGED_MSG: {
    eventType: "governor_changed" as const,
    /** @param newLabel color+name label of the new governor session */
    text: (newLabel: string) =>
      `Governor changed: ${newLabel} is now the governor.`,
  },

  /** @param targetName name of the new governor, @param targetSid SID of the new governor */
  GOVERNOR_SWITCHED: {
    eventType: "governor_changed" as const,
    /** @param targetName name of the new governor, @param targetSid SID of the new governor */
    text: (targetName: string, targetSid: number) =>
      `Governor switched: '${targetName}' (SID ${targetSid}) is now the primary session.`,
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

  // ── Session closed notifications ──────────────────────────────────────────

  SESSION_CLOSED_WITH_NEW_GOVERNOR: {
    eventType: "session_closed" as const,
    /**
     * @param sessionName name of the closed session
     * @param sid SID of the closed session
     * @param label name/label of the promoted governor
     * @param nextSid SID of the promoted governor
     */
    text: (sessionName: string, sid: number, label: string, nextSid: number) =>
      `Session '${sessionName}' (SID ${sid}) has ended. '${label}' (SID ${nextSid}) is now the governor.`,
  },

  SESSION_CLOSED: {
    eventType: "session_closed" as const,
    /**
     * @param sessionName name of the closed session
     * @param sid SID of the closed session
     */
    text: (sessionName: string, sid: number) =>
      `Session '${sessionName}' (SID ${sid}) has ended.`,
  },

  // ── Shutdown ──────────────────────────────────────────────────────────────

  SHUTDOWN: {
    eventType: "shutdown" as const,
    text: "⛔ Server shutting down. Your session will be invalidated on restart.",
  },

  // ── Behavior nudges ───────────────────────────────────────────────────────

  NUDGE_FIRST_MESSAGE: {
    eventType: "behavior_nudge_first_message" as const,
    text: "This is your first message from the operator. React to acknowledge (message_id is in the update). 👀 = processing, 👍 = on it.",
  },

  NUDGE_SLOW_GAP: {
    eventType: "behavior_nudge_slow_gap" as const,
    /** @param seconds how long the operator waited before a response */
    text: (seconds: number) =>
      `The operator waited ${seconds}s with no feedback. Signal activity sooner.`,
  },

  NUDGE_TYPING_RATE: {
    eventType: "behavior_nudge_typing_rate" as const,
    text: "Use action(type: \"show-typing\") after receiving messages to signal you're working.",
  },

  NUDGE_QUESTION_HINT: {
    eventType: "behavior_nudge_question_hint" as const,
    text: "Tip: for yes/no or finite-choice questions, use action(type: \"confirm/yn\") or choose() — the operator can tap rather than type.",
  },

  NUDGE_QUESTION_ESCALATION: {
    eventType: "behavior_nudge_question_escalation" as const,
    text: "You've sent 10+ questions without buttons. Use action(type: \"confirm/ok-cancel\"), action(type: \"confirm/yn\"), or choose() for any predictable-answer question.",
  },
} as const);
