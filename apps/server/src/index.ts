import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastify, { type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import { AgentService } from '@memora/agent';
import { AgentServiceError, REASONING_LEVELS, isOfficeArtifactKind, type MemoryCandidateStatus, type ProviderId, type ReasoningLevel, type RuntimeSettings, type SessionContextSettings } from '@memora/shared';
import { MemoryWriterQueue } from './memory-writer-queue.js';
import { AdminSettingsStore } from './settings.js';
import { RuntimeMetrics } from './metrics.js';
import { ProjectStore, registerProjectRoutes } from './projects.js';
import { McpAccountStore, registerMcpAccountRoutes } from './mcp-accounts.js';
import { McpSecretStore } from './mcp-secrets.js';
import { AutomationStore } from './automation-store.js';
import { AutomationScheduler } from './automation-scheduler.js';
import { AutomationRunner } from './automation-runner.js';
import { registerAutomationRoutes } from './automation-routes.js';
import { TelegramService, TelegramStore } from './telegram.js';
import { BackupService } from './backup.js';
import { registerBackupRoutes } from './backup-routes.js';
import { RcloneService } from './rclone.js';
import { UpdateService } from './update-check.js';
import { registerUpdateRoutes } from './update-routes.js';
import { MonitorService } from './monitor.js';
import { registerMonitorRoutes } from './monitor-routes.js';
import { DataExportService } from './export-data.js';
import { registerExportRoutes } from './export-routes.js';
import { ProjectSectionStore, registerProjectSectionRoutes } from './project-sections.js';
import { registerProjectSourceRoutes } from './project-sources.js';
import { registerProjectFileRoutes } from './project-files.js';
import { ChatAttachmentStore } from './chat-attachments.js';
import { registerChatAttachmentRoutes } from './chat-attachment-routes.js';
import { TurnManager } from './turn-manager.js';
import { TurnReadStore } from './turn-reads.js';
import { registerTurnRoutes } from './turn-routes.js';
import { SecretStore } from './secrets.js';
import { AuthStore } from './auth.js';
import { registerAuthGuard, registerAuthRoutes } from './auth-routes.js';
import { memoraEnv } from './env.js';
import { ModelCatalogService } from './model-catalog.js';
import { registerAdminRoutes } from './admin-settings.js';
import { renderDocxPreviewHtml } from './docx-preview.js';
import { WebSettingsStore, WebSettingsError } from './web-settings.js';
import { WebError, WebService } from '@memora/agent';
import { MemoryService, MemorySourceError, MemoryWriter, MemoryWriterError, MemoryCurator, OpenRouterCuratorProvider, OpenCodeGoCuratorProvider, TransformersEmbeddingService, DEFAULT_EMBEDDING_DIMENSIONS } from '@memora/memory';

const app = fastify({ logger: true });

function sendMemorySourceError(reply: FastifyReply, err: unknown) {
  if (err instanceof MemorySourceError) {
    if (err.code === 'source_not_found') {
      return reply.status(404).send({ error: err.code, message: err.message });
    }
    if (err.code === 'source_forbidden') {
      return reply.status(403).send({ error: err.code, message: err.message });
    }
    if (err.code === 'invalid_source_content') {
      return reply.status(400).send({ error: err.code, message: err.message });
    }
    return reply.status(400).send({ error: err.code, message: err.message });
  }
  app.log.error(err);
  return reply.status(500).send({ error: 'memory_source_failed' });
}

function sendMemoryWriterError(reply: FastifyReply, err: unknown) {
  if (err instanceof MemoryWriterError) {
    if (err.code === 'candidate_not_found') {
      return reply.status(404).send({ error: err.code, message: err.message });
    }
    if (err.code === 'candidate_not_reviewable') {
      return reply.status(409).send({ error: err.code, message: err.message });
    }
    if (err.code === 'memory_changed') return reply.status(409).send({ error: err.code, message: err.message });
    if (err.code === 'invalid_target_path' || err.code === 'invalid_candidate' || err.code === 'sensitive_content') {
      return reply.status(400).send({ error: err.code, message: err.message });
    }
    return reply.status(400).send({ error: err.code, message: err.message });
  }
  app.log.error(err);
  return reply.status(500).send({ error: 'memory_candidate_failed' });
}

function sendAgentProfileError(reply: FastifyReply, err: unknown) {
  if (err instanceof AgentServiceError) {
    if (err.code === 'agent_profile_not_found' || err.code === 'agent_skill_not_found') return reply.status(404).send({ error: err.code, message: err.message });
    if (err.code === 'agent_profile_exists') return reply.status(409).send({ error: err.code, message: err.message });
    if (err.code === 'invalid_agent_profile' || err.code === 'invalid_agent_skill') return reply.status(400).send({ error: err.code, message: err.message });
  }
  app.log.error(err);
  return reply.status(500).send({ error: 'agent_profile_failed' });
}

// --- Configurazione da environment (nessun percorso hardcoded) ---
const host = memoraEnv('HOST') ?? '127.0.0.1';
const port = Number(memoraEnv('PORT') ?? 3000);
const dataDir = memoraEnv('DATA_DIR') ?? './data';
const cwd = memoraEnv('CWD') ?? process.cwd();
const assistantCwdValue = memoraEnv('ASSISTANT_CWD');
const assistantCwd = assistantCwdValue ? path.resolve(assistantCwdValue) : undefined;
const memoryWriterEnabled = memoraEnv('MEMORY_WRITER_ENABLED') === 'true';
const startedAt = Date.now();
const memoraVersion = memoraEnv('VERSION') ?? '0.0.0';
const isProduction = process.env.NODE_ENV === 'production';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultWebDistDir = path.resolve(moduleDir, '../../dist/web');
const webDistDirValue = memoraEnv('WEB_DIST_DIR');
const webDistDir = webDistDirValue ? path.resolve(webDistDirValue) : defaultWebDistDir;

const authStore = new AuthStore(dataDir);
await authStore.load();
const secureAuthCookie = memoraEnv('COOKIE_SECURE') === 'true';
registerAuthGuard(app, { store: authStore, secureCookie: secureAuthCookie });
if (authStore.setupRequired) app.log.warn('Nessuna password configurata: Memora è in modalità setup e le API sono bloccate.');

const secretStore = new SecretStore({ dataDir, env: process.env, warn: message => app.log.warn(message) });
await secretStore.load();
const openRouterApiKey = secretStore.getKey('openrouter') ?? '';
if (!secretStore.getKey('openrouter') && !secretStore.getKey('opencode-go')) {
  app.log.warn('Nessuna API key provider configurata: le chiamate chat/curator falliranno finché non ne viene salvata una.');
}

const settingsStore = new AdminSettingsStore({ dataDir, env: process.env, warn: message => app.log.warn(message) });
await settingsStore.load();
const initialSettings = settingsStore.getSettings();
const embeddingsEnabled = initialSettings.embeddings.enabled;
const embeddingDimensions = Number(memoraEnv('EMBEDDING_DIMENSIONS') ?? DEFAULT_EMBEDDING_DIMENSIONS);
const embeddingModel = initialSettings.embeddings.model;
const projectStore = new ProjectStore(dataDir, message => app.log.warn(message));
const mcpAccountStore = new McpAccountStore(dataDir);
const mcpSecretStore = new McpSecretStore(dataDir);
const projectSectionStore = new ProjectSectionStore(dataDir, message => app.log.warn(message));
const chatAttachmentStore = new ChatAttachmentStore(dataDir);
const runtimeMetrics = new RuntimeMetrics();
const memoryService = new MemoryService(dataDir, {
  embeddings: embeddingsEnabled ? new TransformersEmbeddingService(dataDir, {
    model: embeddingModel,
    dimensions: embeddingDimensions,
  }) : undefined,
  searchMode: initialSettings.memory.searchMode,
  topK: initialSettings.memory.topK,
  maxChars: initialSettings.memory.maxChars,
  maxTokens: initialSettings.memory.maxTokens,
  diversity: initialSettings.memory.diversity,
  sourceFilter: (relativePath, projectId) => projectId ? projectStore.matchesSource(projectId, relativePath) : true,
  onRetrieval: metric => runtimeMetrics.recordRetrieval(metric),
  warn: message => app.log.warn(message),
});
await memoryService.initialize();
const effectiveSearchMode = memoryService.getActiveSearchMode();
app.log.info(`Memory retrieval: ${effectiveSearchMode}${effectiveSearchMode === 'lexical' ? '' : ` | Embedding model: ${embeddingModel}`}`);

const curatorEnabled = initialSettings.curator.enabled;
function buildCuratorProvider(settings: RuntimeSettings) {
  return settings.curator.provider === 'opencode-go'
    ? new OpenCodeGoCuratorProvider(settings.curator.model, secretStore.getKey('opencode-go') ?? '', settings.curator.reasoningLevel)
    : new OpenRouterCuratorProvider(settings.curator.model, secretStore.getKey('openrouter') ?? '', { reasoningLevel: settings.curator.reasoningLevel });
}
const curator = curatorEnabled ? new MemoryCurator(
  buildCuratorProvider(initialSettings),
  memoryService,
  {
    auto: initialSettings.curator.auto,
    minConfidence: initialSettings.curator.minConfidence,
    minSalience: initialSettings.curator.minSalience,
    reasoningLevel: initialSettings.curator.reasoningLevel,
    log: diagnostic => {
      runtimeMetrics.recordCurator(diagnostic.event);
      if (diagnostic.event.endsWith('_failure') || diagnostic.event === 'curator_timeout' || diagnostic.event === 'curator_invalid_json') app.log.warn(diagnostic, 'memory curator');
      else app.log.info(diagnostic, 'memory curator');
    },
  },
) : undefined;
const memoryWriter = new MemoryWriter({
  dataDir,
  memoryService,
  automaticExtraction: memoryWriterEnabled,
  curator,
  autoApprove: {
    enabled: initialSettings.curator.autoApproveEnabled === true,
    minConfidence: initialSettings.curator.autoApproveMinConfidence ?? 0.9,
    minSalience: initialSettings.curator.autoApproveMinSalience ?? 0.85,
  },
});
await memoryWriter.initialize();
const memoryWriterQueue = curatorEnabled ? new MemoryWriterQueue(memoryWriter, (event, depth) => {
  if (event === 'failed' || event === 'rejected') app.log.warn({ event: `memory_queue_${event}`, depth }, 'memory queue');
  else app.log.info({ event: `memory_queue_${event}`, depth }, 'memory queue');
}, {
  dataDir,
  maxAttempts: Number(memoraEnv('MEMORY_QUEUE_MAX_ATTEMPTS') ?? 3),
  retryDelayMs: Number(memoraEnv('MEMORY_QUEUE_RETRY_DELAY_MS') ?? 5_000),
}) : undefined;
await memoryWriterQueue?.initialize();
if (memoryWriterQueue) app.log.info({ event: 'memory_queue_recovered', ...memoryWriterQueue.getStats() }, 'memory queue');

const reloadCurator = () => {
  if (!curator || !memoryWriterQueue) return;
  curator.setProvider(buildCuratorProvider(settingsStore.getSettings()));
  app.log.info('memory curator provider reloaded');
};

const webSettingsStore = new WebSettingsStore(dataDir);
await webSettingsStore.load();
const webService = new WebService(() => webSettingsStore.getConfig());

const mcpRuntime = {
  async listAccounts() {
    const accounts = await mcpAccountStore.list();
    const runtime = [];
    for (const account of accounts) {
      let token: string | undefined;
      if (account.secretRef.startsWith('env:')) token = process.env[account.secretRef.slice(4)];
      else if (account.secretRef.startsWith('secret:')) token = await mcpSecretStore.get(account.id);
      if (!token) continue;
      runtime.push({ id: account.id, serverId: account.serverId, label: account.label, token, defaultForServer: account.defaultForServer });
    }
    return runtime;
  },
};

const agentService = new AgentService({
  dataDir,
  cwd,
  assistantCwd,
  openRouterApiKey,
  openRouterModel: initialSettings.chat.defaultModel,
  chatProvider: initialSettings.chat.provider,
  providerApiKeys: {
    openrouter: secretStore.getKey('openrouter'),
    'opencode-go': secretStore.getKey('opencode-go'),
  },
  memoryService,
  memoryWriter: memoryWriterQueue ?? memoryWriter,
  projectStore,
  webService,
  autoTitleEnabled: initialSettings.chat.autoTitleEnabled !== false,
  mcpRuntime,
});

const telegramStore = new TelegramStore({ dataDir, warn: message => app.log.warn(message) });
await telegramStore.load();
const telegramService = new TelegramService(telegramStore);
const updateService = new UpdateService({
  dataDir,
  currentVersion: memoraVersion,
  log: (event, details) => app.log.info({ event, ...(details ?? {}) }, 'update'),
  notify: async status => {
    const account = telegramService.resolveAccount();
    if (!account || !account.enabled || !account.chatId || !account.tokenConfigured) return false;
    await telegramService.send(
      `🚀 Nuova versione Memora disponibile\nInstallata: ${status.currentVersion}\nDisponibile: ${status.latestVersion ?? '—'}${status.releaseUrl ? `\n${status.releaseUrl}` : ''}`,
      account.id,
    );
    return true;
  },
});
await updateService.load();
const automationStore = new AutomationStore({ dataDir, warn: message => app.log.warn(message) });
await automationStore.load();
const recoveredAutomationRuns = await automationStore.recoverInterruptedRuns();
if (recoveredAutomationRuns > 0) app.log.warn({ count: recoveredAutomationRuns }, 'automation runs marked interrupted after restart');
const automationRunner = new AutomationRunner({
  store: automationStore,
  agentService,
  telegram: telegramService,
  log: (event, details) => app.log.info({ event, ...(details ?? {}) }, 'automations'),
});
const automationScheduler = new AutomationScheduler({
  store: automationStore,
  runner: automationRunner,
  log: (event, details) => app.log.info({ event, ...(details ?? {}) }, 'automations'),
});

const turnManager = new TurnManager({
  agentService,
  maxConcurrent: initialSettings.chat.maxConcurrentTurns ?? 2,
  persistencePath: path.join(dataDir, 'config', 'turns.json'),
});
await turnManager.load();
const turnReadStore = new TurnReadStore(dataDir);
await turnReadStore.load();

const backupService = new BackupService({
  dataDir,
  appVersion: memoraVersion,
  log: (event, details) => app.log.info({ event, ...(details ?? {}) }, 'backup'),
  isIdle: () => turnManager.isIdle()
    && automationScheduler.isIdle()
    && (memoryWriterQueue?.getStats().queued ?? 0) === 0
    && (memoryWriterQueue?.getStats().running ?? 0) === 0,
});
await backupService.load();
const rcloneService = new RcloneService({
  dataDir,
  backupDir: backupService.backupDir,
  getBackups: () => backupService.listBackups(),
  log: (event, details) => app.log.info({ event, ...(details ?? {}) }, 'backup-remote'),
});
await rcloneService.load();
backupService.setAfterBackup(record => rcloneService.afterBackup(record));
const monitorService = new MonitorService({
  dataDir,
  getBackupStatus: () => backupService.getStatus(),
  getRemoteStatus: () => rcloneService.status(),
  getJobs: () => automationStore.listJobs(),
  log: (event, details) => app.log.info({ event, ...(details ?? {}) }, 'monitor'),
  notify: async alerts => {
    const account = telegramService.resolveAccount();
    if (!account || !account.enabled || !account.chatId || !account.tokenConfigured) return false;
    const lines = alerts.slice(0, 8).map(alert => `${alert.severity === 'critical' ? '🚨' : '⚠️'} ${alert.title}\n${alert.detail}`);
    await telegramService.send(`Memora monitor\n\n${lines.join('\n\n')}`, account.id);
    return true;
  },
});
await monitorService.load();
const dataExportService = new DataExportService({
  dataDir,
  appVersion: memoraVersion,
  log: (event, details) => app.log.info({ event, ...(details ?? {}) }, 'export'),
});
try {
  await dataExportService.initialize();
} catch (error) {
  app.log.warn({ error: error instanceof Error ? error.message : String(error) }, 'data export directory unavailable');
}

registerBackupRoutes(app, { backups: backupService, remote: rcloneService });
registerUpdateRoutes(app, { updates: updateService });
registerMonitorRoutes(app, { monitor: monitorService });
registerExportRoutes(app, { exports: dataExportService });

// Durante uno snapshot nessuna richiesta applicativa deve modificare i dati.
// Le API di stato/auth e la stessa area backup restano raggiungibili.
app.addHook('onRequest', async (request, reply) => {
  if (!backupService.isMaintenance()) return;
  const pathname = request.url.split('?')[0] ?? '';
  if (!pathname.startsWith('/api/')) return;
  if (pathname === '/api/health' || pathname.startsWith('/api/auth/') || pathname.startsWith('/api/admin/backup')) return;
  return reply.status(503).send({ error: 'maintenance', message: 'Backup in corso: riprova tra poco' });
});

const catalog = new ModelCatalogService({
  getPiModels: provider => agentService.getProviderModels(provider),
  getApiKey: provider => secretStore.getKey(provider),
});

registerAutomationRoutes(app, { store: automationStore, scheduler: automationScheduler, telegramStore, telegram: telegramService, log: (event, details) => app.log.info({ event, ...(details ?? {}) }, 'automations') });

registerAdminRoutes(app, {
  store: settingsStore,
  secrets: secretStore,
  catalog,
  memoryService,
  curator,
  queue: memoryWriterQueue,
  memoryWriter,
  metrics: runtimeMetrics,
  reloadCurator,
  agentService,
  turns: turnManager,
  dataDir,
  startedAt,
  version: memoraVersion,
});

// --- Health ---
registerProjectRoutes(app, { projects: projectStore, sections: projectSectionStore });
registerMcpAccountRoutes(app, { accounts: mcpAccountStore, secrets: mcpSecretStore });
registerProjectSectionRoutes(app, { sections: projectSectionStore, projects: projectStore });
registerProjectSourceRoutes(app, { projects: projectStore, memory: memoryService, writer: memoryWriter, agentService, dataDir });
registerProjectFileRoutes(app, { dataDir, projects: projectStore });
registerChatAttachmentRoutes(app, { store: chatAttachmentStore, agentService, dataDir, projects: projectStore });
registerTurnRoutes(app, {
  turns: turnManager,
  chatAttachmentStore,
  hasSession: sessionId => agentService.hasSession(sessionId),
  reads: turnReadStore,
});

app.get('/api/health', async () => {
  return { status: 'ok', service: 'memora' };
});

registerAuthRoutes(app, { store: authStore, secureCookie: secureAuthCookie });

app.get('/api/web/status', async (_request, reply) => {
  const config = webSettingsStore.getPublic();
  return reply.send({ configured: config.enabled && (config.provider === 'searxng' ? Boolean(config.searxngUrl) : config.braveConfigured), enabled: config.enabled, provider: config.provider });
});

app.get('/api/admin/web', async (_request, reply) => {
  return reply.send({ settings: webSettingsStore.getPublic() });
});

app.patch<{ Body: Record<string, unknown> }>('/api/admin/web', async (request, reply) => {
  try {
    const body = request.body ?? {};
    const settings = await webSettingsStore.update({
      ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
      ...(body.provider === 'brave' || body.provider === 'searxng' ? { provider: body.provider } : {}),
      ...(typeof body.maxResults === 'number' ? { maxResults: body.maxResults } : {}),
      ...(typeof body.maxChars === 'number' ? { maxChars: body.maxChars } : {}),
      ...(typeof body.timeoutMs === 'number' ? { timeoutMs: body.timeoutMs } : {}),
      ...(typeof body.searxngUrl === 'string' ? { searxngUrl: body.searxngUrl } : {}),
      ...(typeof body.braveApiKey === 'string' ? { braveApiKey: body.braveApiKey.trim() } : {}),
    });
    return reply.send({ settings });
  } catch (err) {
    if (err instanceof WebSettingsError) return reply.status(400).send({ error: err.code, message: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'web_settings_failed' });
  }
});

app.post('/api/admin/web/test', async (_request, reply) => {
  try {
    const results = await webService.search('Memora self-hosted personal assistant');
    return reply.send({ ok: true, results: results.slice(0, 2) });
  } catch (err) {
    if (err instanceof WebError) return reply.status(400).send({ error: err.code, message: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'web_test_failed' });
  }
});

app.get<{ Params: { id: string } }>('/api/sessions/:id/web', async (req, reply) => {
  try {
    return reply.send({ enabled: await agentService.getSessionWebEnabled(req.params.id) });
  } catch (err) {
    if (err instanceof AgentServiceError && err.code === 'session_not_found') return reply.status(404).send({ error: err.code });
    app.log.error(err);
    return reply.status(500).send({ error: 'web_session_failed' });
  }
});

app.patch<{ Params: { id: string }; Body: { enabled?: unknown } }>('/api/sessions/:id/web', async (req, reply) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') return reply.status(400).send({ error: 'invalid_web_setting' });
    const config = webSettingsStore.getConfig();
    if (req.body.enabled && (!config.enabled || (config.provider === 'brave' ? !config.braveApiKey : !config.searxngUrl))) {
      return reply.status(409).send({ error: 'web_not_configured' });
    }
    return reply.send({ enabled: await agentService.setSessionWebEnabled(req.params.id, req.body.enabled) });
  } catch (err) {
    if (err instanceof AgentServiceError && err.code === 'session_not_found') return reply.status(404).send({ error: err.code });
    app.log.error(err);
    return reply.status(500).send({ error: 'web_session_failed' });
  }
});

app.get<{ Params: { id: string } }>('/api/sessions/:id/web/sources', async (req, reply) => {
  try {
    return reply.send({ sources: await agentService.getWebSources(req.params.id) });
  } catch (err) {
    if (err instanceof AgentServiceError && err.code === 'session_not_found') return reply.status(404).send({ error: err.code });
    app.log.error(err);
    return reply.status(500).send({ error: 'web_sources_failed' });
  }
});

// --- Lista sessioni ---
app.get('/api/sessions', async (req, reply) => {
  try {
    // `archived=true` è una vista filtrata: non include le sessioni attive.
    // `includeArchived=true` restituisce attive e archiviate per la sidebar dei progetti.
    const query = req.query as { archived?: string; includeArchived?: string };
    const onlyArchived = query.archived === 'true';
    const includeArchived = query.includeArchived === 'true';
    const sessions = await agentService.listSessions(onlyArchived, includeArchived);
    return reply.send({ sessions });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'session_list_failed' });
  }
});

// --- Rinomina sessione (imposta/rimuove nome visualizzabile) ---
app.patch<{ Params: { id: string }; Body: { name?: string | null } }>(
  '/api/sessions/:id',
  async (req, reply) => {
    try {
      const name = req.body.name ?? '';
      const result = await agentService.renameSession(req.params.id, name);
      return reply.send(result);
    } catch (err) {
      if (err instanceof AgentServiceError && err.code === 'session_not_found') {
        return reply.status(404).send({ error: err.code });
      }
      if (err instanceof AgentServiceError && err.code === 'session_not_persisted') {
        return reply.status(409).send({ error: err.code, message: err.message });
      }
      app.log.error(err);
      return reply.status(500).send({ error: 'session_rename_failed' });
    }
  }
);

// --- Archivia / ripristina sessione ---
app.patch<{ Params: { id: string }; Body: { archived: boolean } }>(
  '/api/sessions/:id/archive',
  async (req, reply) => {
    try {
      const result = await agentService.setSessionArchived(req.params.id, req.body.archived);
      return reply.send(result);
    } catch (err) {
      if (err instanceof AgentServiceError && err.code === 'session_not_found') {
        return reply.status(404).send({ error: err.code });
      }
      if (err instanceof AgentServiceError && err.code === 'session_not_persisted') {
        return reply.status(409).send({ error: err.code, message: err.message });
      }
      app.log.error(err);
      return reply.status(500).send({ error: 'session_archive_failed' });
    }
  }
);

// --- Elimina definitivamente sessione ---
app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
  try {
    const result = await agentService.deleteSession(req.params.id);
    await chatAttachmentStore.removeSession(req.params.id);
    await agentService.removeArtifacts(req.params.id);
    return reply.send({ ...result, deleted: true });
  } catch (err) {
    if (err instanceof AgentServiceError && err.code === 'session_not_found') {
      return reply.status(404).send({ error: err.code });
    }
    if (err instanceof AgentServiceError && err.code === 'session_delete_forbidden') {
      return reply.status(403).send({ error: err.code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'session_delete_failed' });
  }
});

// --- Profili agente disponibili ---
app.get('/api/agents', async (_req, reply) => {
  try {
    return reply.send({ profiles: await agentService.listAgentProfiles() });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'agent_profiles_failed' });
  }
});

// --- Crea sessione ---
app.post('/api/sessions', async (req, reply) => {
  try {
    const body = req.body as { modelId?: string; provider?: string; reasoningLevel?: string; projectId?: string; agentProfileId?: string } | undefined;
    if (body?.provider && body.provider !== 'openrouter' && body.provider !== 'opencode-go') return reply.status(400).send({ error: 'invalid_provider' });
    if (body?.reasoningLevel && !REASONING_LEVELS.includes(body.reasoningLevel as ReasoningLevel)) return reply.status(400).send({ error: 'invalid_reasoning_level' });
    if (body?.projectId !== undefined && (typeof body.projectId !== 'string' || !body.projectId)) return reply.status(400).send({ error: 'invalid_project_id' });
    if (body?.agentProfileId !== undefined && (typeof body.agentProfileId !== 'string' || !body.agentProfileId)) return reply.status(400).send({ error: 'invalid_agent_profile' });
    const result = await agentService.createSession(body?.modelId, body?.provider as ProviderId | undefined, body?.reasoningLevel as ReasoningLevel | undefined, body?.projectId, body?.agentProfileId);
    return reply.status(201).send(result);
  } catch (err) {
    if (err instanceof AgentServiceError && err.code === 'project_not_found') return reply.status(404).send({ error: err.code });
    if (err instanceof AgentServiceError && err.code === 'project_archived') return reply.status(409).send({ error: err.code });
    if (err instanceof AgentServiceError && (err.code === 'agent_profile_not_found' || err.code === 'invalid_agent_profile')) return reply.status(err.code === 'agent_profile_not_found' ? 404 : 400).send({ error: err.code });
    app.log.error(err);
    return reply.status(500).send({ error: 'session_create_failed' });
  }
});

// --- Gestione amministrativa dei profili agente ---
app.get('/api/admin/agents', async (_req, reply) => {
  try {
    return reply.send({ profiles: await agentService.listAgentProfiles() });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'agent_profiles_failed' });
  }
});

app.get<{ Params: { id: string } }>('/api/admin/agents/:id', async (req, reply) => {
  try {
    return reply.send({ profile: await agentService.getAgentProfileDetail(req.params.id) });
  } catch (err) {
    return sendAgentProfileError(reply, err);
  }
});

app.post<{ Body: Record<string, unknown> | undefined }>('/api/admin/agents', async (req, reply) => {
  try {
    return reply.status(201).send({ profile: await agentService.createAgentProfile(req.body ?? {}) });
  } catch (err) {
    return sendAgentProfileError(reply, err);
  }
});

app.patch<{ Params: { id: string }; Body: Record<string, unknown> | undefined }>('/api/admin/agents/:id', async (req, reply) => {
  try {
    return reply.send({ profile: await agentService.updateAgentProfile(req.params.id, req.body ?? {}) });
  } catch (err) {
    return sendAgentProfileError(reply, err);
  }
});

app.delete<{ Params: { id: string }; Querystring: { confirm?: string } }>('/api/admin/agents/:id', async (req, reply) => {
  try {
    if (!req.query.confirm || req.query.confirm !== req.params.id) return reply.status(400).send({ error: 'invalid_agent_profile_confirmation' });
    return reply.send(await agentService.deleteAgentProfile(req.params.id, req.query.confirm));
  } catch (err) {
    return sendAgentProfileError(reply, err);
  }
});

app.post<{ Params: { id: string }; Body: Record<string, unknown> | undefined }>('/api/admin/agents/:id/skills', async (req, reply) => {
  try {
    return reply.send({ profile: await agentService.saveAgentSkill(req.params.id, req.body ?? {}) });
  } catch (err) {
    return sendAgentProfileError(reply, err);
  }
});

app.delete<{ Params: { id: string; skill: string }; Querystring: { confirm?: string } }>('/api/admin/agents/:id/skills/:skill', async (req, reply) => {
  try {
    if (!req.query.confirm || req.query.confirm !== req.params.skill) return reply.status(400).send({ error: 'invalid_agent_skill_confirmation' });
    return reply.send(await agentService.deleteAgentSkill(req.params.id, req.params.skill, req.query.confirm));
  } catch (err) {
    return sendAgentProfileError(reply, err);
  }
});

// --- Applica la versione corrente del profilo a una chat esistente ---
app.post<{ Params: { id: string } }>('/api/sessions/:id/agent/refresh', async (req, reply) => {
  try {
    return reply.send(await agentService.refreshSessionAgent(req.params.id));
  } catch (err) {
    if (err instanceof AgentServiceError) {
      if (err.code === 'session_not_found' || err.code === 'agent_profile_not_found') return reply.status(404).send({ error: err.code, message: err.message });
      if (err.code === 'agent_not_configured' || err.code === 'agent_busy') return reply.status(409).send({ error: err.code, message: err.message });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'session_agent_refresh_failed' });
  }
});

// --- Server MCP attivi nella sessione ---
app.get<{ Params: { id: string } }>('/api/sessions/:id/mcp', async (req, reply) => {
  try { return reply.send({ mcp: await agentService.getSessionMcp(req.params.id) }); }
  catch (err) {
    if (err instanceof AgentServiceError && err.code === 'session_not_found') return reply.status(404).send({ error: err.code });
    app.log.error(err);
    return reply.status(500).send({ error: 'session_mcp_failed' });
  }
});

app.patch<{ Params: { id: string }; Body: { enabled?: unknown; allowWrites?: unknown } }>('/api/sessions/:id/mcp', async (req, reply) => {
  try { return reply.send({ mcp: await agentService.setSessionMcp(req.params.id, req.body?.enabled, req.body?.allowWrites) }); }
  catch (err) {
    if (err instanceof AgentServiceError) {
      if (err.code === 'session_not_found') return reply.status(404).send({ error: err.code });
      if (err.code === 'mcp_busy') return reply.status(409).send({ error: err.code, message: err.message });
      if (['invalid_mcp_server', 'invalid_mcp_tool'].includes(err.code)) return reply.status(400).send({ error: err.code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'session_mcp_failed' });
  }
});

// --- Imposta il profilo agente della sessione (solo prima del primo messaggio) ---
app.patch<{ Params: { id: string }; Body: { profileId?: unknown } }>('/api/sessions/:id/agent', async (req, reply) => {
  try {
    const value = req.body?.profileId;
    if (value !== null && (typeof value !== 'string' || !value)) return reply.status(400).send({ error: 'invalid_agent_profile' });
    const result = await agentService.setSessionAgent(req.params.id, value);
    return reply.send(result);
  } catch (err) {
    if (err instanceof AgentServiceError) {
      if (err.code === 'session_not_found' || err.code === 'agent_profile_not_found') return reply.status(err.code === 'session_not_found' ? 404 : 404).send({ error: err.code });
      if (err.code === 'agent_locked') return reply.status(409).send({ error: err.code, message: err.message });
      if (err.code === 'invalid_agent_profile') return reply.status(400).send({ error: err.code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'session_agent_failed' });
  }
});

// --- Ottieni / riprendi sessione ---
app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
  try {
    const result = await agentService.resumeSession(req.params.id);
    return reply.send({ sessionId: result.sessionId, modelId: result.modelId, provider: result.provider, reasoningLevel: result.reasoningLevel, projectId: result.projectId, agent: result.agent });
  } catch (err) {
    if (err instanceof AgentServiceError && err.code === 'session_not_found') {
      return reply.status(404).send({ error: err.code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'session_resume_failed' });
  }
});

// --- Recupera messaggi storici di una sessione ---
app.get<{ Params: { id: string } }>('/api/sessions/:id/messages', async (req, reply) => {
  try {
    const messages = await agentService.getSessionMessages(req.params.id);
    return reply.send({ messages });
  } catch (err) {
    if (err instanceof AgentServiceError && err.code === 'session_not_found') {
      return reply.status(404).send({ error: err.code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'session_messages_failed' });
  }
});

// --- Artefatti della chat ---
app.post<{ Params: { id: string }; Body: { title?: string; markdown?: string; html?: string; content?: string; format?: string; filename?: string } }>('/api/sessions/:id/artifacts/pdf', async (req, reply) => {
  try {
    if (typeof req.body?.title !== 'string' || !req.body.title.trim()) return reply.status(400).send({ error: 'invalid_pdf_title' });
    const format = req.body?.format === 'html' ? 'html' : 'markdown';
    const content = typeof req.body?.content === 'string' ? req.body.content : format === 'html' ? req.body?.html : req.body?.markdown;
    if (typeof content !== 'string' || !content.trim()) return reply.status(400).send({ error: format === 'html' ? 'invalid_pdf_html' : 'invalid_pdf_markdown' });
    if (!(await agentService.hasSession(req.params.id))) return reply.status(404).send({ error: 'session_not_found' });
    const artifact = await agentService.createPdfArtifact(req.params.id, {
      title: req.body.title,
      ...(format === 'html' ? { html: content, format: 'html' as const } : { markdown: content, format: 'markdown' as const }),
      ...(typeof req.body.filename === 'string' && req.body.filename.trim() ? { filename: req.body.filename } : {}),
    });
    return reply.status(201).send({ artifact });
  } catch (err) {
    if (err instanceof AgentServiceError && err.code === 'session_not_found') return reply.status(404).send({ error: err.code });
    if (err instanceof Error && (err.message === 'empty_markdown' || err.message === 'markdown_too_large' || err.message === 'empty_html' || err.message === 'html_too_large' || err.message === 'pdf_too_many_pages' || err.message === 'pdf_too_large')) {
      return reply.status(400).send({ error: err.message });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'pdf_export_failed' });
  }
});

app.post<{ Params: { id: string; artifactId: string } }>('/api/sessions/:id/artifacts/:artifactId/pdf', async (req, reply) => {
  try {
    const artifact = await agentService.createPdfFromArtifact(req.params.id, req.params.artifactId);
    return reply.status(201).send({ artifact });
  } catch (err) {
    if (err instanceof AgentServiceError && err.code === 'session_not_found') return reply.status(404).send({ error: err.code });
    if (err instanceof AgentServiceError && err.code === 'unsupported_pdf_source') return reply.status(400).send({ error: err.code, message: err.message });
    if (err && typeof err === 'object' && 'code' in err && String((err as { code?: unknown }).code) === 'artifact_not_found') return reply.status(404).send({ error: 'artifact_not_found' });
    app.log.error(err);
    return reply.status(500).send({ error: 'artifact_pdf_failed' });
  }
});

app.get<{ Params: { id: string } }>('/api/sessions/:id/artifacts', async (req, reply) => {
  try {
    const artifacts = await agentService.listArtifacts(req.params.id);
    return reply.send({ artifacts });
  } catch (err) {
    if (err instanceof AgentServiceError && err.code === 'session_not_found') return reply.status(404).send({ error: err.code });
    app.log.error(err);
    return reply.status(500).send({ error: 'artifact_list_failed' });
  }
});

app.delete<{ Params: { id: string; artifactId: string } }>('/api/sessions/:id/artifacts/:artifactId', async (req, reply) => {
  try {
    if (!(await agentService.hasSession(req.params.id))) return reply.status(404).send({ error: 'session_not_found' });
    await agentService.removeArtifact(req.params.id, req.params.artifactId);
    return reply.send({ deleted: true });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      const code = String((err as { code?: unknown }).code);
      if (code === 'artifact_not_found') return reply.status(404).send({ error: code });
      if (code === 'invalid_artifact_id') return reply.status(400).send({ error: code });
      if (code === 'artifact_forbidden') return reply.status(403).send({ error: code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'artifact_delete_failed' });
  }
});

app.get<{ Params: { id: string; artifactId: string } }>('/api/sessions/:id/artifacts/:artifactId/versions', async (req, reply) => {
  try {
    const versions = await agentService.listArtifactVersions(req.params.id, req.params.artifactId);
    return reply.send({ versions });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      const code = String((err as { code?: unknown }).code);
      if (code === 'artifact_not_found') return reply.status(404).send({ error: code });
      if (code === 'invalid_artifact_id') return reply.status(400).send({ error: code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'artifact_versions_failed' });
  }
});

app.get<{ Params: { id: string; artifactId: string; version: string } }>('/api/sessions/:id/artifacts/:artifactId/versions/:version', async (req, reply) => {
  try {
    const version = Number(req.params.version);
    if (!Number.isInteger(version) || version < 1) return reply.status(400).send({ error: 'invalid_artifact_version' });
    const artifact = await agentService.getArtifactVersion(req.params.id, req.params.artifactId, version);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, max-age=60');
    reply.header('Content-Disposition', `${isOfficeArtifactKind(artifact.kind) ? 'attachment' : 'inline'}; filename="${encodeURIComponent(artifact.name)}"`);
    if (artifact.mimeType.startsWith('text/html') || artifact.mimeType === 'image/svg+xml') {
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;");
    }
    return reply.type(artifact.mimeType).send(artifact.buffer);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      const code = String((err as { code?: unknown }).code);
      if (code === 'artifact_version_not_found' || code === 'artifact_not_found') return reply.status(404).send({ error: code });
      if (code === 'invalid_artifact_version' || code === 'invalid_artifact_id') return reply.status(400).send({ error: code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'artifact_version_read_failed' });
  }
});

app.get<{ Params: { id: string; artifactId: string }; Querystring: { version?: string } }>('/api/sessions/:id/artifacts/:artifactId/preview', async (req, reply) => {
  try {
    const versionParam = req.query.version;
    let version: number | undefined;
    if (versionParam !== undefined) {
      version = Number(versionParam);
      if (!Number.isInteger(version) || version < 1) return reply.status(400).send({ error: 'invalid_artifact_version' });
    }
    const artifact = version === undefined
      ? await agentService.getArtifact(req.params.id, req.params.artifactId)
      : await agentService.getArtifactVersion(req.params.id, req.params.artifactId, version);
    if (artifact.kind === 'xlsx') {
      const preview = await agentService.getSpreadsheetPreview(req.params.id, req.params.artifactId, version);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Cache-Control', 'private, max-age=60');
      return reply.send(preview);
    }
    let html: string | null = null;
    if (artifact.kind === 'docx') {
      html = await renderDocxPreviewHtml(artifact.buffer);
    } else if (artifact.kind === 'pptx' && (version === undefined || ('current' in artifact && artifact.current))) {
      html = await agentService.getArtifactPreview(req.params.id, req.params.artifactId);
    }
    if (!html) return reply.status(404).send({ error: 'artifact_preview_not_found' });
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, max-age=60');
    reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;");
    return reply.type('text/html; charset=utf-8').send(html);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      const code = String((err as { code?: unknown }).code);
      if (code === 'artifact_not_found' || code === 'session_not_found' || code === 'artifact_version_not_found') return reply.status(404).send({ error: code });
      if (code === 'invalid_artifact_id' || code === 'invalid_artifact_version' || code === 'unsupported_spreadsheet_preview' || code === 'invalid_xlsx_preview') return reply.status(400).send({ error: code });
      if (code === 'artifact_preview_forbidden') return reply.status(403).send({ error: code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'artifact_preview_failed' });
  }
});

app.post<{ Params: { id: string; artifactId: string } }>('/api/sessions/:id/artifacts/:artifactId/preview-attachment', async (req, reply) => {
  try {
    if (!(await agentService.hasSession(req.params.id))) return reply.status(404).send({ error: 'session_not_found' });
    if (!agentService.sessionSupportsImageInput(req.params.id)) {
      return reply.status(409).send({ error: 'vision_model_required', message: 'Il modello attivo non supporta immagini' });
    }
    const preview = await agentService.renderArtifactPreviewImage(req.params.id, req.params.artifactId);
    const attachment = await chatAttachmentStore.save(req.params.id, { filename: preview.filename, data: preview.buffer });
    return reply.status(201).send({ attachment });
  } catch (err) {
    if (err instanceof AgentServiceError) {
      if (err.code === 'session_not_found') return reply.status(404).send({ error: err.code });
      if (err.code === 'artifact_preview_unsupported') return reply.status(400).send({ error: err.code, message: err.message });
    }
    if (err && typeof err === 'object' && 'code' in err) {
      const code = String((err as { code?: unknown }).code);
      if (code === 'artifact_not_found') return reply.status(404).send({ error: code });
      if (code === 'artifact_preview_unsupported') return reply.status(400).send({ error: code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'artifact_preview_attachment_failed' });
  }
});

app.get<{ Params: { id: string; artifactId: string } }>('/api/sessions/:id/artifacts/:artifactId', async (req, reply) => {
  try {
    const artifact = await agentService.getArtifact(req.params.id, req.params.artifactId);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, max-age=60');
    reply.header('Content-Disposition', `${isOfficeArtifactKind(artifact.kind) ? 'attachment' : 'inline'}; filename="${encodeURIComponent(artifact.name)}"`);
    if (artifact.mimeType.startsWith('text/html') || artifact.mimeType === 'image/svg+xml') {
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;");
    }
    return reply.type(artifact.mimeType).send(artifact.buffer);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      const code = String((err as { code?: unknown }).code);
      if (code === 'artifact_not_found' || code === 'session_not_found') return reply.status(404).send({ error: code });
      if (code === 'invalid_artifact_id') return reply.status(400).send({ error: code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'artifact_read_failed' });
  }
});

// --- Lista modelli disponibili tramite Pi SDK ---
app.get('/api/models', async (req, reply) => {
  try {
    const provider = (req.query as { provider?: 'openrouter' | 'opencode-go' }).provider;
    if (provider && provider !== 'openrouter' && provider !== 'opencode-go') return reply.status(400).send({ error: 'invalid_provider' });
    const models = await agentService.getAvailableModels(provider);
    return reply.send({ models });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'models_list_failed' });
  }
});

// --- Cambia livello di reasoning di una sessione esistente ---
app.patch<{ Params: { id: string }; Body: { reasoningLevel: string } }>(
  '/api/sessions/:id/reasoning',
  async (req, reply) => {
    try {
      if (!REASONING_LEVELS.includes(req.body.reasoningLevel as ReasoningLevel)) {
        return reply.status(400).send({ error: 'invalid_reasoning_level' });
      }
      const result = await agentService.setSessionReasoningLevel(req.params.id, req.body.reasoningLevel as ReasoningLevel);
      return reply.send(result);
    } catch (err) {
      if (err instanceof AgentServiceError && err.code === 'session_not_found') return reply.status(404).send({ error: err.code });
      app.log.error(err);
      return reply.status(500).send({ error: 'session_reasoning_change_failed' });
    }
  }
);

// --- Contesto memoria della sessione ---
app.get<{ Params: { id: string } }>('/api/sessions/:id/context', async (req, reply) => {
  try {
    const context = await agentService.getSessionContext(req.params.id);
    return reply.send({ context });
  } catch (err) {
    if (err instanceof AgentServiceError && err.code === 'session_not_found') return reply.status(404).send({ error: err.code });
    app.log.error(err);
    return reply.status(500).send({ error: 'session_context_failed' });
  }
});

app.patch<{ Params: { id: string }; Body: Partial<SessionContextSettings> }>('/api/sessions/:id/context', async (req, reply) => {
  try {
    const context = await agentService.setSessionContext(req.params.id, req.body ?? {});
    return reply.send({ context });
  } catch (err) {
    if (err instanceof AgentServiceError && err.code === 'session_not_found') return reply.status(404).send({ error: err.code });
    if (err instanceof AgentServiceError && err.code === 'invalid_session_context') return reply.status(400).send({ error: err.code, message: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'session_context_failed' });
  }
});

// --- Cambia modello di una sessione esistente ---
app.patch<{ Params: { id: string }; Body: { modelId: string; provider?: string } }>(
  '/api/sessions/:id/model',
  async (req, reply) => {
    try {
      const provider = req.body.provider as 'openrouter' | 'opencode-go' | undefined;
      if (provider && provider !== 'openrouter' && provider !== 'opencode-go') return reply.status(400).send({ error: 'invalid_provider' });
      const result = await agentService.setSessionModel(req.params.id, req.body.modelId, provider);
      return reply.send(result);
    } catch (err) {
      if (err instanceof AgentServiceError) {
        if (err.code === 'session_not_found') {
          return reply.status(404).send({ error: err.code });
        }
        if (err.code === 'model_not_found') {
          return reply.status(404).send({ error: err.code });
        }
      }
      app.log.error(err);
      return reply.status(500).send({ error: 'session_model_change_failed' });
    }
  }
);

// --- Modifica una domanda e rigenera la risposta (SSE) ---
app.post<{ Params: { id: string; entryId: string }; Body: { text: string } }>(
  '/api/sessions/:id/messages/:entryId/edit',
  async (req, reply) => {
    const sessionId = req.params.id;
    const text = req.body?.text;
    if (!text || typeof text !== 'string') return reply.status(400).send({ error: 'invalid_message' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const sendEvent = (type: string, payload: unknown) => {
      reply.raw.write(`data: ${JSON.stringify({ type, sessionId, timestamp: Date.now(), payload })}\n\n`);
    };
    let settled = false;
    try {
      const { sourcesUsed, memoryCandidatesCreated, memoryWriterError } = await agentService.editUserMessage(sessionId, req.params.entryId, text, (event) => {
        if (settled && event.type !== 'session_title') return;
        sendEvent(event.type, event.payload);
        if (event.type === 'agent_settled' || event.type === 'agent_end') settled = true;
      });
      if (sourcesUsed.length > 0) sendEvent('memory_sources', sourcesUsed);
      if (memoryCandidatesCreated.length > 0) {
        sendEvent('memory_candidates', memoryCandidatesCreated.map((candidate) => ({
          id: candidate.id, status: candidate.status, targetPath: candidate.targetPath,
          project: candidate.project, category: candidate.category,
        })));
      }
      if (memoryWriterError) app.log.warn({ message: memoryWriterError }, 'memory writer failed');
      if (!settled) sendEvent('done', null);
      reply.raw.end();
    } catch (err) {
      if (!settled) sendEvent('error', err instanceof Error ? err.message : String(err));
      try { reply.raw.end(); } catch { /* già chiuso */ }
    }
    return reply.hijack();
  }
);

// --- Invia messaggio in coda e osserva gli eventi (SSE) ---
app.post<{ Params: { id: string }; Body: { text: string; attachmentIds?: string[] } }>(
  '/api/sessions/:id/messages',
  async (req, reply) => {
    const sessionId = req.params.id;
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return reply.status(400).send({ error: 'invalid_message' });
    }
    const attachmentIds = Array.isArray(req.body.attachmentIds) ? req.body.attachmentIds.filter((id): id is string => typeof id === 'string') : [];
    if (attachmentIds.length > 8) return reply.status(400).send({ error: 'too_many_attachments' });
    if (!(await agentService.hasSession(sessionId))) return reply.status(404).send({ error: 'session_not_found' });

    let attachmentContexts;
    try {
      attachmentContexts = await Promise.all((await chatAttachmentStore.loadMany(sessionId, attachmentIds)).map(attachment => chatAttachmentStore.toModelContext(attachment)));
    } catch (err) {
      app.log.error(err, 'chat_attachment_load_failed');
      return reply.status(500).send({ error: 'attachment_load_failed' });
    }

    const turn = turnManager.start(sessionId, text, attachmentContexts);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let closed = false;
    let unsubscribe: (() => void) | null = null;
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
    };
    unsubscribe = turnManager.subscribe(turn.turnId, 0, entry => {
      if (closed) return;
      const event = { ...entry.event, seq: entry.seq };
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (entry.event.type === 'turn_complete') {
        close();
        reply.raw.end();
      }
    });
    if (!unsubscribe) {
      reply.raw.end();
      return reply;
    }
    reply.raw.on('close', close);
    const current = turnManager.getTurn(turn.turnId);
    if (current && (current.status === 'completed' || current.status === 'failed' || current.status === 'aborted' || current.status === 'interrupted')) {
      close();
      reply.raw.end();
    }
    return reply;
  }
);

// --- Estrae proposte atomiche da una risposta, senza persisterle ---
app.post<{ Params: { id: string }; Body: { text?: string; question?: string; context?: string[]; projectId?: string | null } }>(
  '/api/sessions/:id/memory/proposals',
  async (req, reply) => {
    try {
      const text = req.body?.text;
      if (typeof text !== 'string' || !text.trim()) return reply.status(400).send({ error: 'invalid_memory_text' });
      if (!(await agentService.hasSession(req.params.id))) return reply.status(404).send({ error: 'session_not_found' });
      const projectId = typeof req.body.projectId === 'string'
        ? req.body.projectId
        : req.body.projectId === null ? undefined : await agentService.getSessionProjectId(req.params.id);
      const proposals = await memoryWriter.proposeAssistantMemories({
        assistantText: text,
        ...(typeof req.body.question === 'string' ? { question: req.body.question } : {}),
        ...(Array.isArray(req.body.context) ? { context: req.body.context.filter((item): item is string => typeof item === 'string').slice(-6) } : {}),
        ...(projectId ? { projectId } : {}),
      });
      return reply.send({ proposals });
    } catch (err) {
      if (err instanceof Error && err.message === 'sensitive_content') return reply.status(400).send({ error: 'sensitive_content' });
      const warning = err instanceof Error && /timeout|provider|invalid_memory_proposals|missing_model/i.test(err.message)
        ? 'curator_unavailable'
        : 'extraction_failed';
      app.log.warn({ error: err instanceof Error ? err.message : String(err) }, 'memory proposal extraction failed');
      return reply.send({ proposals: null, warning });
    }
  }
);

// --- Promuove esplicitamente una risposta a candidato memoria ---
app.post<{ Params: { id: string }; Body: { text?: string; question?: string; context?: string[]; projectId?: string | null; category?: string; heading?: string; action?: 'new' | 'update'; currentText?: string; sourceMessageId?: string; sourceTimestamp?: number } }>(
  '/api/sessions/:id/memory',
  async (req, reply) => {
    try {
      const text = req.body?.text;
      if (typeof text !== 'string' || !text.trim()) return reply.status(400).send({ error: 'invalid_memory_text' });
      if (!(await agentService.hasSession(req.params.id))) return reply.status(404).send({ error: 'session_not_found' });
      const candidate = await memoryWriter.proposeAssistantMemory({
        sessionId: req.params.id,
        projectId: typeof req.body.projectId === 'string' ? req.body.projectId : req.body.projectId === null ? undefined : await agentService.getSessionProjectId(req.params.id),
        ...(typeof req.body.projectId === 'string' ? { targetPath: `projects/${req.body.projectId}/memory.md` } : req.body.projectId === null ? { targetPath: 'memory/facts.md' } : {}),
        text,
        ...(typeof req.body.category === 'string' ? { category: req.body.category } : {}),
        ...(typeof req.body.heading === 'string' ? { heading: req.body.heading } : {}),
        ...(req.body.action === 'update' && typeof req.body.currentText === 'string' ? { action: 'update' as const, currentText: req.body.currentText } : {}),
        ...(typeof req.body.question === 'string' ? { question: req.body.question } : {}),
        ...(Array.isArray(req.body.context) ? { context: req.body.context.filter((item): item is string => typeof item === 'string').slice(-6) } : {}),
        ...(typeof req.body.sourceMessageId === 'string' ? { sourceMessageId: req.body.sourceMessageId } : {}),
        ...(typeof req.body.sourceTimestamp === 'number' ? { sourceTimestamp: req.body.sourceTimestamp } : {}),
      });
      return reply.status(201).send({ candidate });
    } catch (err) {
      return sendMemoryWriterError(reply, err);
    }
  }
);

// --- Memory Inbox: candidati, approvazione e rifiuto ---
app.get('/api/memory/candidates', async (req, reply) => {
  try {
    const query = req.query as { status?: string; projectId?: string };
    const status = query.status;
    const allowed: MemoryCandidateStatus[] = ['pending', 'conflict', 'approved', 'rejected'];
    if (status && !allowed.includes(status as MemoryCandidateStatus)) {
      return reply.status(400).send({ error: 'invalid_status' });
    }
    const candidates = (await memoryWriter.listCandidates(status as MemoryCandidateStatus | undefined))
      .filter(candidate => !query.projectId || candidate.projectId === query.projectId);
    return reply.send({ candidates });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'memory_candidates_failed' });
  }
});

app.patch<{ Params: { id: string }; Body: { proposedText?: string; targetPath?: string; category?: string; project?: string; heading?: string } }>(
  '/api/memory/candidates/:id',
  async (req, reply) => {
    try {
      const candidate = await memoryWriter.updateCandidate(req.params.id, req.body ?? {});
      return reply.send({ candidate });
    } catch (err) {
      return sendMemoryWriterError(reply, err);
    }
  }
);

app.post<{ Params: { id: string }; Body?: { proposedText?: string; targetPath?: string; category?: string; project?: string; heading?: string } }>(
  '/api/memory/candidates/:id/approve',
  async (req, reply) => {
    try {
      const result = await memoryWriter.approve(req.params.id, req.body ?? {});
      return reply.send(result);
    } catch (err) {
      return sendMemoryWriterError(reply, err);
    }
  }
);

app.post<{ Params: { id: string }; Body?: { reason?: string } }>(
  '/api/memory/candidates/:id/reject',
  async (req, reply) => {
    try {
      const candidate = await memoryWriter.reject(req.params.id, req.body?.reason);
      return reply.send({ candidate });
    } catch (err) {
      return sendMemoryWriterError(reply, err);
    }
  }
);

// --- Ricerca memoria ---
app.get('/api/memory/search', async (req, reply) => {
  try {
    const query = req.query as { q?: string; topK?: string; maxChars?: string; maxTokens?: string; category?: string; project?: string; projectId?: string; memoryType?: string; minConfidence?: string; diversity?: string; mode?: string };
    const q = query.q;
    if (!q) {
      return reply.status(400).send({ error: 'missing_query' });
    }
    const topK = query.topK ? Number(query.topK) : 5;
    const maxChars = query.maxChars ? Number(query.maxChars) : 4000;
    const maxTokens = query.maxTokens ? Number(query.maxTokens) : undefined;
    const minConfidence = query.minConfidence ? Number(query.minConfidence) : undefined;
    const diversity = query.diversity ? Number(query.diversity) : undefined;
    const category = query.category;
    if (query.mode && !['lexical', 'semantic', 'hybrid'].includes(query.mode)) {
      return reply.status(400).send({ error: 'invalid_retrieval_mode' });
    }
    const options = { topK, maxChars, maxTokens, category, project: query.project, projectId: query.projectId, memoryType: query.memoryType, minConfidence, diversity };
    const results = query.mode === 'lexical' ? await memoryService.searchLexical(q, options)
      : query.mode === 'semantic' ? await memoryService.searchSemantic(q, options)
      : query.mode === 'hybrid' ? await memoryService.searchHybrid(q, options)
      : await agentService.memorySearch(q, options);
    return reply.send({ results });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'memory_search_failed' });
  }
});

// --- Reindex memoria ---
app.post('/api/memory/reindex', async (_req, reply) => {
  try {
    await agentService.memoryReindex();
    return reply.send({ ok: true });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'memory_reindex_failed' });
  }
});

// --- Lista fonti memoria ---
app.get('/api/memory/sources', async (_req, reply) => {
  try {
    const sources = await agentService.memoryListSources();
    return reply.send({ sources });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'memory_sources_failed' });
  }
});

// --- Dettaglio, modifica e cancellazione di una fonte Markdown ---
app.get<{ Params: { id: string } }>('/api/memory/sources/:id', async (req, reply) => {
  try {
    const source = await memoryService.getSourceContent(req.params.id);
    return reply.send({ source });
  } catch (err) {
    return sendMemorySourceError(reply, err);
  }
});

app.get<{ Params: { id: string } }>('/api/memory/sources/:id/history', async (req, reply) => {
  try {
    const records = await memoryService.getSourceHistory(req.params.id);
    return reply.send({ records });
  } catch (err) {
    return sendMemorySourceError(reply, err);
  }
});

app.get<{ Querystring: { q?: string; path?: string } }>('/api/memory/history', async (req, reply) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) return reply.status(400).send({ error: 'invalid_query', message: 'q è obbligatorio' });
    const path = typeof req.query.path === 'string' && req.query.path.trim() ? [req.query.path.trim()] : undefined;
    const records = await memoryService.searchHistory(q, { topK: 10, relativePaths: path });
    return reply.send({ records });
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({ error: 'memory_history_failed' });
  }
});

app.patch<{ Params: { id: string }; Body: { content?: string } }>(
  '/api/memory/sources/:id',
  async (req, reply) => {
    try {
      if (typeof req.body?.content !== 'string') {
        return reply.status(400).send({ error: 'invalid_source_content', message: 'content è obbligatorio' });
      }
      const source = await memoryService.updateSourceContent(req.params.id, req.body.content);
      return reply.send({ source });
    } catch (err) {
      return sendMemorySourceError(reply, err);
    }
  }
);

app.delete<{ Params: { id: string } }>('/api/memory/sources/:id', async (req, reply) => {
  try {
    const result = await memoryService.deleteSource(req.params.id);
    const purgedCandidates = await memoryWriter.markCandidatesPurgedForPath(result.relativePath);
    return reply.send({ ...result, deleted: true, purgedCandidates });
  } catch (err) {
    return sendMemorySourceError(reply, err);
  }
});

// --- Abort sessione ---
app.post<{ Params: { id: string } }>('/api/sessions/:id/abort', async (req, reply) => {
  try {
    const turn = await turnManager.abortSession(req.params.id);
    if (!turn) await agentService.abort(req.params.id);
    return reply.send({ ok: true });
  } catch (err) {
    if (err instanceof AgentServiceError && err.code === 'session_not_found') {
      return reply.status(404).send({ error: err.code });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'abort_failed' });
  }
});

// --- Frontend production: Fastify serve la build React, senza Vite ---
if (isProduction) {
  const indexFile = path.join(webDistDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    throw new Error(`Frontend production build non trovata in ${webDistDir}. Esegui pnpm build.`);
  }

  await app.register(fastifyStatic, {
    root: webDistDir,
    prefix: '/',
    wildcard: false,
    index: ['index.html'],
    cacheControl: false,
    // @fastify/static v10 passa la FastifyReply: si usano gli header API di Fastify.
    setHeaders(response, filePath) {
      if (path.basename(filePath) === 'index.html') {
        response.header('Cache-Control', 'no-cache');
      } else {
        response.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });

  app.log.info({ webDistDir }, 'serving production frontend');
}

// Le API sconosciute restano JSON 404. Solo le navigazioni frontend ricevono
// index.html; gli asset mancanti restano 404.
app.setNotFoundHandler((request, reply) => {
  const pathname = request.url.split('?')[0] ?? '/';
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return reply.status(404).send({ error: 'not_found' });
  }
  if (!isProduction) {
    return reply.status(404).send({ error: 'not_found' });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return reply.status(404).send({ error: 'not_found' });
  }
  if (path.extname(pathname)) {
    return reply.status(404).send({ error: 'not_found' });
  }
  return reply.type('text/html').sendFile('index.html');
});

// --- Graceful shutdown ---
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  automationScheduler.stop();
  backupService.stop();
  updateService.stop();
  monitorService.stop();
  try {
    await app.close();
  } catch (err) {
    app.log.error(err, 'fastify close failed');
  } finally {
    agentService.disposeAll();
    try {
      await memoryWriterQueue?.close();
      await memoryService.close();
    } catch (err) {
      app.log.error(err, 'memory close failed');
    }
  }
};
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

const start = async () => {
  try {
    await app.listen({ host, port });
    automationScheduler.start();
    backupService.start();
    updateService.start();
    monitorService.start();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();

export { app };
