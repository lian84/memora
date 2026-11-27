import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  TelegramAccount,
  TelegramAccountInput,
  TelegramAccountView,
  TelegramChat,
  TelegramChatInfo,
  TelegramChatMemberInfo,
  TelegramForumTopic,
} from '@memora/shared';

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
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly retryAfterMs?: number,
  ) {
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

function validTopicName(value: unknown): string {
  if (typeof value !== 'string') throw new TelegramError('invalid_telegram_topic_name', 'Nome topic Telegram non valido');
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name || name.length > 128 || hasControlChars(name)) {
    throw new TelegramError('invalid_telegram_topic_name', 'Nome topic Telegram non valido');
  }
  return name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validCustomEmojiId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !/^\d{1,32}$/.test(value.trim())) {
    throw new TelegramError('invalid_telegram_icon', 'Icona topic Telegram non valida');
  }
  return value.trim();
}

function validMessageThreadId(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TelegramError('invalid_telegram_thread_id', 'ID topic Telegram non valido');
  }
  return value;
}

function validToken(value: unknown): string {
  if (typeof value !== 'string') throw new TelegramError('invalid_telegram_token', 'Il token del bot non è valido');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512 || [...trimmed].some(char => char.charCodeAt(0) < 32)) {
    throw new TelegramError('invalid_telegram_token', 'Il token del bot non è valido');
  }
  return trimmed;
}

function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
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

export type TelegramChatAction =
  | 'typing'
  | 'upload_photo'
  | 'record_video'
  | 'upload_video'
  | 'record_voice'
  | 'upload_voice'
  | 'upload_document'
  | 'choose_sticker'
  | 'find_location'
  | 'record_video_note'
  | 'upload_video_note';

export interface TelegramBotInfo {
  id: string;
  firstName: string;
  username?: string;
  /** False se la privacy mode è attiva; nei gruppi il bot non riceve i messaggi normali. */
  canReadAllGroupMessages?: boolean;
}

export interface TelegramFile {
  fileId: string;
  filePath: string;
  size?: number;
}

export interface TelegramCommand {
  command: string;
  description: string;
}

export type TelegramCommandScope =
  | { type: 'default' | 'all_private_chats' | 'all_group_chats' | 'all_chat_administrators' }
  | { type: 'chat' | 'chat_administrators'; chatId: string }
  | { type: 'chat_member'; chatId: string; userId: string };

export interface TelegramForumTopicIcon {
  customEmojiId: string;
  emoji?: string;
}

export interface TelegramMessageOptions {
  parseMode?: 'HTML';
  messageThreadId?: number;
}

export interface TelegramServiceOptions {
  sleep?: (milliseconds: number) => Promise<void>;
  /** Numero di retry aggiuntivi solo per gli errori 429. */
  maxRetries?: number;
  retryBaseMs?: number;
  maxRetryDelayMs?: number;
}

interface TelegramApiResponse<T> {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
}

function telegramApiError<T>(response: Response, data: TelegramApiResponse<T>): TelegramError {
  const description = data.description ? `Telegram: ${data.description}` : 'Errore API Telegram';
  const retryAfter = typeof data.parameters?.retry_after === 'number' && Number.isFinite(data.parameters.retry_after)
    ? Math.max(0, Math.ceil(data.parameters.retry_after * 1_000))
    : undefined;
  if (response.status === 429 || data.error_code === 429) {
    return new TelegramError('telegram_rate_limited', description, 429, retryAfter);
  }
  if (response.status === 409) return new TelegramError('telegram_conflict', description, 409);
  if (response.status === 401 || response.status === 403) return new TelegramError('telegram_unauthorized', description, response.status);
  return new TelegramError('telegram_api_error', description, 502);
}

async function callTelegram<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  fetchImpl: FetchLike,
  timeoutMs = 20_000,
  externalSignal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: externalSignal ? AbortSignal.any([timeoutSignal, externalSignal]) : timeoutSignal,
    });
  } catch (error) {
    if (externalSignal?.aborted) throw new TelegramError('telegram_aborted', 'Richiesta Telegram annullata', 499);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TelegramError('telegram_timeout', 'Telegram non ha risposto in tempo', 504);
    }
    throw new TelegramError('telegram_unreachable', 'Telegram non è raggiungibile', 502);
  }
  let data: TelegramApiResponse<T>;
  try {
    data = await response.json() as TelegramApiResponse<T>;
  } catch {
    throw new TelegramError('telegram_invalid_response', 'Risposta Telegram non valida', 502);
  }
  if (!response.ok || data.ok === false) throw telegramApiError(response, data);
  return data.result as T;
}

export interface TelegramDocument {
  filename: string;
  mimeType: string;
  buffer: Buffer;
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

async function callTelegramDocument(token: string, document: TelegramDocument, chatId: string, fetchImpl: FetchLike, messageThreadId?: number): Promise<void> {
  const form = new FormData();
  form.append('chat_id', chatId);
  if (messageThreadId !== undefined) form.append('message_thread_id', String(messageThreadId));
  form.append('document', new Blob([new Uint8Array(document.buffer)], { type: document.mimeType }), document.filename);
  let response: Response;
  try {
    response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${token}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new TelegramError('telegram_unreachable', 'Telegram non è raggiungibile', 502);
  }
  let data: TelegramApiResponse<unknown>;
  try {
    data = await response.json() as TelegramApiResponse<unknown>;
  } catch {
    throw new TelegramError('telegram_invalid_response', 'Risposta Telegram non valida', 502);
  }
  if (!response.ok || data.ok === false) throw telegramApiError(response, data);
}

const CHAT_ACTIONS = new Set<TelegramChatAction>([
  'typing',
  'upload_photo',
  'record_video',
  'upload_video',
  'record_voice',
  'upload_voice',
  'upload_document',
  'choose_sticker',
  'find_location',
  'record_video_note',
  'upload_video_note',
]);
const COMMAND_PATTERN = /^[a-z0-9_]{1,32}$/;
const LANGUAGE_CODE_PATTERN = /^[a-zA-Z]{2,3}(?:-[a-zA-Z]{2})?$/;

export class TelegramService {
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly maxRetryDelayMs: number;

  constructor(
    private readonly store: TelegramStore,
    private readonly fetchImpl: FetchLike = fetch,
    options: TelegramServiceOptions = {},
  ) {
    this.sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 2));
    this.retryBaseMs = Math.max(0, Math.floor(options.retryBaseMs ?? 1_000));
    this.maxRetryDelayMs = Math.max(0, Math.floor(options.maxRetryDelayMs ?? 30_000));
  }

  resolveAccount(accountId?: string): TelegramAccountView | undefined {
    return this.store.resolveAccount(accountId);
  }

  async send(text: string, accountId?: string): Promise<number> {
    const { account, token } = this.tokenFor(accountId);
    if (!account.chatId) throw new TelegramError('telegram_not_configured', 'Chat ID Telegram non configurato', 409);
    const chunks = splitTelegramText(text);
    if (chunks.length === 0) return 0;
    for (const chunk of chunks) {
      await this.request(token, 'sendMessage', {
        chat_id: account.chatId,
        text: chunk,
        disable_web_page_preview: true,
      });
    }
    return chunks.length;
  }

  /** Invia un singolo messaggio a una chat esplicita, senza splitting interno. */
  async sendTo(
    chatId: string,
    text: string,
    accountId?: string,
    options: TelegramMessageOptions = {},
  ): Promise<void> {
    const target = this.validTarget(chatId);
    const { token } = this.tokenFor(accountId);
    const messageThreadId = validMessageThreadId(options.messageThreadId);
    const normalized = text.trim();
    if (!normalized) return;
    await this.request(token, 'sendMessage', {
      chat_id: target,
      text: normalized,
      disable_web_page_preview: true,
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
      ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
    });
  }

  /** Modifica un messaggio già inviato; ignora il caso "non modificato". */
  async editMessage(
    chatId: string,
    messageId: number,
    text: string,
    accountId?: string,
    options: TelegramMessageOptions = {},
  ): Promise<void> {
    if (!Number.isSafeInteger(messageId) || messageId <= 0) {
      throw new TelegramError('invalid_telegram_message_id', 'ID messaggio Telegram non valido');
    }
    const target = this.validTarget(chatId);
    const { token } = this.tokenFor(accountId);
    const messageThreadId = validMessageThreadId(options.messageThreadId);
    const normalized = text.trim();
    if (!normalized) return;
    try {
      await this.request(token, 'editMessageText', {
        chat_id: target,
        message_id: messageId,
        text: normalized,
        disable_web_page_preview: true,
        ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
        ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
      });
    } catch (error) {
      if (error instanceof TelegramError && error.code === 'telegram_api_error' && /message is not modified/i.test(error.message)) return;
      throw error;
    }
  }

  async sendChatAction(chatId: string, action: TelegramChatAction, accountId?: string, options: { messageThreadId?: number } = {}): Promise<void> {
    if (!CHAT_ACTIONS.has(action)) throw new TelegramError('invalid_telegram_action', 'Azione Telegram non valida');
    const target = this.validTarget(chatId);
    const { token } = this.tokenFor(accountId);
    const messageThreadId = validMessageThreadId(options.messageThreadId);
    await this.request(token, 'sendChatAction', {
      chat_id: target,
      action,
      ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
    });
  }

  /**
   * Long polling degli update. Non ritenta automaticamente i 429: il supervisore
   * del canale deve poter decidere attesa e backoff e deve poter annullare la
   * richiesta allo shutdown tramite `signal`.
   */
  async getUpdates(
    accountId?: string,
    options: {
      offset?: number;
      timeoutSeconds?: number;
      limit?: number;
      allowedUpdates?: string[];
      signal?: AbortSignal;
    } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const offset = options.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new TelegramError('invalid_telegram_offset', 'Offset Telegram non valido');
    }
    const timeoutSeconds = options.timeoutSeconds ?? 25;
    if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 50) {
      throw new TelegramError('invalid_telegram_timeout', 'Timeout Telegram non valido');
    }
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TelegramError('invalid_telegram_limit', 'Limite update Telegram non valido');
    }
    const allowedUpdates = options.allowedUpdates ?? ['message'];
    if (!Array.isArray(allowedUpdates) || allowedUpdates.length > 20 || allowedUpdates.some(item => typeof item !== 'string' || !/^[a-z_]{1,64}$/.test(item))) {
      throw new TelegramError('invalid_telegram_updates', 'Tipi di update Telegram non validi');
    }
    const { token } = this.tokenFor(accountId);
    const payload: Record<string, unknown> = {
      timeout: timeoutSeconds,
      limit,
      allowed_updates: allowedUpdates,
    };
    if (offset > 0) payload.offset = offset;
    const updates = await callTelegram<Array<Record<string, unknown>>>(
      token,
      'getUpdates',
      payload,
      this.fetchImpl,
      (timeoutSeconds + 10) * 1_000,
      options.signal,
    );
    if (!Array.isArray(updates)) throw new TelegramError('telegram_invalid_response', 'Risposta Telegram non valida', 502);
    return updates;
  }

  async getFile(fileId: string, accountId?: string): Promise<TelegramFile> {
    if (typeof fileId !== 'string' || !fileId.trim() || fileId.length > 512 || hasControlChars(fileId)) {
      throw new TelegramError('invalid_telegram_file_id', 'ID file Telegram non valido');
    }
    const { token } = this.tokenFor(accountId);
    const result = await this.request<{ file_path?: string; file_size?: number }>(token, 'getFile', { file_id: fileId.trim() });
    if (!result || typeof result.file_path !== 'string' || !result.file_path) {
      throw new TelegramError('telegram_file_unavailable', 'File Telegram non disponibile', 409);
    }
    return {
      fileId: fileId.trim(),
      filePath: result.file_path,
      ...(typeof result.file_size === 'number' && Number.isFinite(result.file_size) ? { size: result.file_size } : {}),
    };
  }

  /** Scarica un file Telegram in memoria, con limite di dimensione. */
  async downloadFile(filePath: string, accountId?: string, maxBytes = 20 * 1024 * 1024): Promise<Buffer> {
    if (typeof filePath !== 'string' || !filePath.trim() || filePath.length > 512 || hasControlChars(filePath)) {
      throw new TelegramError('invalid_telegram_file_path', 'Percorso file Telegram non valido');
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new TelegramError('invalid_telegram_file_limit', 'Limite file Telegram non valido');
    }
    const clean = filePath.trim().replace(/^\/+/, '');
    if (!clean || clean.split('/').some(segment => segment === '..' || segment === '.')) {
      throw new TelegramError('invalid_telegram_file_path', 'Percorso file Telegram non valido');
    }
    const encoded = clean.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const { token } = this.tokenFor(accountId);
    let response: Response;
    try {
      response = await this.fetchImpl(`${TELEGRAM_API_BASE}/file/bot${token}/${encoded}`, {
        method: 'GET',
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new TelegramError('telegram_unreachable', 'Telegram non è raggiungibile', 502);
    }
    if (!response.ok) {
      let description = 'Download Telegram non riuscito';
      try {
        const data = await response.json() as { description?: string };
        if (data.description) description = `Telegram: ${data.description}`;
      } catch {
        // Risposta non JSON: mantieni il messaggio generico.
      }
      throw new TelegramError('telegram_file_download_failed', description, 502);
    }
    const contentLength = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new TelegramError('telegram_file_too_large', 'File Telegram troppo grande', 413);
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(await response.arrayBuffer());
    } catch {
      throw new TelegramError('telegram_file_download_failed', 'Download Telegram non riuscito', 502);
    }
    if (buffer.byteLength === 0) throw new TelegramError('telegram_file_download_failed', 'File Telegram vuoto', 502);
    if (buffer.byteLength > maxBytes) throw new TelegramError('telegram_file_too_large', 'File Telegram troppo grande', 413);
    return buffer;
  }

  async getMe(accountId?: string): Promise<TelegramBotInfo> {
    const { token } = this.tokenFor(accountId);
    const result = await this.request<{ id?: number | string; first_name?: string; username?: string; can_read_all_group_messages?: boolean }>(token, 'getMe', {});
    const id = typeof result?.id === 'number' || typeof result?.id === 'string' ? String(result.id) : '';
    if (!id || typeof result.first_name !== 'string') {
      throw new TelegramError('telegram_invalid_response', 'Risposta Telegram non valida', 502);
    }
    return {
      id,
      firstName: result.first_name,
      ...(typeof result.username === 'string' ? { username: result.username } : {}),
      ...(typeof result.can_read_all_group_messages === 'boolean' ? { canReadAllGroupMessages: result.can_read_all_group_messages } : {}),
    };
  }

  async createForumTopic(
    chatId: string,
    name: string,
    accountId?: string,
    options: { iconCustomEmojiId?: string } = {},
  ): Promise<TelegramForumTopic> {
    const target = this.validTarget(chatId);
    const topicName = validTopicName(name);
    const iconCustomEmojiId = validCustomEmojiId(options.iconCustomEmojiId);
    const { token } = this.tokenFor(accountId);
    const result = await this.request<{ message_thread_id?: number; name?: string }>(token, 'createForumTopic', {
      chat_id: target,
      name: topicName,
      ...(iconCustomEmojiId ? { icon_custom_emoji_id: iconCustomEmojiId } : {}),
    });
    if (typeof result?.message_thread_id !== 'number' || !Number.isSafeInteger(result.message_thread_id) || result.message_thread_id <= 0) {
      throw new TelegramError('telegram_invalid_response', 'Risposta Telegram non valida', 502);
    }
    return { threadId: String(result.message_thread_id), name: typeof result.name === 'string' ? result.name : topicName };
  }

  async editForumTopic(
    chatId: string,
    threadId: number,
    name: string,
    accountId?: string,
    options: { iconCustomEmojiId?: string } = {},
  ): Promise<void> {
    const target = this.validTarget(chatId);
    const thread = validMessageThreadId(threadId);
    if (!thread) throw new TelegramError('invalid_telegram_thread_id', 'ID topic Telegram non valido');
    const topicName = validTopicName(name);
    const iconCustomEmojiId = validCustomEmojiId(options.iconCustomEmojiId);
    const { token } = this.tokenFor(accountId);
    await this.request(token, 'editForumTopic', {
      chat_id: target,
      message_thread_id: thread,
      name: topicName,
      ...(iconCustomEmojiId ? { icon_custom_emoji_id: iconCustomEmojiId } : {}),
    });
  }

  async setForumTopicIcon(chatId: string, threadId: number, iconCustomEmojiId: string, accountId?: string): Promise<void> {
    const target = this.validTarget(chatId);
    const thread = validMessageThreadId(threadId);
    if (!thread) throw new TelegramError('invalid_telegram_thread_id', 'ID topic Telegram non valido');
    const icon = validCustomEmojiId(iconCustomEmojiId);
    if (!icon) throw new TelegramError('invalid_telegram_icon', 'Icona topic Telegram non valida');
    const { token } = this.tokenFor(accountId);
    await this.request(token, 'editForumTopic', {
      chat_id: target,
      message_thread_id: thread,
      icon_custom_emoji_id: icon,
    });
  }

  async getForumTopicIconStickers(accountId?: string): Promise<TelegramForumTopicIcon[]> {
    const { token } = this.tokenFor(accountId);
    const result = await this.request<unknown>(token, 'getForumTopicIconStickers', {});
    if (!Array.isArray(result)) throw new TelegramError('telegram_invalid_response', 'Risposta Telegram non valida', 502);
    const icons: TelegramForumTopicIcon[] = [];
    for (const item of result) {
      if (!isRecord(item)) continue;
      const customEmojiId = typeof item.custom_emoji_id === 'string' && /^\d{1,32}$/.test(item.custom_emoji_id)
        ? item.custom_emoji_id
        : '';
      if (!customEmojiId) continue;
      icons.push({
        customEmojiId,
        ...(typeof item.emoji === 'string' ? { emoji: item.emoji } : {}),
      });
    }
    return icons;
  }

  async closeForumTopic(chatId: string, threadId: number, accountId?: string): Promise<void> {
    const target = this.validTarget(chatId);
    const thread = validMessageThreadId(threadId);
    if (!thread) throw new TelegramError('invalid_telegram_thread_id', 'ID topic Telegram non valido');
    const { token } = this.tokenFor(accountId);
    await this.request(token, 'closeForumTopic', { chat_id: target, message_thread_id: thread });
  }

  async getChat(chatId: string, accountId?: string): Promise<TelegramChatInfo> {
    const target = this.validTarget(chatId);
    const { token } = this.tokenFor(accountId);
    const result = await this.request<Record<string, unknown>>(token, 'getChat', { chat_id: target });
    if (!result || (typeof result.id !== 'number' && typeof result.id !== 'string') || typeof result.type !== 'string') {
      throw new TelegramError('telegram_invalid_response', 'Risposta Telegram non valida', 502);
    }
    return {
      id: String(result.id),
      type: result.type,
      ...(typeof result.title === 'string' ? { title: result.title } : {}),
      ...(typeof result.is_forum === 'boolean' ? { isForum: result.is_forum } : {}),
      ...(typeof result.username === 'string' ? { username: result.username } : {}),
    };
  }

  async getChatMember(chatId: string, userId: string | number, accountId?: string): Promise<TelegramChatMemberInfo> {
    const target = this.validTarget(chatId);
    const normalized = typeof userId === 'number' && Number.isSafeInteger(userId)
      ? String(userId)
      : typeof userId === 'string'
        ? userId.trim()
        : '';
    if (!/^\d{1,20}$/.test(normalized)) throw new TelegramError('invalid_telegram_user_id', 'ID utente Telegram non valido');
    const { token } = this.tokenFor(accountId);
    const result = await this.request<Record<string, unknown>>(token, 'getChatMember', {
      chat_id: target,
      user_id: normalized,
    });
    if (!result || typeof result.status !== 'string') {
      throw new TelegramError('telegram_invalid_response', 'Risposta Telegram non valida', 502);
    }
    return {
      status: result.status,
      ...(typeof result.can_manage_topics === 'boolean' ? { canManageTopics: result.can_manage_topics } : {}),
      ...(typeof result.is_member === 'boolean' ? { isMember: result.is_member } : {}),
    };
  }

  async setMyCommands(
    commands: TelegramCommand[],
    accountId?: string,
    options: { languageCode?: string; scope?: TelegramCommandScope } = {},
  ): Promise<void> {
    if (!Array.isArray(commands) || commands.length > 100) {
      throw new TelegramError('invalid_telegram_commands', 'Elenco comandi Telegram non valido');
    }
    const seen = new Set<string>();
    const normalized: TelegramCommand[] = commands.map(item => {
      if (!item || typeof item.command !== 'string' || !COMMAND_PATTERN.test(item.command)) {
        throw new TelegramError('invalid_telegram_commands', 'Comando Telegram non valido');
      }
      if (seen.has(item.command)) throw new TelegramError('invalid_telegram_commands', 'Comando Telegram duplicato');
      seen.add(item.command);
      if (typeof item.description !== 'string') {
        throw new TelegramError('invalid_telegram_commands', 'Descrizione comando Telegram non valida');
      }
      const description = item.description.trim();
      if (!description || description.length > 256 || [...description].some(char => char.charCodeAt(0) < 32)) {
        throw new TelegramError('invalid_telegram_commands', 'Descrizione comando Telegram non valida');
      }
      return { command: item.command, description };
    });
    const languageCode = options.languageCode?.trim();
    if (languageCode && !LANGUAGE_CODE_PATTERN.test(languageCode)) {
      throw new TelegramError('invalid_telegram_language_code', 'Codice lingua Telegram non valido');
    }
    const scope = options.scope
      ? {
        type: options.scope.type,
        ...('chatId' in options.scope ? { chat_id: options.scope.chatId } : {}),
        ...('userId' in options.scope ? { user_id: options.scope.userId } : {}),
      }
      : undefined;
    const { token } = this.tokenFor(accountId);
    await this.request(token, 'setMyCommands', {
      commands: normalized,
      ...(languageCode ? { language_code: languageCode } : {}),
      ...(scope ? { scope } : {}),
    });
  }

  async sendDocument(document: TelegramDocument, accountId?: string): Promise<void> {
    const { account } = this.tokenFor(accountId);
    if (!account.chatId) throw new TelegramError('telegram_not_configured', 'Chat ID Telegram non configurato', 409);
    await this.sendDocumentTo(account.chatId, document, account.id);
  }

  async sendDocumentTo(chatId: string, document: TelegramDocument, accountId?: string, options: { messageThreadId?: number } = {}): Promise<void> {
    const target = this.validTarget(chatId);
    const { token } = this.tokenFor(accountId);
    const messageThreadId = validMessageThreadId(options.messageThreadId);
    this.validateDocument(document);
    await this.retryRateLimit(() => callTelegramDocument(token, document, target, this.fetchImpl, messageThreadId));
  }

  async test(accountId?: string): Promise<void> {
    const { account } = this.tokenFor(accountId);
    await this.getMe(account.id);
    await this.send('Memora · test connessione Telegram riuscito.', account.id);
  }

  async discoverChats(accountId?: string): Promise<TelegramChat[]> {
    const { token } = this.tokenFor(accountId);
    const updates = await this.request<Array<Record<string, unknown>>>(token, 'getUpdates', {
      limit: 100,
      timeout: 0,
      allowed_updates: ['message', 'channel_post'],
    });
    if (!Array.isArray(updates)) throw new TelegramError('telegram_invalid_response', 'Risposta Telegram non valida', 502);
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

  private tokenFor(accountId?: string): { account: TelegramAccountView; token: string } {
    const account = this.store.resolveAccount(accountId);
    if (!account) throw new TelegramError('telegram_not_configured', 'Nessun account Telegram configurato', 409);
    const token = this.store.getToken(account.id);
    if (!token) throw new TelegramError('telegram_not_configured', 'Token Telegram non configurato', 409);
    return { account, token };
  }

  private validTarget(chatId: string): string {
    const target = validChatId(chatId);
    if (!target) throw new TelegramError('invalid_telegram_chat_id', 'Il Chat ID Telegram deve essere numerico');
    return target;
  }

  private validateDocument(document: TelegramDocument): void {
    if (!document || !Buffer.isBuffer(document.buffer) || document.buffer.byteLength === 0) {
      throw new TelegramError('invalid_telegram_document', 'Documento Telegram non valido');
    }
    if (document.buffer.byteLength > 50 * 1024 * 1024) {
      throw new TelegramError('telegram_document_too_large', 'Documento troppo grande per Telegram', 413);
    }
    if (typeof document.filename !== 'string' || !document.filename.trim() || document.filename.length > 180) {
      throw new TelegramError('invalid_telegram_document', 'Nome documento Telegram non valido');
    }
  }

  private async request<T>(
    token: string,
    method: string,
    payload: Record<string, unknown>,
    timeoutMs = 20_000,
  ): Promise<T> {
    return this.retryRateLimit(() => callTelegram<T>(token, method, payload, this.fetchImpl, timeoutMs));
  }

  private async retryRateLimit<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof TelegramError) || error.statusCode !== 429 || attempt >= this.maxRetries) throw error;
        const delay = Math.min(error.retryAfterMs ?? this.retryBaseMs * 2 ** attempt, this.maxRetryDelayMs);
        attempt += 1;
        await this.sleep(Math.max(0, Math.floor(delay)));
      }
    }
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
