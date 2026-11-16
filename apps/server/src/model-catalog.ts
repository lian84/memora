import type {
  ProviderCatalog,
  ProviderConnectionResult,
  ProviderId,
  ProviderModel,
  ReasoningLevel,
} from '@memora/shared';

interface CatalogDependencies {
  getPiModels(provider: ProviderId): Promise<ProviderModel[]>;
  getApiKey(provider: ProviderId): string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
}

interface CacheEntry {
  models: ProviderModel[];
  cachedAt: number;
  source: 'pi' | 'remote';
}

interface OpenCodeRemoteModel {
  id?: unknown;
  name?: unknown;
  canonical_id?: unknown;
  description?: unknown;
  type?: unknown;
  capabilities?: { reasoning?: { supported?: unknown; effort?: unknown } };
  modalities?: { input?: unknown };
  limit?: { context?: unknown; output?: unknown };
  cost?: { text?: { input?: { price?: unknown }; output?: { price?: unknown } } };
}

const OPENROUTER_KEY_ENDPOINT = 'https://openrouter.ai/api/v1/key';
const OPENCODE_MODELS_ENDPOINT = 'https://opencode.ai/inference/go/v1/models';

export class ModelCatalogService {
  private readonly cache = new Map<ProviderId, CacheEntry>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(private readonly deps: CatalogDependencies) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.ttlMs = deps.ttlMs ?? 10 * 60_000;
  }

  async getCatalog(provider: ProviderId, refresh = false): Promise<ProviderCatalog> {
    const cached = this.cache.get(provider);
    if (!refresh && cached && this.now() - cached.cachedAt < this.ttlMs) {
      return { provider, models: cached.models, cachedAt: cached.cachedAt, source: cached.source, stale: false };
    }

    if (provider === 'openrouter') {
      const models = await this.deps.getPiModels('openrouter');
      const entry = { models, cachedAt: this.now(), source: 'pi' as const };
      this.cache.set(provider, entry);
      return { provider, ...entry, stale: false };
    }

    try {
      const remote = await this.fetchOpenCodeModels();
      const piModels = await this.deps.getPiModels('opencode-go');
      const byId = new Map(piModels.map(model => [model.id, model]));
      const models = remote
        .filter((model): model is OpenCodeRemoteModel & { id: string } => typeof model.id === 'string' && model.id.length > 0)
        .filter(model => byId.size === 0 || byId.has(model.id))
        .map((model): ProviderModel => {
          const pi = byId.get(model.id);
          const inputPrice = typeof model.cost?.text?.input?.price === 'number' ? model.cost.text.input.price : pi?.costInput;
          const outputPrice = typeof model.cost?.text?.output?.price === 'number' ? model.cost.text.output.price : pi?.costOutput;
          return {
            id: model.id,
            name: typeof model.name === 'string' ? model.name : pi?.name ?? model.id,
            provider: 'opencode-go',
            api: pi?.api,
            contextWindow: typeof model.limit?.context === 'number' ? model.limit.context : pi?.contextWindow,
            maxTokens: typeof model.limit?.output === 'number' ? model.limit.output : pi?.maxTokens,
            costInput: inputPrice,
            costOutput: outputPrice,
            reasoning: model.capabilities?.reasoning?.supported === true || pi?.reasoning,
            reasoningLevels: Array.isArray(model.capabilities?.reasoning?.effort)
              ? model.capabilities.reasoning.effort.filter((level): level is ReasoningLevel => ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level as string))
              : pi?.reasoningLevels,
            isFree: inputPrice === 0 && outputPrice === 0,
            input: Array.isArray(model.modalities?.input) ? model.modalities.input.filter((item): item is string => typeof item === 'string') : pi?.input,
            canonicalId: typeof model.canonical_id === 'string' ? model.canonical_id : undefined,
            description: typeof model.description === 'string' ? model.description.slice(0, 500) : undefined,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'en'));
      if (models.length === 0) throw new Error('empty catalog');
      const entry = { models, cachedAt: this.now(), source: 'remote' as const };
      this.cache.set(provider, entry);
      return { provider, ...entry, stale: false };
    } catch {
      if (cached) {
        return {
          provider,
          models: cached.models,
          cachedAt: cached.cachedAt,
          source: cached.source,
          stale: true,
          warning: 'Catalogo remoto non disponibile; uso l’ultima cache valida.',
        };
      }
      const fallback = await this.deps.getPiModels('opencode-go');
      return {
        provider,
        models: fallback,
        cachedAt: this.now(),
        source: 'pi',
        stale: true,
        warning: 'Catalogo remoto non disponibile; uso il catalogo Pi locale.',
      };
    }
  }

  async testConnection(provider: ProviderId, suppliedKey?: string): Promise<ProviderConnectionResult> {
    const apiKey = suppliedKey?.trim() || this.deps.getApiKey(provider);
    if (!apiKey) return { ok: false, error: 'missing_credentials' };
    const endpoint = provider === 'openrouter' ? OPENROUTER_KEY_ENDPOINT : OPENCODE_MODELS_ENDPOINT;
    try {
      const response = await this.fetchImpl(endpoint, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return { ok: true, httpStatus: response.status };
      if (response.status === 401 || response.status === 403) return { ok: false, httpStatus: response.status, error: 'invalid_credentials' };
      return { ok: false, httpStatus: response.status, error: 'provider_unavailable' };
    } catch {
      return { ok: false, error: 'provider_unreachable' };
    }
  }

  private async fetchOpenCodeModels(): Promise<OpenCodeRemoteModel[]> {
    const apiKey = this.deps.getApiKey('opencode-go');
    const response = await this.fetchImpl(OPENCODE_MODELS_ENDPOINT, {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('catalog request failed');
    const body = await response.json() as { data?: unknown };
    if (!Array.isArray(body.data)) throw new Error('invalid catalog');
    return body.data.filter((item): item is OpenCodeRemoteModel => !!item && typeof item === 'object') as OpenCodeRemoteModel[];
  }
}
