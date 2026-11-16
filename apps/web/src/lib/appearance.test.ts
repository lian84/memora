import { describe, expect, test } from 'vitest';
import { DEFAULT_APPEARANCE, normalizeAppearance, resolveTheme } from './appearance';

describe('appearance', () => {
  test('normalizza valori mancanti o non validi', () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ theme: 'neon', fontSize: 'huge', density: 'tiny' })).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ theme: 'dark', fontSize: 'large', wideChat: true })).toMatchObject({
      theme: 'dark', fontSize: 'large', wideChat: true,
    });
  });

  test('risolve il tema di sistema', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
