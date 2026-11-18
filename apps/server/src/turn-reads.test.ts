import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TurnReadStore } from './turn-reads.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('TurnReadStore', () => {
  it('persiste la mappa sessioni -> turni letti e la ricarica', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-turn-reads-'));
    roots.push(root);
    const store = new TurnReadStore(root);
    await store.load();
    await store.mark('session-1', 'turn-1');
    await store.mark('session-2', 'turn-2');
    expect(store.getAll()).toEqual({ 'session-1': 'turn-1', 'session-2': 'turn-2' });

    const restarted = new TurnReadStore(root);
    await restarted.load();
    expect(restarted.getAll()).toEqual({ 'session-1': 'turn-1', 'session-2': 'turn-2' });
    const file = await fs.readFile(path.join(root, 'config', 'turn-reads.json'), 'utf8');
    expect(file).toContain('turn-1');
    expect((await fs.stat(path.join(root, 'config', 'turn-reads.json'))).mode & 0o777).toBe(0o600);
  });

  it('ignora file corrotti o voci non valide', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-turn-reads-'));
    roots.push(root);
    await fs.mkdir(path.join(root, 'config'));
    await fs.writeFile(path.join(root, 'config', 'turn-reads.json'), JSON.stringify({ version: 1, reads: { 'session-1': 'turn-1', '../bad': 'x' } }));
    const store = new TurnReadStore(root);
    await store.load();
    expect(store.getAll()).toEqual({ 'session-1': 'turn-1' });
  });
});
