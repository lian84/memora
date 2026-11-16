import { describe, expect, it, vi } from 'vitest';
import type { ProviderModel } from '@memora/shared';
import { ModelCatalogService } from './model-catalog.js';

const piOpenCode: ProviderModel[] = [
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', provider: 'opencode-go', api: 'openai-completions', contextWindow: 1000, reasoning: true, isFree: false },
  { id: 'beam-free', name: 'Beam Free', provider: 'opencode-go', api: 'openai-completions', contextWindow: 2000, reasoning: true, isFree: true },
];
const piOpenRouter: ProviderModel[] = [
  { id: 'openrouter/free', name: 'OpenRouter Free', provider: 'openrouter', api: 'openai-completions', contextWindow: 4096, reasoning: false, isFree: true },
];

function service(fetchImpl: typeof fetch, now = () => 1000) {
  return new ModelCatalogService({
    getPiModels: async provider => provider === 'openrouter' ? piOpenRouter : piOpenCode,
    getApiKey: provider => provider === 'opencode-go' ? 'test-key' : undefined,
    fetch: fetchImpl,
    now,
    ttlMs: 1000,
  });
}

describe('ModelCatalogService', () => {
  it('prefers the Pi catalog for OpenRouter and caches it', async () => {
    const getPiModels = vi.fn(async () => piOpenRouter);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const catalog = new ModelCatalogService({ getPiModels, getApiKey: () => undefined, fetch: fetchImpl, now: () => 1, ttlMs: 1000 });
    expect((await catalog.getCatalog('openrouter')).models[0]?.id).toBe('openrouter/free');
    await catalog.getCatalog('openrouter');
    expect(getPiModels).toHaveBeenCalledTimes(1);
    await catalog.getCatalog('openrouter', true);
    expect(getPiModels).toHaveBeenCalledTimes(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches OpenCode Go remotely and enriches it with Pi metadata', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash 1017', canonical_id: 'deepseek/deepseek-v4.1-flash-1017', capabilities: { reasoning: { supported: true } }, modalities: { input: ['text', 'image'] }, limit: { context: 1_000_000, output: 384_000 }, cost: { text: { input: { price: 0.15 }, output: { price: 0.6 } } } },
      { id: 'beam-free', name: 'Beam Free', limit: { context: 2000 }, cost: { text: { input: { price: 0 }, output: { price: 0 } } } },
      { id: 'not-in-pi', name: 'Unsupported' },
    ] }), { status: 200 })) as unknown as typeof fetch;
    const catalog = service(fetchImpl);
    const result = await catalog.getCatalog('opencode-go');
    expect(result.source).toBe('remote');
    expect(result.models.map(model => model.id)).toEqual(['beam-free', 'deepseek-v4.1-flash']);
    expect(result.models[1]).toMatchObject({ api: 'openai-completions', contextWindow: 1_000_000, maxTokens: 384_000, costInput: 0.15, isFree: false });
    expect(result.models[0]?.isFree).toBe(true);
    const request = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [string, RequestInit];
    expect(request[0]).toBe('https://opencode.ai/inference/go/v1/models');
    expect(request[1].headers).toMatchObject({ Authorization: 'Bearer test-key' });
  });

  it('falls back to the last valid cache and then Pi on remote failures', async () => {
    let fail = false;
    const fetchImpl = vi.fn(async () => fail ? new Response('down', { status: 503 }) : new Response(JSON.stringify({ data: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek' }] }), { status: 200 })) as unknown as typeof fetch;
    const catalog = new ModelCatalogService({ getPiModels: async () => piOpenCode, getApiKey: () => 'key', fetch: fetchImpl, now: () => 1, ttlMs: 1000 });
    expect((await catalog.getCatalog('opencode-go')).source).toBe('remote');
    fail = true;
    const cached = await catalog.getCatalog('opencode-go', true);
    expect(cached).toMatchObject({ stale: true, source: 'remote' });
    expect(cached.warning).toContain('cache');
    const empty = new ModelCatalogService({ getPiModels: async () => piOpenCode, getApiKey: () => 'key', fetch: fetchImpl });
    const fallback = await empty.getCatalog('opencode-go');
    expect(fallback).toMatchObject({ stale: true, source: 'pi' });
    expect(fallback.models.length).toBeGreaterThan(0);
  });

  it('tests credentials through catalog/key endpoints without inference', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const catalog = service(fetchImpl as unknown as typeof fetch);
    expect(await catalog.testConnection('openrouter', 'valid-key')).toEqual({ ok: true, httpStatus: 200 });
    expect(await catalog.testConnection('opencode-go', 'bad-key')).toEqual({ ok: false, httpStatus: 401, error: 'invalid_credentials' });
    expect(await catalog.testConnection('opencode-go')).toEqual({ ok: true, httpStatus: 200 });
    const calls = (fetchImpl as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
    expect(calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/key');
    expect((calls[0]?.[1].headers as Record<string, string>).Authorization).toBe('Bearer valid-key');
    expect(calls[1]?.[0]).toBe('https://opencode.ai/inference/go/v1/models');
  });

  it('returns a sanitized missing-credential result', async () => {
    const catalog = new ModelCatalogService({ getPiModels: async () => [], getApiKey: () => undefined, fetch: vi.fn() as unknown as typeof fetch });
    expect(await catalog.testConnection('openrouter')).toEqual({ ok: false, error: 'missing_credentials' });
  });
});
