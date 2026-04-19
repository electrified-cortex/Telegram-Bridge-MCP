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
  '\u270D', // writing hand (U+270D, no VS16) — matches ALLOWED_EMOJI in set_reaction.ts
  '👨‍💻', // coding
]);

export function isTemporaryByDefault(emoji: string): boolean {
  return TEMPORARY_BY_DEFAULT.has(emoji);
}

// Built-in reaction presets.
// "processing": eyeballs flash (10s), thinking until next outbound.
// Implicit 👌 base at priority -100 is inserted separately by set_reaction.ts.
export const BUILTIN_REACTION_PRESETS = new Map<string, ReactionPresetEntry[]>([
  ['processing', [
    { emoji: '🤔', temporary: true }, // clears on next outbound
    { emoji: '👀', priority: 1, temporary: true, timeout_seconds: 10 },
  ]],
]);

export function getReactionPreset(name: string): ReactionPresetEntry[] | undefined {
  return BUILTIN_REACTION_PRESETS.get(name);
}

export function listReactionPresets(): string[] {
  return [...BUILTIN_REACTION_PRESETS.keys()];
}
