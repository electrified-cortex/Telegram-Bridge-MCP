/**
 * Telegram message effect ID presets.
 *
 * These IDs are well-known community constants but are NOT officially documented
 * by Telegram. They should be verified in a live private chat before shipping
 * to production — effects silently fail or return 400 if an ID is no longer valid.
 *
 * Effects are only available in private chats; they are no-ops in groups/channels.
 *
 * Source: reverse-engineered from Telegram client behaviour; community consensus
 * as of 2025. If Telegram invalidates any ID in a future update, the stale-effect
 * fallback in send.ts will catch the 400 and deliver the message without the effect.
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
