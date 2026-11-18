import type { FastifyInstance } from 'fastify';
import type {
  AdminStatus,
  AdminSettingsUpdate,
  ProviderId,
  ReasoningLevel,
  RuntimeSettings,
  RuntimeSettingsPatch,
  RuntimeMetricsSnapshot,
} from '@memora/shared';
import { AdminSettingsStore, SettingsError } from './settings.js';
import { SecretStore, SecretStoreError } from './secrets.js';
import { ModelCatalogService } from './model-catalog.js';

interface MemoryAdminService {
  getConfiguredSearchMode(): RuntimeSettings['memory']['searchMode'];
  getActiveSearchMode(): RuntimeSettings['memory']['searchMode'];
  getRetrievalDefaults(): { topK: number; maxChars: number; maxTokens: number; diversity: number };
  getEmbeddingStatus(): AdminStatus['embeddings'];
  getStats(): { sourceCount: number; chunkCount: number; vectorCount: number };
  setSearchMode(mode: RuntimeSettings['memory']['searchMode']): void;
  setRetrievalDefaults(options: { topK?: number; maxChars?: number; maxTokens?: number; diversity?: number }): void;
}

interface CuratorAdminService {
  updateRuntimeConfig(options: { auto?: boolean; minConfidence?: number; minSalience?: number; reasoningLevel?: ReasoningLevel }): void;
}

interface QueueAdminService {
  readonly queueLength: number;
  getStats?(): { queued: number; running: number; completed: number; failed: number; attempts: number; oldestQueuedAgeMs: number | null; lastCompletedAt: number | null; lastFailedAt: number | null };
}

interface MemoryWriterAdminService {
  getStats(): Promise<{ pending: number; conflict: number; approved: number; rejected: number; total: number; approvalRate: number | null }>;
}

interface MetricsAdminService {
  snapshot(queue: { queued: number; running: number; failed: number; oldestQueuedAgeMs: number | null }, inbox: { pending: number; conflict: number }): RuntimeMetricsSnapshot;
}

interface AgentAdminService {
  setDefaultChat(provider: ProviderId, modelId: string, reasoningLevel?: ReasoningLevel): void;
  setAutoTitleEnabled(enabled: boolean): void;
  setProviderApiKey(provider: ProviderId, apiKey: string): void;
}

interface TurnAdminService {
  setMaxConcurrent(value: number): void;
}

export interface AdminRouteDependencies {
  store: AdminSettingsStore;
  memoryService: MemoryAdminService;
  curator?: CuratorAdminService;
  queue?: QueueAdminService;
  memoryWriter?: MemoryWriterAdminService;
  metrics?: MetricsAdminService;
  reloadCurator?: () => void;
  agentService: AgentAdminService;
  turns?: TurnAdminService;
  secrets: SecretStore;
  catalog: ModelCatalogService;
  dataDir: string;
  startedAt: number;
  version: string;
}

/** Applies only settings that are safe and effective without replacing services. */
export function applyLiveSettings(
  deps: Pick<AdminRouteDependencies, 'memoryService' | 'curator' | 'agentService' | 'reloadCurator' | 'turns'>,
  changed: string[],
  settings: RuntimeSettings,
): string[] {
  const applied: string[] = [];
  if (changed.some((key) => key.startsWith('memory.'))) {
    deps.memoryService.setSearchMode(settings.memory.searchMode);
    deps.memoryService.setRetrievalDefaults({
      topK: settings.memory.topK,
      maxChars: settings.memory.maxChars,
      maxTokens: settings.memory.maxTokens,
      diversity: settings.memory.diversity,
    });
    applied.push(...changed.filter((key) => key.startsWith('memory.')));
  }
  if (deps.curator) {
    const curatorKeys = changed.filter((key) =>
      key === 'curator.auto' || key === 'curator.minConfidence' || key === 'curator.minSalience' || key === 'curator.reasoningLevel');
    if (curatorKeys.length > 0) {
      deps.curator.updateRuntimeConfig({
        auto: settings.curator.auto,
        minConfidence: settings.curator.minConfidence,
        minSalience: settings.curator.minSalience,
        reasoningLevel: settings.curator.reasoningLevel,
      });
      applied.push(...curatorKeys);
    }
  }
  if (changed.some(key => key === 'curator.provider' || key === 'curator.model')) {
    deps.reloadCurator?.();
    applied.push(...changed.filter(key => key === 'curator.provider' || key === 'curator.model'));
  }
  if (changed.some(key => key === 'chat.provider' || key === 'chat.defaultModel' || key === 'chat.reasoningLevel')) {
    deps.agentService.setDefaultChat(settings.chat.provider, settings.chat.defaultModel, settings.chat.reasoningLevel);
    applied.push(...changed.filter(key => key === 'chat.provider' || key === 'chat.defaultModel' || key === 'chat.reasoningLevel'));
  }
  if (changed.includes('chat.autoTitleEnabled')) {
    deps.agentService.setAutoTitleEnabled(settings.chat.autoTitleEnabled !== false);
    applied.push('chat.autoTitleEnabled');
  }
  if (changed.includes('chat.maxConcurrentTurns') && deps.turns) {
    deps.turns.setMaxConcurrent(settings.chat.maxConcurrentTurns ?? 2);
    applied.push('chat.maxConcurrentTurns');
  }
  return applied;
}

export async function buildAdminStatus(deps: AdminRouteDependencies): Promise<AdminStatus> {
  const settings = deps.store.getSettings();
  const stats = deps.memoryService.getStats();
  const queueStats = deps.queue?.getStats?.();
  const memoryInbox = deps.memoryWriter ? await deps.memoryWriter.getStats() : { pending: 0, conflict: 0, approved: 0, rejected: 0, total: 0, approvalRate: null };
  const metrics = deps.metrics?.snapshot(
    queueStats ?? { queued: 0, running: 0, failed: 0, oldestQueuedAgeMs: null },
    memoryInbox,
  ) ?? { generatedAt: Date.now(), retrieval: { searches: 0, errors: 0, averageLatencyMs: 0, maxLatencyMs: 0, results: 0, estimatedTokens: 0 }, curator: { invoked: 0, completed: 0, declined: 0, failed: 0, invalidJson: 0, timeouts: 0 }, alerts: [] };
  return {
    memoraVersion: deps.version,
    nodeVersion: process.version,
    uptimeSeconds: Math.floor((Date.now() - deps.startedAt) / 1000),
    dataDir: deps.dataDir,
    memory: {
      configuredMode: deps.memoryService.getConfiguredSearchMode(),
      effectiveMode: deps.memoryService.getActiveSearchMode(),
      topK: deps.memoryService.getRetrievalDefaults().topK,
      maxChars: deps.memoryService.getRetrievalDefaults().maxChars,
      maxTokens: deps.memoryService.getRetrievalDefaults().maxTokens,
      diversity: deps.memoryService.getRetrievalDefaults().diversity,
    },
    chat: {
      provider: settings.chat.provider,
      model: settings.chat.defaultModel,
      reasoningLevel: settings.chat.reasoningLevel,
      autoTitleEnabled: settings.chat.autoTitleEnabled !== false,
      maxConcurrentTurns: settings.chat.maxConcurrentTurns ?? 2,
      credential: deps.secrets.getStatus(settings.chat.provider),
    },
    embeddings: deps.memoryService.getEmbeddingStatus(),
    curator: {
      enabled: settings.curator.enabled,
      auto: settings.curator.auto,
      provider: settings.curator.provider,
      model: settings.curator.model,
      reasoningLevel: settings.curator.reasoningLevel,
      credential: deps.secrets.getStatus(settings.curator.provider),
      queueLength: settings.curator.enabled && deps.queue ? deps.queue.queueLength : null,
      queueFailed: settings.curator.enabled ? queueStats?.failed ?? 0 : 0,
      queueAttempts: settings.curator.enabled ? queueStats?.attempts ?? 0 : 0,
    },
    metrics,
    memoryInbox,
    secondBrain: {
      sourceCount: stats.sourceCount,
      chunkCount: stats.chunkCount,
      vectorCount: stats.vectorCount,
    },
  };
}

function sendSettingsError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, error: unknown): unknown {
  if (error instanceof SettingsError) {
    return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}

function isProvider(value: string): value is ProviderId {
  return value === 'openrouter' || value === 'opencode-go';
}

function sendSecretError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, error: unknown): unknown {
  if (error instanceof SecretStoreError) {
    return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}

async function validateRequestedModels(
  body: unknown,
  current: RuntimeSettings,
  catalog: ModelCatalogService,
): Promise<void> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const patch = body as RuntimeSettingsPatch;
  const chat = patch.chat;
  if (chat && (chat.provider !== undefined || chat.defaultModel !== undefined)) {
    const provider = chat.provider ?? current.chat.provider;
    const modelId = chat.defaultModel ?? current.chat.defaultModel;
    const models = (await catalog.getCatalog(provider)).models;
    if (!models.some(model => model.id === modelId)) {
      throw new SettingsError('model_not_found_for_provider', `Il modello non appartiene al provider ${provider}`);
    }
  }
  const curator = patch.curator;
  if (curator && (curator.provider !== undefined || curator.model !== undefined || curator.enabled === true)) {
    const provider = curator.provider ?? current.curator.provider;
    const modelId = curator.model ?? current.curator.model;
    if (curator.enabled === true && !modelId) {
      throw new SettingsError('model_not_found_for_provider', 'Seleziona un modello Curator');
    }
    if (modelId) {
      const models = (await catalog.getCatalog(provider)).models;
      const selected = models.find(model => model.id === modelId);
      if (!selected) {
        throw new SettingsError('model_not_found_for_provider', `Il modello Curator non appartiene al provider ${provider}`);
      }
      if (provider === 'opencode-go' && selected.api !== 'openai-completions') {
        throw new SettingsError('model_not_supported_for_curator', 'Il modello Curator OpenCode Go deve supportare l’API OpenAI-compatible');
      }
      const reasoningLevel = curator.reasoningLevel ?? current.curator.reasoningLevel;
      if (selected.reasoningLevels?.length && !selected.reasoningLevels.includes(reasoningLevel)) {
        throw new SettingsError('reasoning_level_not_supported', 'Il livello di reasoning non è supportato dal modello Curator');
      }
    }
  }
}

// All administrative routes stay under /api/admin. Authentication is not part
// of this task; put a single authorization middleware here before exposing Pi
// Hub beyond localhost/Tailscale.
export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDependencies): void {
  app.get('/api/admin/settings', async (_request, reply) => {
    return reply.send(deps.store.getAdminSettings());
  });

  app.patch('/api/admin/settings', async (request, reply) => {
    try {
      await validateRequestedModels(request.body, deps.store.getSettings(), deps.catalog);
      const result = await deps.store.patch(request.body);
      const current = deps.store.getSettings();
      const appliedLive = applyLiveSettings(deps, result.changed, current);
      const response: AdminSettingsUpdate = {
        ...deps.store.getAdminSettings(),
        changed: result.changed,
        appliedLive,
        restartRequired: result.restartRequired,
      };
      app.log.info({ changed: result.changed, appliedLive, restartRequired: result.restartRequired }, 'admin settings updated');
      return reply.send(response);
    } catch (error) {
      return sendSettingsError(reply, error);
    }
  });

  app.get('/api/admin/status', async (_request, reply) => {
    return reply.send(await buildAdminStatus(deps));
  });

  app.get('/api/admin/secrets', async (_request, reply) => {
    return reply.send({
      openrouter: deps.secrets.getStatus('openrouter'),
      'opencode-go': deps.secrets.getStatus('opencode-go'),
    });
  });

  app.put<{ Params: { provider: string }; Body: { apiKey?: unknown } }>('/api/admin/providers/:provider/secret', async (request, reply) => {
    const provider = request.params.provider;
    if (!isProvider(provider)) return reply.status(400).send({ error: 'invalid_provider' });
    try {
      const status = await deps.secrets.setKey(provider, request.body?.apiKey);
      const apiKey = deps.secrets.getKey(provider);
      if (apiKey) deps.agentService.setProviderApiKey(provider, apiKey);
      if (deps.curator && deps.store.getSettings().curator.provider === provider) deps.reloadCurator?.();
      const restartRequired: string[] = [];
      app.log.info({ provider, configured: status.configured, restartRequired }, 'provider secret updated');
      return reply.send({ provider, ...status, restartRequired });
    } catch (error) {
      return sendSecretError(reply, error);
    }
  });

  app.get<{ Params: { provider: string }; Querystring: { refresh?: string } }>('/api/admin/providers/:provider/models', async (request, reply) => {
    const provider = request.params.provider;
    if (!isProvider(provider)) return reply.status(400).send({ error: 'invalid_provider' });
    return reply.send(await deps.catalog.getCatalog(provider, request.query.refresh === 'true'));
  });

  app.post<{ Params: { provider: string }; Body?: { apiKey?: unknown } }>('/api/admin/providers/:provider/test', async (request, reply) => {
    const provider = request.params.provider;
    if (!isProvider(provider)) return reply.status(400).send({ error: 'invalid_provider' });
    const supplied = typeof request.body?.apiKey === 'string' ? request.body.apiKey : undefined;
    return reply.send(await deps.catalog.testConnection(provider, supplied));
  });
}
