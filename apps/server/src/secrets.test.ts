import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SecretStore } from './secrets.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function fixture(env: NodeJS.ProcessEnv = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-secrets-'));
  roots.push(root);
  const warnings: string[] = [];
  const store = new SecretStore({ dataDir: root, env, warn: message => warnings.push(message) });
  await store.load();
  return { root, store, warnings, filePath: path.join(root, 'config', 'secrets.json') };
}

describe('SecretStore', () => {
  it('does not create a file when no secret is saved', async () => {
    const { store, filePath } = await fixture();
    expect(store.getStatus('openrouter')).toEqual({ configured: false, source: 'none', editable: true });
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('persists only provider keys atomically with 0600 mode', async () => {
    const { store, filePath, root } = await fixture();
    const status = await store.setKey('opencode-go', 'opencode-test-key');
    expect(status).toEqual({ configured: true, source: 'secret-store', editable: true });
    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as Record<string, unknown>;
    expect(raw).toMatchObject({ version: 1, secrets: { 'opencode-go': 'opencode-test-key' } });
    expect(JSON.stringify(await fs.readdir(path.join(root, 'config')))).not.toContain('.tmp');
    const restarted = new SecretStore({ dataDir: root, env: {} });
    await restarted.load();
    expect(restarted.getKey('opencode-go')).toBe('opencode-test-key');
  });

  it('gives environment precedence and locks editing', async () => {
    const { store, filePath } = await fixture({ OPENROUTER_API_KEY: 'env-openrouter-key' });
    expect(store.getKey('openrouter')).toBe('env-openrouter-key');
    expect(store.getStatus('openrouter')).toEqual({ configured: true, source: 'environment', editable: false });
    await expect(store.setKey('openrouter', 'replacement')).rejects.toMatchObject({ code: 'secret_managed_by_environment' });
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects invalid and unsupported secrets without writing values', async () => {
    const { store } = await fixture();
    await expect(store.setKey('openrouter', '')).rejects.toMatchObject({ code: 'invalid_secret' });
    await expect(store.setKey('openrouter', 'line\nbreak')).rejects.toMatchObject({ code: 'invalid_secret' });
    await expect(store.setKey('unknown' as never, 'value')).rejects.toMatchObject({ code: 'invalid_provider' });
  });

  it('ignores corrupted files and keeps existing environment credentials', async () => {
    const { store, filePath, warnings } = await fixture({ OPENCODE_API_KEY: 'env-opencode-key' });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{broken');
    await store.load();
    expect(store.getKey('opencode-go')).toBe('env-opencode-key');
    expect(warnings.length).toBeGreaterThan(0);
  });
});
