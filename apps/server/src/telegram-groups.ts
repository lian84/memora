import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  TelegramGroup,
  TelegramGroupInput,
  TelegramTopicBinding,
  TelegramTopicInput,
  TelegramTopicTitleSource,
} from '@memora/shared';

const ACCOUNT_ID_PATTERN = /^acc_tg_[a-zA-Z0-9-]+$/;
const CHAT_ID_PATTERN = /^-\d{1,20}$/;
const THREAD_ID_PATTERN = /^\d{1,20}$/;
const USER_ID_PATTERN = /^\d{1,20}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TURN_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;

interface GroupFile {
  version: 1;
  accounts: Record<string, { groups: Record<string, TelegramGroup> }>;
}

export class TelegramGroupError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'TelegramGroupError';
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

function validAccountId(value: unknown): string {
  if (typeof value !== 'string' || !ACCOUNT_ID_PATTERN.test(value)) {
    throw new TelegramGroupError('invalid_telegram_group_account', 'Account Telegram non valido');
  }
  return value;
}

function validChatId(value: unknown): string {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  if (!CHAT_ID_PATTERN.test(text)) throw new TelegramGroupError('invalid_telegram_group_chat', 'Chat ID gruppo Telegram non valido');
  return text;
}

function validThreadId(value: unknown): string {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  if (!THREAD_ID_PATTERN.test(text) || text === '0') throw new TelegramGroupError('invalid_telegram_topic', 'ID topic Telegram non valido');
  return text;
}

function validUserId(value: unknown): string {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  if (!USER_ID_PATTERN.test(text)) throw new TelegramGroupError('invalid_telegram_group_user', 'Utente Telegram non valido');
  return text;
}

function validTitle(value: unknown, fallback = '', maxLength = 128): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw new TelegramGroupError('invalid_telegram_group_title', 'Titolo Telegram non valido');
  const title = value.replace(/\s+/g, ' ').trim();
  if (!title || title.length > maxLength || hasControlChars(title)) throw new TelegramGroupError('invalid_telegram_group_title', 'Titolo Telegram non valido');
  return title;
}

function validSessionId(value: unknown): string {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
    throw new TelegramGroupError('invalid_telegram_group_session', 'ID sessione non valido');
  }
  return value;
}

function validOptionalSlug(value: unknown, code: string, message: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !SLUG_PATTERN.test(value)) throw new TelegramGroupError(code, message);
  return value;
}

function validTitleSource(value: unknown): TelegramTopicTitleSource {
  return value === 'auto' ? 'auto' : 'manual';
}

function copyTopic(topic: TelegramTopicBinding): TelegramTopicBinding {
  return { ...topic };
}

function copyGroup(group: TelegramGroup): TelegramGroup {
  return {
    ...group,
    allowedUsers: [...group.allowedUsers],
    topics: Object.fromEntries(Object.entries(group.topics).map(([id, topic]) => [id, copyTopic(topic)])),
  };
}

/**
 * Registry dei gruppi Telegram forum e dei topic collegati alle sessioni.
 *
 * Contiene solo metadata: nessun testo dei messaggi e nessun token. Il file
 * resta in `config/`, quindi è escluso dagli export leggibili e incluso nei
 * backup cifrati.
 */
export class TelegramGroupStore {
  readonly filePath: string;
  private readonly configDir: string;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;
  private readonly accounts = new Map<string, Map<string, TelegramGroup>>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: { dataDir: string; now?: () => number; warn?: (message: string) => void }) {
    this.configDir = path.join(options.dataDir, 'config');
    this.filePath = path.join(this.configDir, 'telegram-groups.json');
    this.now = options.now ?? Date.now;
    this.warn = options.warn ?? (() => undefined);
  }

  async load(): Promise<void> {
    this.accounts.clear();
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.warn('telegram groups ignored: unreadable file');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.warn('telegram groups ignored: invalid JSON');
      return;
    }
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.accounts)) {
      this.warn('telegram groups ignored: invalid format');
      return;
    }
    for (const [accountId, accountValue] of Object.entries(parsed.accounts)) {
      if (!ACCOUNT_ID_PATTERN.test(accountId) || !isRecord(accountValue) || !isRecord(accountValue.groups)) continue;
      const groups = new Map<string, TelegramGroup>();
      for (const [chatId, value] of Object.entries(accountValue.groups)) {
        if (!CHAT_ID_PATTERN.test(chatId) || !isRecord(value)) continue;
        const group = this.parseGroup(chatId, value);
        if (group) groups.set(group.chatId, group);
      }
      this.accounts.set(accountId, groups);
    }
    await fs.chmod(this.filePath, 0o600).catch(() => undefined);
  }

  get(accountId: string, chatId: string): TelegramGroup | undefined {
    const group = this.account(validAccountId(accountId)).get(validChatId(chatId));
    return group ? copyGroup(group) : undefined;
  }

  list(accountId: string): TelegramGroup[] {
    return [...this.account(validAccountId(accountId)).values()]
      .map(copyGroup)
      .sort((a, b) => a.title.localeCompare(b.title, 'it'));
  }

  async upsert(accountId: string, input: TelegramGroupInput): Promise<TelegramGroup> {
    const account = validAccountId(accountId);
    const chatId = validChatId(input.chatId);
    const groups = this.account(account);
    const existing = groups.get(chatId);
    const allowedUsers = [...new Set((input.allowedUsers ?? []).map(validUserId))];
    if (allowedUsers.length === 0 || allowedUsers.length > 20) {
      throw new TelegramGroupError('invalid_telegram_group_users', 'La allowlist del gruppo non è valida');
    }
    const now = this.now();
    const generalSessionId = input.generalSessionId === null
      ? undefined
      : input.generalSessionId !== undefined
        ? validSessionId(input.generalSessionId)
        : existing?.generalSessionId;
    const group: TelegramGroup = {
      chatId,
      title: validTitle(input.title, existing?.title ?? 'Memora', 255),
      isForum: input.isForum !== false,
      pairedAt: existing?.pairedAt ?? now,
      updatedAt: now,
      allowedUsers,
      defaultProjectId: input.defaultProjectId === undefined
        ? existing?.defaultProjectId ?? null
        : validOptionalSlug(input.defaultProjectId, 'invalid_telegram_project_id', 'Progetto Telegram non valido'),
      defaultAgentProfileId: input.defaultAgentProfileId === undefined
        ? existing?.defaultAgentProfileId ?? null
        : validOptionalSlug(input.defaultAgentProfileId, 'invalid_telegram_agent_profile_id', 'Profilo agente Telegram non valido'),
      ...(generalSessionId ? { generalSessionId } : {}),
      ...(generalSessionId && existing?.generalSessionId === generalSessionId && existing.generalLastTurnId
        ? { generalLastTurnId: existing.generalLastTurnId }
        : {}),
      ...(generalSessionId && existing?.generalSessionId === generalSessionId && existing.generalPendingTurnId
        ? { generalPendingTurnId: existing.generalPendingTurnId }
        : {}),
      topics: existing?.topics ?? {},
    };
    groups.set(chatId, group);
    await this.persist();
    return copyGroup(group);
  }

  async removeGroup(accountId: string, chatId: string): Promise<boolean> {
    const account = validAccountId(accountId);
    const groups = this.account(account);
    if (!groups.delete(validChatId(chatId))) return false;
    await this.persist();
    return true;
  }

  async removeAccount(accountId: string): Promise<number> {
    const account = validAccountId(accountId);
    const groups = this.accounts.get(account);
    const removed = groups?.size ?? 0;
    if (removed > 0) {
      this.accounts.delete(account);
      await this.persist();
    }
    return removed;
  }

  async setGeneralSession(accountId: string, chatId: string, sessionId: string | null): Promise<TelegramGroup> {
    const group = this.requireGroup(accountId, chatId);
    const next = sessionId === null ? undefined : validSessionId(sessionId);
    if (next !== group.generalSessionId) {
      delete group.generalLastTurnId;
      delete group.generalPendingTurnId;
    }
    if (next === undefined) delete group.generalSessionId;
    else group.generalSessionId = next;
    group.updatedAt = this.now();
    await this.persist();
    return copyGroup(group);
  }

  async updateGeneralTurn(accountId: string, chatId: string, patch: {
    lastTurnId?: string;
    pendingTurnId?: string | null;
  }): Promise<TelegramGroup> {
    const group = this.requireGroup(accountId, chatId);
    if (!group.generalSessionId) throw new TelegramGroupError('telegram_general_not_found', 'Sessione General non trovata', 404);
    if (patch.lastTurnId !== undefined) {
      if (!TURN_ID_PATTERN.test(patch.lastTurnId)) throw new TelegramGroupError('invalid_telegram_turn', 'ID turno Telegram non valido');
      group.generalLastTurnId = patch.lastTurnId;
    }
    if (patch.pendingTurnId !== undefined) {
      if (patch.pendingTurnId !== null && !TURN_ID_PATTERN.test(patch.pendingTurnId)) {
        throw new TelegramGroupError('invalid_telegram_turn', 'ID turno Telegram non valido');
      }
      if (patch.pendingTurnId === null) delete group.generalPendingTurnId;
      else group.generalPendingTurnId = patch.pendingTurnId;
    }
    group.updatedAt = this.now();
    await this.persist();
    return copyGroup(group);
  }

  getTopic(accountId: string, chatId: string, threadId: string): TelegramTopicBinding | undefined {
    const group = this.requireGroup(accountId, chatId);
    const topic = group.topics[validThreadId(threadId)];
    return topic ? copyTopic(topic) : undefined;
  }

  listTopics(accountId: string, chatId: string): TelegramTopicBinding[] {
    return Object.values(this.requireGroup(accountId, chatId).topics)
      .map(copyTopic)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async putTopic(accountId: string, chatId: string, input: TelegramTopicInput): Promise<TelegramTopicBinding> {
    const group = this.requireGroup(accountId, chatId);
    const threadId = validThreadId(input.threadId);
    const sessionId = validSessionId(input.sessionId);
    const existing = group.topics[threadId];
    const now = this.now();
    const topic: TelegramTopicBinding = {
      threadId,
      sessionId,
      title: validTitle(input.title, existing?.title ?? `Topic ${threadId}`),
      titleSource: input.titleSource === undefined ? existing?.titleSource ?? 'manual' : validTitleSource(input.titleSource),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(existing?.sessionId === sessionId && existing.pendingTurnId ? { pendingTurnId: existing.pendingTurnId } : {}),
      ...(existing?.sessionId === sessionId && existing.lastTurnId ? { lastTurnId: existing.lastTurnId } : {}),
    };
    group.topics[threadId] = topic;
    group.updatedAt = now;
    await this.persist();
    return copyTopic(topic);
  }

  async updateTopicTurn(accountId: string, chatId: string, threadId: string, patch: {
    lastTurnId?: string;
    pendingTurnId?: string | null;
  }): Promise<TelegramTopicBinding> {
    const group = this.requireGroup(accountId, chatId);
    const topic = group.topics[validThreadId(threadId)];
    if (!topic) throw new TelegramGroupError('telegram_topic_not_found', 'Topic Telegram non trovato', 404);
    if (patch.lastTurnId !== undefined) {
      if (!TURN_ID_PATTERN.test(patch.lastTurnId)) throw new TelegramGroupError('invalid_telegram_turn', 'ID turno Telegram non valido');
      topic.lastTurnId = patch.lastTurnId;
    }
    if (patch.pendingTurnId !== undefined) {
      if (patch.pendingTurnId !== null && !TURN_ID_PATTERN.test(patch.pendingTurnId)) {
        throw new TelegramGroupError('invalid_telegram_turn', 'ID turno Telegram non valido');
      }
      if (patch.pendingTurnId === null) delete topic.pendingTurnId;
      else topic.pendingTurnId = patch.pendingTurnId;
    }
    topic.updatedAt = this.now();
    group.updatedAt = topic.updatedAt;
    await this.persist();
    return copyTopic(topic);
  }

  async updateTopicTitle(accountId: string, chatId: string, threadId: string, title: string): Promise<TelegramTopicBinding | undefined> {
    const group = this.requireGroup(accountId, chatId);
    const id = validThreadId(threadId);
    const topic = group.topics[id];
    if (!topic) return undefined;
    topic.title = validTitle(title, topic.title);
    topic.titleSource = 'manual';
    topic.updatedAt = this.now();
    group.updatedAt = topic.updatedAt;
    await this.persist();
    return copyTopic(topic);
  }

  async removeTopic(accountId: string, chatId: string, threadId: string): Promise<boolean> {
    const group = this.requireGroup(accountId, chatId);
    const id = validThreadId(threadId);
    if (!group.topics[id]) return false;
    delete group.topics[id];
    group.updatedAt = this.now();
    await this.persist();
    return true;
  }

  async removeTopicsForSession(sessionId: string): Promise<number> {
    const id = validSessionId(sessionId);
    let removed = 0;
    const now = this.now();
    for (const groups of this.accounts.values()) {
      for (const group of groups.values()) {
        let changed = false;
        if (group.generalSessionId === id) {
          delete group.generalSessionId;
          delete group.generalLastTurnId;
          delete group.generalPendingTurnId;
          changed = true;
          removed += 1;
        }
        for (const [threadId, topic] of Object.entries(group.topics)) {
          if (topic.sessionId !== id) continue;
          delete group.topics[threadId];
          changed = true;
          removed += 1;
        }
        if (changed) group.updatedAt = now;
      }
    }
    if (removed > 0) await this.persist();
    return removed;
  }

  findTopicBySession(accountId: string, sessionId: string): { chatId: string; topic: TelegramTopicBinding } | undefined {
    const id = validSessionId(sessionId);
    for (const [chatId, group] of this.account(validAccountId(accountId))) {
      for (const topic of Object.values(group.topics)) {
        if (topic.sessionId === id) return { chatId, topic: copyTopic(topic) };
      }
    }
    return undefined;
  }

  private account(accountId: string): Map<string, TelegramGroup> {
    const id = validAccountId(accountId);
    let groups = this.accounts.get(id);
    if (!groups) {
      groups = new Map();
      this.accounts.set(id, groups);
    }
    return groups;
  }

  private requireGroup(accountId: string, chatId: string): TelegramGroup {
    const group = this.account(validAccountId(accountId)).get(validChatId(chatId));
    if (!group) throw new TelegramGroupError('telegram_group_not_found', 'Gruppo Telegram non trovato', 404);
    return group;
  }

  private parseGroup(chatId: string, value: Record<string, unknown>): TelegramGroup | null {
    try {
      const allowedUsers = Array.isArray(value.allowedUsers)
        ? [...new Set(value.allowedUsers.map(validUserId))]
        : [];
      if (allowedUsers.length === 0 || allowedUsers.length > 20) return null;
      const topics: Record<string, TelegramTopicBinding> = {};
      if (isRecord(value.topics)) {
        for (const [threadId, topicValue] of Object.entries(value.topics)) {
          if (!THREAD_ID_PATTERN.test(threadId) || threadId === '0' || !isRecord(topicValue)) continue;
          try {
            const sessionId = validSessionId(topicValue.sessionId);
            topics[threadId] = {
              threadId,
              sessionId,
              title: validTitle(topicValue.title, `Topic ${threadId}`),
              titleSource: validTitleSource(topicValue.titleSource),
              createdAt: typeof topicValue.createdAt === 'number' && Number.isFinite(topicValue.createdAt) ? topicValue.createdAt : this.now(),
              updatedAt: typeof topicValue.updatedAt === 'number' && Number.isFinite(topicValue.updatedAt) ? topicValue.updatedAt : this.now(),
              ...(typeof topicValue.pendingTurnId === 'string' && TURN_ID_PATTERN.test(topicValue.pendingTurnId) ? { pendingTurnId: topicValue.pendingTurnId } : {}),
              ...(typeof topicValue.lastTurnId === 'string' && TURN_ID_PATTERN.test(topicValue.lastTurnId) ? { lastTurnId: topicValue.lastTurnId } : {}),
            };
          } catch {
            // Topic non valido: ignoralo.
          }
        }
      }
      let generalSessionId: string | undefined;
      try { generalSessionId = value.generalSessionId === undefined ? undefined : validSessionId(value.generalSessionId); } catch { generalSessionId = undefined; }
      return {
        chatId,
        title: validTitle(value.title, 'Memora', 255),
        isForum: value.isForum !== false,
        pairedAt: typeof value.pairedAt === 'number' && Number.isFinite(value.pairedAt) ? value.pairedAt : this.now(),
        updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : this.now(),
        allowedUsers,
        defaultProjectId: validOptionalSlug(value.defaultProjectId, 'invalid_telegram_project_id', 'Progetto Telegram non valido'),
        defaultAgentProfileId: validOptionalSlug(value.defaultAgentProfileId, 'invalid_telegram_agent_profile_id', 'Profilo agente Telegram non valido'),
        ...(generalSessionId ? { generalSessionId } : {}),
        ...(typeof value.generalLastTurnId === 'string' && TURN_ID_PATTERN.test(value.generalLastTurnId) ? { generalLastTurnId: value.generalLastTurnId } : {}),
        ...(typeof value.generalPendingTurnId === 'string' && TURN_ID_PATTERN.test(value.generalPendingTurnId) ? { generalPendingTurnId: value.generalPendingTurnId } : {}),
        topics,
      };
    } catch {
      return null;
    }
  }

  private persist(): Promise<void> {
    const payload = JSON.stringify({
      version: 1,
      accounts: Object.fromEntries([...this.accounts].map(([accountId, groups]) => [
        accountId,
        { groups: Object.fromEntries(groups) },
      ])),
    } satisfies GroupFile, null, 2);
    const run = this.writeChain.catch(() => undefined).then(async () => {
      await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
      await fs.chmod(this.configDir, 0o700).catch(() => undefined);
      const temporary = path.join(this.configDir, `.telegram-groups.${process.pid}.${crypto.randomUUID()}.tmp`);
      await fs.writeFile(temporary, `${payload}\n`, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    });
    this.writeChain = run;
    return run;
  }
}
