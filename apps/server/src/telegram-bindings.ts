import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_TELEGRAM_INBOUND_SETTINGS,
  TELEGRAM_INBOUND_MAX_ALLOWED_USERS,
  TELEGRAM_INBOUND_MAX_QUEUED_MESSAGES,
  TELEGRAM_PAIRING_MAX_ATTEMPTS,
  TELEGRAM_PAIRING_TTL_MS,
  type TelegramAllowedUser,
  type TelegramAllowedUserInput,
  type TelegramBinding,
  type TelegramInboundAccountView,
  type TelegramInboundPatch,
  type TelegramInboundSettings,
  type TelegramPairingCodeView,
  type TelegramPairingInput,
  type TelegramPairingScope,
  type TelegramReplyMode,
} from '@memora/shared';

const ACCOUNT_ID_PATTERN = /^acc_tg_[a-zA-Z0-9-]+$/;
const USER_ID_PATTERN = /^\d{1,20}$/;
const CHAT_ID_PATTERN = /^-?\d{1,20}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PAIRING_CODE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const PAIRING_HASH_PATTERN = /^[a-f0-9]{64}$/;

interface StoredPairing {
  codeHash: string;
  salt: string;
  createdAt: number;
  expiresAt: number;
  scope: TelegramPairingScope;
}

interface PairingFailures {
  attempts: number;
  firstAt: number;
}

interface TelegramInboundAccountState {
  enabled: boolean;
  allowedUsers: TelegramAllowedUser[];
  pairing: StoredPairing | null;
  offset: number;
  bindings: Record<string, TelegramBinding>;
  settings: TelegramInboundSettings;
}

interface TelegramInboundFile {
  version: 1;
  accounts: Record<string, TelegramInboundAccountState>;
}

export class TelegramInboundError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'TelegramInboundError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validAccountId(value: unknown): string {
  if (typeof value !== 'string' || !ACCOUNT_ID_PATTERN.test(value)) {
    throw new TelegramInboundError('invalid_telegram_account_id', 'ID account Telegram non valido');
  }
  return value;
}

function validUserId(value: unknown): string {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!USER_ID_PATTERN.test(normalized)) {
    throw new TelegramInboundError('invalid_telegram_user_id', 'ID utente Telegram non valido');
  }
  return normalized;
}

function validChatId(value: unknown): string {
  if (typeof value !== 'string' || !CHAT_ID_PATTERN.test(value.trim())) {
    throw new TelegramInboundError('invalid_telegram_chat_id', 'Chat ID Telegram non valido');
  }
  return value.trim();
}

function validSessionId(value: unknown): string {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
    throw new TelegramInboundError('invalid_telegram_session_id', 'ID sessione non valido');
  }
  return value;
}

function validLabel(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw new TelegramInboundError('invalid_telegram_label', 'Etichetta Telegram non valida');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80 || [...trimmed].some(char => char.charCodeAt(0) < 32)) {
    throw new TelegramInboundError('invalid_telegram_label', 'Etichetta Telegram non valida');
  }
  return trimmed;
}

function validOptionalSlug(value: unknown, code: string, message: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !SLUG_PATTERN.test(value)) throw new TelegramInboundError(code, message);
  return value;
}

function validReplyMode(value: unknown): TelegramReplyMode {
  if (value !== 'final' && value !== 'progress') {
    throw new TelegramInboundError('invalid_telegram_reply_mode', 'Modalità di risposta Telegram non valida');
  }
  return value;
}

function validQueueSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > TELEGRAM_INBOUND_MAX_QUEUED_MESSAGES) {
    throw new TelegramInboundError('invalid_telegram_queue_size', 'Dimensione coda Telegram non valida');
  }
  return value;
}

function validOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TelegramInboundError('invalid_telegram_offset', 'Offset Telegram non valido');
  }
  return value;
}

function copyUser(user: TelegramAllowedUser): TelegramAllowedUser {
  return { ...user };
}

function copyBinding(binding: TelegramBinding): TelegramBinding {
  return { ...binding };
}

function defaultSettings(): TelegramInboundSettings {
  return { ...DEFAULT_TELEGRAM_INBOUND_SETTINGS };
}

function defaultState(): TelegramInboundAccountState {
  return {
    enabled: false,
    allowedUsers: [],
    pairing: null,
    offset: 0,
    bindings: {},
    settings: defaultSettings(),
  };
}

function pairingHash(salt: string, code: string): string {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

/**
 * Stato non segreto del canale Telegram in ingresso.
 *
 * Il file contiene allowlist, codici di pairing hashati, offset degli update e
 * collegamenti chat → sessione. Non contiene token, testo dei messaggi o altri
 * segreti. I token restano in `telegram-secrets.json`.
 */
export class TelegramBindingStore {
  readonly filePath: string;
  private readonly configDir: string;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;
  private readonly pairingTtlMs: number;
  private readonly maxAllowedUsers: number;
  private readonly maxPairingAttempts: number;
  private readonly accounts = new Map<string, TelegramInboundAccountState>();
  /** Tentativi falliti per utente, solo in memoria: un utente non può invalidare il codice per gli altri. */
  private readonly pairingFailures = new Map<string, PairingFailures>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: {
    dataDir: string;
    now?: () => number;
    warn?: (message: string) => void;
    pairingTtlMs?: number;
    maxAllowedUsers?: number;
    maxPairingAttempts?: number;
  }) {
    this.configDir = path.join(options.dataDir, 'config');
    this.filePath = path.join(this.configDir, 'telegram-inbound.json');
    this.now = options.now ?? Date.now;
    this.warn = options.warn ?? (() => undefined);
    this.pairingTtlMs = options.pairingTtlMs ?? TELEGRAM_PAIRING_TTL_MS;
    this.maxAllowedUsers = options.maxAllowedUsers ?? TELEGRAM_INBOUND_MAX_ALLOWED_USERS;
    this.maxPairingAttempts = options.maxPairingAttempts ?? TELEGRAM_PAIRING_MAX_ATTEMPTS;
  }

  async load(): Promise<void> {
    this.accounts.clear();
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.warn('telegram inbound state ignored: unreadable file');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.warn('telegram inbound state ignored: invalid JSON');
      return;
    }
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.accounts)) {
      this.warn('telegram inbound state ignored: invalid format');
      return;
    }

    for (const [accountId, value] of Object.entries(parsed.accounts)) {
      if (!ACCOUNT_ID_PATTERN.test(accountId) || !isRecord(value)) continue;
      const state = this.parseAccount(value);
      this.accounts.set(accountId, state);
    }
    await fs.chmod(this.filePath, 0o600).catch(() => undefined);
  }

  /** Vista amministrativa di un account; un account sconosciuto parte disabilitato. */
  get(accountId: string): TelegramInboundAccountView {
    const id = validAccountId(accountId);
    const state = this.account(id);
    const pairingActive = this.pairingActive(state.pairing);
    return {
      accountId: id,
      enabled: state.enabled,
      allowedUsers: state.allowedUsers.map(copyUser).sort((a, b) => a.pairedAt - b.pairedAt),
      bindings: Object.values(state.bindings).map(copyBinding).sort((a, b) => b.updatedAt - a.updatedAt),
      settings: { ...state.settings },
      pairing: {
        active: pairingActive,
        ...(state.pairing ? { expiresAt: state.pairing.expiresAt } : {}),
      },
      offset: state.offset,
    };
  }

  listAccountIds(): string[] {
    return [...this.accounts.keys()].sort();
  }

  async update(accountId: string, patch: TelegramInboundPatch): Promise<TelegramInboundAccountView> {
    const id = validAccountId(accountId);
    const state = this.account(id);
    if (patch.enabled !== undefined) {
      state.enabled = patch.enabled === true;
      if (!state.enabled) {
        state.pairing = null;
        this.clearPairingFailures(id);
      }
    }
    if (patch.defaultProjectId !== undefined) {
      state.settings.defaultProjectId = validOptionalSlug(patch.defaultProjectId, 'invalid_telegram_project_id', 'Progetto Telegram non valido');
    }
    if (patch.defaultAgentProfileId !== undefined) {
      state.settings.defaultAgentProfileId = validOptionalSlug(patch.defaultAgentProfileId, 'invalid_telegram_agent_profile_id', 'Profilo agente Telegram non valido');
    }
    if (patch.replyMode !== undefined) state.settings.replyMode = validReplyMode(patch.replyMode);
    if (patch.maxQueuedMessages !== undefined) state.settings.maxQueuedMessages = validQueueSize(patch.maxQueuedMessages);
    await this.persist();
    return this.get(id);
  }

  async createPairingCode(accountId: string, scope: TelegramPairingScope = 'private'): Promise<TelegramPairingCodeView> {
    if (scope !== 'private' && scope !== 'group') {
      throw new TelegramInboundError('invalid_telegram_pairing_scope', 'Ambito di associazione non valido');
    }
    const id = validAccountId(accountId);
    const state = this.account(id);
    if (!state.enabled) throw new TelegramInboundError('telegram_inbound_disabled', 'Il canale Telegram in ingresso non è abilitato', 409);
    const code = crypto.randomBytes(16).toString('base64url');
    const salt = crypto.randomBytes(16).toString('hex');
    const createdAt = this.now();
    state.pairing = {
      codeHash: pairingHash(salt, code),
      salt,
      createdAt,
      expiresAt: createdAt + this.pairingTtlMs,
      scope,
    };
    this.clearPairingFailures(id);
    const expiresAt = state.pairing.expiresAt;
    await this.persist();
    return { code, expiresAt };
  }

  async clearPairing(accountId: string): Promise<TelegramInboundAccountView> {
    const id = validAccountId(accountId);
    const state = this.account(id);
    if (state.pairing) {
      state.pairing = null;
      this.clearPairingFailures(id);
      await this.persist();
    }
    return this.get(id);
  }

  /**
   * Valida e consuma un codice di pairing senza modificare la allowlist DM.
   *
   * Serve al pairing dei gruppi: un codice con scope `group` autorizza il
   * gruppo, non la chat privata dell'utente. Il chiamante deve verificare i
   * requisiti del gruppo prima di consumare il codice.
   */
  async consumePairingCode(accountId: string, input: TelegramPairingInput): Promise<{ userId: string; label?: string }> {
    const id = validAccountId(accountId);
    const state = this.account(id);
    if (!state.enabled) throw new TelegramInboundError('telegram_inbound_disabled', 'Il canale Telegram in ingresso non è abilitato', 409);

    const userId = validUserId(input.userId);
    const requestedLabel = input.label !== undefined && input.label !== null && input.label !== ''
      ? validLabel(input.label, '')
      : undefined;
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    const scope = input.scope ?? 'private';
    const pairing = state.pairing;
    if (!pairing || (pairing.scope ?? 'private') !== scope) {
      throw new TelegramInboundError('invalid_telegram_pairing_code', 'Codice di associazione non valido');
    }
    if (pairing.expiresAt <= this.now()) {
      state.pairing = null;
      this.clearPairingFailures(id);
      await this.persist();
      throw new TelegramInboundError('telegram_pairing_expired', 'Codice di associazione scaduto', 410);
    }
    if (this.pairingFailureCount(id, userId) >= this.maxPairingAttempts) {
      throw new TelegramInboundError('telegram_pairing_attempts', 'Troppi tentativi di associazione', 429);
    }
    if (!PAIRING_CODE_PATTERN.test(code) || !this.pairingMatches(pairing, code)) {
      const attempts = this.recordPairingFailure(id, userId);
      if (attempts >= this.maxPairingAttempts) {
        throw new TelegramInboundError('telegram_pairing_attempts', 'Troppi tentativi di associazione', 429);
      }
      throw new TelegramInboundError('invalid_telegram_pairing_code', 'Codice di associazione non valido');
    }

    state.pairing = null;
    this.clearPairingFailures(id);
    await this.persist();
    return { userId, ...(requestedLabel !== undefined ? { label: requestedLabel } : {}) };
  }

  /** Completa il pairing DM e aggiunge l'utente alla allowlist. */
  async pair(accountId: string, input: TelegramPairingInput): Promise<TelegramAllowedUser> {
    const id = validAccountId(accountId);
    const state = this.account(id);
    const userId = validUserId(input.userId);
    const existing = state.allowedUsers.find(user => user.id === userId);
    if (!existing && state.allowedUsers.length >= this.maxAllowedUsers) {
      throw new TelegramInboundError('telegram_too_many_users', 'Troppi utenti Telegram autorizzati', 409);
    }

    const consumed = await this.consumePairingCode(id, input);
    if (existing) {
      if (consumed.label !== undefined) existing.label = consumed.label;
      await this.persist();
      return copyUser(existing);
    }

    const user: TelegramAllowedUser = {
      id: userId,
      label: consumed.label ?? `Telegram ${userId}`,
      pairedAt: this.now(),
    };
    state.allowedUsers.push(user);
    await this.persist();
    return copyUser(user);
  }

  /** Aggiunge o aggiorna un utente autorizzato senza consumare un codice. */
  async addAllowedUser(accountId: string, input: TelegramAllowedUserInput): Promise<TelegramAllowedUser> {
    const id = validAccountId(accountId);
    const state = this.account(id);
    const userId = validUserId(input.id);
    const existing = state.allowedUsers.find(user => user.id === userId);
    if (existing) {
      if (input.label !== undefined) {
        const label = validLabel(input.label, existing.label);
        if (label !== existing.label) {
          existing.label = label;
          await this.persist();
        }
      }
      return copyUser(existing);
    }
    if (state.allowedUsers.length >= this.maxAllowedUsers) {
      throw new TelegramInboundError('telegram_too_many_users', 'Troppi utenti Telegram autorizzati', 409);
    }
    const user: TelegramAllowedUser = {
      id: userId,
      label: validLabel(input.label, `Telegram ${userId}`),
      pairedAt: this.now(),
    };
    state.allowedUsers.push(user);
    await this.persist();
    return copyUser(user);
  }

  /** Revoca l'accesso e rimuove il collegamento; la sessione resta intatta. */
  async removeAllowedUser(accountId: string, userId: string | number): Promise<boolean> {
    const id = validAccountId(accountId);
    const state = this.account(id);
    const normalized = validUserId(userId);
    const index = state.allowedUsers.findIndex(user => user.id === normalized);
    if (index < 0) return false;
    state.allowedUsers.splice(index, 1);
    delete state.bindings[normalized];
    await this.persist();
    return true;
  }

  isAllowed(accountId: string, userId: string | number): boolean {
    const id = validAccountId(accountId);
    const normalized = validUserId(userId);
    return this.account(id).allowedUsers.some(user => user.id === normalized);
  }

  getAllowedUser(accountId: string, userId: string | number): TelegramAllowedUser | undefined {
    const id = validAccountId(accountId);
    const normalized = validUserId(userId);
    const user = this.account(id).allowedUsers.find(item => item.id === normalized);
    return user ? copyUser(user) : undefined;
  }

  async touchAllowedUser(accountId: string, userId: string | number): Promise<void> {
    const id = validAccountId(accountId);
    const normalized = validUserId(userId);
    const user = this.account(id).allowedUsers.find(item => item.id === normalized);
    if (!user) return;
    user.lastSeenAt = this.now();
    await this.persist();
  }

  getBinding(accountId: string, userId: string | number): TelegramBinding | undefined {
    const id = validAccountId(accountId);
    const normalized = validUserId(userId);
    const binding = this.account(id).bindings[normalized];
    return binding ? copyBinding(binding) : undefined;
  }

  async setBinding(accountId: string, input: {
    userId: string | number;
    chatId: string;
    sessionId: string;
    projectId?: string | null;
    agentProfileId?: string | null;
  }): Promise<TelegramBinding> {
    const id = validAccountId(accountId);
    const state = this.account(id);
    const userId = validUserId(input.userId);
    if (!state.allowedUsers.some(user => user.id === userId)) {
      throw new TelegramInboundError('telegram_user_not_allowed', 'Utente Telegram non autorizzato', 403);
    }
    const sessionId = validSessionId(input.sessionId);
    const chatId = validChatId(input.chatId);
    const projectId = input.projectId === undefined
      ? undefined
      : validOptionalSlug(input.projectId, 'invalid_telegram_project_id', 'Progetto Telegram non valido');
    const agentProfileId = input.agentProfileId === undefined
      ? undefined
      : validOptionalSlug(input.agentProfileId, 'invalid_telegram_agent_profile_id', 'Profilo agente Telegram non valido');
    const now = this.now();
    const existing = state.bindings[userId];
    const binding: TelegramBinding = {
      chatId,
      userId,
      sessionId,
      ...(projectId !== null && projectId !== undefined ? { projectId } : {}),
      ...(agentProfileId !== null && agentProfileId !== undefined ? { agentProfileId } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(existing?.sessionId === sessionId && existing.lastTurnId ? { lastTurnId: existing.lastTurnId } : {}),
      ...(existing?.sessionId === sessionId && existing.pendingTurnId ? { pendingTurnId: existing.pendingTurnId } : {}),
    };
    state.bindings[userId] = binding;
    await this.persist();
    return copyBinding(binding);
  }

  async updateBinding(accountId: string, userId: string | number, patch: {
    lastTurnId?: string;
    pendingTurnId?: string | null;
  }): Promise<TelegramBinding> {
    const id = validAccountId(accountId);
    const state = this.account(id);
    const normalized = validUserId(userId);
    const binding = state.bindings[normalized];
    if (!binding) throw new TelegramInboundError('telegram_binding_not_found', 'Collegamento Telegram non trovato', 404);
    if (patch.lastTurnId !== undefined) {
      if (!SESSION_ID_PATTERN.test(patch.lastTurnId)) throw new TelegramInboundError('invalid_telegram_turn_id', 'ID turno Telegram non valido');
      binding.lastTurnId = patch.lastTurnId;
    }
    if (patch.pendingTurnId !== undefined) {
      if (patch.pendingTurnId !== null && !SESSION_ID_PATTERN.test(patch.pendingTurnId)) {
        throw new TelegramInboundError('invalid_telegram_turn_id', 'ID turno Telegram non valido');
      }
      if (patch.pendingTurnId === null) delete binding.pendingTurnId;
      else binding.pendingTurnId = patch.pendingTurnId;
    }
    binding.updatedAt = this.now();
    await this.persist();
    return copyBinding(binding);
  }

  async removeBinding(accountId: string, userId: string | number): Promise<boolean> {
    const id = validAccountId(accountId);
    const state = this.account(id);
    const normalized = validUserId(userId);
    if (!state.bindings[normalized]) return false;
    delete state.bindings[normalized];
    await this.persist();
    return true;
  }

  getOffset(accountId: string): number {
    return this.account(validAccountId(accountId)).offset;
  }

  /** L'offset è monotono: un valore più vecchio non fa tornare indietro il poller. */
  async setOffset(accountId: string, offset: number): Promise<number> {
    const id = validAccountId(accountId);
    const state = this.account(id);
    const next = validOffset(offset);
    if (next <= state.offset) return state.offset;
    state.offset = next;
    await this.persist();
    return state.offset;
  }

  async removeAccount(accountId: string): Promise<boolean> {
    const id = validAccountId(accountId);
    if (!this.accounts.delete(id)) return false;
    await this.persist();
    return true;
  }

  private account(accountId: string): TelegramInboundAccountState {
    const id = validAccountId(accountId);
    let state = this.accounts.get(id);
    if (!state) {
      state = defaultState();
      this.accounts.set(id, state);
    }
    return state;
  }

  private pairingActive(pairing: StoredPairing | null): boolean {
    return Boolean(pairing && pairing.expiresAt > this.now());
  }

  private pairingKey(accountId: string, userId: string): string {
    return `${accountId}:${userId}`;
  }

  private pairingFailureCount(accountId: string, userId: string): number {
    const key = this.pairingKey(accountId, userId);
    const entry = this.pairingFailures.get(key);
    if (!entry) return 0;
    if (this.now() - entry.firstAt > this.pairingTtlMs) {
      this.pairingFailures.delete(key);
      return 0;
    }
    return entry.attempts;
  }

  private recordPairingFailure(accountId: string, userId: string): number {
    const key = this.pairingKey(accountId, userId);
    const entry = this.pairingFailures.get(key);
    if (!entry || this.now() - entry.firstAt > this.pairingTtlMs) {
      this.pairingFailures.set(key, { attempts: 1, firstAt: this.now() });
      return 1;
    }
    entry.attempts += 1;
    return entry.attempts;
  }

  private clearPairingFailures(accountId: string): void {
    const prefix = `${accountId}:`;
    for (const key of this.pairingFailures.keys()) {
      if (key.startsWith(prefix)) this.pairingFailures.delete(key);
    }
  }

  private pairingMatches(pairing: StoredPairing, code: string): boolean {
    const expected = Buffer.from(pairingHash(pairing.salt, code), 'hex');
    const actual = Buffer.from(pairing.codeHash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  private parseAccount(value: Record<string, unknown>): TelegramInboundAccountState {
    const state = defaultState();
    state.enabled = value.enabled === true;
    try { state.offset = validOffset(value.offset); } catch { state.offset = 0; }

    if (isRecord(value.settings)) {
      try {
        state.settings.defaultProjectId = value.settings.defaultProjectId === null
          ? null
          : validOptionalSlug(value.settings.defaultProjectId, 'invalid_telegram_project_id', 'Progetto Telegram non valido');
      } catch { state.settings.defaultProjectId = null; }
      try {
        state.settings.defaultAgentProfileId = value.settings.defaultAgentProfileId === null
          ? null
          : validOptionalSlug(value.settings.defaultAgentProfileId, 'invalid_telegram_agent_profile_id', 'Profilo agente Telegram non valido');
      } catch { state.settings.defaultAgentProfileId = null; }
      try { state.settings.replyMode = validReplyMode(value.settings.replyMode); } catch { state.settings.replyMode = DEFAULT_TELEGRAM_INBOUND_SETTINGS.replyMode; }
      try { state.settings.maxQueuedMessages = validQueueSize(value.settings.maxQueuedMessages); } catch { state.settings.maxQueuedMessages = DEFAULT_TELEGRAM_INBOUND_SETTINGS.maxQueuedMessages; }
    }

    if (Array.isArray(value.allowedUsers)) {
      for (const candidate of value.allowedUsers) {
        if (!isRecord(candidate)) continue;
        let id: string;
        try { id = validUserId(candidate.id); } catch { continue; }
        if (state.allowedUsers.some(user => user.id === id)) continue;
        if (state.allowedUsers.length >= this.maxAllowedUsers) break;
        let label: string;
        try { label = validLabel(candidate.label, `Telegram ${id}`); } catch { label = `Telegram ${id}`; }
        const pairedAt = typeof candidate.pairedAt === 'number' && Number.isFinite(candidate.pairedAt) ? candidate.pairedAt : this.now();
        const lastSeenAt = typeof candidate.lastSeenAt === 'number' && Number.isFinite(candidate.lastSeenAt) ? candidate.lastSeenAt : undefined;
        state.allowedUsers.push({ id, label, pairedAt, ...(lastSeenAt !== undefined ? { lastSeenAt } : {}) });
      }
    }

    if (isRecord(value.bindings)) {
      for (const [key, candidate] of Object.entries(value.bindings)) {
        if (!isRecord(candidate)) continue;
        let userId: string;
        let chatId: string;
        let sessionId: string;
        try {
          userId = validUserId(candidate.userId);
          chatId = validChatId(candidate.chatId);
          sessionId = validSessionId(candidate.sessionId);
        } catch { continue; }
        if (key !== userId || !state.allowedUsers.some(user => user.id === userId)) continue;
        let projectId: string | null;
        let agentProfileId: string | null;
        try { projectId = candidate.projectId === undefined ? null : validOptionalSlug(candidate.projectId, 'invalid_telegram_project_id', 'Progetto Telegram non valido'); } catch { projectId = null; }
        try { agentProfileId = candidate.agentProfileId === undefined ? null : validOptionalSlug(candidate.agentProfileId, 'invalid_telegram_agent_profile_id', 'Profilo agente Telegram non valido'); } catch { agentProfileId = null; }
        const createdAt = typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt) ? candidate.createdAt : this.now();
        const updatedAt = typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : createdAt;
        state.bindings[userId] = {
          chatId,
          userId,
          sessionId,
          ...(projectId ? { projectId } : {}),
          ...(agentProfileId ? { agentProfileId } : {}),
          createdAt,
          updatedAt,
          ...(typeof candidate.lastTurnId === 'string' && SESSION_ID_PATTERN.test(candidate.lastTurnId) ? { lastTurnId: candidate.lastTurnId } : {}),
          ...(typeof candidate.pendingTurnId === 'string' && SESSION_ID_PATTERN.test(candidate.pendingTurnId) ? { pendingTurnId: candidate.pendingTurnId } : {}),
        };
      }
    }

    if (isRecord(value.pairing)) {
      const codeHash = typeof value.pairing.codeHash === 'string' && PAIRING_HASH_PATTERN.test(value.pairing.codeHash) ? value.pairing.codeHash : null;
      const salt = typeof value.pairing.salt === 'string' && /^[a-f0-9]{32}$/.test(value.pairing.salt) ? value.pairing.salt : null;
      const createdAt = typeof value.pairing.createdAt === 'number' && Number.isFinite(value.pairing.createdAt) ? value.pairing.createdAt : null;
      const expiresAt = typeof value.pairing.expiresAt === 'number' && Number.isFinite(value.pairing.expiresAt) ? value.pairing.expiresAt : null;
      const scope: TelegramPairingScope = value.pairing.scope === 'group' ? 'group' : 'private';
      if (codeHash && salt && createdAt !== null && expiresAt !== null) {
        state.pairing = { codeHash, salt, createdAt, expiresAt, scope };
      }
    }

    return state;
  }

  private persist(): Promise<void> {
    const payload = JSON.stringify({
      version: 1,
      accounts: Object.fromEntries(this.accounts),
    } satisfies TelegramInboundFile, null, 2);
    const run = this.writeChain.catch(() => undefined).then(async () => {
      await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
      await fs.chmod(this.configDir, 0o700).catch(() => undefined);
      const temporary = path.join(this.configDir, `.telegram-inbound.${process.pid}.${crypto.randomUUID()}.tmp`);
      await fs.writeFile(temporary, `${payload}\n`, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    });
    this.writeChain = run;
    return run;
  }
}
