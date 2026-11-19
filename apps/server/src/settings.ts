import fs from 'node:fs/promises';
import { memoraEnv } from './env.js';
import path from 'node:path';
import {
  DEFAULT_RUNTIME_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  type AdminSettings,
  type ChatProvider,
  type MemorySearchModeSetting,
  type RuntimeSettings,
  type RuntimeSettingsPatch,
  type ReasoningLevel,
  type SettingField,
  type SettingSource,
} from '@memora/shared';

const CATEGORIES = ['memory', 'embeddings', 'curator', 'chat'] as const;

type SettingKey =
  | 'memory.searchMode'
  | 'memory.topK'
  | 'memory.maxChars'
  | 'memory.maxTokens'
  | 'memory.diversity'
  | 'embeddings.enabled'
  | 'embeddings.model'
  | 'curator.enabled'
  | 'curator.auto'
  | 'curator.provider'
  | 'curator.model'
  | 'curator.reasoningLevel'
  | 'curator.minConfidence'
  | 'curator.minSalience'
  | 'curator.autoApproveEnabled'
  | 'curator.autoApproveMinConfidence'
  | 'curator.autoApproveMinSalience'
  | 'chat.provider'
  | 'chat.defaultModel'
  | 'chat.reasoningLevel'
  | 'chat.autoTitleEnabled'
  | 'chat.maxConcurrentTurns';

interface SettingDefinition {
  env: string[];
  requiresRestart: boolean;
  validate(value: unknown): boolean;
  parseEnv(value: string): unknown;
}

const safeModelId = (value: string): boolean =>
  value.length <= 160 &&
  !value.includes('..') &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,100}(?:\/[A-Za-z0-9][A-Za-z0-9._:-]{0,100})?$/.test(value);

const safeEmbeddingModelId = (value: string): boolean =>
  value.length <= 160 &&
  !value.includes('..') &&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(value);

const booleanValue = (value: unknown): boolean => typeof value === 'boolean';
const numberInRange = (min: number, max: number, integer = false) => (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isSafeInteger(value));

const SETTING_DEFINITIONS: Record<SettingKey, SettingDefinition> = {
  'memory.searchMode': {
    env: ['MEMORA_MEMORY_SEARCH_MODE'],
    requiresRestart: false,
    validate: (value) => value === 'lexical' || value === 'semantic' || value === 'hybrid',
    parseEnv: (value) => value.trim().toLowerCase(),
  },
  'memory.topK': {
    env: ['MEMORA_MEMORY_TOP_K'],
    requiresRestart: false,
    validate: numberInRange(1, 50, true),
    parseEnv: (value) => Number(value),
  },
  'memory.maxChars': {
    env: ['MEMORA_MEMORY_MAX_CHARS'],
    requiresRestart: false,
    validate: numberInRange(500, 50000, true),
    parseEnv: (value) => Number(value),
  },
  'memory.maxTokens': {
    env: ['MEMORA_MEMORY_MAX_TOKENS'],
    requiresRestart: false,
    validate: numberInRange(50, 50000, true),
    parseEnv: (value) => Number(value),
  },
  'memory.diversity': {
    env: ['MEMORA_MEMORY_DIVERSITY'],
    requiresRestart: false,
    validate: numberInRange(0, 1),
    parseEnv: (value) => Number(value),
  },
  'embeddings.enabled': {
    env: ['MEMORA_EMBEDDINGS_ENABLED'],
    requiresRestart: true,
    validate: booleanValue,
    parseEnv: (value) => parseBoolean(value),
  },
  'embeddings.model': {
    env: ['MEMORA_EMBEDDING_MODEL'],
    requiresRestart: true,
    validate: (value) => typeof value === 'string' && safeEmbeddingModelId(value),
    parseEnv: (value) => value.trim(),
  },
  'curator.enabled': {
    env: ['MEMORA_MEMORY_CURATOR_ENABLED'],
    requiresRestart: true,
    validate: booleanValue,
    parseEnv: (value) => parseBoolean(value),
  },
  'curator.provider': {
    env: ['MEMORA_MEMORY_CURATOR_PROVIDER'],
    requiresRestart: false,
    validate: (value) => value === 'openrouter' || value === 'opencode-go',
    parseEnv: (value) => value.trim().toLowerCase(),
  },
  'curator.auto': {
    env: ['MEMORA_MEMORY_CURATOR_AUTO'],
    requiresRestart: false,
    validate: booleanValue,
    parseEnv: (value) => parseBoolean(value),
  },
  'curator.reasoningLevel': {
    env: ['MEMORA_MEMORY_CURATOR_REASONING_LEVEL'],
    requiresRestart: false,
    validate: (value) => typeof value === 'string' && ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value),
    parseEnv: (value) => value.trim().toLowerCase(),
  },
  'curator.model': {
    env: ['MEMORA_MEMORY_CURATOR_MODEL'],
    requiresRestart: false,
    validate: (value) => typeof value === 'string' && (value === '' || safeModelId(value)),
    parseEnv: (value) => value.trim(),
  },
  'curator.minConfidence': {
    env: ['MEMORA_MEMORY_CURATOR_MIN_CONFIDENCE'],
    requiresRestart: false,
    validate: numberInRange(0, 1),
    parseEnv: (value) => Number(value),
  },
  'curator.minSalience': {
    env: ['MEMORA_MEMORY_CURATOR_MIN_SALIENCE'],
    requiresRestart: false,
    validate: numberInRange(0, 1),
    parseEnv: (value) => Number(value),
  },
  'curator.autoApproveEnabled': {
    env: [],
    requiresRestart: false,
    validate: booleanValue,
    parseEnv: (value) => parseBoolean(value),
  },
  'curator.autoApproveMinConfidence': {
    env: [],
    requiresRestart: false,
    validate: numberInRange(0, 1),
    parseEnv: (value) => Number(value),
  },
  'curator.autoApproveMinSalience': {
    env: [],
    requiresRestart: false,
    validate: numberInRange(0, 1),
    parseEnv: (value) => Number(value),
  },
  'chat.provider': {
    env: ['MEMORA_CHAT_PROVIDER'],
    requiresRestart: false,
    validate: (value) => value === 'openrouter' || value === 'opencode-go',
    parseEnv: (value) => value.trim().toLowerCase(),
  },
  'chat.reasoningLevel': {
    env: ['MEMORA_CHAT_REASONING_LEVEL'],
    requiresRestart: false,
    validate: (value) => typeof value === 'string' && ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value),
    parseEnv: (value) => value.trim().toLowerCase(),
  },
  'chat.defaultModel': {
    env: ['OPENROUTER_MODEL'],
    requiresRestart: false,
    validate: (value) => typeof value === 'string' && safeModelId(value),
    parseEnv: (value) => value.trim(),
  },
  'chat.autoTitleEnabled': {
    env: [],
    requiresRestart: false,
    validate: booleanValue,
    parseEnv: (value) => parseBoolean(value),
  },
  'chat.maxConcurrentTurns': {
    env: [],
    requiresRestart: false,
    validate: numberInRange(1, 4, true),
    parseEnv: (value) => Number(value),
  },
};

const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

function parseBoolean(value: string): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneSettings(settings: RuntimeSettings): RuntimeSettings {
  return structuredClone(settings);
}

function getAt(settings: RuntimeSettings | RuntimeSettingsPatch, key: SettingKey): unknown {
  const [category, field] = key.split('.') as [string, string];
  return (settings as unknown as Record<string, Record<string, unknown>>)[category]?.[field];
}

function hasAt(settings: RuntimeSettingsPatch, key: SettingKey): boolean {
  const [category, field] = key.split('.') as [keyof RuntimeSettingsPatch, string];
  const section = settings[category];
  return !!section && Object.prototype.hasOwnProperty.call(section, field);
}

function setAt(target: RuntimeSettingsPatch, key: SettingKey, value: unknown): void {
  const [category, field] = key.split('.') as [keyof RuntimeSettingsPatch, string];
  const section = (target[category] ?? {}) as Record<string, unknown>;
  section[field] = value;
  target[category] = section as never;
}

function mergePatch(base: RuntimeSettingsPatch, update: RuntimeSettingsPatch): RuntimeSettingsPatch {
  const merged = structuredClone(base);
  for (const category of CATEGORIES) {
    if (update[category]) setSection(merged, category, { ...(merged[category] ?? {}), ...update[category] });
  }
  return merged;
}

function setSection(target: RuntimeSettingsPatch, category: keyof RuntimeSettingsPatch, value: object): void {
  target[category] = value as never;
}

function isSecretKey(key: string): boolean {
  if (key === 'maxTokens') return false;
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.includes('apikey') || normalized.includes('password') || normalized.includes('secret') ||
    normalized.includes('token') || normalized.includes('credential');
}

function containsSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => isSecretKey(key) || containsSecretKey(child));
}

export class SettingsError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'SettingsError';
  }
}

export interface SettingsStoreOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
}

export interface SettingsPatchResult {
  changed: SettingKey[];
  restartRequired: SettingKey[];
}

export class AdminSettingsStore {
  readonly filePath: string;
  private readonly configDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly warn: (message: string) => void;
  private fileOverrides: RuntimeSettingsPatch = {};
  private resolved = cloneSettings(DEFAULT_RUNTIME_SETTINGS);
  private sources = new Map<SettingKey, SettingSource>();
  readonly warnings: string[] = [];

  constructor(options: SettingsStoreOptions) {
    this.configDir = path.join(options.dataDir, 'config');
    this.filePath = path.join(this.configDir, 'settings.json');
    this.env = options.env ?? process.env;
    this.warn = options.warn ?? (() => {});
    for (const key of SETTING_KEYS) this.sources.set(key, 'default');
  }

  async load(): Promise<void> {
    this.fileOverrides = {};
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      this.fileOverrides = this.parseFile(content);
      await fs.chmod(this.filePath, 0o600).catch(() => {});
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.reportWarning(`settings file ignored: ${error instanceof SyntaxError || error instanceof SettingsError ? 'invalid format' : 'unreadable'}`);
      }
    }
    this.resolve();
  }

  getSettings(): RuntimeSettings {
    return cloneSettings(this.resolved);
  }

  getSource(key: SettingKey): SettingSource {
    return this.sources.get(key) ?? 'default';
  }

  getAdminSettings(): AdminSettings {
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: {
        memory: {
          searchMode: this.field<MemorySearchModeSetting>('memory.searchMode'),
          topK: this.field<number>('memory.topK'),
          maxChars: this.field<number>('memory.maxChars'),
          maxTokens: this.field<number>('memory.maxTokens'),
          diversity: this.field<number>('memory.diversity'),
        },
        embeddings: {
          enabled: this.field<boolean>('embeddings.enabled'),
          model: this.field<string>('embeddings.model'),
        },
        curator: {
          enabled: this.field<boolean>('curator.enabled'),
          auto: this.field<boolean>('curator.auto'),
          provider: this.field<ChatProvider>('curator.provider'),
          model: this.field<string>('curator.model'),
          reasoningLevel: this.field<ReasoningLevel>('curator.reasoningLevel'),
          minConfidence: this.field<number>('curator.minConfidence'),
          minSalience: this.field<number>('curator.minSalience'),
          autoApproveEnabled: this.field<boolean>('curator.autoApproveEnabled'),
          autoApproveMinConfidence: this.field<number>('curator.autoApproveMinConfidence'),
          autoApproveMinSalience: this.field<number>('curator.autoApproveMinSalience'),
        },
        chat: {
          provider: this.field<ChatProvider>('chat.provider'),
          defaultModel: this.field<string>('chat.defaultModel'),
          reasoningLevel: this.field<ReasoningLevel>('chat.reasoningLevel'),
          autoTitleEnabled: this.field<boolean>('chat.autoTitleEnabled'),
          maxConcurrentTurns: this.field<number>('chat.maxConcurrentTurns'),
        },
      },
    };
  }

  async patch(input: unknown): Promise<SettingsPatchResult> {
    if (!isRecord(input)) throw new SettingsError('invalid_settings', 'Le impostazioni devono essere un oggetto JSON');
    if (containsSecretKey(input)) throw new SettingsError('secret_keys_forbidden', 'Le impostazioni non possono contenere segreti');

    const requested: RuntimeSettingsPatch = {};
    const incoming: SettingKey[] = [];
    for (const [category, section] of Object.entries(input)) {
      if (!(CATEGORIES as readonly string[]).includes(category)) {
        throw new SettingsError('unknown_setting', `Categoria di impostazioni sconosciuta: ${category}`);
      }
      if (!isRecord(section)) throw new SettingsError('invalid_settings', `La categoria ${category} deve essere un oggetto`);
      for (const [fieldName, value] of Object.entries(section)) {
        const key = `${category}.${fieldName}` as SettingKey;
        const definition = SETTING_DEFINITIONS[key];
        if (!definition) throw new SettingsError('unknown_setting', `Impostazione sconosciuta: ${key}`);
        if (this.getSource(key) === 'environment') {
          throw new SettingsError('setting_managed_by_environment', `${key} è gestita dall'ambiente`, 409);
        }
        if (!definition.validate(value)) throw new SettingsError('invalid_setting_value', `Valore non valido per ${key}`);
        setAt(requested, key, value);
        incoming.push(key);
      }
    }

    const previous = cloneSettings(this.resolved);
    const nextFileOverrides = mergePatch(this.fileOverrides, requested);
    await this.persist(nextFileOverrides);
    this.fileOverrides = nextFileOverrides;
    this.resolve();

    const changed = incoming.filter((key) => getAt(previous, key) !== getAt(this.resolved, key));
    return {
      changed,
      restartRequired: changed.filter((key) => SETTING_DEFINITIONS[key].requiresRestart),
    };
  }

  private field<T>(key: SettingKey): SettingField<T> {
    const source = this.getSource(key);
    return {
      value: getAt(this.resolved, key) as T,
      source,
      editable: source !== 'environment',
      requiresRestart: SETTING_DEFINITIONS[key].requiresRestart,
    };
  }

  private resolve(): void {
    const resolved = cloneSettings(DEFAULT_RUNTIME_SETTINGS);
    const sources = new Map<SettingKey, SettingSource>();
    for (const key of SETTING_KEYS) {
      if (hasAt(this.fileOverrides, key)) {
        setAt(resolved, key, getAt(this.fileOverrides, key));
        sources.set(key, 'file');
      } else {
        sources.set(key, 'default');
      }
    }

    for (const key of SETTING_KEYS) {
      const definition = SETTING_DEFINITIONS[key];
      let envName = definition.env.find((name) => Object.prototype.hasOwnProperty.call(this.env, name));
      let raw = envName ? this.env[envName] : undefined;
      const hybridLegacy = memoraEnv('HYBRID_SEARCH_ENABLED', this.env);
      if (key === 'memory.searchMode' && !envName && hybridLegacy === 'true') {
        envName = 'MEMORA_HYBRID_SEARCH_ENABLED';
        raw = 'hybrid';
      }
      if (raw === undefined) continue;
      const value = envName === 'MEMORA_HYBRID_SEARCH_ENABLED' ? 'hybrid' : definition.parseEnv(raw);
      if (value === undefined || !definition.validate(value)) {
        this.reportWarning(`environment override ignored for ${key}`);
        continue;
      }
      setAt(resolved, key, value);
      sources.set(key, 'environment');
    }

    this.resolved = resolved;
    this.sources = sources;
  }

  private parseFile(content: string): RuntimeSettingsPatch {
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new SettingsError('invalid_settings_file', 'settings.json non è JSON valido');
    }
    if (!isRecord(raw) || raw.version !== SETTINGS_SCHEMA_VERSION) {
      throw new SettingsError('invalid_settings_file', 'Versione schema settings.json non supportata');
    }

    const overrides: RuntimeSettingsPatch = {};
    for (const [category, section] of Object.entries(raw)) {
      if (category === 'version') continue;
      if (!(CATEGORIES as readonly string[]).includes(category)) {
        this.reportWarning(`unknown settings category ignored: ${category}`);
        continue;
      }
      if (!isRecord(section)) {
        this.reportWarning(`invalid settings category ignored: ${category}`);
        continue;
      }
      for (const [fieldName, value] of Object.entries(section)) {
        const key = `${category}.${fieldName}` as SettingKey;
        const definition = SETTING_DEFINITIONS[key];
        if (!definition) {
          this.reportWarning(`unknown setting ignored: ${key}`);
          continue;
        }
        if (!definition.validate(value)) {
          this.reportWarning(`invalid setting ignored: ${key}`);
          continue;
        }
        setAt(overrides, key, value);
      }
    }
    return overrides;
  }

  private async persist(overrides: RuntimeSettingsPatch): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
    const payload = { version: SETTINGS_SCHEMA_VERSION, ...structuredClone(overrides) };
    const tempPath = path.join(this.configDir, `.settings.${process.pid}.${Date.now()}.tmp`);
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
      await fs.rename(tempPath, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  private reportWarning(message: string): void {
    this.warnings.push(message);
    this.warn(message);
  }
}
