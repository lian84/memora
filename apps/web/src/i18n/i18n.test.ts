import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { fr } from './fr';

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [file] : [];
  });
}

function usedKeys(): string[] {
  const root = path.resolve('apps/web/src');
  const keys = new Set<string>();
  for (const file of sourceFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      keys.add(match[1]!.replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
    }
  }
  return [...keys];
}

describe('UI dictionaries', () => {
  it('mantengono le stesse chiavi', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it('non contengono valori vuoti', () => {
    for (const dictionary of [en, fr]) {
      for (const value of Object.values(dictionary)) expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it('coprono tutte le chiavi statiche usate nei componenti', () => {
    const missing = usedKeys().filter(key => !(key in en));
    expect(missing).toEqual([]);
  });
});
