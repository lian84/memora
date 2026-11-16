import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProviderId, ProviderSecretStatus } from '@memora/shared';

export const PROVIDER_SECRET_ENV: Record<ProviderId, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  'opencode-go': 'OPENCODE_API_KEY',
};

interface SecretsFile {
  version: 1;
  secrets: Partial<Record<ProviderId, string>>;
}

export class SecretStoreError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'SecretStoreError';
  }
}

export interface SecretStoreOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
}

/** Stores provider credentials separately from runtime settings. */
export class SecretStore {
  readonly filePath: string;
  private readonly configDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly warn: (message: string) => void;
  private stored: Partial<Record<ProviderId, string>> = {};

  constructor(options: SecretStoreOptions) {
    this.configDir = path.join(options.dataDir, 'config');
    this.filePath = path.join(this.configDir, 'secrets.json');
    this.env = options.env ?? process.env;
    this.warn = options.warn ?? (() => {});
  }

  async load(): Promise<void> {
    this.stored = {};
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf-8')) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid');
      const data = raw as Partial<SecretsFile>;
      if (data.version !== 1 || !data.secrets || typeof data.secrets !== 'object' || Array.isArray(data.secrets)) throw new Error('invalid');
      for (const provider of Object.keys(PROVIDER_SECRET_ENV) as ProviderId[]) {
        const value = data.secrets[provider];
        if (typeof value === 'string' && value.length > 0 && value.length <= 4096 && ![...value].some(char => char.charCodeAt(0) < 32)) {
          this.stored[provider] = value;
        }
      }
      await fs.chmod(this.filePath, 0o600).catch(() => {});
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warn('secrets file ignored: invalid or unreadable format');
    }
  }

  getKey(provider: ProviderId): string | undefined {
    const envName = PROVIDER_SECRET_ENV[provider];
    const environment = this.env[envName];
    if (environment !== undefined && environment !== '') return environment;
    return this.stored[provider];
  }

  getStatus(provider: ProviderId): ProviderSecretStatus {
    const envName = PROVIDER_SECRET_ENV[provider];
    if (this.env[envName] !== undefined && this.env[envName] !== '') {
      return { configured: true, source: 'environment', editable: false };
    }
    if (this.stored[provider]) return { configured: true, source: 'secret-store', editable: true };
    return { configured: false, source: 'none', editable: true };
  }

  async setKey(provider: ProviderId, apiKey: unknown): Promise<ProviderSecretStatus> {
    if (!(provider in PROVIDER_SECRET_ENV)) throw new SecretStoreError('invalid_provider', 'Provider non supportato');
    if (this.getStatus(provider).source === 'environment') {
      throw new SecretStoreError('secret_managed_by_environment', 'La chiave è gestita dall’ambiente', 409);
    }
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0 || apiKey.length > 4096 || [...apiKey].some(char => char.charCodeAt(0) < 32)) {
      throw new SecretStoreError('invalid_secret', 'La chiave API non è valida');
    }
    const next = { ...this.stored, [provider]: apiKey.trim() };
    await this.persist(next);
    this.stored = next;
    return this.getStatus(provider);
  }

  private async persist(stored: Partial<Record<ProviderId, string>>): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
    const payload: SecretsFile = { version: 1, secrets: stored };
    const tempPath = path.join(this.configDir, `.secrets.${process.pid}.${Date.now()}.tmp`);
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
      await fs.rename(tempPath, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }
}
