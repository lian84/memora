import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AdminSettingsStore, SettingsError } from './settings.js';

const roots: string[] = [];
async function fixture(env: NodeJS.ProcessEnv = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-settings-'));
  roots.push(root);
  const warnings: string[] = [];
  const store = new AdminSettingsStore({ dataDir: root, env, warn: message => warnings.push(message) });
  await store.load();
  return { root, store, warnings, configDir: path.join(root, 'config'), filePath: path.join(root, 'config', 'settings.json') };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('AdminSettingsStore', () => {
  it('uses defaults without creating settings.json', async () => {
    const { store, filePath } = await fixture();
    const settings = store.getSettings();
    expect(settings.memory).toMatchObject({ searchMode: 'lexical', topK: 5, maxChars: 4000, maxTokens: 1000, diversity: 0.15 });
    expect(settings.embeddings.enabled).toBe(false);
    expect(settings.curator).toMatchObject({ enabled: false, auto: true, provider: 'openrouter', reasoningLevel: 'low', minConfidence: 0.75, minSalience: 0.7 });
    expect(settings.chat).toMatchObject({ provider: 'openrouter', reasoningLevel: 'medium', autoTitleEnabled: true });
    expect(store.getAdminSettings().settings.memory.searchMode).toMatchObject({ value: 'lexical', source: 'default', editable: true });
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('loads versioned file overrides and ignores unknown/invalid keys', async () => {
    const { root, store, warnings } = await fixture();
    await fs.mkdir(path.join(root, 'config'), { recursive: true });
    await fs.writeFile(path.join(root, 'config', 'settings.json'), JSON.stringify({
      version: 1,
      memory: { topK: 9, searchMode: 'not-a-mode', unknownField: true },
      curator: { minConfidence: 0.8 },
      unknownCategory: { value: 1 },
    }));
    await store.load();
    expect(store.getSettings().memory.topK).toBe(9);
    expect(store.getSettings().memory.searchMode).toBe('lexical');
    expect(store.getSettings().curator.minConfidence).toBe(0.8);
    expect(store.getAdminSettings().settings.memory.topK.source).toBe('file');
    expect(warnings.some(message => message.includes('unknown'))).toBe(true);
    expect(warnings.some(message => message.includes('invalid'))).toBe(true);
  });

  it('gives environment variables final precedence and locks fields', async () => {
    const { root, store } = await fixture({
      MEMORA_MEMORY_SEARCH_MODE: 'semantic',
      MEMORA_MEMORY_TOP_K: '11',
      MEMORA_MEMORY_MAX_TOKENS: '1500',
      MEMORA_MEMORY_DIVERSITY: '0.4',
      MEMORA_MEMORY_CURATOR_PROVIDER: 'opencode-go',
      MEMORA_CHAT_PROVIDER: 'opencode-go',
      MEMORA_EMBEDDINGS_ENABLED: 'true',
      OPENROUTER_MODEL: 'openrouter/auto',
    });
    await fs.mkdir(path.join(root, 'config'), { recursive: true });
    await fs.writeFile(path.join(root, 'config', 'settings.json'), JSON.stringify({
      version: 1,
      memory: { searchMode: 'hybrid', topK: 7 },
      embeddings: { enabled: false },
      chat: { defaultModel: 'openrouter/free' },
    }));
    await store.load();
    const admin = store.getAdminSettings();
    expect(admin.settings.memory.searchMode).toMatchObject({ value: 'semantic', source: 'environment', editable: false });
    expect(admin.settings.memory.topK).toMatchObject({ value: 11, source: 'environment', editable: false });
    expect(admin.settings.memory.maxTokens).toMatchObject({ value: 1500, source: 'environment', editable: false });
    expect(admin.settings.memory.diversity).toMatchObject({ value: 0.4, source: 'environment', editable: false });
    expect(admin.settings.embeddings.enabled).toMatchObject({ value: true, source: 'environment', editable: false });
    expect(admin.settings.chat.defaultModel).toMatchObject({ value: 'openrouter/auto', source: 'environment' });
    expect(admin.settings.chat.provider).toMatchObject({ value: 'opencode-go', source: 'environment', editable: false });
    expect(admin.settings.curator.provider).toMatchObject({ value: 'opencode-go', source: 'environment', editable: false });
    await expect(store.patch({ memory: { searchMode: 'lexical' } })).rejects.toMatchObject({ code: 'setting_managed_by_environment' });
  });

  it('supports the legacy hybrid environment flag when the new mode is absent', async () => {
    const { store } = await fixture({ MEMORA_HYBRID_SEARCH_ENABLED: 'true' });
    expect(store.getAdminSettings().settings.memory.searchMode).toMatchObject({ value: 'hybrid', source: 'environment' });
  });

  it('rejects invalid enums and ranges with structured errors', async () => {
    const { store } = await fixture();
    await expect(store.patch({ memory: { searchMode: 'invalid' as never } })).rejects.toMatchObject({ code: 'invalid_setting_value' });
    await expect(store.patch({ memory: { topK: 0 } })).rejects.toMatchObject({ code: 'invalid_setting_value' });
    await expect(store.patch({ memory: { maxChars: 100 } })).rejects.toMatchObject({ code: 'invalid_setting_value' });
    await expect(store.patch({ memory: { maxTokens: 10 } })).rejects.toMatchObject({ code: 'invalid_setting_value' });
    await expect(store.patch({ memory: { diversity: 1.2 } })).rejects.toMatchObject({ code: 'invalid_setting_value' });
    await expect(store.patch({ curator: { minConfidence: 2 } })).rejects.toMatchObject({ code: 'invalid_setting_value' });
    await expect(store.patch({ curator: { minSalience: -0.1 } })).rejects.toMatchObject({ code: 'invalid_setting_value' });
  });

  it('enforces the PATCH whitelist and rejects secret keys', async () => {
    const { store } = await fixture();
    await expect(store.patch({ memory: { unknown: true } })).rejects.toMatchObject({ code: 'unknown_setting' });
    await expect(store.patch({ unknownCategory: {} })).rejects.toMatchObject({ code: 'unknown_setting' });
    await expect(store.patch({ memory: { apiKey: 'never' } })).rejects.toBeInstanceOf(SettingsError);
    await expect(store.patch({ memory: { apiKey: 'never' } })).rejects.toMatchObject({ code: 'secret_keys_forbidden' });
    await expect(store.patch({ curator: { token: 'never' } })).rejects.toMatchObject({ code: 'secret_keys_forbidden' });
  });

  it('persists atomically with schema version and 0600 mode, then survives restart', async () => {
    const { store, configDir, filePath } = await fixture();
    const result = await store.patch({ memory: { topK: 8 }, curator: { minConfidence: 0.82 } });
    expect(result.changed).toEqual(['memory.topK', 'curator.minConfidence']);
    expect(result.restartRequired).toEqual([]);
    const files = await fs.readdir(configDir);
    expect(files).toEqual(['settings.json']);
    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8')) as Record<string, unknown>;
    expect(data).toMatchObject({ version: 1, memory: { topK: 8 }, curator: { minConfidence: 0.82 } });

    const restarted = new AdminSettingsStore({ dataDir: path.dirname(configDir), env: {} });
    await restarted.load();
    expect(restarted.getSettings().memory.topK).toBe(8);
    expect(restarted.getAdminSettings().settings.memory.topK.source).toBe('file');
  });

  it('falls back safely on corrupted or unsupported files and can later overwrite them', async () => {
    for (const content of ['{not-json', JSON.stringify({ version: 99, memory: { topK: 9 } })]) {
      const { store, filePath } = await fixture();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
      await store.load();
      expect(store.getSettings().memory.topK).toBe(5);
      expect(store.warnings.length).toBeGreaterThan(0);
      await store.patch({ memory: { topK: 6 } });
      expect(JSON.parse(await fs.readFile(filePath, 'utf-8')).version).toBe(1);
    }
  });

  it('marks embeddings, curator enable/model and provider changes as restart-required', async () => {
    const { store } = await fixture();
    const result = await store.patch({
      embeddings: { enabled: true },
      curator: { enabled: true, provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
      chat: { provider: 'opencode-go' },
    });
    expect(result.restartRequired).toEqual(['embeddings.enabled', 'curator.enabled']);
    expect(result.changed).toContain('chat.provider');
    const second = await store.patch({ embeddings: { model: 'Another/model' } });
    expect(second.restartRequired).toEqual(['embeddings.model']);
  });
});


  it('salva il toggle dei titoli automatici', async () => {
    const { store } = await fixture();
    const result = await store.patch({ chat: { autoTitleEnabled: false } });
    expect(result.changed).toEqual(['chat.autoTitleEnabled']);
    expect(store.getSettings().chat.autoTitleEnabled).toBe(false);
    expect(store.getAdminSettings().settings.chat.autoTitleEnabled).toMatchObject({ value: false, source: 'file' });
  });

  it('accepts provider-specific bare model ids and rejects unknown providers', async () => {
    const { store } = await fixture();
    const result = await store.patch({ chat: { provider: 'opencode-go', defaultModel: 'deepseek-v4.1-flash' } });
    expect(result.changed).toEqual(['chat.provider', 'chat.defaultModel']);
    expect(result.restartRequired).toEqual([]);
    await expect(store.patch({ chat: { provider: 'other-provider' as never } })).rejects.toMatchObject({ code: 'invalid_setting_value' });
  });
