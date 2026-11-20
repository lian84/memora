import fs from 'node:fs/promises';
import path from 'node:path';
import type { TelegramChat, TelegramSettingsView } from '@memora/shared';

const TELEGRAM_ENV_TOKEN = 'MEMORA_TELEGRAM_BOT_TOKEN';
const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_MESSAGE_LENGTH = 4_000;

interface TelegramConfigFile {
  version: 1;
  enabled: boolean;
  chatId: string;
}

interface TelegramSecretsFile {
  version: 1;
  botToken: string;
}

export class TelegramError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'TelegramError';
  }
}

function validChatId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!/^-?\d{1,20}$/.test(trimmed)) throw new TelegramError('invalid_telegram_chat_id', 'Il Chat ID Telegram deve essere numerico');
  return trimmed;
}

function validToken(value: unknown): string {
  if (typeof value !== 'string') throw new TelegramError('invalid_telegram_token', 'Il token del bot non è valido');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512 || [...trimmed].some(char => char.charCodeAt(0) < 32)) {
    throw new TelegramError('invalid_telegram_token', 'Il token del bot non è valido');
  }
  return trimmed;
}

/** Impostazioni Telegram non segrete: abilitazione e destinazione. */
export class TelegramStore {
  readonly configPath: string;
  readonly secretPath: string;
  private readonly configDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly warn: (message: string) => void;
  private config: TelegramConfigFile = { version: 1, enabled: false, chatId: '' };
  private storedToken = '';
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: { dataDir: string; env?: NodeJS.ProcessEnv; warn?: (message: string) => void }) {
    this.configDir = path.join(options.dataDir, 'config');
    this.configPath = path.join(this.configDir, 'telegram.json');
    this.secretPath = path.join(this.configDir, 'telegram-secrets.json');
    this.env = options.env ?? process.env;
    this.warn = options.warn ?? (() => {});
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.configPath, 'utf8')) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid');
      const data = raw as Partial<TelegramConfigFile>;
      if (data.version !== 1) throw new Error('invalid');
      this.config = {
        version: 1,
        enabled: data.enabled === true,
        chatId: validChatId(data.chatId ?? ''),
      };
      await fs.chmod(this.configPath, 0o600).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warn('telegram config ignored: invalid or unreadable format');
    }
    try {
      const raw = JSON.parse(await fs.readFile(this.secretPath, 'utf8')) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid');
      const data = raw as Partial<TelegramSecretsFile>;
      if (data.version !== 1) throw new Error('invalid');
      this.storedToken = typeof data.botToken === 'string' ? validToken(data.botToken) : '';
      await fs.chmod(this.secretPath, 0o600).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warn('telegram secrets ignored: invalid or unreadable format');
    }
  }

  getToken(): string | undefined {
    const environment = this.env[TELEGRAM_ENV_TOKEN];
    if (environment !== undefined && environment !== '') return environment;
    return this.storedToken || undefined;
  }

  getSettings(): TelegramSettingsView {
    const environment = this.env[TELEGRAM_ENV_TOKEN];
    const source = environment !== undefined && environment !== '' ? 'environment' : this.storedToken ? 'secret' : 'none';
    return {
      enabled: this.config.enabled,
      chatId: this.config.chatId,
      tokenConfigured: source !== 'none',
      tokenSource: source,
      tokenEditable: source !== 'environment',
    };
  }

  async update(input: unknown): Promise<TelegramSettingsView> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TelegramError('invalid_telegram_settings', 'Impostazioni Telegram non valide');
    }
    const body = input as Record<string, unknown>;
    const next: TelegramConfigFile = { ...this.config };
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') throw new TelegramError('invalid_telegram_settings', 'Valore enabled non valido');
      next.enabled = body.enabled;
    }
    if (body.chatId !== undefined) next.chatId = validChatId(body.chatId);
    this.config = next;
    await this.persistConfig();
    return this.getSettings();
  }

  async setToken(token: unknown): Promise<TelegramSettingsView> {
    if (this.getSettings().tokenSource === 'environment') {
      throw new TelegramError('telegram_token_managed_by_environment', 'Il token Telegram è gestito dall’ambiente', 409);
    }
    this.storedToken = validToken(token);
    await this.persistSecrets();
    return this.getSettings();
  }

  async clearToken(): Promise<TelegramSettingsView> {
    if (this.getSettings().tokenSource === 'environment') {
      throw new TelegramError('telegram_token_managed_by_environment', 'Il token Telegram è gestito dall’ambiente', 409);
    }
    this.storedToken = '';
    await fs.unlink(this.secretPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    return this.getSettings();
  }

  private persistConfig(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
      const temporary = path.join(this.configDir, `.telegram.${process.pid}.${Date.now()}.tmp`);
      await fs.writeFile(temporary, `${JSON.stringify(this.config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.configPath);
      await fs.chmod(this.configPath, 0o600);
    });
    return this.writeChain;
  }

  private persistSecrets(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
      const payload: TelegramSecretsFile = { version: 1, botToken: this.storedToken };
      const temporary = path.join(this.configDir, `.telegram-secrets.${process.pid}.${Date.now()}.tmp`);
      await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.secretPath);
      await fs.chmod(this.secretPath, 0o600);
    });
    return this.writeChain;
  }
}

type FetchLike = typeof fetch;

interface TelegramApiResponse<T> {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function callTelegram<T>(token: string, method: string, payload: Record<string, unknown>, fetchImpl: FetchLike): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new TelegramError('telegram_unreachable', 'Telegram non è raggiungibile', 502);
  }
  let data: TelegramApiResponse<T>;
  try {
    data = await response.json() as TelegramApiResponse<T>;
  } catch {
    throw new TelegramError('telegram_invalid_response', 'Risposta Telegram non valida', 502);
  }
  if (!response.ok || data.ok === false) {
    throw new TelegramError('telegram_api_error', data.description ? `Telegram: ${data.description}` : 'Errore API Telegram', 502);
  }
  return data.result as T;
}

export function splitTelegramText(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut < Math.floor(limit * 0.6)) cut = remaining.lastIndexOf(' ', limit);
    if (cut < Math.floor(limit * 0.6)) cut = limit;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export class TelegramService {
  constructor(
    private readonly store: TelegramStore,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  getSettings(): TelegramSettingsView {
    return this.store.getSettings();
  }

  get configured(): boolean {
    const settings = this.store.getSettings();
    return Boolean(this.store.getToken() && settings.chatId);
  }

  async send(text: string, chatId = this.store.getSettings().chatId): Promise<number> {
    const token = this.store.getToken();
    const target = validChatId(chatId);
    if (!token) throw new TelegramError('telegram_not_configured', 'Token Telegram non configurato', 409);
    if (!target) throw new TelegramError('telegram_not_configured', 'Chat ID Telegram non configurato', 409);
    const chunks = splitTelegramText(text);
    if (chunks.length === 0) return 0;
    for (const chunk of chunks) {
      await callTelegram(token, 'sendMessage', {
        chat_id: target,
        text: chunk,
        disable_web_page_preview: true,
      }, this.fetchImpl);
    }
    return chunks.length;
  }

  async test(chatId = this.store.getSettings().chatId): Promise<void> {
    const token = this.store.getToken();
    if (!token) throw new TelegramError('telegram_not_configured', 'Token Telegram non configurato', 409);
    await callTelegram(token, 'getMe', {}, this.fetchImpl);
    await this.send('Memora · test connessione Telegram riuscito.', chatId);
  }

  async discoverChats(): Promise<TelegramChat[]> {
    const token = this.store.getToken();
    if (!token) throw new TelegramError('telegram_not_configured', 'Token Telegram non configurato', 409);
    const updates = await callTelegram<Array<Record<string, unknown>>>(token, 'getUpdates', {
      limit: 100,
      timeout: 0,
      allowed_updates: ['message', 'channel_post'],
    }, this.fetchImpl);
    const chats = new Map<string, TelegramChat>();
    for (const update of updates) {
      const message = (update.message ?? update.channel_post) as Record<string, unknown> | undefined;
      const chat = message?.chat as Record<string, unknown> | undefined;
      if (!chat || (typeof chat.id !== 'number' && typeof chat.id !== 'string')) continue;
      const id = String(chat.id);
      if (chats.has(id)) continue;
      const title = typeof chat.title === 'string' ? chat.title : [chat.first_name, chat.last_name].filter(value => typeof value === 'string').join(' ');
      chats.set(id, {
        id,
        label: title || (typeof chat.username === 'string' ? `@${chat.username}` : id),
        type: typeof chat.type === 'string' ? chat.type : 'unknown',
        ...(typeof chat.username === 'string' ? { username: chat.username } : {}),
      });
    }
    return [...chats.values()];
  }
}

export function formatAutomationTelegramMessage(input: {
  jobName: string;
  status: 'completed' | 'failed' | 'timeout' | 'interrupted';
  output?: string;
  error?: string;
  finishedAt: number;
  timezone?: string;
}): string {
  const header = input.status === 'completed' ? `✅ ${input.jobName}` : `⚠️ ${input.jobName}`;
  const when = new Date(input.finishedAt).toLocaleString('it-IT', { timeZone: input.timezone ?? 'Europe/Rome' });
  const body = input.status === 'completed'
    ? input.output?.trim() || 'Attività completata senza testo di risposta.'
    : `Attività non completata: ${input.error ?? input.status}`;
  return `${header}\n${when}\n\n${body}`;
}
