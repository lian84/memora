import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, access } from 'node:fs/promises';
import { AgentService } from './index';
import type { AgentServiceConfig, StreamEvent } from '@memora/shared';

const loaderConfigs = vi.hoisted(() => [] as Array<{ extensionFactories: Array<(pi: { on: (event: string, handler: (event: { messageType: string; prompt: string; systemPrompt: string }) => Promise<unknown>) => void }) => void> }>);

// -------------------------------------------------------------------
// Mock dell'SDK Pi: nessuna chiamata reale a OpenRouter.
// vi.mock è hoisted: la factory usa solo vi.fn() inline, senza riferimenti
// a variabili dichiarate più in basso nel file.
// -------------------------------------------------------------------
vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  ModelRuntime: { create: vi.fn() },
  SessionManager: {
    create: vi.fn(),
    open: vi.fn(),
    list: vi.fn(),
    listAll: vi.fn(),
    findById: vi.fn(),
  },
  SettingsManager: { create: vi.fn() },
  loadSkillsFromDir: vi.fn(() => ({ skills: [], diagnostics: [] })),
  DefaultResourceLoader: class {
    constructor(config: typeof loaderConfigs[number]) { loaderConfigs.push(config); }
    reload = vi.fn(() => Promise.resolve());
  },
}));

// Dopo il hoisting, recupero le funzioni mockate
import {
  type AgentSession,
  type CreateAgentSessionResult,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';

const mockCreateAgentSession = vi.mocked(createAgentSession);
const mockModelRuntimeCreate = vi.mocked(ModelRuntime.create);
const mockSessionManagerCreate = vi.mocked(SessionManager.create);
const mockSessionManagerOpen = vi.mocked(SessionManager.open);
const mockSessionManagerListAll = vi.mocked(SessionManager.listAll);
const mockSessionManagerFindById = vi.mocked(SessionManager.findById);


const mockSubscribe = vi.fn();
const mockPrompt = vi.fn(() => Promise.resolve());
const mockAbort = vi.fn(() => Promise.resolve());
const mockSetThinkingLevel = vi.fn();
const mockDispose = vi.fn();
const mockSetRuntimeApiKey = vi.fn();
const mockGetModel = vi.fn((provider?: string, modelId?: string) => { void provider; void modelId; return { id: 'openrouter/auto' }; });

const mockSessionObj = {
  sessionId: 'test-session-123',
  sessionFile: '/tmp/memora/data/pi-sessions/test-session-123.jsonl',
  model: { id: 'openrouter/auto' },
  isStreaming: false,
  isIdle: true,
  messages: [],
  setModel: vi.fn(),
  subscribe: mockSubscribe,
  prompt: mockPrompt,
  abort: mockAbort,
  setThinkingLevel: mockSetThinkingLevel,
  dispose: mockDispose,
  
} as unknown as AgentSession;

const mockModelRuntimeObj = {
  setRuntimeApiKey: mockSetRuntimeApiKey,
  getModel: mockGetModel,
  getModels: vi.fn(),
  hasConfiguredAuth: vi.fn(),
} as unknown as ModelRuntime;

const baseConfig: AgentServiceConfig = {
  dataDir: '/tmp/memora-test/data',
  cwd: '/tmp/memora-test',
  openRouterApiKey: 'test-api-key',
  openRouterModel: 'openrouter/auto',
};

beforeEach(() => {
  vi.clearAllMocks();
  loaderConfigs.length = 0;

  mockCreateAgentSession.mockResolvedValue({
      session: mockSessionObj,
      extensionsResult: {
        extensions: [],
        errors: [],
        runtime: {} as unknown as Record<string, unknown>,
      },
    } as unknown as CreateAgentSessionResult);
  mockModelRuntimeCreate.mockResolvedValue(mockModelRuntimeObj);
  mockGetModel.mockReturnValue({ id: 'openrouter/auto' });
  mockSessionManagerCreate.mockReturnValue({} as unknown as ReturnType<typeof SessionManager.create>);
  (mockSessionObj as unknown as { sessionManager: { getCwd: () => string; appendCustomEntry: ReturnType<typeof vi.fn> } }).sessionManager = {
    getCwd: () => '/tmp/runtime',
    appendCustomEntry: vi.fn(),
  };
  mockSessionManagerOpen.mockReturnValue({ getEntries: () => [] } as unknown as ReturnType<typeof SessionManager.open>);
  mockSessionManagerListAll.mockResolvedValue([]);
  mockSessionManagerFindById.mockReturnValue(undefined);
  vi.mocked(SettingsManager.create).mockReturnValue({} as unknown as ReturnType<typeof SettingsManager.create>);
  mockSubscribe.mockImplementation((listener: (e: unknown) => void) => {
        listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Ciao' } });
        return () => {};
      });
  mockPrompt.mockResolvedValue(undefined);
  mockAbort.mockResolvedValue(undefined);
  mockDispose.mockReturnValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AgentService', () => {
  describe('createSession', () => {
    it('dovrebbe creare una nuova sessione con OpenRouter', async () => {
      const service = new AgentService(baseConfig);
      const result = await service.createSession();

      expect(mockModelRuntimeCreate).toHaveBeenCalledWith({
        authPath: '/tmp/memora-test/data/.pi/auth.json',
        modelsPath: '/tmp/memora-test/data/.pi/models.json',
      });
      expect(mockSetRuntimeApiKey).toHaveBeenCalledWith(
        'openrouter',
        'test-api-key'
      );
      expect(mockGetModel).toHaveBeenCalledWith('openrouter', 'openrouter/auto');
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/tmp/memora-test/data/runtime/assistant',
          noTools: 'builtin',
          agentDir: '/tmp/memora-test/data/.pi',
          modelRuntime: mockModelRuntimeObj,
          model: { id: 'openrouter/auto' },
        })
      );
      expect(result.sessionId).toBe('test-session-123');
      expect(result.sessionFile).toBe(
        '/tmp/memora/data/pi-sessions/test-session-123.jsonl'
      );

      service.disposeAll();
    });

    it('dovrebbe usare MEMORA_DATA_DIR per derivare i percorsi', async () => {
      const config: AgentServiceConfig = {
        ...baseConfig,
        dataDir: '/tmp/memora-test/custom-data',
      };
      const service = new AgentService(config);
      await service.createSession();

      expect(mockModelRuntimeCreate).toHaveBeenCalledWith({
        authPath: '/tmp/memora-test/custom-data/.pi/auth.json',
        modelsPath: '/tmp/memora-test/custom-data/.pi/models.json',
      });

      service.disposeAll();
    });
  });

  describe('agent profile', () => {
    it('associa un profilo alla bozza e lo espone nella lista sessioni', async () => {
      const dataDir = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp('/tmp/memora-agent-service-'));
      try {
        mockSessionManagerCreate.mockReturnValue({ getCwd: () => '/tmp/runtime' } as unknown as ReturnType<typeof SessionManager.create>);
        const service = new AgentService({ ...baseConfig, dataDir });
        const created = await service.createSession();
        const selected = await service.setSessionAgent(created.sessionId, 'commercialista');
        expect(selected.agent).toEqual({ id: 'commercialista', name: 'Commercialista', icon: 'calculator', color: '#0f8a6a' });
        const sessions = await service.listSessions();
        expect(sessions.find(session => session.sessionId === created.sessionId)?.agent).toEqual(selected.agent);
        service.disposeAll();
      } finally {
        const { rm } = await import('node:fs/promises');
        await rm(dataDir, { recursive: true, force: true });
      }
    });

    it('inietta il prompt del profilo nel turno successivo', async () => {
      const dataDir = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp('/tmp/memora-agent-prompt-'));
      try {
        const service = new AgentService({ ...baseConfig, dataDir });
        const created = await service.createSession();
        await service.setSessionAgent(created.sessionId, 'commercialista');
        const config = loaderConfigs[0]!;
        let handler: ((event: { messageType: string; prompt: string; systemPrompt: string }) => Promise<unknown>) | undefined;
        config.extensionFactories[0]!({ on: (_event, fn) => { handler = fn; } });
        const result = await handler!({ messageType: 'user', prompt: 'Come calcolo l’IVA?', systemPrompt: 'assistant' }) as { systemPrompt: string };
        expect(result.systemPrompt).toContain('--- Profilo agente ---');
        expect(result.systemPrompt).toContain('modalità Commercialista');
        service.disposeAll();
      } finally {
        const { rm } = await import('node:fs/promises');
        await rm(dataDir, { recursive: true, force: true });
      }
    });

    it('mostra i metadati visivi aggiornati anche nelle chat esistenti', async () => {
      const dataDir = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp('/tmp/memora-agent-live-'));
      try {
        const service = new AgentService({ ...baseConfig, dataDir });
        const created = await service.createSession();
        await service.setSessionAgent(created.sessionId, 'commercialista');
        await service.updateAgentProfile('commercialista', { icon: 'terminal', color: '#123456', name: 'Commercialista aggiornato' });
        const sessions = await service.listSessions();
        expect(sessions.find(session => session.sessionId === created.sessionId)?.agent).toEqual({
          id: 'commercialista',
          name: 'Commercialista aggiornato',
          icon: 'terminal',
          color: '#123456',
        });
        service.disposeAll();
      } finally {
        const { rm } = await import('node:fs/promises');
        await rm(dataDir, { recursive: true, force: true });
      }
    });

    it('aggiorna il prompt del profilo in una chat già avviata', async () => {
      const dataDir = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp('/tmp/memora-agent-refresh-'));
      try {
        const service = new AgentService({ ...baseConfig, dataDir });
        const created = await service.createSession();
        await service.setSessionAgent(created.sessionId, 'commercialista');
        await service.updateAgentProfile('commercialista', { prompt: 'Nuovo prompt aggiornato.' });
        const refreshed = await service.refreshSessionAgent(created.sessionId);
        expect(refreshed.agent.id).toBe('commercialista');
        const config = loaderConfigs[0]!;
        let handler: ((event: { messageType: string; prompt: string; systemPrompt: string }) => Promise<unknown>) | undefined;
        config.extensionFactories[0]!({ on: (_event, fn) => { handler = fn; } });
        const result = await handler!({ messageType: 'user', prompt: 'ciao', systemPrompt: 'assistant' }) as { systemPrompt: string };
        expect(result.systemPrompt).toContain('Nuovo prompt aggiornato.');
        service.disposeAll();
      } finally {
        const { rm } = await import('node:fs/promises');
        await rm(dataDir, { recursive: true, force: true });
      }
    });

    it('rifiuta il cambio profilo dopo il primo messaggio utente', async () => {
      const dataDir = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp('/tmp/memora-agent-lock-'));
      try {
        const service = new AgentService({ ...baseConfig, dataDir });
        const created = await service.createSession();
        (mockSessionObj as unknown as { messages: unknown[] }).messages = [{ role: 'user', content: 'Ciao' }];
        await expect(service.setSessionAgent(created.sessionId, 'commercialista')).rejects.toMatchObject({ code: 'agent_locked' });
        service.disposeAll();
      } finally {
        (mockSessionObj as unknown as { messages: unknown[] }).messages = [];
        const { rm } = await import('node:fs/promises');
        await rm(dataDir, { recursive: true, force: true });
      }
    });
  });

  describe('sendMessage', () => {
    it('dovrebbe inviare un prompt con streaming e convogliare eventi', async () => {
      const service = new AgentService(baseConfig);
      await service.createSession();

      const events: StreamEvent[] = [];
      await service.sendMessage('test-session-123', 'Ciao mondo', (e) => {
        events.push(e);
      });

      expect(mockPrompt).toHaveBeenCalledWith('Ciao mondo', {
        streamingBehavior: 'steer',
      });
      expect(mockSubscribe).toHaveBeenCalled();
      expect(events.length).toBeGreaterThan(0);

      service.disposeAll();
    });

    it('usa il default OpenCode Go per nuove sessioni e non modifica quelle esistenti', async () => {
      const service = new AgentService({
        ...baseConfig,
        chatProvider: 'opencode-go',
        openRouterModel: 'deepseek-v4.1-flash',
        providerApiKeys: { 'opencode-go': 'go-test-key' },
      });
      mockGetModel.mockImplementation((provider?: string) => provider === 'opencode-go'
        ? ({ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' } as ReturnType<typeof mockGetModel>)
        : ({ id: 'openrouter/auto', name: 'OpenRouter Auto' } as ReturnType<typeof mockGetModel>));

      const first = await service.createSession();
      expect(first).toMatchObject({ modelId: 'deepseek-v4.1-flash', provider: 'opencode-go' });
      expect(mockSetRuntimeApiKey).toHaveBeenCalledWith('opencode-go', 'go-test-key');
      expect(mockCreateAgentSession).toHaveBeenCalledWith(expect.objectContaining({ thinkingLevel: 'medium' }));
      await expect(service.setSessionReasoningLevel(first.sessionId, 'high')).resolves.toMatchObject({ reasoningLevel: 'high' });
      expect(mockSetThinkingLevel).toHaveBeenCalledWith('high');

      service.setDefaultChat('openrouter', 'openrouter/auto');
      const resumed = await service.resumeSession(first.sessionId);
      expect(resumed).toMatchObject({ modelId: 'deepseek-v4.1-flash', provider: 'opencode-go' });
      expect((await service.createSession()).provider).toBe('openrouter');
      service.disposeAll();
    });

    it('salva un titolo di fallback dal primo messaggio', async () => {
      (mockSessionObj as unknown as { messages: unknown[] }).messages = [];
      const appendSessionInfo = vi.fn();
      const appendCustomEntry = vi.fn();
      mockSessionManagerOpen.mockReturnValue({
        getEntries: () => [],
        getSessionName: () => undefined,
        appendSessionInfo,
        appendCustomEntry,
      } as unknown as ReturnType<typeof SessionManager.open>);
      const service = new AgentService({ ...baseConfig, autoTitleEnabled: false });
      await service.createSession();
      const events: StreamEvent[] = [];
      await service.sendMessage('test-session-123', 'Ciao mondo', event => events.push(event));
      expect(events.some(event => event.type === 'session_title')).toBe(true);
      expect(appendSessionInfo).toHaveBeenCalledWith('Ciao mondo');
      expect(appendCustomEntry).toHaveBeenCalledWith('memora.title', expect.objectContaining({ source: 'auto', kind: 'fallback' }));
      service.disposeAll();
    });

    it('sostituisce il fallback con un titolo LLM e protegge il rename manuale', async () => {
      (mockSessionObj as unknown as { messages: unknown[] }).messages = [];
      const appendSessionInfo = vi.fn();
      const appendCustomEntry = vi.fn();
      mockSessionManagerOpen.mockReturnValue({
        getEntries: () => [],
        getSessionName: () => undefined,
        appendSessionInfo,
        appendCustomEntry,
      } as unknown as ReturnType<typeof SessionManager.open>);
      (mockModelRuntimeObj as unknown as { completeSimple: ReturnType<typeof vi.fn> }).completeSimple = vi.fn(async () => ({ content: [{ type: 'text', text: 'Notizie di oggi' }] }));
      const service = new AgentService(baseConfig);
      await service.createSession();
      await service.sendMessage('test-session-123', 'Mi trovi le notizie di oggi?', () => undefined);
      expect(appendSessionInfo).toHaveBeenNthCalledWith(1, 'Mi trovi le notizie di oggi');
      expect(appendSessionInfo).toHaveBeenNthCalledWith(2, 'Notizie di oggi');
      expect(appendCustomEntry).toHaveBeenCalledWith('memora.title', expect.objectContaining({ kind: 'llm' }));
      service.disposeAll();
    });

    it('non sovrascrive un titolo manuale già presente', async () => {
      (mockSessionObj as unknown as { messages: unknown[] }).messages = [];
      const appendSessionInfo = vi.fn();
      mockSessionManagerOpen.mockReturnValue({
        getEntries: () => [{ type: 'custom', customType: 'memora.title', data: { source: 'manual' } }],
        getSessionName: () => 'Titolo scelto',
        appendSessionInfo,
        appendCustomEntry: vi.fn(),
      } as unknown as ReturnType<typeof SessionManager.open>);
      const service = new AgentService(baseConfig);
      await service.createSession();
      await service.sendMessage('test-session-123', 'Ciao', () => undefined);
      expect(appendSessionInfo).not.toHaveBeenCalled();
      service.disposeAll();
    });

    it('dovrebbe lanciare errore se sessione non trovata', async () => {
      const service = new AgentService(baseConfig);
      await expect(
        service.sendMessage('inesistente', 'test', () => {})
      ).rejects.toThrow(/sessione non trovata/i);

      service.disposeAll();
    });

    it('passa il turno e la provenienza del messaggio al MemoryWriter', async () => {
      const processTurn = vi.fn(async () => ({ created: [] }));
      const service = new AgentService({ ...baseConfig, memoryWriter: { processTurn } });
      await service.createSession();
      (mockSessionObj as unknown as { messages: unknown[] }).messages = [
        { role: 'user', id: 'message-provenance', timestamp: 1_759_999_000_000, content: 'Ricorda che preferisco i test piccoli' },
        { role: 'assistant', content: 'Capito.' },
      ];

      const result = await service.sendMessage('test-session-123', 'Ricorda che preferisco i test piccoli', () => {});

      expect(processTurn).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'test-session-123',
        userText: 'Ricorda che preferisco i test piccoli',
        sourceMessageId: 'message-provenance',
        sourceTimestamp: 1_759_999_000_000,
        turnId: 'test-session-123:message-provenance',
      }));
      expect(result.memoryCandidatesCreated).toEqual([]);
      (mockSessionObj as unknown as { messages: unknown[] }).messages = [];
      service.disposeAll();
    });

    it('isola un errore del MemoryWriter dalla risposta della chat', async () => {
      const processTurn = vi.fn(async () => { throw new Error('inbox non disponibile'); });
      const service = new AgentService({ ...baseConfig, memoryWriter: { processTurn } });
      await service.createSession();

      const result = await service.sendMessage('test-session-123', 'Ciao', () => {});

      expect(result.memoryWriterError).toBe('inbox non disponibile');
      expect(result.memoryCandidatesCreated).toEqual([]);
      service.disposeAll();
    });
  });

  describe('abort', () => {
    it('dovrebbe chiamare abort sulla sessione', async () => {
      const service = new AgentService(baseConfig);
      await service.createSession();

      await service.abort('test-session-123');
      expect(mockAbort).toHaveBeenCalled();

      service.disposeAll();
    });

    it('salva un titolo di fallback dal primo messaggio', async () => {
      (mockSessionObj as unknown as { messages: unknown[] }).messages = [];
      const appendSessionInfo = vi.fn();
      const appendCustomEntry = vi.fn();
      mockSessionManagerOpen.mockReturnValue({
        getEntries: () => [],
        getSessionName: () => undefined,
        appendSessionInfo,
        appendCustomEntry,
      } as unknown as ReturnType<typeof SessionManager.open>);
      const service = new AgentService({ ...baseConfig, autoTitleEnabled: false });
      await service.createSession();
      const events: StreamEvent[] = [];
      await service.sendMessage('test-session-123', 'Ciao mondo', event => events.push(event));
      expect(events.some(event => event.type === 'session_title')).toBe(true);
      expect(appendSessionInfo).toHaveBeenCalledWith('Ciao mondo');
      expect(appendCustomEntry).toHaveBeenCalledWith('memora.title', expect.objectContaining({ source: 'auto', kind: 'fallback' }));
      service.disposeAll();
    });

    it('sostituisce il fallback con un titolo LLM e protegge il rename manuale', async () => {
      (mockSessionObj as unknown as { messages: unknown[] }).messages = [];
      const appendSessionInfo = vi.fn();
      const appendCustomEntry = vi.fn();
      mockSessionManagerOpen.mockReturnValue({
        getEntries: () => [],
        getSessionName: () => undefined,
        appendSessionInfo,
        appendCustomEntry,
      } as unknown as ReturnType<typeof SessionManager.open>);
      (mockModelRuntimeObj as unknown as { completeSimple: ReturnType<typeof vi.fn> }).completeSimple = vi.fn(async () => ({ content: [{ type: 'text', text: 'Notizie di oggi' }] }));
      const service = new AgentService(baseConfig);
      await service.createSession();
      await service.sendMessage('test-session-123', 'Mi trovi le notizie di oggi?', () => undefined);
      expect(appendSessionInfo).toHaveBeenNthCalledWith(1, 'Mi trovi le notizie di oggi');
      expect(appendSessionInfo).toHaveBeenNthCalledWith(2, 'Notizie di oggi');
      expect(appendCustomEntry).toHaveBeenCalledWith('memora.title', expect.objectContaining({ kind: 'llm' }));
      service.disposeAll();
    });

    it('non sovrascrive un titolo manuale già presente', async () => {
      (mockSessionObj as unknown as { messages: unknown[] }).messages = [];
      const appendSessionInfo = vi.fn();
      mockSessionManagerOpen.mockReturnValue({
        getEntries: () => [{ type: 'custom', customType: 'memora.title', data: { source: 'manual' } }],
        getSessionName: () => 'Titolo scelto',
        appendSessionInfo,
        appendCustomEntry: vi.fn(),
      } as unknown as ReturnType<typeof SessionManager.open>);
      const service = new AgentService(baseConfig);
      await service.createSession();
      await service.sendMessage('test-session-123', 'Ciao', () => undefined);
      expect(appendSessionInfo).not.toHaveBeenCalled();
      service.disposeAll();
    });

    it('dovrebbe lanciare errore se sessione non trovata', async () => {
      const service = new AgentService(baseConfig);
      await expect(service.abort('inesistente')).rejects.toThrow(
        /sessione non trovata/i
      );

      service.disposeAll();
    });
  });

  describe('listSessions', () => {
    it('dovrebbe restituire la lista delle sessioni', async () => {
      const service = new AgentService(baseConfig);
      mockSessionManagerListAll.mockResolvedValue([
        {
          id: 'session-1',
          path: '/path/to/session-1.jsonl',
          cwd: '/tmp',
          created: new Date('2024-01-01'),
          modified: new Date('2024-01-02'),
          messageCount: 5,
          firstMessage: 'Ciao',
          allMessagesText: '',
        },
      ]);

      const sessions = await service.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('session-1');
      expect(sessions[0].messageCount).toBe(5);

      service.disposeAll();
    });

    it('restituisce solo la vista richiesta: attive oppure archiviate', async () => {
      const active = {
        id: 'active-session',
        path: '/path/to/active-session.jsonl',
        cwd: '/tmp',
        created: new Date('2024-01-01'),
        modified: new Date('2024-01-02'),
        messageCount: 1,
        firstMessage: 'Attiva',
        allMessagesText: '',
      };
      const archived = {
        ...active,
        id: 'archived-session',
        path: '/path/to/archived-session.jsonl',
        firstMessage: 'Archiviata',
      };
      mockSessionManagerListAll.mockResolvedValue([active, archived]);
      mockSessionManagerFindById.mockImplementation((_cwd, sessionId) => `/path/to/${sessionId}.jsonl`);
      mockSessionManagerOpen.mockImplementation((path) => ({
        getEntries: () => path.includes('archived-session')
          ? [{ type: 'custom', customType: 'memora.session-meta', data: { archived: true } }]
          : [],
      } as unknown as ReturnType<typeof SessionManager.open>));

      const service = new AgentService(baseConfig);
      await expect(service.listSessions()).resolves.toEqual([
        expect.objectContaining({ sessionId: 'active-session', archived: false }),
      ]);
      await expect(service.listSessions(true)).resolves.toEqual([
        expect.objectContaining({ sessionId: 'archived-session', archived: true }),
      ]);
    });

    it('sposta una sessione tra vista attive e archiviate dopo archive/restore', async () => {
      const entries: Array<{ type: string; customType?: string; data?: { archived: boolean } }> = [];
      const info = {
        id: 'archive-session',
        path: '/path/to/archive-session.jsonl',
        cwd: '/tmp',
        created: new Date('2024-01-01'),
        modified: new Date('2024-01-02'),
        messageCount: 1,
        firstMessage: 'Da archiviare',
        allMessagesText: '',
      };
      mockSessionManagerListAll.mockResolvedValue([info]);
      mockSessionManagerFindById.mockReturnValue(info.path);
      const appendCustomEntry = vi.fn((_customType: string, data: { archived: boolean }) => {
        entries.push({ type: 'custom', customType: 'memora.session-meta', data });
        return 'metadata-entry';
      });
      mockSessionManagerOpen.mockReturnValue({
        getEntries: () => entries,
        appendCustomEntry,
      } as unknown as ReturnType<typeof SessionManager.open>);

      const service = new AgentService(baseConfig);
      await expect(service.listSessions()).resolves.toHaveLength(1);
      await service.setSessionArchived('archive-session', true);
      await expect(service.listSessions()).resolves.toHaveLength(0);
      await expect(service.listSessions(true)).resolves.toEqual([
        expect.objectContaining({ sessionId: 'archive-session', archived: true }),
      ]);
      await service.setSessionArchived('archive-session', false);
      await expect(service.listSessions()).resolves.toEqual([
        expect.objectContaining({ sessionId: 'archive-session', archived: false }),
      ]);
      await expect(service.listSessions(true)).resolves.toHaveLength(0);
      expect(appendCustomEntry).toHaveBeenCalledTimes(2);
    });
  });

  describe('resumeSession', () => {
    it('usa lo stesso servizio memoria configurato per sessioni nuove e riprese', async () => {
      const search = vi.fn(async () => [{ sourceId: 'vega', relativePath: 'projects/vega.md', category: 'projects', heading: 'Vega', startLine: 1, endLine: 2, content: 'turchese', score: 1, retrievalMode: 'semantic' }]);
      const memoryService = { search, reindex: vi.fn(async () => {}), listSources: vi.fn(async () => []) };
      const service = new AgentService({ ...baseConfig, memoryService });
      await service.createSession();
      service.disposeAll();
      mockSessionManagerFindById.mockReturnValue('/tmp/memora/data/pi-sessions/test-session-123.jsonl');
      mockSessionManagerOpen.mockReturnValue({ buildSessionContext: () => ({ messages: [], model: null }) } as unknown as ReturnType<typeof SessionManager.open>);
      await service.resumeSession('test-session-123');
      expect(loaderConfigs).toHaveLength(2);
      for (const config of loaderConfigs) {
        let handler: ((event: { messageType: string; prompt: string; systemPrompt: string }) => Promise<unknown>) | undefined;
        config.extensionFactories[0]!({ on: (_event, fn) => { handler = fn; } });
        const result = await handler!({ messageType: 'user', prompt: 'colore Vega', systemPrompt: 'assistant' });
        expect(result).toMatchObject({ systemPrompt: expect.stringContaining('turchese') });
        expect((result as { systemPrompt: string }).systemPrompt).not.toContain('semantic');
      }
      expect(search).toHaveBeenCalledTimes(2);
      expect(search).toHaveBeenNthCalledWith(1, 'colore Vega', { globalOnly: true });
      expect(search).toHaveBeenNthCalledWith(2, 'colore Vega', { globalOnly: true });
      service.disposeAll();
    });

    it('usa prompt e default del progetto e associa il projectId', async () => {
      const project = {
        version: 1 as const, id: 'orione', name: 'Orione', description: '', status: 'active' as const,
        prompt: 'Rispondi in modo conciso.', defaults: { provider: 'opencode-go' as const, model: 'deepseek-v4.1-flash', reasoningLevel: 'high' as const },
        retrieval: { includeGlobal: false, includeProjectMemory: true, includeProjectSources: true },
        sources: { include: ['memory.md'], exclude: [] }, createdAt: 1, updatedAt: 2, source: 'file' as const,
      };
      const projectStore = { get: vi.fn(async (id: string) => id === 'orione' ? project : null) };
      const searchScoped = vi.fn(async () => []);
      const memoryService = { search: vi.fn(async () => []), searchScoped, reindex: vi.fn(async () => {}), listSources: vi.fn(async () => []) };
      const service = new AgentService({ ...baseConfig, projectStore, memoryService });
      const created = await service.createSession(undefined, undefined, undefined, 'orione');
      expect(created).toMatchObject({ modelId: 'deepseek-v4.1-flash', provider: 'opencode-go', reasoningLevel: 'high', projectId: 'orione' });
      const config = loaderConfigs[0]!;
      let handler: ((event: { messageType: string; prompt: string; systemPrompt: string }) => Promise<unknown>) | undefined;
      config.extensionFactories[0]!({ on: (_event, fn) => { handler = fn; } });
      const result = await handler!({ messageType: 'user', prompt: 'ciao', systemPrompt: 'assistant' }) as { systemPrompt: string };
      expect(result.systemPrompt).toContain('--- Istruzioni progetto ---');
      expect(result.systemPrompt).toContain('Rispondi in modo conciso.');
      expect(projectStore.get).toHaveBeenCalledWith('orione');
      expect(searchScoped).toHaveBeenCalledWith('ciao', { projectId: 'orione', includeGlobal: false, includeProjectMemory: true, includeProjectSources: true });
      service.disposeAll();
    });

    it('persiste il projectId nel JSONL dopo il primo messaggio', async () => {
      const project = {
        version: 1 as const, id: 'orione', name: 'Orione', description: '', status: 'active' as const,
        prompt: '', defaults: {}, retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
        sources: { include: ['memory.md'], exclude: [] }, createdAt: 1, updatedAt: 2, source: 'file' as const,
      };
      const appendCustomEntry = vi.fn(() => 'entry');
      mockSessionManagerOpen.mockReturnValue({ appendCustomEntry } as unknown as ReturnType<typeof SessionManager.open>);
      const service = new AgentService({ ...baseConfig, projectStore: { get: vi.fn(async () => project) } });
      await service.createSession(undefined, undefined, undefined, 'orione');
      await service.sendMessage('test-session-123', 'ciao', () => {});
      expect(appendCustomEntry).toHaveBeenCalledWith('memora.project', { projectId: 'orione' });
      service.disposeAll();
    });

    it('legge il projectId dal metadata della sessione al resume', async () => {
      const project = {
        version: 1 as const, id: 'orione', name: 'Orione', description: '', status: 'active' as const,
        prompt: '', defaults: {}, retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
        sources: { include: ['memory.md'], exclude: [] }, createdAt: 1, updatedAt: 2, source: 'file' as const,
      };
      const projectStore = { get: vi.fn(async () => project) };
      mockSessionManagerFindById.mockReturnValue('/tmp/memora/data/pi-sessions/test-session-123.jsonl');
      mockSessionManagerOpen.mockReturnValue({
        getEntries: () => [{ type: 'custom', customType: 'memora.project', data: { projectId: 'orione' } }],
        buildSessionContext: () => ({ messages: [], model: null }),
      } as unknown as ReturnType<typeof SessionManager.open>);
      const service = new AgentService({ ...baseConfig, projectStore });
      const resumed = await service.resumeSession('test-session-123');
      expect(resumed).toMatchObject({ projectId: 'orione' });
      service.disposeAll();
    });

    it('inietta la memoria storica solo per domande temporali', async () => {
      const active = [{ sourceId: 'demo', relativePath: 'projects/demo.md', category: 'projects', heading: 'Database', startLine: 1, endLine: 2, content: 'Demo usa MySQL.', score: 1, retrievalMode: 'lexical' }];
      const historical = [{
        memoryId: 'mem_demo', versionId: 'ver_demo_1', version: 1, status: 'superseded' as const,
        text: 'Demo usa PostgreSQL.', relativePath: 'projects/demo.md', line: 1,
        createdAt: 1, updatedAt: 2, supersededBy: 'ver_demo_2',
      }];
      const search = vi.fn(async () => active);
      const searchHistory = vi.fn(async () => historical);
      const memoryService = { search, searchHistory, reindex: vi.fn(async () => {}), listSources: vi.fn(async () => []) };
      const service = new AgentService({ ...baseConfig, memoryService });
      await service.createSession();
      const config = loaderConfigs[0]!;
      let handler: ((event: { messageType: string; prompt: string; systemPrompt: string }) => Promise<unknown>) | undefined;
      config.extensionFactories[0]!({ on: (_event, fn) => { handler = fn; } });

      const result = await handler!({ messageType: 'user', prompt: 'Che database usava prima Demo?', systemPrompt: 'assistant' }) as { systemPrompt: string };
      expect(searchHistory).toHaveBeenCalledWith('Che database usava prima Demo?', { topK: 5, relativePaths: ['projects/demo.md'], fallbackToLatest: true });
      expect(result.systemPrompt).toContain('Memoria storica');
      expect(result.systemPrompt).toContain('Demo usa PostgreSQL.');

      const current = await handler!({ messageType: 'user', prompt: 'Che database usa Demo?', systemPrompt: 'assistant' }) as { systemPrompt: string };
      expect(searchHistory).toHaveBeenCalledTimes(1);
      expect(current.systemPrompt).not.toContain('Memoria storica');
      service.disposeAll();
    });

    it('dovrebbe riprendere una sessione esistente', async () => {
      const service = new AgentService(baseConfig);
      mockSessionManagerFindById.mockReturnValue(
        '/tmp/memora/data/pi-sessions/test-session-123.jsonl'
      );
      mockSessionManagerOpen.mockReturnValue({
        buildSessionContext: () => ({
          messages: [],
          thinkingLevel: 'medium',
          model: { provider: 'openrouter', modelId: 'openrouter/auto' },
        }),
      } as unknown as ReturnType<typeof SessionManager.open>);

      const result = await service.resumeSession('test-session-123');
      expect(mockSessionManagerOpen).toHaveBeenCalledWith(
        '/tmp/memora/data/pi-sessions/test-session-123.jsonl',
        '/tmp/memora-test/data/pi-sessions',
        '/tmp/memora-test/data/runtime/assistant'
      );
      expect(result.modelId).toBe('openrouter/auto');

      service.disposeAll();
    });

    it('salva un titolo di fallback dal primo messaggio', async () => {
      (mockSessionObj as unknown as { messages: unknown[] }).messages = [];
      const appendSessionInfo = vi.fn();
      const appendCustomEntry = vi.fn();
      mockSessionManagerOpen.mockReturnValue({
        getEntries: () => [],
        getSessionName: () => undefined,
        appendSessionInfo,
        appendCustomEntry,
      } as unknown as ReturnType<typeof SessionManager.open>);
      const service = new AgentService({ ...baseConfig, autoTitleEnabled: false });
      await service.createSession();
      const events: StreamEvent[] = [];
      await service.sendMessage('test-session-123', 'Ciao mondo', event => events.push(event));
      expect(events.some(event => event.type === 'session_title')).toBe(true);
      expect(appendSessionInfo).toHaveBeenCalledWith('Ciao mondo');
      expect(appendCustomEntry).toHaveBeenCalledWith('memora.title', expect.objectContaining({ source: 'auto', kind: 'fallback' }));
      service.disposeAll();
    });

    it('sostituisce il fallback con un titolo LLM e protegge il rename manuale', async () => {
      (mockSessionObj as unknown as { messages: unknown[] }).messages = [];
      const appendSessionInfo = vi.fn();
      const appendCustomEntry = vi.fn();
      mockSessionManagerOpen.mockReturnValue({
        getEntries: () => [],
        getSessionName: () => undefined,
        appendSessionInfo,
        appendCustomEntry,
      } as unknown as ReturnType<typeof SessionManager.open>);
      (mockModelRuntimeObj as unknown as { completeSimple: ReturnType<typeof vi.fn> }).completeSimple = vi.fn(async () => ({ content: [{ type: 'text', text: 'Notizie di oggi' }] }));
      const service = new AgentService(baseConfig);
      await service.createSession();
      await service.sendMessage('test-session-123', 'Mi trovi le notizie di oggi?', () => undefined);
      expect(appendSessionInfo).toHaveBeenNthCalledWith(1, 'Mi trovi le notizie di oggi');
      expect(appendSessionInfo).toHaveBeenNthCalledWith(2, 'Notizie di oggi');
      expect(appendCustomEntry).toHaveBeenCalledWith('memora.title', expect.objectContaining({ kind: 'llm' }));
      service.disposeAll();
    });

    it('non sovrascrive un titolo manuale già presente', async () => {
      (mockSessionObj as unknown as { messages: unknown[] }).messages = [];
      const appendSessionInfo = vi.fn();
      mockSessionManagerOpen.mockReturnValue({
        getEntries: () => [{ type: 'custom', customType: 'memora.title', data: { source: 'manual' } }],
        getSessionName: () => 'Titolo scelto',
        appendSessionInfo,
        appendCustomEntry: vi.fn(),
      } as unknown as ReturnType<typeof SessionManager.open>);
      const service = new AgentService(baseConfig);
      await service.createSession();
      await service.sendMessage('test-session-123', 'Ciao', () => undefined);
      expect(appendSessionInfo).not.toHaveBeenCalled();
      service.disposeAll();
    });

    it('dovrebbe lanciare errore se sessione non trovata', async () => {
      const service = new AgentService(baseConfig);
      mockSessionManagerFindById.mockReturnValue(undefined);

      await expect(service.resumeSession('inesistente')).rejects.toThrow(
        /sessione non trovata/i
      );

      service.disposeAll();
    });
  });

  describe('deleteSession', () => {
    it('elimina solo il JSONL della sessione e dispone la sessione caricata', async () => {
      const sessionDir = `${baseConfig.dataDir}/pi-sessions`;
      const sessionFile = `${sessionDir}/test-session-123.jsonl`;
      await mkdir(sessionDir, { recursive: true });
      await writeFile(sessionFile, '{"type":"session"}\n');
      mockSessionManagerFindById.mockReturnValue(sessionFile);
      const service = new AgentService(baseConfig);
      await service.createSession();
      mockSessionManagerListAll.mockResolvedValue([{
        id: 'test-session-123',
        path: sessionFile,
        cwd: baseConfig.cwd,
        created: new Date('2024-01-01'),
        modified: new Date('2024-01-02'),
        messageCount: 1,
        firstMessage: 'Fixture delete',
        allMessagesText: '',
      }]);
      mockSessionManagerOpen.mockReturnValue({ getEntries: () => [] } as unknown as ReturnType<typeof SessionManager.open>);

      await expect(service.listSessions()).resolves.toEqual([
        expect.objectContaining({ sessionId: 'test-session-123', archived: false }),
      ]);
      await expect(service.deleteSession('test-session-123')).resolves.toEqual({ sessionId: 'test-session-123' });
      await expect(access(sessionFile)).rejects.toThrow();
      expect(mockAbort).toHaveBeenCalled();
      expect(mockDispose).toHaveBeenCalled();
      mockSessionManagerListAll.mockResolvedValue([]);
      await expect(service.listSessions()).resolves.toEqual([]);
      mockSessionManagerFindById.mockReturnValue(undefined);
      await expect(service.deleteSession('test-session-123')).rejects.toMatchObject({
        code: 'session_not_found',
      });
      await rm(baseConfig.dataDir, { recursive: true, force: true });
    });

    it('rifiuta un file risolto fuori da pi-sessions', async () => {
      const outside = `${baseConfig.dataDir}/outside.jsonl`;
      await mkdir(`${baseConfig.dataDir}/pi-sessions`, { recursive: true });
      await mkdir(baseConfig.dataDir, { recursive: true });
      await writeFile(outside, 'non cancellare');
      mockSessionManagerFindById.mockReturnValue(outside);
      const service = new AgentService(baseConfig);
      await expect(service.deleteSession('test-session-123')).rejects.toThrow(/directory delle sessioni/i);
      await expect(access(outside)).resolves.toBeUndefined();
      await rm(baseConfig.dataDir, { recursive: true, force: true });
    });
  });

  describe('dispose', () => {
    it('dovrebbe rilasciare le risorse della sessione', async () => {
      const service = new AgentService(baseConfig);
      await service.createSession();

      service.dispose('test-session-123');
      expect(mockDispose).toHaveBeenCalled();

      service.disposeAll();
    });
  });

  describe('restart simulato (integration test senza OpenRouter)', () => {
    it('dovrebbe preservare ID, nome e metadata dopo dispose + nuova istanza', async () => {
      // --- Prima istanza: crea sessione ---
      const service1 = new AgentService(baseConfig);
      mockSessionManagerFindById.mockReturnValue(
        '/tmp/memora-test/data/pi-sessions/test-session-123.jsonl'
      );
      mockSessionManagerOpen.mockReturnValue({
        buildSessionContext: () => ({
          messages: [],
          thinkingLevel: 'medium',
          model: { provider: 'openrouter', modelId: 'openrouter/auto' },
        }),
        getEntries: () => [],
        getSessionName: () => undefined,
      } as unknown as ReturnType<typeof SessionManager.open>);

      const createResult = await service1.createSession();
      expect(createResult.sessionId).toBe('test-session-123');
      expect(createResult.modelId).toBe('openrouter/auto');

      // Simula impostazione nome e archiviazione (metadata Memora)
      mockSessionManagerFindById.mockReturnValue(
        '/tmp/memora-test/data/pi-sessions/test-session-123.jsonl'
      );

      // --- Dispose prima istanza ---
      service1.disposeAll();
      expect(mockDispose).toHaveBeenCalled();

      // --- Seconda istanza: stessa data directory, resume sessione ---
      const service2 = new AgentService(baseConfig);
      mockSessionManagerFindById.mockReturnValue(
        '/tmp/memora-test/data/pi-sessions/test-session-123.jsonl'
      );
      mockSessionManagerOpen.mockReturnValue({
        buildSessionContext: () => ({
          messages: [],
          thinkingLevel: 'medium',
          model: { provider: 'openrouter', modelId: 'openrouter/auto' },
        }),
        getEntries: () => [],
        getSessionName: () => undefined,
      } as unknown as ReturnType<typeof SessionManager.open>);

      const resumeResult = await service2.resumeSession('test-session-123');
      expect(resumeResult.sessionId).toBe('test-session-123');
      expect(resumeResult.modelId).toBe('openrouter/auto');

      service2.disposeAll();
    });

    it('dovrebbe preservare nome sessione dopo restart', async () => {
      const service1 = new AgentService(baseConfig);

      mockSessionManagerFindById.mockReturnValue(
        '/tmp/memora-test/data/pi-sessions/test-session-456.jsonl'
      );
      mockSessionManagerOpen.mockReturnValue({
        buildSessionContext: () => ({
          messages: [],
          thinkingLevel: 'medium',
          model: { provider: 'openrouter', modelId: 'openrouter/free' },
        }),
        getEntries: () => [],
        getSessionName: () => 'Mia sessione rinominata',
        appendSessionInfo: vi.fn(),
        appendCustomEntry: vi.fn(),
      } as unknown as ReturnType<typeof SessionManager.open>);

      // Il mock di createAgentSession restituisce l'ID richiesto per questa chiamata
      mockCreateAgentSession.mockImplementationOnce(() =>
        Promise.resolve({
          session: {
            ...mockSessionObj,
            sessionId: 'test-session-456',
            sessionFile: '/tmp/memora-test/data/pi-sessions/test-session-456.jsonl',
          } as unknown as AgentSession,
          extensionsResult: {
            extensions: [],
            errors: [],
            runtime: {} as unknown as Record<string, unknown>,
          },
        } as unknown as CreateAgentSessionResult)
      );

      const createResult = await service1.createSession();
      expect(createResult.sessionId).toBe('test-session-456');

      // Rinomina sessione
      mockSessionManagerFindById.mockReturnValue(
        '/tmp/memora-test/data/pi-sessions/test-session-456.jsonl'
      );
      const renameResult = await service1.renameSession(
        'test-session-456',
        'Mia sessione rinominata'
      );
      expect(renameResult.name).toBe('Mia sessione rinominata');

      service1.disposeAll();

      // Seconda istanza: resume con nome preservato
      const service2 = new AgentService(baseConfig);
      mockSessionManagerFindById.mockReturnValue(
        '/tmp/memora-test/data/pi-sessions/test-session-456.jsonl'
      );
      mockSessionManagerOpen.mockReturnValue({
        buildSessionContext: () => ({
          messages: [],
          thinkingLevel: 'medium',
          model: { provider: 'openrouter', modelId: 'openrouter/free' },
        }),
        getEntries: () => [],
        getSessionName: () => 'Mia sessione rinominata',
        appendSessionInfo: vi.fn(),
        appendCustomEntry: vi.fn(),
      } as unknown as ReturnType<typeof SessionManager.open>);

      mockCreateAgentSession.mockImplementationOnce(() =>
        Promise.resolve({
          session: {
            ...mockSessionObj,
            sessionId: 'test-session-456',
            sessionFile: '/tmp/memora-test/data/pi-sessions/test-session-456.jsonl',
          } as unknown as AgentSession,
          extensionsResult: {
            extensions: [],
            errors: [],
            runtime: {} as unknown as Record<string, unknown>,
          },
        } as unknown as CreateAgentSessionResult)
      );

      const resumeResult = await service2.resumeSession('test-session-456');
      expect(resumeResult.sessionId).toBe('test-session-456');
      expect(resumeResult.modelId).toBe('openrouter/free');

      service2.disposeAll();
    });
  });
});
