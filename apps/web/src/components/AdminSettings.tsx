import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdminSettings as AdminSettingsData,
  AdminStatus,
  MemorySearchModeSetting,
  ProviderCatalog,
  ProviderConnectionResult,
  ProviderId,
  ProviderSecretStatus,
  ReasoningLevel,
  RuntimeSettings,
  RuntimeSettingsPatch,
  SettingField,
} from '@memora/shared';
import { PROVIDER_LABELS, REASONING_LEVELS } from '@memora/shared';
import { useI18n } from '../i18n';
import { WebSettingsPanel } from './WebSettingsPanel';
import {
  getAdminSettings,
  getAdminStatus,
  getProviderCatalog,
  getProviderSecrets,
  reindexMemory,
  saveProviderSecret,
  testProviderConnection,
  updateAdminSettings,
} from '../lib/api';
import { ModelCombobox, filterModels } from './ModelCombobox';
import { AppearanceSettings } from './AppearanceSettings';
import { AgentsAdminPanel } from './AgentsAdminPanel';
import { McpAdminPanel } from './McpAdminPanel';
import { TelegramAdminPanel } from './TelegramAdminPanel';
import { BackupAdminPanel } from './BackupAdminPanel';
import { UpdateAdminPanel } from './UpdateAdminPanel';
import {
  getBrowserNotificationPermission,
  isBrowserNotificationEnabled,
  requestBrowserNotificationPermission,
  setBrowserNotificationEnabled,
} from '../lib/browser-notifications';

type Preset = 'lite' | 'standard' | 'custom';
type Category = keyof RuntimeSettings;
type ModelRole = 'chat' | 'curator';
type ProviderSecrets = Record<ProviderId, ProviderSecretStatus>;
type KeyMessage = { ok: boolean; text: string };

function BrowserNotificationsSetting() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(() => isBrowserNotificationEnabled());
  const [permission, setPermission] = useState(() => getBrowserNotificationPermission());
  const [error, setError] = useState<string | null>(null);

  const toggle = async (next: boolean) => {
    setError(null);
    if (!next) {
      setBrowserNotificationEnabled(false);
      setEnabled(false);
      return;
    }
    const result = await requestBrowserNotificationPermission();
    setPermission(result);
    if (result !== 'granted') {
      setError(result === 'unsupported'
        ? t('Questo browser non supporta le notifiche.')
        : t('Permesso notifiche negato. Abilitalo nelle impostazioni del browser.'));
      return;
    }
    setBrowserNotificationEnabled(true);
    setEnabled(true);
  };

  return (
    <div className="admin-notification-setting">
      <label className="admin-toggle">
        <input type="checkbox" checked={enabled} onChange={event => void toggle(event.target.checked)} />
        <span>{t('Notifiche browser a risposta pronta')}</span>
      </label>
      <small>{t('Solo su questo browser. La scheda Memora deve restare aperta, anche in background.')}</small>
      {permission === 'denied' && <span className="admin-field-note is-locked">{t('Permesso notifiche negato nel browser.')}</span>}
      {error && <div role="alert" className="admin-alert is-error">{error}</div>}
    </div>
  );
}

interface AdminSettingsViewProps {
  settings: AdminSettingsData;
  status: AdminStatus | null;
  draft: RuntimeSettings;
  providerUi: ProviderUiState;
  saving: boolean;
  reindexing: boolean;
  error: string | null;
  message: string | null;
  restartRequired: string[];
  preset: Preset | null;
  preview: PresetPreview[];
  onDraftChange: (category: Category, field: string, value: unknown) => void;
  onProviderChange: (role: ModelRole, provider: ProviderId) => void;
  onModelChange: (role: ModelRole, modelId: string) => void;
  onReasoningChange: (role: ModelRole, level: ReasoningLevel) => void;
  onKeyDraft: (provider: ProviderId, value: string) => void;
  onSaveKey: (provider: ProviderId) => void;
  onTestKey: (provider: ProviderId) => void;
  onRefreshCatalog: (provider: ProviderId) => void;
  onSelectPreset: (preset: Preset) => void;
  onApplyPreset: () => void;
  onCancelPreset: () => void;
  onSave: () => void;
  onResetDraft: () => void;
  onReindex: () => void;
  onClose: () => void;
}

interface ProviderUiState {
  secrets: ProviderSecrets | null;
  keyDrafts: Record<ProviderId, string>;
  keySaving: ProviderId | null;
  keyTesting: ProviderId | null;
  keyMessages: Partial<Record<ProviderId, KeyMessage>>;
  catalogs: Partial<Record<ProviderId, ProviderCatalog>>;
  catalogLoading: ProviderId | null;
  catalogErrors: Partial<Record<ProviderId, string>>;
}

export interface PresetPreview {
  field: string;
  label: string;
  from: string;
  to: string;
  editable: boolean;
}

const modeDescriptions: Record<MemorySearchModeSetting, string> = {
  lexical: 'Minimo consumo RAM, ricerca per parole.',
  semantic: 'Ricerca per significato tramite embedding locale.',
  hybrid: 'Combina ricerca lessicale e semantica.',
};

export function settingsValues(settings: AdminSettingsData): RuntimeSettings {
  return {
    memory: {
      searchMode: settings.settings.memory.searchMode.value,
      topK: settings.settings.memory.topK.value,
      maxChars: settings.settings.memory.maxChars.value,
      maxTokens: settings.settings.memory.maxTokens.value,
      diversity: settings.settings.memory.diversity.value,
    },
    embeddings: {
      enabled: settings.settings.embeddings.enabled.value,
      model: settings.settings.embeddings.model.value,
    },
    curator: {
      enabled: settings.settings.curator.enabled.value,
      auto: settings.settings.curator.auto.value,
      provider: settings.settings.curator.provider.value,
      model: settings.settings.curator.model.value,
      reasoningLevel: settings.settings.curator.reasoningLevel.value,
      minConfidence: settings.settings.curator.minConfidence.value,
      minSalience: settings.settings.curator.minSalience.value,
      autoApproveEnabled: settings.settings.curator.autoApproveEnabled.value,
      autoApproveMinConfidence: settings.settings.curator.autoApproveMinConfidence.value,
      autoApproveMinSalience: settings.settings.curator.autoApproveMinSalience.value,
    },
    chat: {
      provider: settings.settings.chat.provider.value,
      defaultModel: settings.settings.chat.defaultModel.value,
      reasoningLevel: settings.settings.chat.reasoningLevel.value,
      autoTitleEnabled: settings.settings.chat.autoTitleEnabled.value,
      maxConcurrentTurns: settings.settings.chat.maxConcurrentTurns.value,
    },
  };
}

const fieldMetadata = (settings: AdminSettingsData, category: Category, field: string): SettingField<unknown> =>
  (settings.settings[category] as unknown as Record<string, SettingField<unknown>>)[field]!;

export function buildSettingsPatch(draft: RuntimeSettings, settings: AdminSettingsData): RuntimeSettingsPatch {
  const patch: RuntimeSettingsPatch = {};
  for (const category of ['memory', 'embeddings', 'curator', 'chat'] as const) {
    for (const [field, value] of Object.entries(draft[category])) {
      const metadata = fieldMetadata(settings, category, field);
      if (!metadata.editable || Object.is(metadata.value, value)) continue;
      const section = (patch[category] ?? {}) as Record<string, unknown>;
      section[field] = value;
      patch[category] = section as never;
    }
  }
  return patch;
}

export function switchProvider(draft: RuntimeSettings, role: ModelRole, provider: ProviderId): RuntimeSettings {
  if (role === 'chat') return { ...draft, chat: { ...draft.chat, provider, defaultModel: '' } };
  return { ...draft, curator: { ...draft.curator, provider, model: '' } };
}

export function validateSettingsDraft(draft: RuntimeSettings): string | null {
  if (!Number.isInteger(draft.memory.topK) || draft.memory.topK < 1 || draft.memory.topK > 50) return 'topK deve essere un intero tra 1 e 50.';
  if (!Number.isInteger(draft.memory.maxChars) || draft.memory.maxChars < 500 || draft.memory.maxChars > 50000) return 'maxChars deve essere un intero tra 500 e 50000.';
  if (!Number.isInteger(draft.memory.maxTokens) || draft.memory.maxTokens < 50 || draft.memory.maxTokens > 50000) return 'maxTokens deve essere un intero tra 50 e 50000.';
  if (!Number.isFinite(draft.memory.diversity) || draft.memory.diversity < 0 || draft.memory.diversity > 1) return 'diversity deve essere tra 0 e 1.';
  if (!Number.isFinite(draft.curator.minConfidence) || draft.curator.minConfidence < 0 || draft.curator.minConfidence > 1) return 'Minimum confidence deve essere tra 0 e 1.';
  if (!Number.isFinite(draft.curator.minSalience) || draft.curator.minSalience < 0 || draft.curator.minSalience > 1) return 'Minimum salience deve essere tra 0 e 1.';
  if (!Number.isFinite(draft.curator.autoApproveMinConfidence ?? 0.9) || (draft.curator.autoApproveMinConfidence ?? 0.9) < 0 || (draft.curator.autoApproveMinConfidence ?? 0.9) > 1) return 'La confidenza minima di auto-approvazione deve essere tra 0 e 1.';
  if (!Number.isFinite(draft.curator.autoApproveMinSalience ?? 0.85) || (draft.curator.autoApproveMinSalience ?? 0.85) < 0 || (draft.curator.autoApproveMinSalience ?? 0.85) > 1) return 'La rilevanza minima di auto-approvazione deve essere tra 0 e 1.';
  if (!draft.embeddings.model.trim()) return 'Il modello embedding non può essere vuoto.';
  if (!draft.chat.defaultModel.trim()) return 'Il modello chat predefinito non può essere vuoto.';
  if (draft.curator.enabled && !draft.curator.model.trim()) return 'Seleziona un modello per il Memory Curator.';
  if (!Number.isInteger(draft.chat.maxConcurrentTurns ?? 2) || (draft.chat.maxConcurrentTurns ?? 2) < 1 || (draft.chat.maxConcurrentTurns ?? 2) > 4) return 'La concorrenza dei turni deve essere un intero tra 1 e 4.';
  return null;
}

export function validateModelSelections(
  draft: RuntimeSettings,
  catalogs: Partial<Record<ProviderId, ProviderCatalog>>,
): string | null {
  const chatModels = catalogs[draft.chat.provider]?.models;
  if (chatModels && !chatModels.some(model => model.id === draft.chat.defaultModel)) return 'Il modello chat non appartiene al provider selezionato.';
  const curatorModels = catalogs[draft.curator.provider]?.models;
  if (draft.curator.enabled && curatorModels && !curatorModels.some(model => model.id === draft.curator.model)) return 'Il modello Curator non appartiene al provider selezionato.';
  return null;
}

export function presetPreview(preset: Preset, settings: AdminSettingsData): PresetPreview[] {
  if (preset === 'custom') return [];
  const changes: Array<{ category: Category; field: 'enabled' | 'searchMode'; label: string; value: unknown; display: string }> = preset === 'lite'
    ? [
        { category: 'embeddings', field: 'enabled', label: 'Embeddings', value: false, display: 'OFF' },
        { category: 'memory', field: 'searchMode', label: 'Retrieval mode', value: 'lexical', display: 'Lexical' },
      ]
    : [
        { category: 'embeddings', field: 'enabled', label: 'Embeddings', value: true, display: 'ON' },
        { category: 'memory', field: 'searchMode', label: 'Retrieval mode', value: 'semantic', display: 'Semantic' },
      ];
  return changes.map((change) => {
    const metadata = fieldMetadata(settings, change.category, change.field);
    const current = change.field === 'enabled' ? (metadata.value ? 'ON' : 'OFF') : String(metadata.value);
    return {
      field: `${change.category}.${change.field}`,
      label: change.label,
      from: metadata.source === 'environment' ? 'Gestito dall’ambiente' : current,
      to: metadata.source === 'environment' ? 'Gestito dall’ambiente' : change.display,
      editable: metadata.editable,
    };
  });
}

export function presetPatch(preset: Preset, settings: AdminSettingsData): RuntimeSettingsPatch {
  if (preset === 'custom') return {};
  const patch: RuntimeSettingsPatch = {};
  for (const change of presetPreview(preset, settings)) {
    if (!change.editable) continue;
    const [category, field] = change.field.split('.') as [Category, string];
    if (category === 'embeddings' && field === 'enabled') patch.embeddings = { ...patch.embeddings, enabled: preset === 'standard' };
    if (category === 'memory' && field === 'searchMode') patch.memory = { ...patch.memory, searchMode: preset === 'standard' ? 'semantic' : 'lexical' };
  }
  return patch;
}

export function isSemanticUnavailable(settings: AdminSettingsData, status: AdminStatus | null): boolean {
  const mode = settings.settings.memory.searchMode.value;
  if (mode === 'lexical') return false;
  return !settings.settings.embeddings.enabled.value || !status?.embeddings.available;
}

function FieldLock({ field }: { field: SettingField<unknown> }) {
  const { t } = useI18n();
  if (field.source !== 'environment') return field.requiresRestart ? <span className="admin-field-note">{t('Richiede riavvio')}</span> : null;
  return <span className="admin-field-note is-locked">{t('Gestito dall’ambiente')}</span>;
}

function credentialLabel(status: ProviderSecretStatus | undefined, t: (source: string) => string): string {
  if (!status?.configured) return t('non configurata');
  return t(status.source === 'environment' ? 'configurata dall’ambiente' : 'configurata nel secret store');
}

interface ProviderCredentialProps {
  provider: ProviderId;
  status?: ProviderSecretStatus;
  state: ProviderUiState;
  showInput: boolean;
  onKeyDraft: (provider: ProviderId, value: string) => void;
  onSaveKey: (provider: ProviderId) => void;
  onTestKey: (provider: ProviderId) => void;
}

function ProviderCredential({ provider, status, state, showInput, onKeyDraft, onSaveKey, onTestKey }: ProviderCredentialProps) {
  const { t } = useI18n();
  const message = state.keyMessages[provider];
  const busy = state.keySaving === provider || state.keyTesting === provider;
  return (
    <div className="provider-credential">
      <div className="provider-credential-status">
        <span>API key {PROVIDER_LABELS[provider]}</span>
        <strong className={status?.configured ? 'is-configured' : 'is-missing'}>{credentialLabel(status, t)}</strong>
        {status?.source === 'environment' && <span className="admin-field-note is-locked">{t('Gestito dall’ambiente')}</span>}
      </div>
      {showInput && status?.editable !== false && (
        <div className="provider-key-row">
          <input
            type="password"
            autoComplete="new-password"
            placeholder={status?.configured ? t('Inserisci una nuova chiave per sostituirla') : t('Inserisci API key')}
            value={state.keyDrafts[provider]}
            onChange={(event) => onKeyDraft(provider, event.target.value)}
          />
          <button type="button" onClick={() => onSaveKey(provider)} disabled={busy || !state.keyDrafts[provider].trim()}>
            {state.keySaving === provider ? t('Salvo…') : t('Salva/Cambia')}
          </button>
          <button type="button" onClick={() => onTestKey(provider)} disabled={busy || (!state.keyDrafts[provider].trim() && !status?.configured)}>
            {state.keyTesting === provider ? t('Verifico…') : t('Test connessione')}
          </button>
        </div>
      )}
      {!showInput && <p className="admin-card-description">{t('Usa la stessa chiave già associata a {provider}.', { provider: PROVIDER_LABELS[provider] })}</p>}
      {message && <div className={`provider-key-message ${message.ok ? 'is-ok' : 'is-error'}`} role="status">{message.ok ? '✓' : '✗'} {message.text}</div>}
    </div>
  );
}

interface ModelFieldProps {
  role: ModelRole;
  provider: ProviderId;
  value: string;
  reasoningLevel: ReasoningLevel;
  state: ProviderUiState;
  settings: AdminSettingsData;
  onProviderChange: (role: ModelRole, provider: ProviderId) => void;
  onModelChange: (role: ModelRole, modelId: string) => void;
  onReasoningChange: (role: ModelRole, level: ReasoningLevel) => void;
  onRefreshCatalog: (provider: ProviderId) => void;
}

function ModelField({ role, provider, value, reasoningLevel, state, settings, onProviderChange, onModelChange, onReasoningChange, onRefreshCatalog }: ModelFieldProps) {
  const { t } = useI18n();
  const category = role === 'chat' ? 'chat' : 'curator';
  const providerMeta = fieldMetadata(settings, category, 'provider');
  const modelMeta = fieldMetadata(settings, category, role === 'chat' ? 'defaultModel' : 'model');
  const reasoningMeta = fieldMetadata(settings, category, 'reasoningLevel');
  const catalog = state.catalogs[provider];
  const usableModels = role === 'curator' && provider === 'opencode-go'
    ? (catalog?.models ?? []).filter(model => model.api === 'openai-completions')
    : catalog?.models ?? [];
  const loading = state.catalogLoading === provider;
  const error = state.catalogErrors[provider];
  const selectedModel = usableModels.find(model => model.id === value);
  const reasoningChoices = role === 'curator' && selectedModel?.reasoningLevels?.length
    ? selectedModel.reasoningLevels
    : REASONING_LEVELS;
  return (
    <div className="model-field">
      <div className="admin-grid-2">
        <label className="admin-label">{t('Provider')}
          <select
            value={provider}
            disabled={!providerMeta.editable}
            onChange={(event) => onProviderChange(role, event.target.value as ProviderId)}
          >
            <option value="openrouter">OpenRouter</option>
            <option value="opencode-go">OpenCode Go</option>
          </select>
          <FieldLock field={providerMeta} />
        </label>
        <div className="admin-label">{t('Stato catalogo')}
          <span className="model-catalog-status">
            {loading ? t('Caricamento…') : catalog ? t('{count} modelli', { count: usableModels.length }) : t('Non caricato')}
            {catalog?.stale && <small>cache/fallback</small>}
          </span>
        </div>
      </div>
      {error && <div className="admin-inline-warning">{error}</div>}
      {!modelMeta.editable && (
        <div className="admin-inline-warning">
          Il modello è forzato dall’ambiente. Rimuovi <code>{role === 'chat' ? 'OPENROUTER_MODEL' : 'MEMORA_MEMORY_CURATOR_MODEL'}</code> dal deployment per gestirlo dalla UI.
        </div>
      )}
      {catalog?.warning && <div className="admin-inline-warning">{catalog.warning}</div>}
      <label className="admin-label">{role === 'chat' ? t('Modello chat predefinito') : t('Modello Curator')}
        <ModelCombobox
          models={usableModels}
          provider={provider}
          value={value}
          disabled={!modelMeta.editable}
          loading={loading}
          onChange={(modelId) => onModelChange(role, modelId)}
          onRefresh={() => onRefreshCatalog(provider)}
        />
        <FieldLock field={modelMeta} />
      </label>
      <label className="admin-label">{t('Livello reasoning')}
        <select value={reasoningLevel} disabled={!reasoningMeta.editable} onChange={(event) => onReasoningChange(role, event.target.value as ReasoningLevel)}>
          {reasoningChoices.map(level => <option key={level} value={level}>{level}</option>)}
        </select>
        <FieldLock field={reasoningMeta} />
      </label>
    </div>
  );
}

export function AdminSettingsView({
  settings,
  status,
  draft,
  providerUi,
  saving,
  reindexing,
  error,
  message,
  restartRequired,
  preset,
  preview,
  onDraftChange,
  onProviderChange,
  onModelChange,
  onReasoningChange,
  onKeyDraft,
  onSaveKey,
  onTestKey,
  onRefreshCatalog,
  onSelectPreset,
  onApplyPreset,
  onCancelPreset,
  onSave,
  onResetDraft,
  onReindex,
  onClose,
}: AdminSettingsViewProps) {
  const { t } = useI18n();
  const semanticUnavailable = isSemanticUnavailable(settings, status);
  const field = (category: Category, name: string) => fieldMetadata(settings, category, name);
  const disabled = (category: Category, name: string) => !field(category, name).editable || saving;
  const hasChanges = Object.keys(buildSettingsPatch(draft, settings)).length > 0 ||
    Object.values(providerUi.keyDrafts).some(value => value.trim().length > 0);
  const chatStatus = providerUi.secrets?.[draft.chat.provider];
  const curatorStatus = providerUi.secrets?.[draft.curator.provider];
  const showCuratorKey = draft.curator.provider !== draft.chat.provider;
  const [activePage, setActivePage] = useState('general');
  const groups = [
    ['general', 'Generale'],
    ['models', 'Modelli'],
    ['memory', 'Memoria'],
    ['integrations', 'Integrazioni'],
    ['agents', 'Agenti'],
    ['system', 'Sistema'],
  ] as const;

  return (
    <section className="admin-settings" aria-label="Impostazioni amministrazione">
      <div className="admin-settings-header">
        <div>
          <h2>{t('Impostazioni')}</h2>
          <p>{t('Configurazione runtime persistente. Le API key sono nel secret store locale e non vengono mai restituite.')}</p>
        </div>
        <button type="button" className="admin-close" onClick={onClose}>{t('Torna alla chat')}</button>
      </div>

      {error && <div role="alert" className="admin-alert is-error">{error}</div>}
      {message && <div className="admin-alert is-success">{message}</div>}
      {restartRequired.length > 0 && (
        <div className="admin-alert is-warning">
          Riavvio Memora necessario per: {restartRequired.join(', ')}. Nessun riavvio automatico viene eseguito.
        </div>
      )}

      <div className="admin-layout">
      <nav id="admin-pages-nav" className="admin-side-nav" aria-label={t('Pagine impostazioni')}>
        {groups.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={activePage === id ? 'page' : undefined}
            className={activePage === id ? 'is-active' : ''}
            onClick={() => {
              setActivePage(id);
              document.getElementById('admin-pages-nav')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            {t(label)}
          </button>
        ))}
      </nav>

      <div className="admin-content">


      <div id="admin-page-appearance" className="admin-page" hidden={activePage !== 'general'}>
        <AppearanceSettings />
      </div>

      <div id="admin-page-general" className="admin-page" hidden={activePage !== 'general'}>
      <section id="admin-section-general" className="admin-card">
        <h3>{t('Generale')}</h3>
        <p className="admin-card-description">{t('Nessun preset viene applicato senza anteprima e conferma.')}</p>
        <div className="admin-presets">
          <button type="button" className={preset === 'lite' ? 'is-active' : ''} onClick={() => onSelectPreset('lite')}>
            <strong>{t('Lite')}</strong><span>{t('Consigliato per VPS piccole / 1–2 GB RAM.')}</span>
          </button>
          <button type="button" className={preset === 'standard' ? 'is-active' : ''} onClick={() => onSelectPreset('standard')}>
            <strong>{t('Standard')}</strong><span>{t('Consigliato da 4 GB RAM.')}</span>
          </button>
          <button type="button" className={preset === 'custom' ? 'is-active' : ''} onClick={() => onSelectPreset('custom')}>
            <strong>{t('Custom')}</strong><span>{t('Configurazione manuale.')}</span>
          </button>
        </div>
        {preset && preset !== 'custom' && (
          <div className="admin-preset-preview">
            <strong>Modifiche del preset {preset}:</strong>
            <ul>
              {preview.map((change) => (
                <li key={change.field}>{change.label}: <code>{change.from}</code> → <code>{change.to}</code>{!change.editable && ' (bloccato dall’ambiente)'}</li>
              ))}
            </ul>
            <div className="admin-actions">
              <button type="button" className="admin-primary" onClick={onApplyPreset} disabled={saving}>{t('Applica preset')}</button>
              <button type="button" onClick={onCancelPreset} disabled={saving}>{t('Annulla')}</button>
            </div>
          </div>
        )}
      </section>
      </div>

      <div id="admin-page-chat" className="admin-page" hidden={activePage !== 'models'}>
      <section id="admin-section-chat" className="admin-card">
        <h3>{t('Chat')}</h3>
        <ModelField
          role="chat"
          provider={draft.chat.provider}
          value={draft.chat.defaultModel}
          reasoningLevel={draft.chat.reasoningLevel}
          state={providerUi}
          settings={settings}
          onProviderChange={onProviderChange}
          onModelChange={onModelChange}
          onReasoningChange={onReasoningChange}
          onRefreshCatalog={onRefreshCatalog}
        />
        <ProviderCredential
          provider={draft.chat.provider}
          status={chatStatus}
          state={providerUi}
          showInput
          onKeyDraft={onKeyDraft}
          onSaveKey={onSaveKey}
          onTestKey={onTestKey}
        />
        <label className="admin-toggle">
          <input type="checkbox" checked={draft.chat.autoTitleEnabled !== false} disabled={disabled('chat', 'autoTitleEnabled')} onChange={event => onDraftChange('chat', 'autoTitleEnabled', event.target.checked)} />
          <span>{t('Titoli automatici delle chat')}</span>
        </label>
        <FieldLock field={field('chat', 'autoTitleEnabled')} />
        <label className="admin-label">{t('Turni simultanei')}
          <input type="number" min={1} max={4} value={draft.chat.maxConcurrentTurns ?? 2} disabled={disabled('chat', 'maxConcurrentTurns')} onChange={event => onDraftChange('chat', 'maxConcurrentTurns', Number(event.target.value))} />
          <small>{t('Quante risposte possono essere generate in parallelo (1–4). Le altre restano in coda.')}</small>
          <FieldLock field={field('chat', 'maxConcurrentTurns')} />
        </label>
        <BrowserNotificationsSetting />
        <p className="admin-card-description">Il modello Chat viene usato solo dalle nuove sessioni; quelle esistenti mantengono il modello già persistito. I titoli automatici usano solo il primo messaggio della nuova chat; il titolo manuale non viene sovrascritto.</p>
      </section>
      </div>

      <div id="admin-page-agents" className="admin-page" hidden={activePage !== 'agents'}>
        <AgentsAdminPanel />
      </div>

      <div id="admin-page-mcp" className="admin-page" hidden={activePage !== 'integrations'}>
        <McpAdminPanel />
      </div>

      <div id="admin-page-telegram" className="admin-page" hidden={activePage !== 'integrations'}>
        <TelegramAdminPanel />
      </div>

      <div id="admin-page-backup" className="admin-page" hidden={activePage !== 'system'}>
        <BackupAdminPanel />
      </div>


      <div id="admin-page-memory" className="admin-page" hidden={activePage !== 'memory'}>
      <section id="admin-section-memory" className="admin-card">
        <h3>{t('Memoria')}</h3>
        <div className="admin-mode-grid" role="radiogroup" aria-label="Retrieval mode">
          {(['lexical', 'semantic', 'hybrid'] as const).map((mode) => (
            <label key={mode} className={`admin-mode${draft.memory.searchMode === mode ? ' is-selected' : ''}${mode !== 'lexical' && semanticUnavailable ? ' is-unavailable' : ''}`}>
              <input
                type="radio"
                name="memory-search-mode"
                value={mode}
                checked={draft.memory.searchMode === mode}
                disabled={disabled('memory', 'searchMode')}
                onChange={() => onDraftChange('memory', 'searchMode', mode)}
              />
              <strong>{mode[0]!.toUpperCase() + mode.slice(1)}</strong>
              <span>{modeDescriptions[mode]}</span>
            </label>
          ))}
        </div>
        <FieldLock field={field('memory', 'searchMode')} />
        {semanticUnavailable && <div className="admin-inline-warning">Semantic/Hybrid richiede un modello embedding locale disponibile; senza di esso il runtime usa Lexical.</div>}
        <div className="admin-grid-2">
          <label className="admin-label">Top K
            <input type="number" min={1} max={50} value={draft.memory.topK} disabled={disabled('memory', 'topK')} onChange={(event) => onDraftChange('memory', 'topK', Number(event.target.value))} />
            <FieldLock field={field('memory', 'topK')} />
          </label>
          <label className="admin-label">Max characters
            <input type="number" min={500} max={50000} value={draft.memory.maxChars} disabled={disabled('memory', 'maxChars')} onChange={(event) => onDraftChange('memory', 'maxChars', Number(event.target.value))} />
            <FieldLock field={field('memory', 'maxChars')} />
          </label>
          <label className="admin-label">Token budget (stimati)
            <input type="number" min={50} max={50000} value={draft.memory.maxTokens} disabled={disabled('memory', 'maxTokens')} onChange={(event) => onDraftChange('memory', 'maxTokens', Number(event.target.value))} />
            <small>Limite del contesto dopo filtri e diversità. Stima: caratteri / 4.</small>
            <FieldLock field={field('memory', 'maxTokens')} />
          </label>
          <label className="admin-label">Diversità: {draft.memory.diversity.toFixed(2)}
            <input type="range" min={0} max={1} step={0.05} value={draft.memory.diversity} disabled={disabled('memory', 'diversity')} onChange={(event) => onDraftChange('memory', 'diversity', Number(event.target.value))} />
            <small>Penalizza chunk ridondanti. 0 = disabilitata.</small>
            <FieldLock field={field('memory', 'diversity')} />
          </label>
        </div>
      </section>

      <section id="admin-section-embeddings" className="admin-card">
        <h3>{t('Embeddings')}</h3>
        <label className="admin-toggle">
          <input type="checkbox" checked={draft.embeddings.enabled} disabled={disabled('embeddings', 'enabled')} onChange={(event) => onDraftChange('embeddings', 'enabled', event.target.checked)} />
          <span>Enable semantic embeddings</span>
        </label>
        <FieldLock field={field('embeddings', 'enabled')} />
        <label className="admin-label">Embedding model
          <input value={draft.embeddings.model} disabled={disabled('embeddings', 'model')} onChange={(event) => onDraftChange('embeddings', 'model', event.target.value)} />
          <FieldLock field={field('embeddings', 'model')} />
        </label>
        <p className="admin-card-description">Il modello viene preparato con <code>pnpm embeddings:setup</code>. Nessun download viene avviato da questa pagina.</p>
        <div className="admin-status-inline">
          <span>Status: <strong>{status?.embeddings.loaded ? 'Loaded' : status?.embeddings.available ? 'Available' : 'Non disponibile'}</strong></span>
          <span>Dimensions: <strong>{status?.embeddings.dimensions ?? '—'}</strong></span>
        </div>
        <div className="admin-actions">
          <button type="button" onClick={onReindex} disabled={reindexing || saving}>{reindexing ? 'Reindicizzo…' : 'Reindex Second Brain'}</button>
        </div>
      </section>
      </div>

      <div id="admin-page-curator" className="admin-page" hidden={activePage !== 'models'}>
      <section id="admin-section-curator" className="admin-card">
        <h3>{t('Memory Curator')}</h3>
        <label className="admin-toggle">
          <input type="checkbox" checked={draft.curator.enabled} disabled={disabled('curator', 'enabled')} onChange={(event) => onDraftChange('curator', 'enabled', event.target.checked)} />
          <span>Automatic Memory Curator</span>
        </label>
        <FieldLock field={field('curator', 'enabled')} />
        <label className="admin-toggle">
          <input type="checkbox" checked={draft.curator.auto} disabled={disabled('curator', 'auto')} onChange={(event) => onDraftChange('curator', 'auto', event.target.checked)} />
          <span>Automatic detection</span>
        </label>
        <FieldLock field={field('curator', 'auto')} />
        <ModelField
          role="curator"
          provider={draft.curator.provider}
          value={draft.curator.model}
          reasoningLevel={draft.curator.reasoningLevel}
          state={providerUi}
          settings={settings}
          onProviderChange={onProviderChange}
          onModelChange={onModelChange}
          onReasoningChange={onReasoningChange}
          onRefreshCatalog={onRefreshCatalog}
        />
        <ProviderCredential
          provider={draft.curator.provider}
          status={curatorStatus}
          state={providerUi}
          showInput={showCuratorKey}
          onKeyDraft={onKeyDraft}
          onSaveKey={onSaveKey}
          onTestKey={onTestKey}
        />
        <div className="admin-grid-2">
          <label className="admin-label">Minimum confidence: {draft.curator.minConfidence.toFixed(2)}
            <input type="range" min={0} max={1} step={0.05} value={draft.curator.minConfidence} disabled={disabled('curator', 'minConfidence')} onChange={(event) => onDraftChange('curator', 'minConfidence', Number(event.target.value))} />
            <small>Quanto il Curator è sicuro della propria interpretazione.</small>
          </label>
          <label className="admin-label">Minimum salience: {draft.curator.minSalience.toFixed(2)}
            <input type="range" min={0} max={1} step={0.05} value={draft.curator.minSalience} disabled={disabled('curator', 'minSalience')} onChange={(event) => onDraftChange('curator', 'minSalience', Number(event.target.value))} />
            <small>Quanto l’informazione è considerata importante e durevole.</small>
          </label>
        </div>
        <div className="admin-auto-approve">
          <label className="admin-toggle">
            <input type="checkbox" checked={draft.curator.autoApproveEnabled === true} disabled={disabled('curator', 'autoApproveEnabled')} onChange={(event) => onDraftChange('curator', 'autoApproveEnabled', event.target.checked)} />
            <span>{t('Salvataggio automatico dei nuovi ricordi')}</span>
          </label>
          <FieldLock field={field('curator', 'autoApproveEnabled')} />
          <p className="admin-card-description">{t('Salva automaticamente solo i nuovi ricordi con confidenza e rilevanza alte. Aggiornamenti, conflitti, duplicati e dati personali restano in revisione manuale.')}</p>
          {draft.curator.autoApproveEnabled === true && (
            <div className="admin-grid-2">
              <label className="admin-label">{t('Confidenza minima auto-salvataggio')}: {(draft.curator.autoApproveMinConfidence ?? 0.9).toFixed(2)}
                <input type="range" min={0} max={1} step={0.05} value={draft.curator.autoApproveMinConfidence ?? 0.9} disabled={disabled('curator', 'autoApproveMinConfidence')} onChange={(event) => onDraftChange('curator', 'autoApproveMinConfidence', Number(event.target.value))} />
                <small>{t('Soglia più alta = meno salvataggi automatici, maggiore prudenza.')}</small>
                <FieldLock field={field('curator', 'autoApproveMinConfidence')} />
              </label>
              <label className="admin-label">{t('Rilevanza minima auto-salvataggio')}: {(draft.curator.autoApproveMinSalience ?? 0.85).toFixed(2)}
                <input type="range" min={0} max={1} step={0.05} value={draft.curator.autoApproveMinSalience ?? 0.85} disabled={disabled('curator', 'autoApproveMinSalience')} onChange={(event) => onDraftChange('curator', 'autoApproveMinSalience', Number(event.target.value))} />
                <small>{t('La rilevanza combina importanza, durabilità, utilità futura, novità e confidenza.')}</small>
                <FieldLock field={field('curator', 'autoApproveMinSalience')} />
              </label>
            </div>
          )}
        </div>
        <p className="admin-card-description">Provider e modello Curator vengono ricaricati a caldo se il Curator è già attivo; abilitarlo/disabilitarlo richiede un riavvio. Il livello reasoning è applicato subito e gli errori del provider non bloccano la chat.</p>
      </section>
      </div>

      <div id="admin-page-web" className="admin-page" hidden={activePage !== 'integrations'}>
        <WebSettingsPanel />
      </div>

      <div id="admin-page-system" className="admin-page" hidden={activePage !== 'system'}>
      <section id="admin-section-egress" className="admin-card">
        <h3>{t('Dati e provider esterni')}</h3>
        <div className="admin-egress-grid">
          <div>
            <span>Chat</span>
            <strong>{PROVIDER_LABELS[draft.chat.provider]}</strong>
            <p>Riceve i messaggi e le risposte della conversazione per generare il turno.</p>
          </div>
          <div>
            <span>Memory Curator</span>
            <strong>{draft.curator.enabled ? PROVIDER_LABELS[draft.curator.provider] : 'Disabilitato'}</strong>
            <p>{draft.curator.enabled
              ? 'Riceve il turno corrente, fino a 3 messaggi utente recenti e fino a 5 estratti di memoria pertinenti.'
              : 'Nessun contenuto viene inviato al Curator finché non viene abilitato.'}</p>
          </div>
          <div>
            <span>Embeddings</span>
            <strong>Locali</strong>
            <p>Calcolati sul dispositivo; i documenti della memoria non vengono inviati per l’indicizzazione.</p>
          </div>
          <div>
            <span>Log</span>
            <strong>Solo metadata</strong>
            <p>Provider, esito, latenza e token; nessun messaggio, prompt o contenuto di memoria.</p>
          </div>
        </div>
        <p className="admin-egress-warning">Prima dell’invio al Curator i segreti bloccano l’analisi; email, telefoni, IBAN, carte e codici fiscali vengono rimossi. Nomi, indirizzi e altre PII non riconoscibili possono ancora essere inviati: non inserire dati che non vuoi condividere con il provider.</p>
      </section>

      <section className="admin-card">
        <h3>{t('Osservabilità')}</h3>
        {status && status.metrics.alerts.length > 0 && (
          <div className="admin-inline-warning" role="status">
            {status.metrics.alerts.join(' · ')}
          </div>
        )}
        <div className="admin-system-grid">
          <div><span>Ricerche</span><strong>{status?.metrics.retrieval.searches ?? '—'}</strong></div>
          <div><span>Errori retrieval</span><strong>{status?.metrics.retrieval.errors ?? '—'}</strong></div>
          <div><span>Latenza media / max</span><strong>{status ? `${status.metrics.retrieval.averageLatencyMs.toFixed(1)} / ${status.metrics.retrieval.maxLatencyMs.toFixed(1)} ms` : '—'}</strong></div>
          <div><span>Token stimati recuperati</span><strong>{status?.metrics.retrieval.estimatedTokens ?? '—'}</strong></div>
          <div><span>Curator completati / falliti</span><strong>{status ? `${status.metrics.curator.completed} / ${status.metrics.curator.failed}` : '—'}</strong></div>
          <div><span>Curator declinati</span><strong>{status?.metrics.curator.declined ?? '—'}</strong></div>
          <div><span>Inbox pending / conflict</span><strong>{status ? `${status.memoryInbox.pending} / ${status.memoryInbox.conflict}` : '—'}</strong></div>
          <div><span>Tasso approvazione</span><strong>{status?.memoryInbox.approvalRate === null || status?.memoryInbox.approvalRate === undefined ? '—' : `${Math.round(status.memoryInbox.approvalRate * 100)}%`}</strong></div>
        </div>
      </section>

      <section id="admin-section-system" className="admin-card">
        <h3>{t('Sistema')}</h3>
        <div className="admin-system-grid">
          <div><span>Memora</span><strong>{status?.memoraVersion ?? '—'}</strong></div>
          <div><span>Node</span><strong>{status?.nodeVersion ?? '—'}</strong></div>
          <div><span>Uptime</span><strong>{status ? `${status.uptimeSeconds}s` : '—'}</strong></div>
          <div><span>Data dir</span><strong title={status?.dataDir}>{status?.dataDir ?? '—'}</strong></div>
          <div><span>Retrieval effettivo</span><strong>{status?.memory.effectiveMode ?? '—'}</strong></div>
          <div><span>Token budget / diversità</span><strong>{status ? `${status.memory.maxTokens} / ${status.memory.diversity.toFixed(2)}` : '—'}</strong></div>
          <div><span>Chat attuale</span><strong>{status ? `${PROVIDER_LABELS[status.chat.provider]} / ${status.chat.model}` : '—'}</strong></div>
          <div><span>Chat credential</span><strong>{status ? (status.chat.credential.configured ? 'configured' : 'missing') : '—'}</strong></div>
          <div><span>Turni simultanei</span><strong>{status?.chat.maxConcurrentTurns ?? '—'}</strong></div>
          <div><span>Curator</span><strong>{status ? `${PROVIDER_LABELS[status.curator.provider]} / ${status.curator.model || '—'}` : '—'}</strong></div>
          <div><span>Curator credential</span><strong>{status ? (status.curator.credential.configured ? 'configured' : 'missing') : '—'}</strong></div>
          <div><span>Curator queue</span><strong>{status ? `${status.curator.queueLength ?? 0} in coda · ${status.curator.queueFailed} failed · ${status.curator.queueAttempts} tentativi` : '—'}</strong></div>
          <div><span>Sources / chunks</span><strong>{status ? `${status.secondBrain.sourceCount} / ${status.secondBrain.chunkCount}` : '—'}</strong></div>
          <div><span>Vectors</span><strong>{status?.secondBrain.vectorCount ?? '—'}</strong></div>
        </div>
        <p className="admin-security-note">Non esporre Memora pubblicamente senza autenticazione. Le API amministrative sono centralizzate sotto <code>/api/admin/*</code>.</p>
      </section>

      <UpdateAdminPanel />
      </div>

      </div>
      </div>

      {['general', 'models', 'memory'].includes(activePage) && <div className="admin-savebar">
        <span>{hasChanges ? t('Modifiche non salvate') : t('Nessuna modifica non salvata')} · {t('I valori gestiti dall’ambiente non vengono inviati.')}</span>
        <div className="admin-savebar-actions">
          <button type="button" onClick={onResetDraft} disabled={saving || !hasChanges}>{t('Annulla')}</button>
          <button type="button" className="admin-primary" onClick={onSave} disabled={saving}>{saving ? t('Salvo…') : t('Salva impostazioni')}</button>
        </div>
      </div>}
    </section>
  );
}

const emptyKeys: Record<ProviderId, string> = { openrouter: '', 'opencode-go': '' };

export function AdminSettings({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AdminSettingsData | null>(null);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [draft, setDraft] = useState<RuntimeSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState<string[]>([]);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<ProviderId, string>>({ ...emptyKeys });
  const [secrets, setSecrets] = useState<ProviderSecrets | null>(null);
  const [keySaving, setKeySaving] = useState<ProviderId | null>(null);
  const [keyTesting, setKeyTesting] = useState<ProviderId | null>(null);
  const [keyMessages, setKeyMessages] = useState<Partial<Record<ProviderId, KeyMessage>>>({});
  const [catalogs, setCatalogs] = useState<Partial<Record<ProviderId, ProviderCatalog>>>({});
  const [catalogLoading, setCatalogLoading] = useState<ProviderId | null>(null);
  const [catalogErrors, setCatalogErrors] = useState<Partial<Record<ProviderId, string>>>({});

  const loadCatalog = useCallback(async (provider: ProviderId, refresh = false) => {
    setCatalogLoading(provider);
    setCatalogErrors(current => ({ ...current, [provider]: undefined }));
    try {
      const catalog = await getProviderCatalog(provider, refresh);
      setCatalogs(current => ({ ...current, [provider]: catalog }));
    } catch (err) {
      setCatalogErrors(current => ({ ...current, [provider]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setCatalogLoading(current => current === provider ? null : current);
    }
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextSettings, nextStatus, nextSecrets] = await Promise.all([getAdminSettings(), getAdminStatus(), getProviderSecrets()]);
      setSettings(nextSettings);
      setStatus(nextStatus);
      setSecrets(nextSecrets);
      const nextDraft = settingsValues(nextSettings);
      setDraft(nextDraft);
      const providers = [...new Set([nextDraft.chat.provider, nextDraft.curator.provider])];
      await Promise.all(providers.map(provider => loadCatalog(provider)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadCatalog]);

  useEffect(() => { void load(); }, [load]);

  const preview = useMemo(() => settings && preset ? presetPreview(preset, settings) : [], [settings, preset]);

  const handleDraftChange = useCallback((category: Category, field: string, value: unknown) => {
    setDraft((current) => {
      if (!current) return current;
      return { ...current, [category]: { ...current[category], [field]: value } } as RuntimeSettings;
    });
    setMessage(null);
  }, []);

  const handleProviderChange = useCallback((role: ModelRole, provider: ProviderId) => {
    setDraft((current) => {
      if (!current) return current;
      return switchProvider(current, role, provider);
    });
    if (!catalogs[provider]) void loadCatalog(provider);
    setMessage(null);
  }, [catalogs, loadCatalog]);

  const handleModelChange = useCallback((role: ModelRole, modelId: string) => {
    setDraft(current => {
      if (!current) return current;
      const provider = role === 'chat' ? current.chat.provider : current.curator.provider;
      const selected = catalogs[provider]?.models.find(model => model.id === modelId);
      if (role === 'chat') return { ...current, chat: { ...current.chat, defaultModel: modelId } };
      const allowed = selected?.reasoningLevels;
      const reasoningLevel = allowed?.length && !allowed.includes(current.curator.reasoningLevel)
        ? (allowed.includes('low') ? 'low' : allowed[0]!)
        : current.curator.reasoningLevel;
      return { ...current, curator: { ...current.curator, model: modelId, reasoningLevel } };
    });
    setMessage(null);
  }, [catalogs]);

  const handleReasoningChange = useCallback((role: ModelRole, level: ReasoningLevel) => {
    setDraft(current => current ? role === 'chat'
      ? { ...current, chat: { ...current.chat, reasoningLevel: level } }
      : { ...current, curator: { ...current.curator, reasoningLevel: level } } : current);
    setMessage(null);
  }, []);

  const handleKeyDraft = useCallback((provider: ProviderId, value: string) => {
    setKeyDrafts(current => ({ ...current, [provider]: value }));
    setKeyMessages(current => ({ ...current, [provider]: undefined }));
  }, []);

  const handleSaveKey = useCallback(async (provider: ProviderId) => {
    const key = keyDrafts[provider].trim();
    if (!key) return;
    setKeySaving(provider);
    setKeyMessages(current => ({ ...current, [provider]: undefined }));
    try {
      const saved = await saveProviderSecret(provider, key);
      setSecrets(current => current ? { ...current, [provider]: { configured: saved.configured, source: saved.source, editable: saved.editable } } : current);
      setKeyDrafts(current => ({ ...current, [provider]: '' }));
      if (saved.restartRequired.length > 0) setRestartRequired(current => [...new Set([...current, ...saved.restartRequired])]);
      setStatus(await getAdminStatus());
      setMessage(`Chiave ${PROVIDER_LABELS[provider]} salvata.`);
    } catch (err) {
      setKeyMessages(current => ({ ...current, [provider]: { ok: false, text: err instanceof Error ? err.message : String(err) } }));
    } finally {
      setKeySaving(null);
    }
  }, [keyDrafts]);

  const handleTestKey = useCallback(async (provider: ProviderId) => {
    setKeyTesting(provider);
    setKeyMessages(current => ({ ...current, [provider]: undefined }));
    try {
      const result: ProviderConnectionResult = await testProviderConnection(provider, keyDrafts[provider].trim() || undefined);
      setKeyMessages(current => ({
        ...current,
        [provider]: result.ok
          ? { ok: true, text: 'Connessione riuscita' }
          : { ok: false, text: result.error === 'invalid_credentials' ? 'Credenziale non valida' : 'Connessione non riuscita' },
      }));
    } catch (err) {
      setKeyMessages(current => ({ ...current, [provider]: { ok: false, text: err instanceof Error ? err.message : String(err) } }));
    } finally {
      setKeyTesting(null);
    }
  }, [keyDrafts]);

  const handleSave = useCallback(async () => {
    if (!settings || !draft) return;
    const validation = validateSettingsDraft(draft) ?? validateModelSelections(draft, catalogs);
    if (validation) { setError(validation); return; }
    const patch = buildSettingsPatch(draft, settings);
    if (!Object.keys(patch).length) {
      setMessage('Nessuna modifica da salvare.');
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await updateAdminSettings(patch);
      setSettings(result);
      setDraft(settingsValues(result));
      setStatus(await getAdminStatus());
      setRestartRequired(result.restartRequired);
      if (result.changed.some(key => key === 'chat.provider' || key === 'chat.defaultModel')) {
        window.dispatchEvent(new CustomEvent('memora-chat-default-changed', {
          detail: {
            model: result.settings.chat.defaultModel.value,
            provider: result.settings.chat.provider.value,
            reasoningLevel: result.settings.chat.reasoningLevel.value,
          },
        }));
      }
      setMessage(result.changed.length === 0 ? 'Nessuna modifica effettiva.' : 'Impostazioni salvate.');
      setPreset(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [catalogs, draft, settings]);

  const handleReset = useCallback(() => {
    if (!settings) return;
    setDraft(settingsValues(settings));
    setKeyDrafts({ ...emptyKeys });
    setError(null);
    setMessage('Modifiche non salvate annullate.');
  }, [settings]);

  const applyPreset = useCallback(async () => {
    if (!settings || !preset) return;
    const patch = presetPatch(preset, settings);
    if (!Object.keys(patch).length) {
      setMessage('Nessuna modifica applicabile: i campi del preset sono gestiti dall’ambiente.');
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await updateAdminSettings(patch);
      setSettings(result);
      setDraft(settingsValues(result));
      setStatus(await getAdminStatus());
      setRestartRequired(result.restartRequired);
      setMessage(`Preset ${preset} applicato.`);
      setPreset(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [preset, settings]);

  const handleReindex = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.confirm('Reindicizzare il Second Brain? L’operazione può richiedere tempo.')) return;
    setReindexing(true);
    setError(null);
    try {
      await reindexMemory();
      setStatus(await getAdminStatus());
      setMessage('Reindex completato.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReindexing(false);
    }
  }, []);

  if (!settings || !draft) {
    return (
      <section className="admin-settings">
        <div className="admin-settings-header"><div><h2>{t('Impostazioni')}</h2><p>Caricamento configurazione…</p></div><button type="button" className="admin-close" onClick={onClose}>{t('Torna alla chat')}</button></div>
        {error && <div role="alert" className="admin-alert is-error">{error}</div>}
      </section>
    );
  }

  const providerUi: ProviderUiState = { secrets, keyDrafts, keySaving, keyTesting, keyMessages, catalogs, catalogLoading, catalogErrors };

  return (
    <AdminSettingsView
      settings={settings}
      status={status}
      draft={draft}
      providerUi={providerUi}
      saving={saving}
      reindexing={reindexing}
      error={error}
      message={message}
      restartRequired={restartRequired}
      preset={preset}
      preview={preview}
      onDraftChange={handleDraftChange}
      onProviderChange={handleProviderChange}
      onModelChange={handleModelChange}
      onReasoningChange={handleReasoningChange}
      onKeyDraft={handleKeyDraft}
      onSaveKey={(provider) => void handleSaveKey(provider)}
      onTestKey={(provider) => void handleTestKey(provider)}
      onRefreshCatalog={(provider) => void loadCatalog(provider, true)}
      onSelectPreset={setPreset}
      onApplyPreset={() => void applyPreset()}
      onCancelPreset={() => setPreset(null)}
      onSave={() => void handleSave()}
      onResetDraft={handleReset}
      onReindex={() => void handleReindex()}
      onClose={onClose}
    />
  );
}

export { filterModels };
