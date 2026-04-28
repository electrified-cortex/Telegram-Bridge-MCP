/**
 * Behavioral rule registry — data-driven catalog of all shaping rules.
 * New rules are data entries here; no new TMCP feature code needed.
 */

export type RuleSeverity = "hint" | "service-message";
export type RuleTrigger = "first-call" | "threshold" | "anomaly";

export interface BehaviorRuleSpec {
  /** Stable identifier, used for per-session disable overrides */
  name: string;
  /** Human-readable purpose */
  description: string;
  /** hint = envelope/trailing nudge; service-message = queued interruption */
  severity: RuleSeverity;
  /** first-call = once per session on first use; threshold = detector-based; anomaly = pattern-based */
  trigger: RuleTrigger;
  /** Stable event_type emitted when this rule fires */
  eventType: string;
  /** The help topic this rule points to */
  helpTopic?: string;
}

export const BEHAVIOR_REGISTRY: readonly BehaviorRuleSpec[] = [
  // ── Reaction semantics (Part B) ─────────────────────────────────────────
  {
    name: "reaction_semantics",
    description: "Teach reaction emoji semantics on first react() call per session",
    severity: "service-message",
    trigger: "first-call",
    eventType: "behavior_nudge_reaction_semantics",
    helpTopic: "reactions",
  },
  // ── Presence / silent-work (Part C — existing rules, documented here) ───
  {
    name: "presence_silence_rung1",
    description: "Silence > threshold: envelope hint nudging activity signal",
    severity: "hint",
    trigger: "threshold",
    eventType: "behavior_nudge_presence_rung1",
    helpTopic: "presence",
  },
  {
    name: "presence_silence_rung2",
    description: "Silence > 2× threshold: service-message escalation",
    severity: "service-message",
    trigger: "threshold",
    eventType: "behavior_nudge_presence_rung2",
    helpTopic: "presence",
  },
  // ── Existing behavior-tracker nudges (documented) ────────────────────────
  {
    name: "first_message",
    description: "Nudge reaction/typing on first operator message",
    severity: "service-message",
    trigger: "first-call",
    eventType: "behavior_nudge_first_message",
    helpTopic: "reactions",
  },
  {
    name: "slow_gap",
    description: "Nudge faster activity signal after slow response",
    severity: "service-message",
    trigger: "anomaly",
    eventType: "behavior_nudge_slow_gap",
    helpTopic: "reactions",
  },
  {
    name: "typing_rate",
    description: "Nudge show-typing before sends when typing rate is low",
    severity: "service-message",
    trigger: "anomaly",
    eventType: "behavior_nudge_typing_rate",
    helpTopic: "show-typing",
  },
  {
    name: "question_hint",
    description: "Nudge button use on first actionable question without buttons",
    severity: "service-message",
    trigger: "first-call",
    eventType: "behavior_nudge_question_hint",
    helpTopic: "send",
  },
  {
    name: "question_escalation",
    description: "Escalation after 10+ actionable questions without buttons",
    severity: "service-message",
    trigger: "anomaly",
    eventType: "behavior_nudge_question_escalation",
    helpTopic: "send",
  },
  // NOTE: tasks 15-713 (compression hints) and 15-714 (modality hints) add
  // entries for compression_hint_dm, compression_hint_route, and
  // modality_hint_voice when their branches merge.
  {
    name: "caption_duplication",
    description: "Nudge when audio+text caption Jaccard similarity ≥ 0.7 indicates restating",
    severity: "service-message",
    trigger: "anomaly",
    eventType: "behavior_nudge_caption_duplication",
    helpTopic: "audio",
  },
];
