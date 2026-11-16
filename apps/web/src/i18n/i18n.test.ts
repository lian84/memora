import { describe, expect, it } from 'vitest';
import { en } from './en';
import { fr } from './fr';

describe('UI dictionaries', () => {
  it('mantengono le stesse chiavi', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it('non contengono valori vuoti', () => {
    for (const dictionary of [en, fr]) {
      for (const value of Object.values(dictionary)) expect(value.trim().length).toBeGreaterThan(0);
    }
  });
});
