import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { TelegramShare, TelegramShareMode } from '@memora/shared';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ACCOUNT_ID_PATTERN = /^acc_tg_[a-zA-Z0-9-]+$/;
const USER_ID_PATTERN = /^\d{1,20}$/;
const CHAT_ID_PATTERN = /^-?\d{1,20}$/;
const TURN_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;

interface SharesFile {
  version: 1;
  shares: Record<string, TelegramShare>;
}

export interface TelegramShareInput {
  accountId: string;
  userId: string | number;
  chatId: string | number;
  mode?: TelegramShareMode;
  includeArtifacts?: boolean;
}

export class TelegramShareError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'TelegramShareError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function validSessionId(value: unknown): string {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
    throw new TelegramShareError('invalid_telegram_share_session', 'ID sessione non valido');
  }
  return value;
}

function validAccountId(value: unknown): string {
  if (typeof value !== 'string' || !ACCOUNT_ID_PATTERN.test(value)) {
    throw new TelegramShareError('invalid_telegram_share_account', 'Account Telegram non valido');
  }
  return value;
}

function validUserId(value: unknown): string {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  if (!USER_ID_PATTERN.test(text)) throw new TelegramShareError('invalid_telegram_share_user', 'Utente Telegram non valido');
  return text;
}

function validChatId(value: unknown): string {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  if (!CHAT_ID_PATTERN.test(text)) throw new TelegramShareError('invalid_telegram_share_chat', 'Chat Telegram non valida');
  return text;
}

function validMode(value: unknown): TelegramShareMode {
  if (value === undefined) return 'answers';
  if (value !== 'answers' && value !== 'full') {
    throw new TelegramShareError('invalid_telegram_share_mode', 'Modalità di condivisione Telegram non valida');
  }
  return value;
}

function validTurnId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !TURN_ID_PATTERN.test(value)) {
    throw new TelegramShareError('invalid_telegram_share_turn', 'ID turno Telegram non valido');
  }
  return value;
}

function validError(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 500 || hasControlChars(value)) {
    throw new TelegramShareError('invalid_telegram_share_error', 'Errore di condivisione Telegram non valido');
  }
  return value;
}

/**
 * Configurazione per-sessione della condivisione web → Telegram.
 *
 * Non contiene token né testo delle conversazioni. I chat ID sono metadata
 * personali e restano in `config/`, escluso dagli export leggibili.
 */
export class TelegramShareStore {
  readonly filePath: string;
  private readonly configDir: string;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;
  private readonly shares = new Map<string, TelegramShare>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: { dataDir: string; now?: () => number; warn?: (message: string) => void }) {
    this.configDir = path.join(options.dataDir, 'config');
    this.filePath = path.join(this.configDir, 'telegram-shares.json');
    this.now = options.now ?? Date.now;
    this.warn = options.warn ?? (() => undefined);
  }

  async load(): Promise<void> {
    this.shares.clear();
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.warn('telegram shares ignored: unreadable file');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.warn('telegram shares ignored: invalid JSON');
      return;
    }
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.shares)) {
      this.warn('telegram shares ignored: invalid format');
      return;
    }
    for (const [sessionId, value] of Object.entries(parsed.shares)) {
      if (!SESSION_ID_PATTERN.test(sessionId) || !isRecord(value)) continue;
      try {
        const share: TelegramShare = {
          sessionId,
          accountId: validAccountId(value.accountId),
          userId: validUserId(value.userId),
          chatId: validChatId(value.chatId),
          mode: validMode(value.mode),
          includeArtifacts: value.includeArtifacts !== false,
          createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : this.now(),
          updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : this.now(),
          ...(validTurnId(value.lastDeliveredTurnId) ? { lastDeliveredTurnId: value.lastDeliveredTurnId as string } : {}),
          ...(validError(value.lastError) ? { lastError: value.lastError as string } : {}),
        };
        this.shares.set(sessionId, share);
      } catch {
        // Una entry non valida viene ignorata senza bloccare le altre.
      }
    }
    await fs.chmod(this.filePath, 0o600).catch(() => undefined);
  }

  get(sessionId: string): TelegramShare | undefined {
    const share = this.shares.get(validSessionId(sessionId));
    return share ? { ...share } : undefined;
  }

  list(): TelegramShare[] {
    return [...this.shares.values()].map(share => ({ ...share }));
  }

  async set(sessionId: string, input: TelegramShareInput): Promise<TelegramShare> {
    const id = validSessionId(sessionId);
    const now = this.now();
    const existing = this.shares.get(id);
    const share: TelegramShare = {
      sessionId: id,
      accountId: validAccountId(input.accountId),
      userId: validUserId(input.userId),
      chatId: validChatId(input.chatId),
      mode: validMode(input.mode),
      includeArtifacts: input.includeArtifacts !== false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.shares.set(id, share);
    await this.persist();
    return { ...share };
  }

  async remove(sessionId: string): Promise<boolean> {
    const id = validSessionId(sessionId);
    if (!this.shares.delete(id)) return false;
    await this.persist();
    return true;
  }

  async removeForAccount(accountId: string): Promise<number> {
    const id = validAccountId(accountId);
    let removed = 0;
    for (const [sessionId, share] of this.shares) {
      if (share.accountId !== id) continue;
      this.shares.delete(sessionId);
      removed += 1;
    }
    if (removed > 0) await this.persist();
    return removed;
  }

  async removeForUser(accountId: string, userId: string | number): Promise<number> {
    const account = validAccountId(accountId);
    const user = validUserId(userId);
    let removed = 0;
    for (const [sessionId, share] of this.shares) {
      if (share.accountId !== account || share.userId !== user) continue;
      this.shares.delete(sessionId);
      removed += 1;
    }
    if (removed > 0) await this.persist();
    return removed;
  }

  async markDelivered(sessionId: string, turnId: string): Promise<void> {
    const share = this.shares.get(validSessionId(sessionId));
    if (!share) return;
    share.lastDeliveredTurnId = validTurnId(turnId);
    delete share.lastError;
    share.updatedAt = this.now();
    await this.persist();
  }

  async setError(sessionId: string, error: string): Promise<void> {
    const share = this.shares.get(validSessionId(sessionId));
    if (!share) return;
    share.lastError = validError(error.slice(0, 500));
    share.updatedAt = this.now();
    await this.persist();
  }

  private persist(): Promise<void> {
    const payload = JSON.stringify({ version: 1, shares: Object.fromEntries(this.shares) } satisfies SharesFile, null, 2);
    const run = this.writeChain.catch(() => undefined).then(async () => {
      await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
      await fs.chmod(this.configDir, 0o700).catch(() => undefined);
      const temporary = path.join(this.configDir, `.telegram-shares.${process.pid}.${crypto.randomUUID()}.tmp`);
      await fs.writeFile(temporary, `${payload}\n`, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    });
    this.writeChain = run;
    return run;
  }
}
