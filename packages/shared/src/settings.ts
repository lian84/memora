import type { ProviderId, ProviderSecretStatus, ReasoningLevel } from './providers.js';

export const SETTINGS_SCHEMA_VERSION = 1;

export type MemorySearchModeSetting = 'lexical' | 'semantic' | 'hybrid';
export type ChatProvider = ProviderId;

export interface RuntimeSettings {
  memory: {
    searchMode: MemorySearchModeSetting;
    topK: number;
    maxChars: number;
    maxTokens: number;
    diversity: number;
  };
  embeddings: {
    enabled: boolean;
    model: string;
  };
  curator: {
    enabled: boolean;
    auto: boolean;
    provider: ChatProvider;
    model: string;
    reasoningLevel: ReasoningLevel;
    minConfidence: number;
    minSalience: number;
  };
  chat: {
    provider: ChatProvider;
    defaultModel: string;
    reasoningLevel: ReasoningLevel;
    /** Titolo LLM automatico per le nuove chat; il fallback locale resta attivo. */
    autoTitleEnabled?: boolean;
    /** Numero massimo di turni eseguiti in parallelo. */
    maxConcurrentTurns?: number;
  };
}

export type RuntimeSettingsPatch = {
  memory?: Partial<RuntimeSettings['memory']>;
  embeddings?: Partial<RuntimeSettings['embeddings']>;
  curator?: Partial<RuntimeSettings['curator']>;
  chat?: Partial<RuntimeSettings['chat']>;
};

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  memory: { searchMode: 'lexical', topK: 5, maxChars: 4000, maxTokens: 1000, diversity: 0.15 },
  embeddings: { enabled: false, model: 'Horizon-Labs/multilingual-embedding-small' },
  curator: {
    enabled: false,
    auto: true,
    provider: 'openrouter',
    model: '',
    reasoningLevel: 'low',
    minConfidence: 0.75,
    minSalience: 0.7,
  },
  chat: { provider: 'openrouter', defaultModel: 'openrouter/free', reasoningLevel: 'medium', autoTitleEnabled: true, maxConcurrentTurns: 2 },
};

export type SettingSource = 'default' | 'file' | 'environment';

export interface SettingField<T> {
  value: T;
  source: SettingSource;
  editable: boolean;
  /** A change affects the runtime only after process restart. */
  requiresRestart: boolean;
}

export interface AdminSettings {
  schemaVersion: number;
  settings: {
    memory: {
      searchMode: SettingField<MemorySearchModeSetting>;
      topK: SettingField<number>;
      maxChars: SettingField<number>;
      maxTokens: SettingField<number>;
      diversity: SettingField<number>;
    };
    embeddings: {
      enabled: SettingField<boolean>;
      model: SettingField<string>;
    };
    curator: {
      enabled: SettingField<boolean>;
      auto: SettingField<boolean>;
      provider: SettingField<ChatProvider>;
      model: SettingField<string>;
      reasoningLevel: SettingField<ReasoningLevel>;
      minConfidence: SettingField<number>;
      minSalience: SettingField<number>;
    };
    chat: {
      provider: SettingField<ChatProvider>;
      defaultModel: SettingField<string>;
      reasoningLevel: SettingField<ReasoningLevel>;
      autoTitleEnabled: SettingField<boolean>;
      maxConcurrentTurns: SettingField<number>;
    };
  };
}

export interface AdminSettingsUpdate extends AdminSettings {
  changed: string[];
  appliedLive: string[];
  restartRequired: string[];
}

export interface EmbeddingRuntimeStatus {
  enabled: boolean;
  available: boolean;
  model: string | null;
  loaded: boolean;
  dimensions: number | null;
}

export interface RuntimeMetricsSnapshot {
  generatedAt: number;
  retrieval: {
    searches: number;
    errors: number;
    averageLatencyMs: number;
    maxLatencyMs: number;
    results: number;
    estimatedTokens: number;
  };
  curator: {
    invoked: number;
    completed: number;
    declined: number;
    failed: number;
    invalidJson: number;
    timeouts: number;
  };
  alerts: string[];
}

export interface AdminStatus {
  memoraVersion: string;
  nodeVersion: string;
  uptimeSeconds: number;
  dataDir: string;
  memory: {
    configuredMode: MemorySearchModeSetting;
    effectiveMode: MemorySearchModeSetting;
    topK: number;
    maxChars: number;
    maxTokens: number;
    diversity: number;
  };
  chat: {
    provider: ChatProvider;
    model: string;
    reasoningLevel: ReasoningLevel;
    autoTitleEnabled: boolean;
    maxConcurrentTurns: number;
    credential: ProviderSecretStatus;
  };
  embeddings: EmbeddingRuntimeStatus;
  curator: {
    enabled: boolean;
    auto: boolean;
    provider: ChatProvider;
    model: string;
    reasoningLevel: ReasoningLevel;
    credential: ProviderSecretStatus;
    queueLength: number | null;
    queueFailed: number;
    queueAttempts: number;
  };
  metrics: RuntimeMetricsSnapshot;
  memoryInbox: {
    pending: number;
    conflict: number;
    approved: number;
    rejected: number;
    total: number;
    approvalRate: number | null;
  };
  secondBrain: {
    sourceCount: number;
    chunkCount: number;
    vectorCount: number;
  };
}
