import type {
  ChatAttachment,
  ChatAttachmentContext,
  ChatProvider,
  ReasoningLevel,
  StreamEvent,
  TelegramBinding,
  TelegramChat,
  TelegramChatInfo,
  TelegramChatMemberInfo,
  TelegramForumTopic,
  TelegramGroup,
  TelegramInboundStatus,
  TelegramTopicBinding,
  TelegramPairingCodeView,
  TelegramPollerStatus,
} from '@memora/shared';
import { escapeTelegramHtml, prepareTelegramReply, splitTelegramHtml } from './telegram-format.js';
import type { TelegramBindingStore } from './telegram-bindings.js';
import type { TelegramGroupStore } from './telegram-groups.js';
import { TelegramInboundError } from './telegram-bindings.js';
import { TelegramError, type TelegramBotInfo, type TelegramDocument, type TelegramFile, type TelegramStore } from './telegram.js';

export interface TelegramInboundTransport {
  getUpdates(
    accountId: string | undefined,
    options: {
      offset?: number;
      timeoutSeconds?: number;
      limit?: number;
      allowedUpdates?: string[];
      signal?: AbortSignal;
    },
  ): Promise<Array<Record<string, unknown>>>;
  sendTo(
    chatId: string,
    text: string,
    accountId?: string,
    options?: { parseMode?: 'HTML'; messageThreadId?: number },
  ): Promise<void>;
  sendDocumentTo(chatId: string, document: TelegramDocument, accountId?: string, options?: { messageThreadId?: number }): Promise<void>;
  sendChatAction?(chatId: string, action: 'typing' | 'upload_document' | 'upload_photo', accountId?: string, options?: { messageThreadId?: number }): Promise<void>;
  getFile?(fileId: string, accountId?: string): Promise<TelegramFile>;
  downloadFile?(filePath: string, accountId?: string, maxBytes?: number): Promise<Buffer>;
  getMe(accountId?: string): Promise<TelegramBotInfo>;
  createForumTopic?(chatId: string, name: string, accountId?: string): Promise<TelegramForumTopic>;
  editForumTopic?(chatId: string, threadId: number, name: string, accountId?: string): Promise<void>;
  getChat?(chatId: string, accountId?: string): Promise<TelegramChatInfo>;
  getChatMember?(chatId: string, userId: string | number, accountId?: string): Promise<TelegramChatMemberInfo>;
}


export interface TelegramInboundSessionInfo {
  sessionId: string;
  name?: string;
  firstMessage: string;
  messageCount: number;
  modified: Date | number;
  archived?: boolean;
  projectId?: string;
}

export interface TelegramInboundArtifactInfo {
  id: string;
  name: string;
  kind: string;
  createdAt: number;
}

/** Superficie minima di AgentService usata dalla conversazione Telegram. */
export interface TelegramInboundSessionService {
  createSession(
    modelId?: string,
    provider?: ChatProvider,
    reasoningLevel?: ReasoningLevel,
    projectId?: string,
    agentProfileId?: string,
    options?: { autoTitle?: boolean },
  ): Promise<{ sessionId: string }>;
  hasSession(sessionId: string): Promise<boolean>;
  resumeSession(sessionId: string): Promise<unknown>;
  getSessionArchived?(sessionId: string): Promise<boolean>;
  listSessions(onlyArchived?: boolean, includeArchived?: boolean): Promise<TelegramInboundSessionInfo[]>;
  getSessionMessages(sessionId: string): Promise<Array<{ role: string; content: string }>>;
  renameSession(sessionId: string, name: string): Promise<unknown>;
  listArtifacts(sessionId: string): Promise<TelegramInboundArtifactInfo[]>;
  getArtifact(sessionId: string, artifactId: string): Promise<{ name: string; mimeType: string; buffer: Buffer }>;
}

export interface TelegramInboundTurnInfo {
  turnId: string;
  sessionId: string;
  status: string;
  createdAt: number;
  error?: string;
}

/** Superficie minima di TurnManager usata dal bridge Telegram. */
export interface TelegramInboundTurns {
  start(sessionId: string, text: string, attachments?: ChatAttachmentContext[]): TelegramInboundTurnInfo;
  startTelegram(sessionId: string, text: string, attachments?: ChatAttachmentContext[]): TelegramInboundTurnInfo;
  subscribe(
    turnId: string,
    after: number,
    listener: (entry: { seq: number; event: StreamEvent }) => void,
  ): (() => void) | null;
  getTurn(turnId: string): TelegramInboundTurnInfo | null;
  getCurrent(sessionId: string): TelegramInboundTurnInfo | null;
  abortSession(sessionId: string): Promise<TelegramInboundTurnInfo | null>;
  abort(turnId: string): Promise<TelegramInboundTurnInfo | null>;
}

export interface TelegramInboundReads {
  mark(sessionId: string, turnId: string): Promise<void>;
}

export interface TelegramInboundAttachments {
  save(sessionId: string, input: { filename: string; data: Buffer }): Promise<ChatAttachment>;
  toModelContext(attachment: ChatAttachment & { buffer: Buffer }): Promise<ChatAttachmentContext>;
}

export interface TelegramInboundDeps {
  telegram: TelegramInboundTransport;
  accounts: TelegramStore;
  bindings: TelegramBindingStore;
  log?: (event: string, details?: Record<string, unknown>) => void;
  /** Durante il maintenance dei backup il polling viene sospeso. */
  canProcess?: () => boolean;
  now?: () => number;
  pollTimeoutSeconds?: number;
  maxBackoffMs?: number;
  incomingLimit?: number;
  incomingWindowMs?: number;
  /** TurnManager condiviso con la web UI. */
  turns?: TelegramInboundTurns;
  /** AgentService per sessioni, messaggi e artefatti. */
  sessions?: TelegramInboundSessionService;
  /** Stato letto condiviso con la web UI. */
  reads?: TelegramInboundReads;
  /** Store degli allegati delle chat, riusato dalla web UI. */
  attachments?: TelegramInboundAttachments;
  /** Registry dei gruppi forum e dei topic collegati alle sessioni. */
  groups?: TelegramGroupStore;
}

interface PollerState {
  controller: AbortController;
  task: Promise<void>;
  status: TelegramPollerStatus;
  lastUpdateAt?: number;
  lastError?: string;
}

interface IncomingCounter {
  windowStart: number;
  count: number;
}

interface TurnBridge {
  accountId: string;
  chatId: string;
  userId: string;
  /** Presente per i messaggi nei topic; assente per General e per le DM. */
  threadId?: string;
  group: boolean;
  sessionId: string;
  turnId: string;
  startedAt: number;
  queuedNotified: boolean;
  queuedTimer: NodeJS.Timeout | null;
  running: boolean;
  finished: boolean;
  text: string;
  typingTimer: NodeJS.Timeout | null;
  unsubscribe?: () => void;
}

interface SessionChoice {
  at: number;
  entries: Array<{ sessionId: string; title: string; projectId?: string }>;
}

interface GroupContext {
  accountId: string;
  chatId: string;
  userId: string;
  userLabel: string;
  group: TelegramGroup;
  threadId?: string;
}

interface GroupSessionChoice {
  at: number;
  entries: Array<{ sessionId: string; title: string; threadId?: string; general: boolean }>;
}

const MAX_OBSERVED_CHATS = 50;
const MAX_SESSION_CHOICES = 8;
const SESSION_CHOICE_TTL_MS = 10 * 60_000;
const TYPING_INTERVAL_MS = 4_000;
const DOCUMENT_ARTIFACT_KINDS = new Set(['pdf', 'docx', 'xlsx', 'pptx']);
const MAX_INBOUND_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const SUPPORTED_ATTACHMENT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'csv', 'json', 'log', 'html', 'htm', 'pdf', 'docx', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numericId(value: unknown, pattern: RegExp): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  return pattern.test(text) ? text : null;
}

function cleanName(value: string): string {
  const clean = [...value]
    .filter(char => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim();
  return clean.slice(0, 80);
}

function displayName(from: Record<string, unknown>, userId: string): string {
  const first = typeof from.first_name === 'string' ? cleanName(from.first_name) : '';
  const last = typeof from.last_name === 'string' ? cleanName(from.last_name) : '';
  const name = [first, last].filter(Boolean).join(' ').slice(0, 80);
  if (name) return name;
  if (typeof from.username === 'string' && cleanName(from.username)) return `@${cleanName(from.username)}`.slice(0, 80);
  return `Telegram ${userId}`;
}

function parseCommand(text: string): { name: string; args: string } | null {
  const match = /^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  return { name: (match[1] ?? '').toLowerCase(), args: (match[2] ?? '').trim() };
}

function sessionTitle(session: TelegramInboundSessionInfo): string {
  const title = session.name?.trim() || session.firstMessage.trim() || 'Sessione senza titolo';
  return title.replace(/\s+/g, ' ').slice(0, 80);
}

function timeOf(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined;
}

function messageThreadId(message: Record<string, unknown>): string | undefined {
  const threadId = numericId(message.message_thread_id, /^\d{1,20}$/);
  if (!threadId || threadId === '0' || threadId === '1') return undefined;
  // General può arrivare con thread_id 1: non è un topic secondario.
  if (message.is_topic_message === false) return undefined;
  return threadId;
}

function threadNumber(threadId?: string): number | undefined {
  if (!threadId) return undefined;
  const value = Number(threadId);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function groupLink(chatId: string, threadId?: string): string {
  const bare = chatId.startsWith('-100') ? chatId.slice(4) : chatId.replace(/^-/, '');
  return `https://t.me/c/${bare}${threadId ? `/${threadId}` : ''}`;
}


type IncomingAttachment =
  | { kind: 'none' }
  | { kind: 'unsupported'; reason: 'media' | 'document' }
  | { kind: 'ok'; fileId: string; filename: string; size?: number; isImage: boolean };

const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
  'text/html': 'html',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

function documentFilename(document: Record<string, unknown>, messageId: unknown): string {
  const given = typeof document.file_name === 'string' ? document.file_name.trim() : '';
  const extension = given.toLowerCase().split('.').pop() ?? '';
  if (given && SUPPORTED_ATTACHMENT_EXTENSIONS.has(extension)) return given;
  const mime = typeof document.mime_type === 'string' ? document.mime_type.toLowerCase() : '';
  const inferred = MIME_EXTENSIONS[mime];
  if (!inferred) return '';
  const base = typeof messageId === 'number' || typeof messageId === 'string' ? String(messageId) : 'telegram';
  return `documento-${base.replace(/[^0-9A-Za-z_-]/g, '')}.${inferred}`;
}

function attachmentFromMessage(message: Record<string, unknown>): IncomingAttachment {
  const photos = Array.isArray(message.photo) ? message.photo : [];
  if (photos.length > 0) {
    const photo = [...photos].reverse().find(item => isRecord(item) && typeof item.file_id === 'string');
    if (!photo) return { kind: 'unsupported', reason: 'media' };
    const size = typeof photo.file_size === 'number' && Number.isFinite(photo.file_size) ? photo.file_size : undefined;
    return {
      kind: 'ok',
      fileId: String(photo.file_id),
      filename: `foto-${String(message.message_id ?? 'telegram').replace(/[^0-9A-Za-z_-]/g, '')}.jpg`,
      ...(size !== undefined ? { size } : {}),
      isImage: true,
    };
  }

  if (isRecord(message.document)) {
    const fileId = typeof message.document.file_id === 'string' ? message.document.file_id : '';
    if (!fileId) return { kind: 'unsupported', reason: 'document' };
    const filename = documentFilename(message.document, message.message_id);
    if (!filename) return { kind: 'unsupported', reason: 'document' };
    const size = typeof message.document.file_size === 'number' && Number.isFinite(message.document.file_size)
      ? message.document.file_size
      : undefined;
    return {
      kind: 'ok',
      fileId,
      filename,
      ...(size !== undefined ? { size } : {}),
      isImage: /^(png|jpe?g|webp|gif|svg)$/i.test(filename.split('.').pop() ?? ''),
    };
  }

  if (message.voice || message.audio || message.video || message.video_note || message.sticker || message.animation) {
    return { kind: 'unsupported', reason: 'media' };
  }
  return { kind: 'none' };
}

function attachmentErrorMessage(error: unknown): string {
  const code = errorCode(error);
  if (code === 'attachment_too_large' || code === 'telegram_file_too_large') {
    return 'L’allegato supera il limite di 15 MB.';
  }
  if (code === 'unsupported_attachment_type' || code === 'invalid_attachment_name' || code === 'invalid_telegram_file_path') {
    return 'Formato non supportato. Sono supportati PDF, DOCX, testo e immagini.';
  }
  if (code === 'telegram_file_unavailable' || code === 'telegram_file_download_failed' || code === 'telegram_unreachable') {
    return 'Non sono riuscito a scaricare l’allegato. Riprova tra poco.';
  }
  return 'Non è stato possibile elaborare l’allegato.';
}

function normalizeTitle(value: string): string {
  const clean = [...value]
    .filter(char => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
  return clean.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function pairingErrorMessage(code: string): string {
  switch (code) {
    case 'telegram_pairing_expired':
      return 'Il codice di associazione è scaduto. Generane uno nuovo da Amministrazione → Telegram.';
    case 'telegram_pairing_attempts':
      return 'Troppi tentativi di associazione. Attendi qualche minuto e riprova con un nuovo codice.';
    case 'telegram_too_many_users':
      return 'Il limite di utenti Telegram autorizzati è stato raggiunto.';
    case 'telegram_inbound_disabled':
      return 'Il canale Telegram in ingresso non è abilitato.';
    default:
      return 'Codice di associazione non valido. Controlla il codice e riprova.';
  }
}

/**
 * Supervisore del canale Telegram in ingresso.
 *
 * Un poller per account abilitato possiede `getUpdates`; gli update vengono
 * autorizzati, trasformati in comandi locali o in turni della stessa sessione
 * Memora usata dalla web UI.
 */
export class TelegramInboundService {
  private readonly telegram: TelegramInboundTransport;
  private readonly accounts: TelegramStore;
  private readonly bindings: TelegramBindingStore;
  private readonly log: (event: string, details?: Record<string, unknown>) => void;
  private readonly canProcess: () => boolean;
  private readonly now: () => number;
  private readonly pollTimeoutSeconds: number;
  private readonly maxBackoffMs: number;
  private readonly incomingLimit: number;
  private readonly incomingWindowMs: number;
  private readonly turns?: TelegramInboundTurns;
  private readonly sessions?: TelegramInboundSessionService;
  private readonly reads?: TelegramInboundReads;
  private readonly attachments?: TelegramInboundAttachments;
  private readonly groups?: TelegramGroupStore;
  private readonly bridges = new Map<string, TurnBridge>();
  private readonly groupChoices = new Map<string, GroupSessionChoice>();
  /** Topic creati via API: evita che il service message crei una seconda sessione. */
  private readonly pendingTopicCreations = new Set<string>();
  private readonly typingTimers = new Set<NodeJS.Timeout>();
  private readonly sessionChoices = new Map<string, SessionChoice>();
  private readonly pendingTitles = new Map<string, string>();
  private readonly pollers = new Map<string, PollerState>();
  private readonly botInfo = new Map<string, TelegramBotInfo>();
  private readonly observedChats = new Map<string, Map<string, TelegramChat>>();
  private readonly incomingCounters = new Map<string, IncomingCounter>();
  private handling = 0;
  private stopping = false;

  constructor(deps: TelegramInboundDeps) {
    this.telegram = deps.telegram;
    this.accounts = deps.accounts;
    this.bindings = deps.bindings;
    this.log = deps.log ?? (() => undefined);
    this.canProcess = deps.canProcess ?? (() => true);
    this.now = deps.now ?? Date.now;
    this.pollTimeoutSeconds = deps.pollTimeoutSeconds ?? 25;
    this.maxBackoffMs = deps.maxBackoffMs ?? 30_000;
    this.incomingLimit = Math.max(1, deps.incomingLimit ?? 30);
    this.incomingWindowMs = Math.max(1_000, deps.incomingWindowMs ?? 60_000);
    this.turns = deps.turns;
    this.sessions = deps.sessions;
    this.reads = deps.reads;
    this.attachments = deps.attachments;
    this.groups = deps.groups;
  }

  /** Avvia i poller degli account con ingresso e account abilitati. */
  async start(): Promise<void> {
    this.stopping = false;
    const accountIds = this.accounts.listAccounts().map(account => account.id);
    await Promise.all(accountIds.map(accountId => this.startAccount(accountId)));
  }

  /** Ferma tutti i poller; le richieste long-poll vengono annullate. */
  async stop(): Promise<void> {
    this.stopping = true;
    for (const bridge of this.bridges.values()) {
      bridge.finished = true;
      this.stopTyping(bridge);
      if (bridge.queuedTimer) clearTimeout(bridge.queuedTimer);
      bridge.unsubscribe?.();
    }
    this.bridges.clear();
    for (const timer of this.typingTimers) clearInterval(timer);
    this.typingTimers.clear();
    const states = [...this.pollers.values()];
    this.pollers.clear();
    for (const state of states) state.controller.abort();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled(states.map(state => state.task)),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 5_000); }),
    ]);
    if (timer) clearTimeout(timer);
  }

  /** Riavvia un account dopo una modifica di token, stato o configurazione. */
  async refreshAccount(accountId: string): Promise<void> {
    await this.stopAccount(accountId);
    this.botInfo.delete(accountId);
    if (!this.stopping) await this.startAccount(accountId);
  }

  /** Rimuove lo stato del bridge quando l'account Telegram viene eliminato. */
  async removeAccount(accountId: string): Promise<void> {
    await this.stopAccount(accountId);
    await this.bindings.removeAccount(accountId);
    this.botInfo.delete(accountId);
    this.observedChats.delete(accountId);
    const counterPrefix = `${accountId}:`;
    for (const key of this.incomingCounters.keys()) {
      if (key.startsWith(counterPrefix)) this.incomingCounters.delete(key);
    }
  }

  isInboundEnabled(accountId: string): boolean {
    return this.bindings.get(accountId).enabled;
  }

  isIdle(): boolean {
    return this.handling === 0 && this.bridges.size === 0;
  }

  getStatus(accountId: string): TelegramInboundStatus {
    const inbound = this.bindings.get(accountId);
    const account = this.accounts.getAccount(accountId);
    const state = this.pollers.get(accountId);
    const info = this.botInfo.get(accountId);
    let status: TelegramPollerStatus = state?.status ?? (inbound.enabled ? 'starting' : 'disabled');
    let lastError = state?.lastError;

    if (inbound.enabled) {
      if (!account) {
        status = 'error';
        lastError = 'Account Telegram non trovato';
      } else if (!account.enabled) {
        status = 'disabled';
        lastError = undefined;
      } else if (!account.tokenConfigured) {
        status = 'error';
        lastError = 'Token Telegram non configurato';
      }
    }

    return {
      accountId,
      enabled: inbound.enabled,
      status,
      ...(info?.username ? { botUsername: info.username } : {}),
      ...(state?.lastUpdateAt !== undefined ? { lastUpdateAt: state.lastUpdateAt } : {}),
      ...(lastError ? { lastError } : {}),
    };
  }

  listObservedChats(accountId: string): TelegramChat[] {
    return [...(this.observedChats.get(accountId)?.values() ?? [])].sort((a, b) => a.label.localeCompare(b.label, 'it'));
  }

  async createPairingCode(accountId: string): Promise<TelegramPairingCodeView> {
    const account = this.accounts.getAccount(accountId);
    if (!account) throw new TelegramInboundError('telegram_account_not_found', 'Account Telegram non trovato', 404);
    if (!account.tokenConfigured) {
      throw new TelegramError('telegram_not_configured', 'Token Telegram non configurato', 409);
    }
    const pairing = await this.bindings.createPairingCode(accountId);
    const info = await this.ensureBotInfo(accountId);
    return {
      ...pairing,
      ...(info?.username ? { deepLink: `https://t.me/${info.username}?start=${encodeURIComponent(pairing.code)}` } : {}),
    };
  }

  async clearPairingCode(accountId: string): Promise<void> {
    await this.bindings.clearPairing(accountId);
  }

  private async startAccount(accountId: string): Promise<void> {
    if (this.stopping) return;
    await this.stopAccount(accountId);
    if (!this.shouldRun(accountId)) return;
    await this.notifyInterrupted(accountId);

    const controller = new AbortController();
    const state: PollerState = {
      controller,
      task: Promise.resolve(),
      status: 'starting',
    };
    this.pollers.set(accountId, state);
    state.task = this.run(accountId, state);
  }

  private async stopAccount(accountId: string): Promise<void> {
    const state = this.pollers.get(accountId);
    if (!state) return;
    this.pollers.delete(accountId);
    state.controller.abort();
    await state.task.catch(() => undefined);
  }

  private shouldRun(accountId: string): boolean {
    const account = this.accounts.getAccount(accountId);
    if (!account || !account.enabled || !account.tokenConfigured) return false;
    return this.bindings.get(accountId).enabled;
  }

  private async run(accountId: string, state: PollerState): Promise<void> {
    const signal = state.controller.signal;
    void this.ensureBotInfo(accountId);
    let backoffMs = 1_000;

    while (!signal.aborted && !this.stopping) {
      if (!this.canProcess()) {
        state.status = 'paused';
        await this.sleep(5_000, signal);
        continue;
      }

      state.status = 'running';
      try {
        const updates = await this.telegram.getUpdates(accountId, {
          offset: this.bindings.getOffset(accountId),
          timeoutSeconds: this.pollTimeoutSeconds,
          allowedUpdates: ['message'],
          signal,
        });
        backoffMs = 1_000;
        state.lastError = undefined;

        // Il maintenance può iniziare mentre il long poll è in corso: in quel
        // caso gli update restano non confermati e Telegram li rimanda.
        if (!this.canProcess()) {
          state.status = 'paused';
          await this.sleep(1_000, signal);
          continue;
        }

        if (updates.length > 0) state.lastUpdateAt = this.now();

        for (const update of updates) {
          if (signal.aborted) break;
          const updateId = typeof update.update_id === 'number' && Number.isSafeInteger(update.update_id) && update.update_id >= 0
            ? update.update_id
            : null;
          // Difesa esplicita contro un update già confermato (offset = id + 1).
          if (updateId !== null && updateId < this.bindings.getOffset(accountId)) continue;
          this.handling += 1;
          try {
            await this.handleUpdate(accountId, update);
          } catch (error) {
            this.log('telegram_update_failed', {
              accountId,
              updateId: typeof update.update_id === 'number' ? update.update_id : undefined,
              code: error instanceof TelegramError ? error.code : 'internal',
            });
          } finally {
            this.handling = Math.max(0, this.handling - 1);
          }
          if (updateId !== null) await this.bindings.setOffset(accountId, updateId + 1);
        }
      } catch (error) {
        if (signal.aborted || this.stopping) break;
        const code = error instanceof TelegramError ? error.code : '';
        state.lastError = error instanceof Error ? error.message : String(error);
        if (code === 'telegram_aborted') break;
        if (code === 'telegram_conflict') {
          state.status = 'conflict';
          this.log('telegram_poll_conflict', { accountId });
          break;
        }
        if (code === 'telegram_unauthorized') {
          state.status = 'error';
          this.log('telegram_poll_unauthorized', { accountId });
          break;
        }
        state.status = 'error';
        const wait = error instanceof TelegramError && error.statusCode === 429
          ? error.retryAfterMs ?? Math.min(backoffMs, this.maxBackoffMs)
          : Math.min(backoffMs, this.maxBackoffMs);
        backoffMs = Math.min(backoffMs * 2, this.maxBackoffMs);
        await this.sleep(wait, signal);
      }
    }
  }

  private async notifyInterrupted(accountId: string): Promise<void> {
    if (!this.turns) return;
    let bindings: TelegramBinding[];
    try {
      bindings = this.bindings.get(accountId).bindings;
    } catch {
      this.log('telegram_pending_read_failed', { accountId });
      bindings = [];
    }
    for (const binding of bindings) {
      if (!binding.pendingTurnId) continue;
      const turn = this.turns.getTurn(binding.pendingTurnId);
      if (turn?.status === 'interrupted') {
        await this.safeReply(
          accountId,
          binding.chatId,
          '⚠️ La risposta precedente è stata interrotta da un riavvio di Memora. Puoi riprovare.',
        );
      }
      try {
        await this.bindings.updateBinding(accountId, binding.userId, { pendingTurnId: null });
      } catch (error) {
        this.log('telegram_pending_clear_failed', { accountId, code: errorCode(error) ?? 'internal' });
      }
    }

    if (!this.groups) return;
    let groups;
    try {
      groups = this.groups.list(accountId);
    } catch {
      this.log('telegram_group_pending_read_failed', { accountId });
      return;
    }
    for (const group of groups) {
      if (group.generalPendingTurnId) {
        const turn = this.turns.getTurn(group.generalPendingTurnId);
        if (turn?.status === 'interrupted') {
          await this.safeReply(
            accountId,
            group.chatId,
            '⚠️ La risposta precedente è stata interrotta da un riavvio di Memora. Puoi riprovare.',
          );
        }
        await this.groups.updateGeneralTurn(accountId, group.chatId, { pendingTurnId: null }).catch(error => {
          this.log('telegram_pending_clear_failed', { accountId, code: errorCode(error) ?? 'internal' });
        });
      }
      for (const topic of Object.values(group.topics)) {
        if (!topic.pendingTurnId) continue;
        const turn = this.turns.getTurn(topic.pendingTurnId);
        if (turn?.status === 'interrupted') {
          await this.safeReply(
            accountId,
            group.chatId,
            '⚠️ La risposta precedente è stata interrotta da un riavvio di Memora. Puoi riprovare.',
            topic.threadId,
          );
        }
        await this.groups.updateTopicTurn(accountId, group.chatId, topic.threadId, { pendingTurnId: null }).catch(error => {
          this.log('telegram_pending_clear_failed', { accountId, code: errorCode(error) ?? 'internal' });
        });
      }
    }
  }

  private async ensureBotInfo(accountId: string): Promise<TelegramBotInfo | undefined> {
    const cached = this.botInfo.get(accountId);
    if (cached) return cached;
    try {
      const info = await this.telegram.getMe(accountId);
      this.botInfo.set(accountId, info);
      return info;
    } catch {
      return undefined;
    }
  }

  private async handleUpdate(accountId: string, update: Record<string, unknown>): Promise<void> {
    const message = isRecord(update.message) ? update.message : undefined;
    if (!message) return;
    const from = isRecord(message.from) ? message.from : undefined;
    const chat = isRecord(message.chat) ? message.chat : undefined;
    if (!from || !chat || from.is_bot === true) return;
    if (chat.type !== 'private' && chat.type !== 'supergroup') return;

    const userId = numericId(from.id, /^\d{1,20}$/);
    const chatId = numericId(chat.id, /^-?\d{1,20}$/);
    if (!userId || !chatId) return;

    const text = typeof message.text === 'string' ? message.text : typeof message.caption === 'string' ? message.caption : '';
    const name = displayName(from, userId);
    this.trackObservedChat(accountId, chatId, chat);
    if (!this.allowIncoming(accountId, userId)) return;

    if (chat.type === 'supergroup') {
      await this.handleGroupUpdate(accountId, chatId, userId, name, message, text, chat);
      return;
    }

    if (!this.bindings.isAllowed(accountId, userId)) {
      await this.handleUnauthorized(accountId, chatId, userId, name, text);
      return;
    }

    try {
      await this.bindings.touchAllowedUser(accountId, userId);
    } catch {
      // Un errore di metadata non deve bloccare la risposta.
    }

    const command = parseCommand(text);
    if (!command) {
      await this.handleChat(accountId, chatId, userId, message, text);
      return;
    }

    switch (command.name) {
      case 'start':
        await this.safeReply(accountId, chatId, '**Memora**\n\nQuesto account è già associato. Usa /help per i comandi disponibili.');
        return;
      case 'ping':
        await this.safeReply(accountId, chatId, '🏓 pong');
        return;
      case 'help':
        await this.showHelp(accountId, chatId);
        return;
      case 'status':
        await this.showStatus(accountId, chatId, userId);
        return;
      case 'new':
        await this.newSession(accountId, chatId, userId, command.args);
        return;
      case 'sessions':
        await this.showSessions(accountId, chatId, userId);
        return;
      case 'switch':
        await this.switchSession(accountId, chatId, userId, command.args);
        return;
      case 'current':
        await this.showCurrent(accountId, chatId, userId);
        return;
      case 'rename':
        await this.renameActive(accountId, chatId, userId, command.args);
        return;
      case 'stop':
        await this.stopActive(accountId, chatId, userId);
        return;
      default:
        await this.safeReply(accountId, chatId, 'Comando non riconosciuto. Usa /help per i comandi disponibili.');
    }
  }

  private async handleGroupUpdate(
    accountId: string,
    chatId: string,
    userId: string,
    userLabel: string,
    message: Record<string, unknown>,
    text: string,
    chat: Record<string, unknown>,
  ): Promise<void> {
    if (!this.groups) return;
    const threadId = messageThreadId(message);
    const group = this.groups.get(accountId, chatId);
    const command = parseCommand(text);

    if (isRecord(message.forum_topic_created)) {
      await this.handleGroupTopicCreated(accountId, chatId, userId, message);
      return;
    }
    if (isRecord(message.forum_topic_edited)) {
      if (group && threadId && group.allowedUsers.includes(userId)) {
        const name = typeof message.forum_topic_edited.name === 'string' ? message.forum_topic_edited.name : '';
        if (name) await this.groups.updateTopicTitle(accountId, chatId, threadId, name).catch(() => undefined);
      }
      return;
    }

    if (!group) {
      if (command?.name === 'start') {
        await this.pairGroup(accountId, chatId, userId, userLabel, text, threadId, chat);
      }
      return;
    }

    if (!group.isForum) {
      if (command?.name === 'start') {
        await this.safeReply(
          accountId,
          chatId,
          'Questo gruppo non è un forum. Attiva i **Topics** nelle impostazioni del gruppo e riprova.',
          threadId,
        );
      }
      return;
    }

    if (!group.allowedUsers.includes(userId)) {
      if (command?.name === 'start') {
        await this.safeReply(
          accountId,
          chatId,
          'Questo gruppo è già associato a Memora, ma il tuo account non è autorizzato. Chiedi all’amministratore di generare un nuovo codice per il gruppo.',
          threadId,
        );
      }
      return;
    }

    const context: GroupContext = { accountId, chatId, userId, userLabel, group, ...(threadId ? { threadId } : {}) };
    if (command) {
      await this.handleGroupCommand(context, command.name, command.args);
      return;
    }
    await this.handleGroupMessage(context, message, text);
  }

  private async pairGroup(
    accountId: string,
    chatId: string,
    userId: string,
    userLabel: string,
    text: string,
    threadId: string | undefined,
    chat: Record<string, unknown>,
  ): Promise<void> {
    const command = parseCommand(text);
    if (!command || command.name !== 'start' || !command.args) {
      await this.safeReply(
        accountId,
        chatId,
        'Per associare il gruppo a Memora, genera un codice in **Amministrazione → Telegram → Gruppi** e invia `/start <codice>` nel topic **General**.',
        threadId,
      );
      return;
    }
    if (threadId) {
      await this.safeReply(
        accountId,
        chatId,
        'Invia il codice di associazione nel topic **General**, non in un topic secondario.',
        threadId,
      );
      return;
    }
    if (!this.groups) return;
    const getChat = this.telegram.getChat?.bind(this.telegram);
    const getChatMember = this.telegram.getChatMember?.bind(this.telegram);
    if (!getChat || !getChatMember) {
      await this.safeReply(accountId, chatId, 'La configurazione dei gruppi non è disponibile in questo momento.', threadId);
      return;
    }

    let info: TelegramChatInfo;
    try {
      info = await getChat(chatId, accountId);
    } catch (error) {
      this.log('telegram_group_chat_failed', { accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(accountId, chatId, '⚠️ Non è stato possibile verificare il gruppo. Riprova tra poco.', threadId);
      return;
    }
    if (info.type !== 'supergroup' || info.isForum !== true) {
      await this.safeReply(
        accountId,
        chatId,
        'Questo gruppo non è un forum. Attiva i **Topics** nelle impostazioni del gruppo e riprova.',
        threadId,
      );
      return;
    }
    if (info.username) {
      await this.safeReply(accountId, chatId, 'Per la prima versione usa un gruppo **privato**, senza username pubblico.', threadId);
      return;
    }

    // Forza una nuova lettura: la privacy mode può essere stata modificata
    // dopo l'ultimo avvio del poller.
    this.botInfo.delete(accountId);
    const bot = await this.ensureBotInfo(accountId);
    if (!bot) {
      await this.safeReply(accountId, chatId, '⚠️ Non è stato possibile leggere l’identità del bot. Riprova tra poco.', threadId);
      return;
    }
    if (bot.canReadAllGroupMessages === false) {
      await this.safeReply(
        accountId,
        chatId,
        'La privacy mode del bot è attiva. In BotFather usa `/setprivacy` → **Disable**, poi rimuovi e riaggiungi il bot al gruppo.',
        threadId,
      );
      return;
    }

    let member: TelegramChatMemberInfo;
    try {
      member = await getChatMember(chatId, bot.id, accountId);
    } catch (error) {
      this.log('telegram_group_member_failed', { accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(accountId, chatId, '⚠️ Non è stato possibile verificare i permessi del bot nel gruppo.', threadId);
      return;
    }
    if ((member.status !== 'administrator' && member.status !== 'creator') || member.canManageTopics !== true) {
      await this.safeReply(
        accountId,
        chatId,
        'Rendi il bot **amministratore** del gruppo con il permesso **Manage Topics** e riprova.',
        threadId,
      );
      return;
    }

    const code = command.args.split(/\s+/)[0] ?? '';
    let consumed: { userId: string; label?: string };
    try {
      consumed = await this.bindings.consumePairingCode(accountId, {
        code,
        userId,
        label: userLabel,
        scope: 'group',
      });
    } catch (error) {
      if (error instanceof TelegramInboundError) {
        await this.safeReply(accountId, chatId, pairingErrorMessage(error.code), threadId);
        return;
      }
      throw error;
    }

    const title = info.title?.trim() || (typeof chat.title === 'string' ? chat.title.trim() : '') || 'Memora';
    try {
      await this.groups.upsert(accountId, {
        chatId,
        title,
        isForum: true,
        allowedUsers: [consumed.userId],
      });
    } catch (error) {
      this.log('telegram_group_pair_failed', { accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(accountId, chatId, '⚠️ Il gruppo è valido, ma non è stato possibile salvarlo. Riprova.', threadId);
      return;
    }

    this.log('telegram_group_paired', { accountId });
    await this.safeReply(
      accountId,
      chatId,
      '**Gruppo associato a Memora.**\n\nIl topic General è la sessione predefinita. Usa `/new [titolo]` da General per creare un topic-sessione, `/help` per i comandi.',
      threadId,
    );
  }

  private async handleGroupTopicCreated(
    accountId: string,
    chatId: string,
    userId: string,
    message: Record<string, unknown>,
  ): Promise<void> {
    if (!this.groups || !this.sessions) return;
    const group = this.groups.get(accountId, chatId);
    if (!group || !group.allowedUsers.includes(userId)) return;
    const threadId = messageThreadId(message);
    if (!threadId) return;
    const creationKey = `${chatId}:${threadId}`;
    if (this.pendingTopicCreations.delete(creationKey)) return;
    if (this.groups.getTopic(accountId, chatId, threadId)) return;
    const created = isRecord(message.forum_topic_created) ? message.forum_topic_created : {};
    const name = typeof created.name === 'string' ? normalizeTitle(created.name) : '';
    const title = name || `Topic ${threadId}`;
    let sessionId: string;
    try {
      sessionId = await this.createGroupSession(group, accountId);
    } catch (error) {
      this.log('telegram_group_topic_session_failed', { accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(accountId, chatId, '⚠️ Topic creato, ma non è stato possibile creare la sessione. Riprova a scrivere qui.', threadId);
      return;
    }
    try {
      await this.groups.putTopic(accountId, chatId, { threadId, sessionId, title, titleSource: 'manual' });
    } catch (error) {
      this.log('telegram_group_topic_bind_failed', { accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(accountId, chatId, '⚠️ Non è stato possibile collegare il topic alla sessione.', threadId);
      return;
    }
    if (name) this.pendingTitles.set(sessionId, name);
    await this.safeReply(accountId, chatId, '✅ **Topic collegato a Memora.**\nScrivi qui per continuare la sessione.', threadId);
  }

  private async handleGroupCommand(context: GroupContext, name: string, args: string): Promise<void> {
    switch (name) {
      case 'start':
        await this.safeReply(
          context.accountId,
          context.chatId,
          'Questo gruppo è già associato a Memora. Usa `/help` per i comandi disponibili.',
          context.threadId,
        );
        return;
      case 'ping':
        await this.safeReply(context.accountId, context.chatId, '🏓 pong', context.threadId);
        return;
      case 'help':
        await this.groupShowHelp(context);
        return;
      case 'status':
        await this.groupShowStatus(context);
        return;
      case 'new':
        await this.groupNewTopic(context, args);
        return;
      case 'sessions':
        await this.groupShowSessions(context);
        return;
      case 'switch':
        await this.groupSwitch(context, args);
        return;
      case 'current':
        await this.groupShowCurrent(context);
        return;
      case 'rename':
        await this.groupRename(context, args);
        return;
      case 'stop':
        await this.groupStop(context);
        return;
      default:
        await this.safeReply(
          context.accountId,
          context.chatId,
          'Comando non riconosciuto. Usa `/help` per i comandi disponibili.',
          context.threadId,
        );
    }
  }

  private async handleGroupMessage(
    context: GroupContext,
    message: Record<string, unknown>,
    text: string,
  ): Promise<void> {
    if (!this.turns || !this.sessions) {
      await this.safeReply(context.accountId, context.chatId, 'La conversazione Telegram non è ancora disponibile.', context.threadId);
      return;
    }

    const incoming = attachmentFromMessage(message);
    if (incoming.kind === 'unsupported') {
      await this.safeReply(
        context.accountId,
        context.chatId,
        incoming.reason === 'media'
          ? 'Per ora supporto foto, PDF, DOCX e file di testo. Vocali, video e sticker non sono ancora supportati.'
          : 'Formato non supportato. Sono supportati PDF, DOCX, testo e immagini.',
        context.threadId,
      );
      return;
    }
    if (incoming.kind === 'ok' && incoming.size !== undefined && incoming.size > MAX_INBOUND_ATTACHMENT_BYTES) {
      await this.safeReply(context.accountId, context.chatId, 'L’allegato supera il limite di 15 MB.', context.threadId);
      return;
    }
    if (incoming.kind === 'none' && !text.trim()) {
      // Messaggi di servizio del forum (topic chiuso, messaggio fissato, ecc.).
      return;
    }

    let downloaded: Buffer | undefined;
    if (incoming.kind === 'ok') {
      if (!this.attachments || !this.telegram.getFile || !this.telegram.downloadFile) {
        await this.safeReply(context.accountId, context.chatId, 'Gli allegati da Telegram non sono disponibili in questo momento.', context.threadId);
        return;
      }
      try {
        const file = await this.telegram.getFile(incoming.fileId, context.accountId);
        if (file.size !== undefined && file.size > MAX_INBOUND_ATTACHMENT_BYTES) {
          await this.safeReply(context.accountId, context.chatId, 'L’allegato supera il limite di 15 MB.', context.threadId);
          return;
        }
        downloaded = await this.telegram.downloadFile(file.filePath, context.accountId, MAX_INBOUND_ATTACHMENT_BYTES);
      } catch (error) {
        this.log('telegram_attachment_failed', { accountId: context.accountId, code: errorCode(error) ?? 'internal' });
        await this.safeReply(context.accountId, context.chatId, attachmentErrorMessage(error), context.threadId);
        return;
      }
    }

    let active: { sessionId: string; notice?: string };
    try {
      active = await this.ensureGroupSession(context);
    } catch (error) {
      this.log('telegram_turn_start_failed', { accountId: context.accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(context.accountId, context.chatId, '⚠️ Non è stato possibile avviare la risposta. Riprova tra poco.', context.threadId);
      return;
    }
    if (active.notice) await this.safeReply(context.accountId, context.chatId, active.notice, context.threadId);

    const contexts: ChatAttachmentContext[] = [];
    if (incoming.kind === 'ok' && downloaded) {
      try {
        const saved = await this.attachments!.save(active.sessionId, { filename: incoming.filename, data: downloaded });
        contexts.push(await this.attachments!.toModelContext({ ...saved, buffer: downloaded }));
      } catch (error) {
        this.log('telegram_attachment_failed', { accountId: context.accountId, code: errorCode(error) ?? 'internal' });
        await this.safeReply(context.accountId, context.chatId, attachmentErrorMessage(error), context.threadId);
        return;
      }
    }

    const prompt = text.trim() || (incoming.kind === 'ok'
      ? (incoming.isImage ? 'Descrivi l’immagine allegata.' : 'Analizza il documento allegato.')
      : '');
    if (!prompt) {
      await this.safeReply(context.accountId, context.chatId, 'Il messaggio non contiene testo o allegati supportati.', context.threadId);
      return;
    }

    try {
      const turn = this.turns.startTelegram(active.sessionId, prompt, contexts);
      await this.markGroupPendingTurn(context, active.sessionId, turn.turnId);
      this.attachTurn(context.accountId, context.chatId, context.userId, active.sessionId, turn, {
        ...(context.threadId ? { threadId: context.threadId } : {}),
        group: true,
      });
    } catch (error) {
      this.log('telegram_turn_start_failed', { accountId: context.accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(context.accountId, context.chatId, '⚠️ Non è stato possibile avviare la risposta. Riprova tra poco.', context.threadId);
    }
  }

  private async ensureGroupSession(context: GroupContext): Promise<{ sessionId: string; notice?: string }> {
    if (!this.sessions || !this.groups) throw new Error('sessions_unavailable');
    const group = this.groups.get(context.accountId, context.chatId);
    if (!group) throw new Error('group_not_found');

    if (context.threadId) {
      const topic = this.groups.getTopic(context.accountId, context.chatId, context.threadId);
      if (topic) {
        if (!(await this.sessions.hasSession(topic.sessionId))) {
          const created = await this.createGroupSession(group, context.accountId);
          await this.groups.putTopic(context.accountId, context.chatId, {
            threadId: context.threadId,
            sessionId: created,
            title: topic.title,
            titleSource: topic.titleSource,
          });
          return { sessionId: created, notice: 'ℹ️ La sessione precedente non esiste più; ne ho aperta una nuova in questo topic.' };
        }
        const archived = this.sessions.getSessionArchived ? await this.sessions.getSessionArchived(topic.sessionId) : false;
        if (archived) {
          const created = await this.createGroupSession(group, context.accountId);
          await this.groups.putTopic(context.accountId, context.chatId, {
            threadId: context.threadId,
            sessionId: created,
            title: topic.title,
            titleSource: topic.titleSource,
          });
          return { sessionId: created, notice: 'ℹ️ La sessione precedente era archiviata; ne ho aperta una nuova in questo topic.' };
        }
        await this.sessions.resumeSession(topic.sessionId);
        return { sessionId: topic.sessionId };
      }

      const created = await this.createGroupSession(group, context.accountId);
      await this.groups.putTopic(context.accountId, context.chatId, {
        threadId: context.threadId,
        sessionId: created,
        title: `Topic ${context.threadId}`,
        titleSource: 'manual',
      });
      return { sessionId: created };
    }

    if (group.generalSessionId) {
      if (!(await this.sessions.hasSession(group.generalSessionId))) {
        const created = await this.createGroupSession(group, context.accountId);
        await this.groups.setGeneralSession(context.accountId, context.chatId, created);
        return { sessionId: created, notice: 'ℹ️ La sessione General non esiste più; ne ho aperta una nuova.' };
      }
      const archived = this.sessions.getSessionArchived ? await this.sessions.getSessionArchived(group.generalSessionId) : false;
      if (archived) {
        const created = await this.createGroupSession(group, context.accountId);
        await this.groups.setGeneralSession(context.accountId, context.chatId, created);
        return { sessionId: created, notice: 'ℹ️ La sessione General era archiviata; ne ho aperta una nuova.' };
      }
      await this.sessions.resumeSession(group.generalSessionId);
      return { sessionId: group.generalSessionId };
    }

    const created = await this.createGroupSession(group, context.accountId);
    await this.groups.setGeneralSession(context.accountId, context.chatId, created);
    return { sessionId: created };
  }

  private async createGroupSession(group: TelegramGroup, accountId?: string): Promise<string> {
    if (!this.sessions) throw new Error('sessions_unavailable');
    const settings = accountId ? this.bindings.get(accountId).settings : undefined;
    const created = await this.sessions.createSession(
      undefined,
      undefined,
      undefined,
      group.defaultProjectId ?? settings?.defaultProjectId ?? undefined,
      group.defaultAgentProfileId ?? settings?.defaultAgentProfileId ?? undefined,
      { autoTitle: true },
    );
    return created.sessionId;
  }

  private async markGroupPendingTurn(context: GroupContext, sessionId: string, turnId: string): Promise<void> {
    if (!this.groups) return;
    try {
      if (context.threadId) {
        const topic = this.groups.getTopic(context.accountId, context.chatId, context.threadId);
        if (topic?.sessionId === sessionId) {
          await this.groups.updateTopicTurn(context.accountId, context.chatId, context.threadId, {
            lastTurnId: turnId,
            pendingTurnId: turnId,
          });
        }
      } else {
        const group = this.groups.get(context.accountId, context.chatId);
        if (group?.generalSessionId === sessionId) {
          await this.groups.updateGeneralTurn(context.accountId, context.chatId, {
            lastTurnId: turnId,
            pendingTurnId: turnId,
          });
        }
      }
    } catch (error) {
      this.log('telegram_pending_turn_failed', { accountId: context.accountId, code: errorCode(error) ?? 'internal' });
    }
  }

  private groupSession(context: GroupContext): { sessionId: string; topic?: TelegramTopicBinding } | null {
    if (!this.groups) return null;
    const group = this.groups.get(context.accountId, context.chatId);
    if (!group) return null;
    if (context.threadId) {
      const topic = group.topics[context.threadId];
      return topic ? { sessionId: topic.sessionId, topic } : null;
    }
    return group.generalSessionId ? { sessionId: group.generalSessionId } : null;
  }

  private async groupShowHelp(context: GroupContext): Promise<void> {
    await this.safeReply(context.accountId, context.chatId, [
      '**Comandi del gruppo**',
      '',
      '/new [titolo] — crea un topic e una sessione (solo da General)',
      '/sessions — elenca le sessioni del gruppo',
      '/switch N — apre il topic della sessione N',
      '/current — sessione di questo topic',
      '/rename Titolo — rinomina sessione e topic',
      '/stop — interrompe la risposta',
      '/status — stato del gruppo',
      '/ping — verifica il canale',
      '/help — questo elenco',
    ].join('\n'), context.threadId);
  }

  private async groupShowStatus(context: GroupContext): Promise<void> {
    const group = this.groups?.get(context.accountId, context.chatId) ?? context.group;
    const status = this.getStatus(context.accountId);
    const current = this.groupSession(context);
    const active = current && this.turns ? this.turns.getCurrent(current.sessionId) : null;
    const topicCount = Object.keys(group.topics).length;
    const label = context.threadId ? current?.topic?.title ?? `Topic ${context.threadId}` : 'General';
    await this.safeSendHtml(context.accountId, context.chatId, [
      '<b>Memora · Gruppo Telegram</b>',
      '',
      `Gruppo: ${escapeTelegramHtml(group.title)}`,
      `Forum: ${group.isForum ? 'sì' : 'no'}`,
      `Canale: ${status.enabled ? 'abilitato' : 'disabilitato'} (${escapeTelegramHtml(status.status)})`,
      `Utenti autorizzati: ${group.allowedUsers.length}`,
      `Topic collegati: ${topicCount}`,
      `General: ${group.generalSessionId ? 'attivo' : 'non ancora avviato'}`,
      `Contesto: ${escapeTelegramHtml(label)}`,
      `Sessione: ${current ? `<code>${escapeTelegramHtml(current.sessionId.slice(0, 20))}…</code>` : 'nessuna'}`,
      ...(active && (active.status === 'running' || active.status === 'queued') ? [`Turno: ${escapeTelegramHtml(active.status)}`] : []),
    ].join('\n'), context.threadId);
  }

  private async groupNewTopic(context: GroupContext, args: string): Promise<void> {
    if (context.threadId) {
      await this.safeReply(
        context.accountId,
        context.chatId,
        'Crea nuove sessioni da **General** con `/new [titolo]`; questo topic è già collegato a una sessione.',
        context.threadId,
      );
      return;
    }
    if (!this.sessions || !this.groups || !this.telegram.createForumTopic) {
      await this.safeReply(context.accountId, context.chatId, 'La creazione dei topic non è disponibile in questo momento.', context.threadId);
      return;
    }
    const requestedTitle = normalizeTitle(args);
    const title = requestedTitle || 'Nuova sessione';
    let topic: TelegramForumTopic;
    try {
      topic = await this.telegram.createForumTopic(context.chatId, title, context.accountId);
    } catch (error) {
      this.log('telegram_topic_create_failed', { accountId: context.accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(
        context.accountId,
        context.chatId,
        '⚠️ Non è stato possibile creare il topic. Verifica che il bot sia amministratore con **Manage Topics**.',
        context.threadId,
      );
      return;
    }
    const threadId = /^\d{1,20}$/.test(topic.threadId) && topic.threadId !== '0' ? topic.threadId : '';
    if (!threadId) {
      await this.safeReply(context.accountId, context.chatId, '⚠️ Telegram ha restituito un topic non valido.', context.threadId);
      return;
    }
    const creationKey = `${context.chatId}:${threadId}`;
    this.pendingTopicCreations.add(creationKey);
    try {
      let sessionId: string;
      try {
        sessionId = await this.createGroupSession(context.group, context.accountId);
      } catch (error) {
        this.log('telegram_group_topic_session_failed', { accountId: context.accountId, code: errorCode(error) ?? 'internal' });
        await this.safeReply(context.accountId, context.chatId, '⚠️ Topic creato, ma non è stato possibile creare la sessione. Scrivi nel topic per riprovare.', context.threadId);
        return;
      }
      try {
        await this.groups.putTopic(context.accountId, context.chatId, {
          threadId,
          sessionId,
          title: topic.name || title,
          titleSource: 'manual',
        });
      } catch (error) {
        this.log('telegram_group_topic_bind_failed', { accountId: context.accountId, code: errorCode(error) ?? 'internal' });
        await this.safeReply(context.accountId, context.chatId, '⚠️ Topic creato, ma non è stato possibile collegarlo alla sessione.', context.threadId);
        return;
      }
      if (requestedTitle) this.pendingTitles.set(sessionId, requestedTitle);
    } finally {
      this.pendingTopicCreations.delete(creationKey);
    }
    const link = groupLink(context.chatId, threadId);
    await this.safeSendHtml(
      context.accountId,
      context.chatId,
      `<b>Topic creato</b>\n<a href="${link}">${escapeTelegramHtml(topic.name || title)}</a>\nScrivi nel topic per iniziare.`,
      context.threadId,
    );
  }

  private async groupShowSessions(context: GroupContext): Promise<void> {
    if (!this.groups) return;
    const group = this.groups.get(context.accountId, context.chatId);
    if (!group) return;
    const entries: Array<{ sessionId: string; title: string; threadId?: string; general: boolean }> = [];
    if (group.generalSessionId) {
      entries.push({ sessionId: group.generalSessionId, title: 'General', general: true });
    }
    for (const topic of Object.values(group.topics).sort((a, b) => a.createdAt - b.createdAt)) {
      entries.push({ sessionId: topic.sessionId, title: topic.title, threadId: topic.threadId, general: false });
    }
    this.groupChoices.set(`${context.accountId}:${context.chatId}`, { at: this.now(), entries });
    if (entries.length === 0) {
      await this.safeReply(
        context.accountId,
        context.chatId,
        'Nessuna sessione nel gruppo. Scrivi in General oppure usa `/new` da General.',
        context.threadId,
      );
      return;
    }
    const lines = ['<b>Sessioni del gruppo</b>', ''];
    entries.forEach((entry, index) => {
      const marker = context.threadId
        ? entry.threadId === context.threadId ? '▸ ' : ''
        : entry.general ? '▸ ' : '';
      const link = entry.threadId ? ` · <a href="${groupLink(context.chatId, entry.threadId)}">apri</a>` : '';
      lines.push(`${index + 1}. ${marker}<b>${escapeTelegramHtml(entry.title)}</b>${link}`);
    });
    lines.push('', 'Usa <code>/switch N</code> per aprire il topic di una sessione.');
    await this.safeSendHtml(context.accountId, context.chatId, lines.join('\n'), context.threadId);
  }

  private async groupSwitch(context: GroupContext, args: string): Promise<void> {
    const choice = this.groupChoices.get(`${context.accountId}:${context.chatId}`);
    const index = Number(args.trim());
    if (!choice || this.now() - choice.at > SESSION_CHOICE_TTL_MS || !Number.isSafeInteger(index) || index < 1 || index > choice.entries.length) {
      await this.safeReply(context.accountId, context.chatId, 'Usa `/sessions` e poi `/switch N` con un numero valido.', context.threadId);
      return;
    }
    const selected = choice.entries[index - 1];
    if (!selected) {
      await this.safeReply(context.accountId, context.chatId, 'Sessione non valida.', context.threadId);
      return;
    }
    if (selected.threadId) {
      await this.safeSendHtml(
        context.accountId,
        context.chatId,
        `<b>Apri il topic</b>\n<a href="${groupLink(context.chatId, selected.threadId)}">${escapeTelegramHtml(selected.title)}</a>`,
        context.threadId,
      );
      return;
    }
    await this.safeReply(
      context.accountId,
      context.chatId,
      'General è la sessione predefinita del gruppo. Scrivi in General per continuarla.',
      context.threadId,
    );
  }

  private async groupShowCurrent(context: GroupContext): Promise<void> {
    if (!this.sessions) {
      await this.safeReply(context.accountId, context.chatId, 'La conversazione Telegram non è ancora disponibile.', context.threadId);
      return;
    }
    const current = this.groupSession(context);
    if (!current) {
      await this.safeReply(
        context.accountId,
        context.chatId,
        context.threadId ? 'Questo topic non è ancora collegato a una sessione. Scrivi un messaggio per crearlo.' : 'General non ha ancora una sessione. Scrivi un messaggio per crearla.',
        context.threadId,
      );
      return;
    }
    try {
      const list = await this.sessions.listSessions(false, true);
      const session = list.find(item => item.sessionId === current.sessionId);
      if (!session) {
        await this.safeReply(context.accountId, context.chatId, 'La sessione collegata non esiste più. Scrivi un messaggio per crearne una nuova.', context.threadId);
        return;
      }
      if (session.archived) {
        await this.safeReply(context.accountId, context.chatId, 'La sessione collegata è archiviata. Scrivi un messaggio per crearne una nuova.', context.threadId);
        return;
      }
      await this.safeSendHtml(context.accountId, context.chatId, [
        '<b>Sessione corrente</b>',
        escapeTelegramHtml(sessionTitle(session)),
        `${session.messageCount} messaggi`,
        `Topic: ${escapeTelegramHtml(context.threadId ? current.topic?.title ?? `Topic ${context.threadId}` : 'General')}`,
        ...(session.projectId ? [`Progetto: ${escapeTelegramHtml(session.projectId)}`] : []),
      ].join('\n'), context.threadId);
    } catch (error) {
      this.log('telegram_current_failed', { accountId: context.accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(context.accountId, context.chatId, '⚠️ Non è stato possibile leggere la sessione corrente.', context.threadId);
    }
  }

  private async groupRename(context: GroupContext, args: string): Promise<void> {
    if (!this.sessions) {
      await this.safeReply(context.accountId, context.chatId, 'La conversazione Telegram non è ancora disponibile.', context.threadId);
      return;
    }
    const title = normalizeTitle(args);
    if (!title) {
      await this.safeReply(context.accountId, context.chatId, 'Uso: `/rename Titolo della sessione`', context.threadId);
      return;
    }
    const current = this.groupSession(context);
    if (!current) {
      await this.safeReply(context.accountId, context.chatId, 'Nessuna sessione in questo contesto. Scrivi un messaggio oppure usa `/new` da General.', context.threadId);
      return;
    }
    let renamed = false;
    try {
      await this.sessions.renameSession(current.sessionId, title);
      this.pendingTitles.delete(current.sessionId);
      renamed = true;
    } catch (error) {
      if (errorCode(error) === 'session_not_persisted') {
        this.pendingTitles.set(current.sessionId, title);
      } else {
        this.log('telegram_rename_failed', { accountId: context.accountId, code: errorCode(error) ?? 'internal' });
        await this.safeReply(context.accountId, context.chatId, '⚠️ Non è stato possibile rinominare la sessione.', context.threadId);
        return;
      }
    }

    let topicUpdated = true;
    if (context.threadId) {
      if (this.telegram.editForumTopic) {
        try {
          await this.telegram.editForumTopic(context.chatId, Number(context.threadId), title, context.accountId);
        } catch (error) {
          topicUpdated = false;
          this.log('telegram_topic_rename_failed', { accountId: context.accountId, code: errorCode(error) ?? 'internal' });
        }
      } else {
        topicUpdated = false;
      }
      if (topicUpdated && this.groups) {
        await this.groups.updateTopicTitle(context.accountId, context.chatId, context.threadId, title).catch(() => undefined);
      }
    }
    await this.safeSendHtml(
      context.accountId,
      context.chatId,
      renamed
        ? `<b>${context.threadId ? 'Sessione e topic rinominati' : 'Sessione rinominata'}</b>\n${escapeTelegramHtml(title)}${topicUpdated ? '' : '\n\nIl titolo del topic non è stato aggiornato: verifica i permessi del bot.'}`
        : `<b>Titolo in attesa</b>\n${escapeTelegramHtml(title)}\nVerrà applicato dopo il primo messaggio.`,
      context.threadId,
    );
  }

  private async groupStop(context: GroupContext): Promise<void> {
    if (!this.turns) {
      await this.safeReply(context.accountId, context.chatId, 'La conversazione Telegram non è ancora disponibile.', context.threadId);
      return;
    }
    const current = this.groupSession(context);
    if (!current) {
      await this.safeReply(context.accountId, context.chatId, 'Nessuna risposta in corso.', context.threadId);
      return;
    }
    const turn = this.turns.getCurrent(current.sessionId);
    if (!turn || (turn.status !== 'running' && turn.status !== 'queued')) {
      await this.safeReply(context.accountId, context.chatId, 'Nessuna risposta in corso.', context.threadId);
      return;
    }
    const owned = this.bridges.has(turn.turnId);
    try {
      const aborted = await this.turns.abortSession(current.sessionId);
      if (!aborted) {
        await this.safeReply(context.accountId, context.chatId, 'Nessuna risposta in corso.', context.threadId);
        return;
      }
      if (!owned) await this.safeReply(context.accountId, context.chatId, '⏹ Interruzione richiesta.', context.threadId);
    } catch (error) {
      this.log('telegram_stop_failed', { accountId: context.accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(context.accountId, context.chatId, '⚠️ Non è stato possibile interrompere la risposta.', context.threadId);
    }
  }

  private sessionKey(accountId: string, userId: string): string {
    return `${accountId}:${userId}`;
  }

  private async handleChat(
    accountId: string,
    chatId: string,
    userId: string,
    message: Record<string, unknown>,
    text: string,
  ): Promise<void> {
    if (!this.turns || !this.sessions) {
      await this.safeReply(accountId, chatId, 'La conversazione Telegram non è ancora disponibile.');
      return;
    }

    const incoming = attachmentFromMessage(message);
    if (incoming.kind === 'unsupported') {
      await this.safeReply(
        accountId,
        chatId,
        incoming.reason === 'media'
          ? 'Per ora supporto foto, PDF, DOCX e file di testo. Vocali, video e sticker non sono ancora supportati.'
          : 'Formato non supportato. Sono supportati PDF, DOCX, testo e immagini.',
      );
      return;
    }
    if (incoming.kind === 'ok' && incoming.size !== undefined && incoming.size > MAX_INBOUND_ATTACHMENT_BYTES) {
      await this.safeReply(accountId, chatId, 'L’allegato supera il limite di 15 MB.');
      return;
    }
    if (incoming.kind === 'none' && !text.trim()) {
      await this.safeReply(accountId, chatId, 'Il messaggio non contiene testo o allegati supportati.');
      return;
    }

    let downloaded: Buffer | undefined;
    if (incoming.kind === 'ok') {
      if (!this.attachments || !this.telegram.getFile || !this.telegram.downloadFile) {
        await this.safeReply(accountId, chatId, 'Gli allegati da Telegram non sono disponibili in questo momento.');
        return;
      }
      try {
        const file = await this.telegram.getFile(incoming.fileId, accountId);
        if (file.size !== undefined && file.size > MAX_INBOUND_ATTACHMENT_BYTES) {
          await this.safeReply(accountId, chatId, 'L’allegato supera il limite di 15 MB.');
          return;
        }
        downloaded = await this.telegram.downloadFile(file.filePath, accountId, MAX_INBOUND_ATTACHMENT_BYTES);
      } catch (error) {
        this.log('telegram_attachment_failed', { accountId, code: errorCode(error) ?? 'internal' });
        await this.safeReply(accountId, chatId, attachmentErrorMessage(error));
        return;
      }
    }

    let active: { sessionId: string; notice?: string };
    try {
      active = await this.ensureSession(accountId, chatId, userId);
    } catch (error) {
      this.log('telegram_turn_start_failed', { accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(accountId, chatId, '⚠️ Non è stato possibile avviare la risposta. Riprova tra poco.');
      return;
    }
    if (active.notice) await this.safeReply(accountId, chatId, active.notice);

    const contexts: ChatAttachmentContext[] = [];
    if (incoming.kind === 'ok' && downloaded) {
      try {
        const saved = await this.attachments!.save(active.sessionId, { filename: incoming.filename, data: downloaded });
        contexts.push(await this.attachments!.toModelContext({ ...saved, buffer: downloaded }));
      } catch (error) {
        this.log('telegram_attachment_failed', { accountId, code: errorCode(error) ?? 'internal' });
        await this.safeReply(accountId, chatId, attachmentErrorMessage(error));
        return;
      }
    }

    const prompt = text.trim() || (incoming.kind === 'ok'
      ? (incoming.isImage ? 'Descrivi l’immagine allegata.' : 'Analizza il documento allegato.')
      : '');
    if (!prompt) {
      await this.safeReply(accountId, chatId, 'Il messaggio non contiene testo o allegati supportati.');
      return;
    }

    try {
      const turn = this.turns.startTelegram(active.sessionId, prompt, contexts);
      await this.markPendingTurn(accountId, userId, active.sessionId, turn.turnId);
      this.attachTurn(accountId, chatId, userId, active.sessionId, turn);
    } catch (error) {
      this.log('telegram_turn_start_failed', { accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(accountId, chatId, '⚠️ Non è stato possibile avviare la risposta. Riprova tra poco.');
    }
  }

  private async markPendingTurn(accountId: string, userId: string, sessionId: string, turnId: string): Promise<void> {
    try {
      const binding = this.bindings.getBinding(accountId, userId);
      if (binding?.sessionId === sessionId) {
        await this.bindings.updateBinding(accountId, userId, { lastTurnId: turnId, pendingTurnId: turnId });
      }
    } catch (error) {
      this.log('telegram_pending_turn_failed', { accountId, code: errorCode(error) ?? 'internal' });
    }
  }

  private async clearPendingTurn(bridge: TurnBridge): Promise<void> {
    try {
      if (bridge.group) {
        if (!this.groups) return;
        if (bridge.threadId) {
          const topic = this.groups.getTopic(bridge.accountId, bridge.chatId, bridge.threadId);
          if (topic?.sessionId === bridge.sessionId && topic.pendingTurnId === bridge.turnId) {
            await this.groups.updateTopicTurn(bridge.accountId, bridge.chatId, bridge.threadId, { pendingTurnId: null });
          }
        } else {
          const group = this.groups.get(bridge.accountId, bridge.chatId);
          if (group?.generalSessionId === bridge.sessionId && group.generalPendingTurnId === bridge.turnId) {
            await this.groups.updateGeneralTurn(bridge.accountId, bridge.chatId, { pendingTurnId: null });
          }
        }
        return;
      }
      const binding = this.bindings.getBinding(bridge.accountId, bridge.userId);
      if (binding?.sessionId === bridge.sessionId && binding.pendingTurnId === bridge.turnId) {
        await this.bindings.updateBinding(bridge.accountId, bridge.userId, { pendingTurnId: null });
      }
    } catch (error) {
      this.log('telegram_pending_clear_failed', { accountId: bridge.accountId, code: errorCode(error) ?? 'internal' });
    }
  }

  private async createBoundSession(accountId: string, chatId: string, userId: string): Promise<{ sessionId: string }> {
    if (!this.sessions) throw new Error('sessions_unavailable');
    const inbound = this.bindings.get(accountId);
    const projectId = inbound.settings.defaultProjectId ?? undefined;
    const agentProfileId = inbound.settings.defaultAgentProfileId ?? undefined;
    const created = await this.sessions.createSession(
      undefined,
      undefined,
      undefined,
      projectId,
      agentProfileId,
      { autoTitle: true },
    );
    await this.bindings.setBinding(accountId, {
      userId,
      chatId,
      sessionId: created.sessionId,
      projectId: projectId ?? null,
      agentProfileId: agentProfileId ?? null,
    });
    this.sessionChoices.delete(this.sessionKey(accountId, userId));
    return { sessionId: created.sessionId };
  }

  private async ensureSession(accountId: string, chatId: string, userId: string): Promise<{ sessionId: string; notice?: string }> {
    if (!this.sessions) throw new Error('sessions_unavailable');
    const binding = this.bindings.getBinding(accountId, userId);
    if (!binding) return this.createBoundSession(accountId, chatId, userId);

    if (!(await this.sessions.hasSession(binding.sessionId))) {
      const created = await this.createBoundSession(accountId, chatId, userId);
      return { ...created, notice: 'ℹ️ La sessione precedente non esiste più; ne ho aperta una nuova.' };
    }
    const archived = this.sessions.getSessionArchived
      ? await this.sessions.getSessionArchived(binding.sessionId)
      : false;
    if (archived) {
      const created = await this.createBoundSession(accountId, chatId, userId);
      return { ...created, notice: 'ℹ️ La sessione precedente era archiviata; ne ho aperta una nuova.' };
    }
    await this.sessions.resumeSession(binding.sessionId);
    return { sessionId: binding.sessionId };
  }

  private attachTurn(
    accountId: string,
    chatId: string,
    userId: string,
    sessionId: string,
    turn: TelegramInboundTurnInfo,
    options: { threadId?: string; group?: boolean } = {},
  ): void {
    if (!this.turns) return;
    const bridge: TurnBridge = {
      accountId,
      chatId,
      userId,
      group: options.group === true,
      ...(options.threadId ? { threadId: options.threadId } : {}),
      sessionId,
      turnId: turn.turnId,
      startedAt: turn.createdAt,
      queuedNotified: false,
      queuedTimer: null,
      running: false,
      finished: false,
      text: '',
      typingTimer: null,
    };
    this.bridges.set(turn.turnId, bridge);

    const unsubscribe = this.turns.subscribe(turn.turnId, 0, entry => {
      if (bridge.finished) return;
      const payload = isRecord(entry.event.payload) ? entry.event.payload : {};
      if (entry.event.type === 'message_update') {
        const assistantEvent = isRecord(payload.assistantMessageEvent) ? payload.assistantMessageEvent : {};
        if (assistantEvent.type === 'text_delta' && typeof assistantEvent.delta === 'string') {
          bridge.text = (bridge.text + assistantEvent.delta).slice(-200_000);
        }
        return;
      }
      if (entry.event.type === 'turn_status') {
        const status = typeof payload.status === 'string' ? payload.status : '';
        if (status === 'queued' && !bridge.queuedNotified && !bridge.queuedTimer) {
          bridge.queuedTimer = setTimeout(() => {
            bridge.queuedTimer = null;
            if (bridge.finished || bridge.running || bridge.queuedNotified) return;
            bridge.queuedNotified = true;
            void this.safeReply(accountId, chatId, '⏳ In coda…', bridge.threadId);
          }, 2_000);
          bridge.queuedTimer.unref?.();
        } else if (status === 'running') {
          bridge.running = true;
          if (bridge.queuedTimer) {
            clearTimeout(bridge.queuedTimer);
            bridge.queuedTimer = null;
          }
          this.startTyping(bridge);
        }
        return;
      }
      if (entry.event.type === 'turn_complete') {
        void this.finishTurn(bridge, payload);
      }
    });
    if (unsubscribe) bridge.unsubscribe = unsubscribe;
    else void this.finishTurn(bridge, { status: 'failed' });
  }

  private startTyping(bridge: TurnBridge): void {
    if (bridge.finished || bridge.typingTimer) return;
    const tick = (): void => {
      void this.telegram.sendChatAction?.(bridge.chatId, 'typing', bridge.accountId, {
        ...(threadNumber(bridge.threadId) ? { messageThreadId: threadNumber(bridge.threadId) } : {}),
      }).catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, TYPING_INTERVAL_MS);
    timer.unref?.();
    bridge.typingTimer = timer;
    this.typingTimers.add(timer);
  }

  private stopTyping(bridge: TurnBridge): void {
    if (!bridge.typingTimer) return;
    clearInterval(bridge.typingTimer);
    this.typingTimers.delete(bridge.typingTimer);
    bridge.typingTimer = null;
  }

  private async finishTurn(bridge: TurnBridge, payload: Record<string, unknown>): Promise<void> {
    if (bridge.finished) return;
    bridge.finished = true;
    this.stopTyping(bridge);
    if (bridge.queuedTimer) {
      clearTimeout(bridge.queuedTimer);
      bridge.queuedTimer = null;
    }
    bridge.unsubscribe?.();
    if (this.stopping) {
      this.bridges.delete(bridge.turnId);
      return;
    }

    try {
      await this.clearPendingTurn(bridge);

      const status = typeof payload.status === 'string' ? payload.status : 'failed';
      if (status === 'aborted') {
        await this.safeReply(bridge.accountId, bridge.chatId, '⏹ Risposta interrotta.', bridge.threadId);
        return;
      }
      if (status === 'failed' || status === 'interrupted') {
        const error = this.turns?.getTurn(bridge.turnId)?.error;
        const detail = error ? `\n\n${escapeTelegramHtml(error)}` : '';
        await this.safeSendHtml(bridge.accountId, bridge.chatId, `<b>⚠️ Risposta non completata</b>${detail}`, bridge.threadId);
        return;
      }

      let text = bridge.text.trim();
      if (!text) {
        try {
          text = await this.lastAssistantText(bridge.sessionId);
        } catch (error) {
          this.log('telegram_final_text_failed', { accountId: bridge.accountId, code: errorCode(error) ?? 'internal' });
        }
      }
      const sent = await this.safeReply(bridge.accountId, bridge.chatId, text || 'Risposta completata senza testo.', bridge.threadId);
      const documents = await this.sendTurnArtifacts(bridge);

      const pendingTitle = this.pendingTitles.get(bridge.sessionId);
      if (pendingTitle && this.sessions) {
        this.pendingTitles.delete(bridge.sessionId);
        await this.sessions.renameSession(bridge.sessionId, pendingTitle).catch(error => {
          this.log('telegram_pending_title_failed', { accountId: bridge.accountId, code: errorCode(error) ?? 'internal' });
        });
      }

      if ((sent || documents > 0) && this.reads) {
        await this.reads.mark(bridge.sessionId, bridge.turnId).catch(error => {
          this.log('telegram_read_mark_failed', { accountId: bridge.accountId, code: errorCode(error) ?? 'internal' });
        });
      }
    } finally {
      this.bridges.delete(bridge.turnId);
    }
  }

  private async lastAssistantText(sessionId: string): Promise<string> {
    if (!this.sessions) return '';
    const messages = await this.sessions.getSessionMessages(sessionId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === 'assistant' && message.content.trim()) return message.content.trim();
    }
    return '';
  }

  private async sendTurnArtifacts(bridge: TurnBridge): Promise<number> {
    if (!this.sessions) return 0;
    let sent = 0;
    try {
      const artifacts = await this.sessions.listArtifacts(bridge.sessionId);
      const selected = artifacts.filter(artifact => DOCUMENT_ARTIFACT_KINDS.has(artifact.kind) && artifact.createdAt >= bridge.startedAt - 1_000);
      for (const artifact of selected) {
        try {
          const full = await this.sessions.getArtifact(bridge.sessionId, artifact.id);
          await this.telegram.sendDocumentTo(bridge.chatId, {
            filename: full.name,
            mimeType: full.mimeType,
            buffer: full.buffer,
          }, bridge.accountId, {
            ...(threadNumber(bridge.threadId) ? { messageThreadId: threadNumber(bridge.threadId) } : {}),
          });
          sent += 1;
        } catch (error) {
          this.log('telegram_artifact_send_failed', { accountId: bridge.accountId, artifactId: artifact.id, code: errorCode(error) ?? 'internal' });
        }
      }
    } catch (error) {
      this.log('telegram_artifact_list_failed', { accountId: bridge.accountId, code: errorCode(error) ?? 'internal' });
    }
    return sent;
  }

  private async showHelp(accountId: string, chatId: string): Promise<void> {
    await this.safeReply(accountId, chatId, [
      '**Comandi disponibili**',
      '',
      '/new [titolo] — nuova sessione',
      '/sessions — sessioni recenti',
      '/switch N — cambia sessione',
      '/current — sessione attiva',
      '/rename Titolo — rinomina la sessione',
      '/stop — interrompe la risposta',
      '/status — stato del canale',
      '/ping — verifica il canale',
      '/help — questo elenco',
    ].join('\n'));
  }

  private async showStatus(accountId: string, chatId: string, userId: string): Promise<void> {
    const status = this.getStatus(accountId);
    const inbound = this.bindings.get(accountId);
    const binding = this.bindings.getBinding(accountId, userId);
    const current = binding && this.turns ? this.turns.getCurrent(binding.sessionId) : null;
    const active = current && (current.status === 'running' || current.status === 'queued') ? current : null;
    await this.safeReply(accountId, chatId, [
      '**Memora · Telegram**',
      '',
      `Canale: ${status.enabled ? 'abilitato' : 'disabilitato'}`,
      `Stato: ${status.status}`,
      `Bot: ${status.botUsername ? `@${status.botUsername}` : '—'}`,
      `Utenti autorizzati: ${inbound.allowedUsers.length}`,
      `Sessioni collegate: ${inbound.bindings.length}`,
      `Sessione Telegram: ${binding ? 'sì' : 'no'}`,
      ...(active ? [`Turno: ${active.status}`] : []),
    ].join('\n'));
  }

  private async newSession(accountId: string, chatId: string, userId: string, titleArg: string): Promise<void> {
    if (!this.sessions) {
      await this.safeReply(accountId, chatId, 'La conversazione Telegram non è ancora disponibile.');
      return;
    }
    try {
      const created = await this.createBoundSession(accountId, chatId, userId);
      const title = normalizeTitle(titleArg);
      if (title) this.pendingTitles.set(created.sessionId, title);
      await this.safeReply(accountId, chatId, title
        ? '**Nuova sessione pronta.**\nIl titolo verrà applicato dopo il primo messaggio.'
        : '**Nuova sessione pronta.**\nScrivi il primo messaggio.');
    } catch (error) {
      this.log('telegram_new_session_failed', { accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(accountId, chatId, '⚠️ Non è stato possibile creare una nuova sessione.');
    }
  }

  private async showSessions(accountId: string, chatId: string, userId: string): Promise<void> {
    if (!this.sessions) {
      await this.safeReply(accountId, chatId, 'La conversazione Telegram non è ancora disponibile.');
      return;
    }
    try {
      const list = await this.sessions.listSessions(false, false);
      const sorted = [...list].sort((a, b) => timeOf(b.modified) - timeOf(a.modified)).slice(0, MAX_SESSION_CHOICES);
      this.sessionChoices.set(this.sessionKey(accountId, userId), {
        at: this.now(),
        entries: sorted.map(session => ({
          sessionId: session.sessionId,
          title: sessionTitle(session),
          ...(session.projectId ? { projectId: session.projectId } : {}),
        })),
      });
      if (sorted.length === 0) {
        await this.safeReply(accountId, chatId, 'Nessuna sessione disponibile. Usa /new per crearne una.');
        return;
      }
      const current = this.bindings.getBinding(accountId, userId)?.sessionId;
      const lines = ['<b>Sessioni recenti</b>', ''];
      sorted.forEach((session, index) => {
        const marker = session.sessionId === current ? '▸ ' : '';
        lines.push(`${index + 1}. ${marker}<b>${escapeTelegramHtml(sessionTitle(session))}</b> · ${session.messageCount} msg`);
      });
      lines.push('', 'Per aprire una sessione: <code>/switch N</code>');
      await this.safeSendHtml(accountId, chatId, lines.join('\n'));
    } catch (error) {
      this.log('telegram_session_list_failed', { accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(accountId, chatId, '⚠️ Non è stato possibile leggere le sessioni.');
    }
  }

  private async switchSession(accountId: string, chatId: string, userId: string, args: string): Promise<void> {
    if (!this.sessions) {
      await this.safeReply(accountId, chatId, 'La conversazione Telegram non è ancora disponibile.');
      return;
    }
    const choice = this.sessionChoices.get(this.sessionKey(accountId, userId));
    const index = Number(args.trim());
    if (!choice || this.now() - choice.at > SESSION_CHOICE_TTL_MS || !Number.isSafeInteger(index) || index < 1 || index > choice.entries.length) {
      await this.safeReply(accountId, chatId, 'Usa /sessions e poi /switch N con un numero valido.');
      return;
    }
    const selected = choice.entries[index - 1];
    if (!selected) {
      await this.safeReply(accountId, chatId, 'Sessione non valida.');
      return;
    }
    try {
      if (!(await this.sessions.hasSession(selected.sessionId))) {
        await this.safeReply(accountId, chatId, 'La sessione selezionata non esiste più. Usa /new.');
        return;
      }
      if (this.sessions.getSessionArchived && await this.sessions.getSessionArchived(selected.sessionId)) {
        await this.safeReply(accountId, chatId, 'La sessione selezionata è archiviata. Usa /new o ripristinala dalla web UI.');
        return;
      }
      await this.sessions.resumeSession(selected.sessionId);
      await this.bindings.setBinding(accountId, {
        userId,
        chatId,
        sessionId: selected.sessionId,
        ...(selected.projectId ? { projectId: selected.projectId } : {}),
      });
      await this.safeSendHtml(accountId, chatId, `<b>Sessione attiva</b>\n${escapeTelegramHtml(selected.title)}`);
    } catch (error) {
      this.log('telegram_switch_failed', { accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(accountId, chatId, '⚠️ Non è stato possibile cambiare sessione.');
    }
  }

  private async showCurrent(accountId: string, chatId: string, userId: string): Promise<void> {
    if (!this.sessions) {
      await this.safeReply(accountId, chatId, 'La conversazione Telegram non è ancora disponibile.');
      return;
    }
    const binding = this.bindings.getBinding(accountId, userId);
    if (!binding) {
      await this.safeReply(accountId, chatId, 'Nessuna sessione attiva. Usa /new o scrivi un messaggio.');
      return;
    }
    try {
      const list = await this.sessions.listSessions(false, true);
      const current = list.find(session => session.sessionId === binding.sessionId);
      if (!current) {
        await this.safeReply(accountId, chatId, 'La sessione collegata non esiste più. Usa /new.');
        return;
      }
      if (current.archived) {
        await this.safeReply(accountId, chatId, 'La sessione collegata è archiviata. Usa /new o ripristinala dalla web UI.');
        return;
      }
      await this.safeSendHtml(accountId, chatId, [
        '<b>Sessione attiva</b>',
        escapeTelegramHtml(sessionTitle(current)),
        `${current.messageCount} messaggi`,
        ...(current.projectId ? [`Progetto: ${escapeTelegramHtml(current.projectId)}`] : []),
      ].join('\n'));
    } catch (error) {
      this.log('telegram_current_failed', { accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(accountId, chatId, '⚠️ Non è stato possibile leggere la sessione attiva.');
    }
  }

  private async renameActive(accountId: string, chatId: string, userId: string, args: string): Promise<void> {
    if (!this.sessions) {
      await this.safeReply(accountId, chatId, 'La conversazione Telegram non è ancora disponibile.');
      return;
    }
    const title = normalizeTitle(args);
    if (!title) {
      await this.safeReply(accountId, chatId, 'Uso: /rename Titolo della sessione');
      return;
    }
    const binding = this.bindings.getBinding(accountId, userId);
    if (!binding) {
      await this.safeReply(accountId, chatId, 'Nessuna sessione attiva. Usa /new o scrivi un messaggio.');
      return;
    }
    try {
      await this.sessions.renameSession(binding.sessionId, title);
      this.pendingTitles.delete(binding.sessionId);
      this.sessionChoices.delete(this.sessionKey(accountId, userId));
      await this.safeSendHtml(accountId, chatId, `<b>Sessione rinominata</b>\n${escapeTelegramHtml(title)}`);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'session_not_persisted') {
        await this.safeReply(accountId, chatId, 'Invia prima un messaggio, poi potrai rinominare la sessione.');
        return;
      }
      this.log('telegram_rename_failed', { accountId, code: code ?? 'internal' });
      await this.safeReply(accountId, chatId, '⚠️ Non è stato possibile rinominare la sessione.');
    }
  }

  private async stopActive(accountId: string, chatId: string, userId: string): Promise<void> {
    if (!this.turns) {
      await this.safeReply(accountId, chatId, 'La conversazione Telegram non è ancora disponibile.');
      return;
    }
    const binding = this.bindings.getBinding(accountId, userId);
    if (!binding) {
      await this.safeReply(accountId, chatId, 'Nessuna risposta in corso.');
      return;
    }
    const current = this.turns.getCurrent(binding.sessionId);
    if (!current || (current.status !== 'running' && current.status !== 'queued')) {
      await this.safeReply(accountId, chatId, 'Nessuna risposta in corso.');
      return;
    }
    const owned = this.bridges.has(current.turnId);
    try {
      const aborted = await this.turns.abortSession(binding.sessionId);
      if (!aborted) {
        await this.safeReply(accountId, chatId, 'Nessuna risposta in corso.');
        return;
      }
      if (!owned) await this.safeReply(accountId, chatId, '⏹ Interruzione richiesta.');
    } catch (error) {
      this.log('telegram_stop_failed', { accountId, code: errorCode(error) ?? 'internal' });
      await this.safeReply(accountId, chatId, '⚠️ Non è stato possibile interrompere la risposta.');
    }
  }

  private async handleUnauthorized(
    accountId: string,
    chatId: string,
    userId: string,
    label: string,
    text: string,
  ): Promise<void> {
    const command = parseCommand(text);
    if (command?.name === 'start' && command.args) {
      const code = command.args.split(/\s+/)[0] ?? '';
      try {
        await this.bindings.pair(accountId, { code, userId, label });
        const account = this.accounts.getAccount(accountId);
        if (account && !account.chatId) {
          await this.accounts.updateAccount(accountId, { chatId }).catch(() => undefined);
        }
        this.log('telegram_paired', { accountId });
        await this.safeReply(
          accountId,
          chatId,
          '**Benvenuto in Memora.**\n\nAccount Telegram associato. Usa /help per i comandi disponibili.',
        );
      } catch (error) {
        if (error instanceof TelegramInboundError) {
          await this.safeReply(accountId, chatId, pairingErrorMessage(error.code));
          return;
        }
        throw error;
      }
      return;
    }

    if (command?.name === 'start') {
      await this.safeReply(
        accountId,
        chatId,
        'Per associare questo account, genera un codice in **Amministrazione → Telegram** e invia `/start <codice>`.',
      );
      return;
    }

    await this.safeReply(
      accountId,
      chatId,
      'Questo account Telegram non è autorizzato. Per associarlo usa il codice fornito in Amministrazione → Telegram.',
    );
  }

  private async safeReply(accountId: string, chatId: string, markdown: string, threadId?: string): Promise<boolean> {
    try {
      const prepared = prepareTelegramReply(markdown);
      const messageThreadId = threadNumber(threadId);
      let sent = false;
      for (const chunk of prepared.chunks) {
        await this.telegram.sendTo(chatId, chunk, accountId, {
          parseMode: 'HTML',
          ...(messageThreadId ? { messageThreadId } : {}),
        });
        sent = true;
      }
      if (prepared.document) {
        await this.telegram.sendDocumentTo(chatId, prepared.document, accountId, {
          ...(messageThreadId ? { messageThreadId } : {}),
        });
        sent = true;
      }
      return sent;
    } catch (error) {
      this.log('telegram_reply_failed', {
        accountId,
        code: error instanceof TelegramError ? error.code : 'internal',
      });
      return false;
    }
  }

  private async safeSendHtml(accountId: string, chatId: string, html: string, threadId?: string): Promise<boolean> {
    try {
      const chunks = splitTelegramHtml(html);
      const messageThreadId = threadNumber(threadId);
      let sent = false;
      for (const chunk of chunks) {
        await this.telegram.sendTo(chatId, chunk, accountId, {
          parseMode: 'HTML',
          ...(messageThreadId ? { messageThreadId } : {}),
        });
        sent = true;
      }
      return sent;
    } catch (error) {
      this.log('telegram_reply_failed', {
        accountId,
        code: error instanceof TelegramError ? error.code : 'internal',
      });
      return false;
    }
  }

  private trackObservedChat(accountId: string, chatId: string, chat: Record<string, unknown>): void {
    let chats = this.observedChats.get(accountId);
    if (!chats) {
      chats = new Map();
      this.observedChats.set(accountId, chats);
    }
    const title = typeof chat.title === 'string' ? chat.title.trim() : '';
    const name = [chat.first_name, chat.last_name].filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).join(' ').trim();
    const username = typeof chat.username === 'string' ? chat.username : undefined;
    const label = title || name || (username ? `@${username}` : chatId);
    chats.set(chatId, {
      id: chatId,
      label: label.slice(0, 120),
      type: typeof chat.type === 'string' ? chat.type : 'unknown',
      ...(username ? { username } : {}),
      ...(chat.is_forum === true ? { isForum: true } : {}),
    });
    while (chats.size > MAX_OBSERVED_CHATS) {
      const oldest = chats.keys().next().value;
      if (oldest === undefined) break;
      chats.delete(oldest);
    }
  }

  private allowIncoming(accountId: string, userId: string): boolean {
    const key = `${accountId}:${userId}`;
    const now = this.now();
    const entry = this.incomingCounters.get(key);
    if (!entry || now - entry.windowStart >= this.incomingWindowMs) {
      this.incomingCounters.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (entry.count >= this.incomingLimit) return false;
    entry.count += 1;
    return true;
  }

  private sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(done, milliseconds);
      const onAbort = (): void => done();
      function done(): void {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve();
      }
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) done();
    });
  }
}
