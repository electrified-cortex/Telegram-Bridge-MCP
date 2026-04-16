// Reaction presets and default temporality for the Telegram MCP bridge.

export interface ReactionPresetEntry {
  emoji: string;
  priority?: number;
  temporary: boolean;
  timeout_seconds?: number;
}

// Canonical emoji that are temporary by default (when `temporary` not explicitly set).
export const TEMPORARY_BY_DEFAULT = new Set<string>([
  '🤔', // thinking
  '👀', // eyeballs / reading
  '⏳', // hourglass / working
  '✍️', // writing
  '👨‍💻', // coding
]);

export function isTemporaryByDefault(emoji: string): boolean {
  return TEMPORARY_BY_DEFAULT.has(emoji);
}

// Built-in reaction presets.
// "acknowledge": eyeballs flash (5s), thinking until next outbound, thumbs-up permanent.
export const BUILTIN_REACTION_PRESETS = new Map<string, ReactionPresetEntry[]>([
  ['acknowledge', [
    { emoji: '👍', priority: -1, temporary: false },
    { emoji: '🤔', priority: 0, temporary: true }, // clears on next outbound
    { emoji: '👀', priority: 1, temporary: true, timeout_seconds: 5 },
  ]],
]);

export function getReactionPreset(name: string): ReactionPresetEntry[] | undefined {
  return BUILTIN_REACTION_PRESETS.get(name);
}

export function listReactionPresets(): string[] {
  return [...BUILTIN_REACTION_PRESETS.keys()];
}
