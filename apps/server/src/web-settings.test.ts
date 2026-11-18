import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSettingsStore } from './web-settings.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-web-settings-'));
  roots.push(root);
  return { root, store: new WebSettingsStore(root) };
}

describe('WebSettingsStore', () => {
  it('parte disabilitato e salva la configurazione con permessi 0600', async () => {
    const { root, store } = await fixture();
    await store.load();
    expect(store.getPublic()).toMatchObject({ enabled: false, provider: 'brave', braveConfigured: false });
    const saved = await store.update({ enabled: true, provider: 'searxng', searxngUrl: 'http://127.0.0.1:8080', braveApiKey: 'not-returned' });
    expect(saved).toMatchObject({ enabled: true, provider: 'searxng', braveConfigured: true });
    expect(JSON.stringify(saved)).not.toContain('not-returned');
    expect((await fs.stat(path.join(root, 'config/web.json'))).mode & 0o777).toBe(0o600);
    const reloaded = new WebSettingsStore(root);
    await reloaded.load();
    expect(reloaded.getConfig()).toMatchObject({ enabled: true, provider: 'searxng', braveApiKey: 'not-returned' });
  });

  it('rifiuta provider e limiti invalidi', async () => {
    const { store } = await fixture();
    await store.load();
    await expect(store.update({ provider: 'invalid' as never })).rejects.toMatchObject({ code: 'invalid_web_provider' });
    await expect(store.update({ maxResults: 100 })).rejects.toMatchObject({ code: 'invalid_web_settings' });
  });
});
