import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fastify from 'fastify';
import type { ProviderModel } from '@memora/shared';
import { AdminSettingsStore } from './settings.js';
import { SecretStore } from './secrets.js';
import { applyLiveSettings, buildAdminStatus, registerAdminRoutes, type AdminRouteDependencies } from './admin-settings.js';
import type { ModelCatalogService } from './model-catalog.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

const models: ProviderModel[] = [
  { id: 'openrouter/free', name: 'OpenRouter Free', provider: 'openrouter', isFree: true },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', provider: 'opencode-go', api: 'openai-completions', reasoningLevels: ['low', 'high', 'max'], isFree: false },
];

async function deps(env: NodeJS.ProcessEnv = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-admin-'));
  roots.push(root);
  const store = new AdminSettingsStore({ dataDir: root, env });
  await store.load();
  const secrets = new SecretStore({ dataDir: root, env });
  await secrets.load();
  let configured: 'lexical' | 'semantic' | 'hybrid' = store.getSettings().memory.searchMode;
  let effective = configured;
  const defaults = { topK: store.getSettings().memory.topK, maxChars: store.getSettings().memory.maxChars, maxTokens: store.getSettings().memory.maxTokens, diversity: store.getSettings().memory.diversity };
  const memoryService = {
    getConfiguredSearchMode: () => configured,
    getActiveSearchMode: () => effective,
    getRetrievalDefaults: () => ({ ...defaults }),
    getEmbeddingStatus: () => ({ enabled: false, available: false, model: null, loaded: false, dimensions: null }),
    getStats: () => ({ sourceCount: 2, chunkCount: 3, vectorCount: 0 }),
    setSearchMode: vi.fn((mode: typeof configured) => { configured = mode; effective = mode; }),
    setRetrievalDefaults: vi.fn((next: { topK?: number; maxChars?: number; maxTokens?: number; diversity?: number }) => { Object.assign(defaults, next); }),
  };
  const curator = { updateRuntimeConfig: vi.fn() };
  const agentService = { setDefaultChat: vi.fn(), setProviderApiKey: vi.fn(), setDefaultModel: vi.fn(), setAutoTitleEnabled: vi.fn() };
  const reloadCurator = vi.fn();
  const catalog = {
    getCatalog: vi.fn(async (provider: 'openrouter' | 'opencode-go') => ({
      provider,
      models: models.filter(model => model.provider === provider),
      cachedAt: Date.now(), source: 'pi' as const, stale: false,
    })),
    testConnection: vi.fn(async () => ({ ok: true, httpStatus: 200 })),
  } as unknown as ModelCatalogService;
  const dependencies: AdminRouteDependencies & {
    setSearchMode: typeof memoryService.setSearchMode;
    setRetrievalDefaults: typeof memoryService.setRetrievalDefaults;
    updateRuntimeConfig: typeof curator.updateRuntimeConfig;
    setDefaultChat: typeof agentService.setDefaultChat;
    setProviderApiKey: typeof agentService.setProviderApiKey;
    setAutoTitleEnabled: typeof agentService.setAutoTitleEnabled;
    testConnection: typeof catalog.testConnection;
    reloadCurator: typeof reloadCurator;
  } = {
    store, secrets, catalog, memoryService, curator, queue: { queueLength: 2 }, agentService,
    dataDir: root, startedAt: Date.now() - 1000, version: 'test-version',
    setSearchMode: memoryService.setSearchMode,
    setRetrievalDefaults: memoryService.setRetrievalDefaults,
    updateRuntimeConfig: curator.updateRuntimeConfig,
    setDefaultChat: agentService.setDefaultChat,
    setProviderApiKey: agentService.setProviderApiKey,
    setAutoTitleEnabled: agentService.setAutoTitleEnabled,
    testConnection: catalog.testConnection,
    reloadCurator,
  };
  return dependencies;
}

describe('admin settings API', () => {
  it('returns metadata, applies memory mode live and exposes status without secrets', async () => {
    const dependencies = await deps({ OPENROUTER_API_KEY: 'sk-secret-never-return', MEMORA_MEMORY_CURATOR_MODEL: '' });
    const app = fastify();
    registerAdminRoutes(app, dependencies);

    const before = await app.inject({ method: 'GET', url: '/api/admin/settings' });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json();
    expect(beforeBody.settings.memory.searchMode).toMatchObject({ value: 'lexical', source: 'default', editable: true });
    expect(beforeBody.settings.chat.provider).toMatchObject({ value: 'openrouter' });
    expect(before.body).not.toContain('sk-secret-never-return');
    expect(before.body.toLowerCase()).not.toContain('apikey');

    const updated = await app.inject({ method: 'PATCH', url: '/api/admin/settings', payload: { memory: { searchMode: 'semantic', topK: 7 } } });
    expect(updated.statusCode).toBe(200);
    const updateBody = updated.json();
    expect(updateBody.settings.memory.searchMode).toMatchObject({ value: 'semantic', source: 'file' });
    expect(updateBody.changed).toEqual(['memory.searchMode', 'memory.topK']);
    expect(updateBody.appliedLive).toEqual(['memory.searchMode', 'memory.topK']);
    expect(dependencies.setSearchMode).toHaveBeenCalledWith('semantic');
    expect(dependencies.setRetrievalDefaults).toHaveBeenCalledWith({ topK: 7, maxChars: 4000, maxTokens: 1000, diversity: 0.15 });

    const status = await app.inject({ method: 'GET', url: '/api/admin/status' });
    expect(status.statusCode).toBe(200);
    const statusBody = status.json();
    expect(statusBody.memory).toMatchObject({ configuredMode: 'semantic', effectiveMode: 'semantic', topK: 7 });
    expect(statusBody.secondBrain).toEqual({ sourceCount: 2, chunkCount: 3, vectorCount: 0 });
    expect(statusBody.chat).toMatchObject({ provider: 'openrouter', credential: { configured: true, source: 'environment' } });
    expect(status.body).not.toContain('sk-secret-never-return');
    await app.close();
  });

  it('rejects environment-locked, unknown and secret settings over HTTP', async () => {
    const dependencies = await deps({ MEMORA_MEMORY_SEARCH_MODE: 'hybrid' });
    const app = fastify();
    registerAdminRoutes(app, dependencies);

    const locked = await app.inject({ method: 'PATCH', url: '/api/admin/settings', payload: { memory: { searchMode: 'lexical' } } });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error).toBe('setting_managed_by_environment');
    const unknown = await app.inject({ method: 'PATCH', url: '/api/admin/settings', payload: { memory: { surprise: true } } });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error).toBe('unknown_setting');
    const secret = await app.inject({ method: 'PATCH', url: '/api/admin/settings', payload: { curator: { apiKey: 'bad' } } });
    expect(secret.statusCode).toBe(400);
    expect(secret.json().error).toBe('secret_keys_forbidden');
    await app.close();
  });

  it('validates provider/model pairs and applies chat default live', async () => {
    const dependencies = await deps();
    const app = fastify();
    registerAdminRoutes(app, dependencies);

    const mismatch = await app.inject({ method: 'PATCH', url: '/api/admin/settings', payload: { chat: { provider: 'opencode-go' } } });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error).toBe('model_not_found_for_provider');

    const valid = await app.inject({ method: 'PATCH', url: '/api/admin/settings', payload: { chat: { provider: 'opencode-go', defaultModel: 'deepseek-v4.1-flash' } } });
    expect(valid.statusCode).toBe(200);
    expect(valid.json().appliedLive).toEqual(['chat.provider', 'chat.defaultModel']);
    expect(dependencies.setDefaultChat).toHaveBeenCalledWith('opencode-go', 'deepseek-v4.1-flash', 'medium');
    await app.close();
  });

  it('applies Curator provider/model changes live without restart', async () => {
    const dependencies = await deps();
    const app = fastify();
    registerAdminRoutes(app, dependencies);
    const update = await app.inject({
      method: 'PATCH', url: '/api/admin/settings',
      payload: { curator: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningLevel: 'low' } },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().restartRequired).toEqual([]);
    expect(update.json().appliedLive).toEqual(['curator.provider', 'curator.model']);
    expect(dependencies.reloadCurator).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('stores provider secrets without returning the key and supports catalog/test APIs', async () => {
    const dependencies = await deps();
    const app = fastify();
    registerAdminRoutes(app, dependencies);

    const put = await app.inject({ method: 'PUT', url: '/api/admin/providers/opencode-go/secret', payload: { apiKey: 'opencode-secret-value' } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ provider: 'opencode-go', configured: true, source: 'secret-store' });
    expect(put.body).not.toContain('opencode-secret-value');
    expect(dependencies.setProviderApiKey).toHaveBeenCalledWith('opencode-go', 'opencode-secret-value');

    const list = await app.inject({ method: 'GET', url: '/api/admin/secrets' });
    expect(list.statusCode).toBe(200);
    expect(list.json()['opencode-go']).toEqual({ configured: true, source: 'secret-store', editable: true });
    expect(list.body).not.toContain('opencode-secret-value');

    const catalog = await app.inject({ method: 'GET', url: '/api/admin/providers/opencode-go/models' });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().models[0]).toMatchObject({ id: 'deepseek-v4.1-flash', provider: 'opencode-go' });

    const test = await app.inject({ method: 'POST', url: '/api/admin/providers/opencode-go/test', payload: { apiKey: 'candidate-key' } });
    expect(test.statusCode).toBe(200);
    expect(test.json()).toEqual({ ok: true, httpStatus: 200 });
    expect(dependencies.testConnection).toHaveBeenCalledWith('opencode-go', 'candidate-key');
    await app.close();
  });

  it('applica il toggle dei titoli automatici a caldo', () => {
    const agentService = { setDefaultChat: vi.fn(), setProviderApiKey: vi.fn(), setAutoTitleEnabled: vi.fn() };
    const dependencies = {
      memoryService: {
        getConfiguredSearchMode: () => 'lexical' as const,
        getActiveSearchMode: () => 'lexical' as const,
        getRetrievalDefaults: () => ({ topK: 5, maxChars: 4000, maxTokens: 1000, diversity: 0.15 }),
        getEmbeddingStatus: () => ({ enabled: false, available: false, model: null, loaded: false, dimensions: null }),
        getStats: () => ({ sourceCount: 0, chunkCount: 0, vectorCount: 0 }),
        setSearchMode: vi.fn(),
        setRetrievalDefaults: vi.fn(),
      },
      agentService,
    };
    const applied = applyLiveSettings(dependencies, ['chat.autoTitleEnabled'], {
      memory: { searchMode: 'lexical', topK: 5, maxChars: 4000, maxTokens: 1000, diversity: 0.15 },
      embeddings: { enabled: false, model: 'Owner/model' },
      curator: { enabled: false, auto: true, provider: 'openrouter', model: '', reasoningLevel: 'low', minConfidence: 0.75, minSalience: 0.7 },
      chat: { provider: 'openrouter', defaultModel: 'openrouter/free', reasoningLevel: 'medium', autoTitleEnabled: false },
    });
    expect(applied).toEqual(['chat.autoTitleEnabled']);
    expect(agentService.setAutoTitleEnabled).toHaveBeenCalledWith(false);
  });


  it('applica a caldo il limite di turni simultanei', () => {
    const turns = { setMaxConcurrent: vi.fn() };
    const dependencies = {
      memoryService: {
        getConfiguredSearchMode: () => 'lexical' as const,
        getActiveSearchMode: () => 'lexical' as const,
        getRetrievalDefaults: () => ({ topK: 5, maxChars: 4000, maxTokens: 1000, diversity: 0.15 }),
        getEmbeddingStatus: () => ({ enabled: false, available: false, model: null, loaded: false, dimensions: null }),
        getStats: () => ({ sourceCount: 0, chunkCount: 0, vectorCount: 0 }),
        setSearchMode: vi.fn(),
        setRetrievalDefaults: vi.fn(),
      },
      agentService: { setDefaultChat: vi.fn(), setProviderApiKey: vi.fn(), setAutoTitleEnabled: vi.fn() },
      turns,
    };
    const applied = applyLiveSettings(dependencies, ['chat.maxConcurrentTurns'], {
      memory: { searchMode: 'lexical', topK: 5, maxChars: 4000, maxTokens: 1000, diversity: 0.15 },
      embeddings: { enabled: false, model: 'Owner/model' },
      curator: { enabled: false, auto: true, provider: 'openrouter', model: '', reasoningLevel: 'low', minConfidence: 0.75, minSalience: 0.7 },
      chat: { provider: 'openrouter', defaultModel: 'openrouter/free', reasoningLevel: 'medium', maxConcurrentTurns: 3 },
    });
    expect(applied).toEqual(['chat.maxConcurrentTurns']);
    expect(turns.setMaxConcurrent).toHaveBeenCalledWith(3);
  });
  it('applies auto-approval settings live to the memory writer', () => {
    const memoryWriter = { getStats: vi.fn(), setAutoApprove: vi.fn() };
    const dependencies = {
      memoryService: {
        getConfiguredSearchMode: () => 'lexical' as const,
        getActiveSearchMode: () => 'lexical' as const,
        getRetrievalDefaults: () => ({ topK: 5, maxChars: 4000, maxTokens: 1000, diversity: 0.15 }),
        getEmbeddingStatus: () => ({ enabled: false, available: false, model: null, loaded: false, dimensions: null }),
        getStats: () => ({ sourceCount: 0, chunkCount: 0, vectorCount: 0 }),
        setSearchMode: vi.fn(),
        setRetrievalDefaults: vi.fn(),
      },
      agentService: { setDefaultChat: vi.fn(), setProviderApiKey: vi.fn(), setAutoTitleEnabled: vi.fn() },
      memoryWriter,
    };
    const applied = applyLiveSettings(dependencies, ['curator.autoApproveEnabled', 'curator.autoApproveMinConfidence', 'curator.autoApproveMinSalience'], {
      memory: { searchMode: 'lexical', topK: 5, maxChars: 4000, maxTokens: 1000, diversity: 0.15 },
      embeddings: { enabled: false, model: 'Owner/model' },
      curator: { enabled: false, auto: true, provider: 'openrouter', model: '', reasoningLevel: 'low', minConfidence: 0.75, minSalience: 0.7, autoApproveEnabled: true, autoApproveMinConfidence: 0.92, autoApproveMinSalience: 0.88 },
      chat: { provider: 'openrouter', defaultModel: 'openrouter/free', reasoningLevel: 'medium' },
    });
    expect(applied).toEqual(['curator.autoApproveEnabled', 'curator.autoApproveMinConfidence', 'curator.autoApproveMinSalience']);
    expect(memoryWriter.setAutoApprove).toHaveBeenCalledWith({ enabled: true, minConfidence: 0.92, minSalience: 0.88 });
  });

  it('applies curator thresholds and chat defaults live', () => {
    const dependencies = {
      memoryService: {
        getConfiguredSearchMode: () => 'lexical' as const,
        getActiveSearchMode: () => 'lexical' as const,
        getRetrievalDefaults: () => ({ topK: 5, maxChars: 4000, maxTokens: 1000, diversity: 0.15 }),
        getEmbeddingStatus: () => ({ enabled: false, available: false, model: null, loaded: false, dimensions: null }),
        getStats: () => ({ sourceCount: 0, chunkCount: 0, vectorCount: 0 }),
        setSearchMode: vi.fn(),
        setRetrievalDefaults: vi.fn(),
      },
      curator: { updateRuntimeConfig: vi.fn() },
      agentService: { setDefaultChat: vi.fn(), setProviderApiKey: vi.fn(), setAutoTitleEnabled: vi.fn() },
    };
    const applied = applyLiveSettings(dependencies, ['curator.minConfidence', 'curator.minSalience', 'curator.auto', 'chat.provider', 'chat.defaultModel'], {
      memory: { searchMode: 'lexical', topK: 5, maxChars: 4000, maxTokens: 1000, diversity: 0.15 },
      embeddings: { enabled: false, model: 'Owner/model' },
      curator: { enabled: true, auto: false, provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningLevel: 'high', minConfidence: 0.82, minSalience: 0.65 },
      chat: { provider: 'opencode-go', defaultModel: 'deepseek-v4.1-flash', reasoningLevel: 'medium' },
    });
    expect(applied).toEqual(['curator.minConfidence', 'curator.minSalience', 'curator.auto', 'chat.provider', 'chat.defaultModel']);
    expect(dependencies.agentService.setDefaultChat).toHaveBeenCalledWith('opencode-go', 'deepseek-v4.1-flash', 'medium');
    expect(dependencies.agentService.setAutoTitleEnabled).not.toHaveBeenCalled();
    expect(dependencies.curator.updateRuntimeConfig).toHaveBeenCalledWith({ auto: false, minConfidence: 0.82, minSalience: 0.65, reasoningLevel: 'high' });
    expect(dependencies.agentService.setDefaultChat).toHaveBeenCalledWith('opencode-go', 'deepseek-v4.1-flash', 'medium');
  });

  it('status reports runtime details without prompts or memory contents', async () => {
    const dependencies = await deps();
    const status = await buildAdminStatus(dependencies);
    expect(status).toMatchObject({ memoraVersion: 'test-version', memory: { configuredMode: 'lexical' }, secondBrain: { sourceCount: 2 } });
    expect(status.chat).toMatchObject({ provider: 'openrouter', model: 'openrouter/free' });
    expect(JSON.stringify(status)).not.toContain('prompt');
    expect(JSON.stringify(status)).not.toContain('content');
  });
});
