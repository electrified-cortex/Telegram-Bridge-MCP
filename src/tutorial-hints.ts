import { isTutorialEnabled, markTutorialToolSeen } from "./session-manager.js";

const HINT_MAP: Record<string, string> = {
  dequeue:
    "Tip: Use dequeue(timeout: 0) to drain all pending items instantly, then dequeue() (no args) for a blocking wait — this loop is your heartbeat. If pending > 0 in the response, call again immediately.",
  send:
    "Tip: Pass both audio and text to send a voice note with a text caption — voice is heard even when the phone is face-down. Prefer audio for important or emotive messages; text alone for quick status.",
  "send:dm":
    "Tip: DMs are delivered internally between sessions and never appear in the Telegram chat. Use action(type: 'session/list') to find target session IDs; refer to the session name as an alias.",
  confirm:
    "Tip: confirm blocks until the user taps a button or the timeout expires. Drain any pending updates with dequeue(timeout: 0) before calling, or pass ignore_pending: true to proceed immediately.",
  choose:
    "Tip: choose waits for a button tap and returns { label, value }. If the user types instead, you receive { skipped: true, text_response }. Drain pending updates first or pass ignore_pending: true.",
};

const REACTION_HINT =
  "Tip: Reactions from humans are acknowledgements — they don't require a response or action unless the context makes it explicit.";

export function getTutorialKey(
  toolName: string,
  args: Record<string, unknown>
): string {
  if (toolName === "send" && args.type === "dm") return "send:dm";
  return toolName;
}

export function getTutorialHint(
  sid: number,
  toolName: string,
  args: Record<string, unknown>
): string | undefined {
  if (!isTutorialEnabled(sid)) return undefined;
  const key = getTutorialKey(toolName, args);
  if (!markTutorialToolSeen(sid, key)) return undefined;
  return HINT_MAP[key];
}

export function getTutorialReactionHint(sid: number): string | undefined {
  if (!isTutorialEnabled(sid)) return undefined;
  if (!markTutorialToolSeen(sid, "reaction")) return undefined;
  return REACTION_HINT;
}
