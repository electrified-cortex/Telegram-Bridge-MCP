import { describe, it, expect } from 'vitest';
import { isTemporaryByDefault } from './reaction-presets.js';

describe('isTemporaryByDefault', () => {
  it('returns true for ✍ (U+270D, no VS16)', () => {
    expect(isTemporaryByDefault('\u270D')).toBe(true);
  });

  it('returns false for ✍️ (U+270D + VS16 variation selector)', () => {
    expect(isTemporaryByDefault('\u270D\uFE0F')).toBe(false);
  });

  it('returns true for other temporary-by-default emoji', () => {
    expect(isTemporaryByDefault('🤔')).toBe(true);
    expect(isTemporaryByDefault('👀')).toBe(true);
    expect(isTemporaryByDefault('⏳')).toBe(true);
  });

  it('returns false for unknown emoji', () => {
    expect(isTemporaryByDefault('🔥')).toBe(false);
  });
});
