import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { AdminSettings, AdminStatus, SettingField, SettingSource } from '@memora/shared';
import {
  AdminSettingsView,
  buildSettingsPatch,
  presetPatch,
  presetPreview,
  settingsValues,
  validateSettingsDraft,
} from './AdminSettings';

const field = <T,>(value: T, source: SettingSource = 'default', requiresRestart = false): SettingField<T> => ({
  value,
  source,
  editable: source !== 'environment',
  requiresRestart,
});

function settings(overrides: Partial<AdminSettings['settings']['memory']> = {}): AdminSettings {
  return {
    schemaVersion: 1,
    settings: {
      memory: {
        searchMode: field('lexical'),
        topK: field(5),
        maxChars: field(4000),
        maxTokens: field(1000),
        diversity: field(0.15),
        ...overrides,
      },
      embeddings: {
        enabled: field(false),
        model: field('Horizon-Labs/multilingual-embedding-small', 'environment', true),
      },
      curator: {
        enabled: field(false, 'environment', true),
        auto: field(true),
        provider: field('openrouter', 'environment', true),
        model: field('', 'environment', true),
        reasoningLevel: field('low'),
        minConfidence: field(0.75),
        minSalience: field(0.7),
        autoApproveEnabled: field(false),
        autoApproveMinConfidence: field(0.9),
        autoApproveMinSalience: field(0.85),
      },
      chat: {
        provider: field('openrouter'),
        defaultModel: field('openrouter/free'),
        reasoningLevel: field('medium'),
        autoTitleEnabled: field(true),
        maxConcurrentTurns: field(2),
      },
    },
  };
}

const status: AdminStatus = {
  memoraVersion: '0.0.0',
  nodeVersion: 'v24',
  uptimeSeconds: 12,
  dataDir: '/tmp/memora-data',
  memory: { configuredMode: 'lexical', effectiveMode: 'lexical', topK: 5, maxChars: 4000, maxTokens: 1000, diversity: 0.15 },
  chat: { provider: 'openrouter', model: 'openrouter/free', reasoningLevel: 'medium', autoTitleEnabled: true, maxConcurrentTurns: 2, credential: { configured: true, source: 'environment', editable: false } },
  embeddings: { enabled: false, available: false, model: null, loaded: false, dimensions: null },
  curator: { enabled: false, auto: true, provider: 'openrouter', model: '', reasoningLevel: 'low', credential: { configured: false, source: 'none', editable: true }, queueLength: null, queueFailed: 0, queueAttempts: 0 },
  metrics: { generatedAt: 1, retrieval: { searches: 3, errors: 0, averageLatencyMs: 12, maxLatencyMs: 20, results: 7, estimatedTokens: 100 }, curator: { invoked: 2, completed: 1, declined: 1, failed: 0, invalidJson: 0, timeouts: 0 }, alerts: [] },
  memoryInbox: { pending: 0, conflict: 0, approved: 2, rejected: 1, total: 3, approvalRate: 0.667 },
  secondBrain: { sourceCount: 1, chunkCount: 2, vectorCount: 0 },
};

const baseProps = {
  settings: settings(),
  status,
  draft: settingsValues(settings()),
  providerUi: {
    secrets: {
      openrouter: { configured: true, source: 'environment' as const, editable: false },
      'opencode-go': { configured: false, source: 'none' as const, editable: true },
    },
    keyDrafts: { openrouter: '', 'opencode-go': '' },
    keySaving: null,
    keyTesting: null,
    keyMessages: {},
    catalogs: {
      openrouter: { provider: 'openrouter' as const, models: [{ id: 'openrouter/free', name: 'OpenRouter Free', provider: 'openrouter' as const, isFree: true }], cachedAt: 1, source: 'pi' as const, stale: false },
      'opencode-go': { provider: 'opencode-go' as const, models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', provider: 'opencode-go' as const, isFree: false }], cachedAt: 1, source: 'remote' as const, stale: false },
    },
    catalogLoading: null,
    catalogErrors: {},
  },
  saving: false,
  reindexing: false,
  error: null,
  message: null,
  restartRequired: [] as string[],
  preset: null,
  preview: [],
  onDraftChange: () => undefined,
  onProviderChange: () => undefined,
  onModelChange: () => undefined,
  onReasoningChange: () => undefined,
  onKeyDraft: () => undefined,
  onSaveKey: () => undefined,
  onTestKey: () => undefined,
  onRefreshCatalog: () => undefined,
  onSelectPreset: () => undefined,
  onApplyPreset: () => undefined,
  onCancelPreset: () => undefined,
  onSave: () => undefined,
  onResetDraft: () => undefined,
  onReindex: () => undefined,
  onClose: () => undefined,
};

describe('AdminSettings UI', () => {
  test('mostra la pagina impostazioni e il pulsante di salvataggio', () => {
    const markup = renderToStaticMarkup(<AdminSettingsView {...baseProps} />);
    expect(markup).toContain('Impostazioni');
    expect(markup).toContain('Salva impostazioni');
    expect(markup).toContain('Reindex Second Brain');
    expect(markup).toContain('Turni simultanei');
    expect(markup).toContain('Notifiche browser a risposta pronta');
    expect(markup).toContain('Salvataggio automatico dei nuovi ricordi');
    expect(markup).toContain('Non esporre Memora pubblicamente senza autenticazione.');
  });

  test('mostra quali provider esterni ricevono messaggi e memorie', () => {
    const data = settings();
    data.settings.curator.enabled = field(true);
    const markup = renderToStaticMarkup(<AdminSettingsView {...baseProps} settings={data} draft={settingsValues(data)} />);
    expect(markup).toContain('Dati e provider esterni');
    expect(markup).toContain('Riceve il turno corrente, fino a 3 messaggi utente recenti e fino a 5 estratti di memoria pertinenti.');
    expect(markup).toContain('Calcolati sul dispositivo');
    expect(markup).toContain('i segreti bloccano l’analisi; email, telefoni, IBAN, carte e codici fiscali vengono rimossi');
    expect(markup).toContain('Nomi, indirizzi e altre PII non riconoscibili');
  });

  test('espone token budget, diversità e la navigazione tra sezioni', () => {
    const markup = renderToStaticMarkup(<AdminSettingsView {...baseProps} />);
    expect(markup).toContain('Token budget (stimati)');
    expect(markup).toContain('Diversità:');
    expect(markup).toContain('Pagine impostazioni');
    expect(markup).toContain('admin-page-appearance');
    expect(markup).toContain('Aspetto');
    expect(markup).toContain('admin-page-memory');
    expect(markup).toContain('admin-page-system');
    expect(markup).toContain('Osservabilità');
    expect(markup).toContain('admin-side-nav');
    expect(markup).toContain('Modelli');
    expect(markup).toContain('Integrazioni');
  });

  test('mostra provider, API key e selettore modello Chat', () => {
    const data = settings();
    const ui = { ...baseProps.providerUi, secrets: { ...baseProps.providerUi.secrets, openrouter: { configured: true, source: 'secret-store' as const, editable: true } } };
    const markup = renderToStaticMarkup(<AdminSettingsView {...baseProps} settings={data} draft={settingsValues(data)} providerUi={ui} />);
    expect(markup).toContain('OpenRouter');
    expect(markup).toContain('OpenCode Go');
    expect(markup).toContain('API key OpenRouter');
    expect(markup).toContain('Test connessione');
    expect(markup).toContain('Modello chat predefinito');
    expect(markup).toContain('Livello reasoning');
    expect((markup.match(/type="password"/g) ?? []).length).toBe(5); // 2 provider keys + 2 backup password fields + Mega password
    expect(markup).toContain('Usa la stessa chiave già associata a OpenRouter');
  });

  test('con provider Curator diverso mostra una sola chiave per provider riutilizzabile', () => {
    const data = settings();
    data.settings.curator.provider = field('opencode-go');
    const ui = {
      ...baseProps.providerUi,
      secrets: {
        openrouter: { configured: true, source: 'secret-store' as const, editable: true },
        'opencode-go': { configured: false, source: 'none' as const, editable: true },
      },
    };
    const markup = renderToStaticMarkup(<AdminSettingsView {...baseProps} settings={data} draft={settingsValues(data)} providerUi={ui} />);
    expect((markup.match(/type="password"/g) ?? []).length).toBe(6); // 3 provider keys + 2 backup password fields + Mega password
    expect(markup).toContain('API key OpenCode Go');
  });

  test('blocca il modello Chat quando è forzato dall’ambiente', () => {
    const data = settings();
    data.settings.chat.defaultModel = field('nvidia/nemotron-3.5-super-vl:free', 'environment');
    const markup = renderToStaticMarkup(<AdminSettingsView {...baseProps} settings={data} draft={settingsValues(data)} />);
    expect(markup).toContain('Il modello è forzato dall’ambiente');
    expect(markup).toContain('Gestito dall’ambiente');
    expect(markup).toMatch(/role="combobox"[^>]*disabled/);
  });

  test('mostra e blocca un campo gestito dall’ambiente', () => {
    const data = settings();
    data.settings.embeddings.enabled = field(true, 'environment', true);
    const markup = renderToStaticMarkup(
      <AdminSettingsView {...baseProps} settings={data} draft={settingsValues(data)} />,
    );
    expect(markup).toContain('Gestito dall’ambiente');
    expect(markup).toMatch(/type="checkbox"[^>]*disabled/);
  });

  test('il payload di salvataggio esclude i campi gestiti dall’ambiente', () => {
    const data = settings();
    const draft = settingsValues(data);
    draft.memory.topK = 7;
    draft.memory.maxChars = 5000;
    draft.embeddings.enabled = true;
    const patch = buildSettingsPatch(draft, data);
    expect(patch.memory).toEqual({ topK: 7, maxChars: 5000 });
    expect(patch.embeddings).toEqual({ enabled: true });
    expect(patch.embeddings?.model).toBeUndefined();
  });

  test('mostra le soglie di auto-approvazione quando abilitata', () => {
    const data = settings();
    data.settings.curator.autoApproveEnabled = field(true);
    const markup = renderToStaticMarkup(<AdminSettingsView {...baseProps} settings={data} draft={settingsValues(data)} />);
    expect(markup).toContain('Salvataggio automatico dei nuovi ricordi');
    expect(markup).toContain('Confidenza minima auto-salvataggio');
    expect(markup).toContain('Rilevanza minima auto-salvataggio');
  });

  test('valida i numeri e mostra un errore leggibile', () => {
    const invalid = settingsValues(settings());
    invalid.memory.topK = 0;
    expect(validateSettingsDraft(invalid)).toContain('topK');
    const invalidTurns = settingsValues(settings());
    invalidTurns.chat.maxConcurrentTurns = 5;
    expect(validateSettingsDraft(invalidTurns)).toContain('concorrenza');
    const invalidAutoApprove = settingsValues(settings());
    invalidAutoApprove.curator.autoApproveMinConfidence = 1.1;
    expect(validateSettingsDraft(invalidAutoApprove)).toContain('auto-approvazione');
    const markup = renderToStaticMarkup(<AdminSettingsView {...baseProps} error="topK deve essere un intero tra 1 e 50." />);
    expect(markup).toContain('topK deve essere un intero tra 1 e 50.');
  });

  test('anteprima Lite e Standard prima dell’applicazione', () => {
    const data = settings();
    data.settings.embeddings.enabled = field(true);
    const standardData = settings();
    const lite = presetPreview('lite', data);
    const standard = presetPreview('standard', standardData);
    expect(lite).toEqual([
      expect.objectContaining({ field: 'embeddings.enabled', from: 'ON', to: 'OFF', editable: true }),
      expect.objectContaining({ field: 'memory.searchMode', from: 'lexical', to: 'Lexical' }),
    ]);
    expect(standard).toEqual([
      expect.objectContaining({ field: 'embeddings.enabled', from: 'OFF', to: 'ON' }),
      expect.objectContaining({ field: 'memory.searchMode', from: 'lexical', to: 'Semantic' }),
    ]);
    expect(presetPatch('lite', data)).toEqual({ embeddings: { enabled: false }, memory: { searchMode: 'lexical' } });
    const markup = renderToStaticMarkup(<AdminSettingsView {...baseProps} settings={data} draft={settingsValues(data)} preset="lite" preview={lite} />);
    expect(markup).toContain('Modifiche del preset lite:');
    expect(markup).toContain('Applica preset');
  });

  test('segnala semantic/hybrid quando embeddings non sono disponibili', () => {
    const data = settings({ searchMode: field('semantic') });
    const markup = renderToStaticMarkup(<AdminSettingsView {...baseProps} settings={data} draft={settingsValues(data)} />);
    expect(markup).toContain('Semantic/Hybrid richiede un modello embedding locale disponibile');
  });
});
