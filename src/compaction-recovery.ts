/**
 * Compaction recovery helper.
 *
 * When an agent compacts and comes back online, the bridge shows a "recovering"
 * animation. The first subsequent outbound action (send, show-typing, react)
 * calls `maybeReplaceRecoveringAnimation`, which replaces the recovering
 * animation with a persistent info-style "compacted" notify — once per
 * compaction cycle, never on subsequent actions.
 */

import { isRecoveringAnimation, cancelAnimation } from "./animation-state.js";
import { getHasCompacted, clearHasCompacted } from "./session-manager.js";

const COMPACTED_NOTIFY_TEXT = "ℹ️ *Compacted*";
const COMPACTED_NOTIFY_PARSE_MODE = "MarkdownV2" as const;

/**
 * If a compacted event has fired for this session and the recovering animation
 * is still visible, replaces it with a persistent "compacted" notify.
 * Returns true if the replacement was performed.
 * One-shot: clears the flag immediately to prevent duplicate fires.
 */
export async function maybeReplaceRecoveringAnimation(sid: number): Promise<boolean> {
  if (!getHasCompacted(sid) || !isRecoveringAnimation(sid)) return false;
  clearHasCompacted(sid);
  await cancelAnimation(sid, COMPACTED_NOTIFY_TEXT, COMPACTED_NOTIFY_PARSE_MODE);
  return true;
}
