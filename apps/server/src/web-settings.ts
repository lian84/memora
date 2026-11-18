import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { WebConfig, WebProvider, WebSettingsView } from '@memora/shared';

const DEFAULTS: WebConfig = {
  enabled: false,
  provider: 'brave',
  maxResults: 5,
  maxChars: 20_000,
  timeoutMs: 15_000,
  searxngUrl: 'http://127.0.0.1:8080',
  braveApiKey: '',
};

export class WebSettingsError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WebSettingsError';
  }
}

export class WebSettingsStore {
  private readonly filePath: string;
  private settings: WebConfig = { ...DEFAULTS };

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'config', 'web.json');
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<WebConfig>;
      this.settings = this.validate({ ...DEFAULTS, ...raw });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new WebSettingsError('invalid_web_settings', 'Configurazione web non valida');
    }
  }

  private validate(input: WebConfig): WebConfig {
    if (input.provider !== 'brave' && input.provider !== 'searxng') throw new WebSettingsError('invalid_web_provider', 'Provider web non valido');
    if (!Number.isSafeInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 10) throw new WebSettingsError('invalid_web_settings', 'Risultati web non validi');
    if (!Number.isSafeInteger(input.maxChars) || input.maxChars < 1000 || input.maxChars > 50000) throw new WebSettingsError('invalid_web_settings', 'Limite caratteri web non valido');
    if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 2000 || input.timeoutMs > 60000) throw new WebSettingsError('invalid_web_settings', 'Timeout web non valido');
    if (typeof input.searxngUrl !== 'string' || input.searxngUrl.length > 500) throw new WebSettingsError('invalid_web_settings', 'URL SearXNG non valido');
    if (input.searxngUrl && !/^https?:\/\//i.test(input.searxngUrl)) throw new WebSettingsError('invalid_web_settings', 'URL SearXNG non valido');
    if (typeof input.braveApiKey !== 'string' || input.braveApiKey.length > 4096 || [...input.braveApiKey].some(char => char.charCodeAt(0) < 32)) throw new WebSettingsError('invalid_web_settings', 'API key Brave non valida');
    return input;
  }

  getConfig(): WebConfig { return { ...this.settings, searxngUrl: this.settings.searxngUrl.trim() }; }

  getPublic(): WebSettingsView {
    const { braveApiKey, ...settings } = this.settings;
    return { ...settings, braveConfigured: Boolean(braveApiKey) };
  }

  async update(patch: Partial<WebConfig>): Promise<WebSettingsView> {
    const next = this.validate({
      ...this.settings,
      ...(patch.enabled !== undefined ? { enabled: Boolean(patch.enabled) } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider as WebProvider } : {}),
      ...(patch.maxResults !== undefined ? { maxResults: Number(patch.maxResults) } : {}),
      ...(patch.maxChars !== undefined ? { maxChars: Number(patch.maxChars) } : {}),
      ...(patch.timeoutMs !== undefined ? { timeoutMs: Number(patch.timeoutMs) } : {}),
      ...(patch.searxngUrl !== undefined ? { searxngUrl: String(patch.searxngUrl) } : {}),
      ...(patch.braveApiKey !== undefined ? { braveApiKey: String(patch.braveApiKey) } : {}),
    });
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.tmp-${crypto.randomUUID()}`;
    await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, this.filePath);
    await fs.chmod(this.filePath, 0o600);
    this.settings = next;
    return this.getPublic();
  }
}
