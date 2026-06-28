/**
 * Well-known message_effect_id constants (Bot API 7.4, community-verified).
 * Telegram does not expose a list-effects API method — these IDs are stable
 * but undocumented. Verify each against a live private chat before shipping.
 *
 * Effects are only available in private chats; they are no-ops in groups/channels.
 * If Telegram invalidates any ID in a future update, the stale-effect fallback
 * in send.ts will catch the 400 and deliver the message without the effect.
 */
export const MESSAGE_EFFECTS: Record<string, string> = {
  fire:        "5104841245755180586",
  thumbs_up:   "5107584321108051014",
  thumbs_down: "5104858069142078462",
  heart:       "5044134455711629726",
  celebrate:   "5046509860389126442",
  poop:        "5046589136895476101",
};

export type EffectName = keyof typeof MESSAGE_EFFECTS;
