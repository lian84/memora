import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TelegramAccount, TelegramAccountInput, TelegramAccountView, TelegramChat } from '@memora/shared';

const TELEGRAM_ENV_TOKEN = 'MEMORA_TELEGRAM_BOT_TOKEN';
const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_MESSAGE_LENGTH = 4_000;
const DEFAULT_ACCOUNT_ID = 'acc_tg_default';
const ACCOUNT_ID_PATTERN = /^acc_tg_[a-zA-Z0-9-]+$/;

interface AccountsFile {
  version: 1;
  accounts: TelegramAccount[];
}

interface TokensFile {
  version: 1;
  tokens: Record<string, string>;
}

interface LegacyConfigFile {
  version?: 1;
  enabled?: boolean;
  chatId?: string;
}

interface LegacyTokenFile {
  version?: 1;
  botToken?: string;
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

function validLabel(value: unknown): string {
  if (typeof value !== 'string') throw new TelegramError('invalid_telegram_label', 'Il nome dell’account Telegram è obbligatorio');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) throw new TelegramError('invalid_telegram_label', 'Il nome dell’account Telegram non è valido');
  return trimmed;
}

/** Registry di account Telegram (bot + chat) salvato nella data directory. */
export class TelegramStore {
  readonly accountsPath: string;
  readonly secretPath: string;
  private readonly legacyConfigPath: string;
  private readonly configDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly warn: (message: string) => void;
  private accounts: TelegramAccount[] = [];
  private tokens: Record<string, string> = {};
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: { dataDir: string; env?: NodeJS.ProcessEnv; warn?: (message: string) => void }) {
    this.configDir = path.join(options.dataDir, 'config');
    this.accountsPath = path.join(this.configDir, 'telegram-accounts.json');
    this.secretPath = path.join(this.configDir, 'telegram-secrets.json');
    this.legacyConfigPath = path.join(this.configDir, 'telegram.json');
    this.env = options.env ?? process.env;
    this.warn = options.warn ?? (() => {});
  }

  async load(): Promise<void> {
    this.accounts = [];
    this.tokens = {};
    const accountsLoaded = await this.loadAccounts();
    await this.loadTokens();
    if (!accountsLoaded) await this.migrateLegacy();
    // Un account default senza file può esistere solo per il token da ambiente.
    if (this.accounts.length === 0 && this.env[TELEGRAM_ENV_TOKEN]) {
      this.accounts = [{
        id: DEFAULT_ACCOUNT_ID,
        label: 'Telegram',
        chatId: '',
        enabled: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }];
      await this.persistAccounts();
    }
  }

  listAccounts(): TelegramAccountView[] {
    return this.accounts.map(account => this.toView(account));
  }

  getAccount(id: string): TelegramAccountView | undefined {
    const account = this.accounts.find(item => item.id === id);
    return account ? this.toView(account) : undefined;
  }

  /** Usa l'account richiesto o, per compatibilità, il primo account abilitato. */
  resolveAccount(id?: string): TelegramAccountView | undefined {
    if (id) return this.getAccount(id);
    return this.listAccounts().find(account => account.enabled) ?? this.listAccounts()[0];
  }

  getToken(id: string): string | undefined {
    if (id === DEFAULT_ACCOUNT_ID) {
      const environment = this.env[TELEGRAM_ENV_TOKEN];
      if (environment !== undefined && environment !== '') return environment;
    }
    return this.tokens[id] || undefined;
  }

  async createAccount(input: TelegramAccountInput): Promise<TelegramAccountView> {
    const now = Date.now();
    const account: TelegramAccount = {
      id: `acc_tg_${randomUUID()}`,
      label: validLabel(input.label),
      chatId: validChatId(input.chatId ?? ''),
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now,
    };
    const token = validToken(input.token);
    this.accounts.push(account);
    this.tokens[account.id] = token;
    await this.persistAccounts();
    await this.persistTokens();
    return this.toView(account);
  }

  async updateAccount(id: string, input: Partial<TelegramAccountInput>): Promise<TelegramAccountView> {
    const index = this.accounts.findIndex(item => item.id === id);
    if (index < 0) throw new TelegramError('telegram_account_not_found', 'Account Telegram non trovato', 404);
    const current = this.accounts[index];
    const updated: TelegramAccount = {
      ...current,
      ...(input.label !== undefined ? { label: validLabel(input.label) } : {}),
      ...(input.chatId !== undefined ? { chatId: validChatId(input.chatId) } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled === true } : {}),
      updatedAt: Date.now(),
    };
    this.accounts[index] = updated;
    if (input.token !== undefined) this.tokens[id] = validToken(input.token);
    await this.persistAccounts();
    if (input.token !== undefined) await this.persistTokens();
    return this.toView(updated);
  }

  async deleteAccount(id: string): Promise<{ id: string }> {
    const index = this.accounts.findIndex(item => item.id === id);
    if (index < 0) throw new TelegramError('telegram_account_not_found', 'Account Telegram non trovato', 404);
    this.accounts.splice(index, 1);
    delete this.tokens[id];
    await this.persistAccounts();
    await this.persistTokens();
    return { id };
  }

  private toView(account: TelegramAccount): TelegramAccountView {
    const source = account.id === DEFAULT_ACCOUNT_ID && this.env[TELEGRAM_ENV_TOKEN] ? 'environment' : this.tokens[account.id] ? 'secret' : 'none';
    return {
      ...account,
      tokenConfigured: source !== 'none',
      tokenSource: source,
    };
  }

  private async loadAccounts(): Promise<boolean> {
    try {
      const raw = JSON.parse(await fs.readFile(this.accountsPath, 'utf8')) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid');
      const data = raw as Partial<AccountsFile>;
      if (data.version !== 1 || !Array.isArray(data.accounts)) throw new Error('invalid');
      for (const value of data.accounts) {
        if (!value || typeof value !== 'object' || !ACCOUNT_ID_PATTERN.test(String(value.id))) continue;
        const account = value as Partial<TelegramAccount>;
        this.accounts.push({
          id: account.id!,
          label: validLabel(account.label),
          chatId: validChatId(account.chatId ?? ''),
          enabled: account.enabled === true,
          createdAt: typeof account.createdAt === 'number' ? account.createdAt : Date.now(),
          updatedAt: typeof account.updatedAt === 'number' ? account.updatedAt : Date.now(),
        });
      }
      await fs.chmod(this.accountsPath, 0o600).catch(() => undefined);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warn('telegram accounts ignored: invalid or unreadable format');
      return false;
    }
  }

  private async loadTokens(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.secretPath, 'utf8')) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid');
      const data = raw as Partial<TokensFile & LegacyTokenFile>;
      if (data.tokens && typeof data.tokens === 'object' && !Array.isArray(data.tokens)) {
        for (const [id, token] of Object.entries(data.tokens)) {
          if (ACCOUNT_ID_PATTERN.test(id) && typeof token === 'string') {
            try { this.tokens[id] = validToken(token); } catch { /* ignore invalid entry */ }
          }
        }
      } else if (typeof data.botToken === 'string') {
        // Migrazione dal formato a token singolo.
        this.tokens[this.accounts.some(account => account.id === DEFAULT_ACCOUNT_ID) ? DEFAULT_ACCOUNT_ID : this.accounts[0]?.id ?? DEFAULT_ACCOUNT_ID] = validToken(data.botToken);
      }
      await fs.chmod(this.secretPath, 0o600).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warn('telegram secrets ignored: invalid or unreadable format');
    }
  }

  private async migrateLegacy(): Promise<void> {
    let legacyConfig: LegacyConfigFile | null = null;
    try {
      legacyConfig = JSON.parse(await fs.readFile(this.legacyConfigPath, 'utf8')) as LegacyConfigFile;
    } catch { /* nessuna configurazione legacy */ }
    const legacyToken = this.tokens[DEFAULT_ACCOUNT_ID] ?? this.tokens[this.accounts[0]?.id ?? ''];
    if (!legacyConfig && !legacyToken && !this.env[TELEGRAM_ENV_TOKEN]) return;
    const now = Date.now();
    let legacyChatId = '';
    try { legacyChatId = validChatId(legacyConfig?.chatId ?? ''); } catch { /* legado non valido: mantieni vuoto */ }
    const account: TelegramAccount = {
      id: DEFAULT_ACCOUNT_ID,
      label: 'Telegram',
      chatId: legacyChatId,
      enabled: legacyConfig?.enabled === true,
      createdAt: now,
      updatedAt: now,
    };
    this.accounts = [account];
    if (legacyToken) this.tokens[account.id] = legacyToken;
    await this.persistAccounts();
    if (legacyToken) await this.persistTokens();
  }

  private persistAccounts(): Promise<void> {
    const payload = JSON.stringify({ version: 1, accounts: this.accounts } satisfies AccountsFile, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
      const temporary = path.join(this.configDir, `.telegram-accounts.${process.pid}.${Date.now()}.tmp`);
      await fs.writeFile(temporary, `${payload}\n`, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.accountsPath);
      await fs.chmod(this.accountsPath, 0o600);
    });
    return this.writeChain;
  }

  private persistTokens(): Promise<void> {
    const payload = JSON.stringify({ version: 1, tokens: this.tokens } satisfies TokensFile, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
      const temporary = path.join(this.configDir, `.telegram-secrets.${process.pid}.${Date.now()}.tmp`);
      await fs.writeFile(temporary, `${payload}\n`, { mode: 0o600, flag: 'wx' });
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

  resolveAccount(accountId?: string): TelegramAccountView | undefined {
    return this.store.resolveAccount(accountId);
  }

  async send(text: string, accountId?: string): Promise<number> {
    const account = this.store.resolveAccount(accountId);
    if (!account) throw new TelegramError('telegram_not_configured', 'Nessun account Telegram configurato', 409);
    const token = this.store.getToken(account.id);
    if (!token) throw new TelegramError('telegram_not_configured', 'Token Telegram non configurato', 409);
    if (!account.chatId) throw new TelegramError('telegram_not_configured', 'Chat ID Telegram non configurato', 409);
    const chunks = splitTelegramText(text);
    if (chunks.length === 0) return 0;
    for (const chunk of chunks) {
      await callTelegram(token, 'sendMessage', {
        chat_id: account.chatId,
        text: chunk,
        disable_web_page_preview: true,
      }, this.fetchImpl);
    }
    return chunks.length;
  }

  async test(accountId?: string): Promise<void> {
    const account = this.store.resolveAccount(accountId);
    if (!account) throw new TelegramError('telegram_not_configured', 'Nessun account Telegram configurato', 409);
    const token = this.store.getToken(account.id);
    if (!token) throw new TelegramError('telegram_not_configured', 'Token Telegram non configurato', 409);
    await callTelegram(token, 'getMe', {}, this.fetchImpl);
    await this.send('Memora · test connessione Telegram riuscito.', account.id);
  }

  async discoverChats(accountId?: string): Promise<TelegramChat[]> {
    const account = this.store.resolveAccount(accountId);
    if (!account) throw new TelegramError('telegram_not_configured', 'Nessun account Telegram configurato', 409);
    const token = this.store.getToken(account.id);
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
