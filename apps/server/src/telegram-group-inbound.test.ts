import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ChatAttachment,
  ChatAttachmentContext,
  StreamEvent,
  TelegramChatInfo,
  TelegramChatMemberInfo,
  TelegramForumTopic,
} from '@memora/shared';
import type { TelegramBotInfo } from './telegram.js';
import { TelegramStore } from './telegram.js';
import { TelegramBindingStore } from './telegram-bindings.js';
import { TelegramGroupStore } from './telegram-groups.js';
import {
  TelegramInboundService,
  type TelegramInboundArtifactInfo,
  type TelegramInboundSessionInfo,
  type TelegramInboundSessionService,
  type TelegramInboundTransport,
  type TelegramInboundTurnInfo,
  type TelegramInboundTurns,
} from './telegram-inbound.js';

const dirs: string[] = [];
const services: TelegramInboundService[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-telegram-group-inbound-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.stop()));
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

class FakeTransport implements TelegramInboundTransport {
  updates: Array<Record<string, unknown>> = [];
  sent: Array<{ chatId: string; text: string; accountId?: string; threadId?: number }> = [];
  documents: Array<{ chatId: string; filename: string; accountId?: string; threadId?: number }> = [];
  typing: Array<{ chatId: string; accountId?: string; threadId?: number }> = [];
  createdTopics: Array<{ chatId: string; name: string; threadId: string }> = [];
  editedTopics: Array<{ chatId: string; threadId: number; name: string }> = [];
  appliedIcons: Array<{ chatId: string; threadId: number; icon: string }> = [];
  setMyCommands = vi.fn(async (
    _commands: Array<{ command: string; description: string }>,
    _accountId?: string,
    _options?: { scope?: { type: string } },
  ): Promise<void> => { void _commands; void _accountId; void _options; });
  fileBuffer = Buffer.from('%PDF');
  getFile = vi.fn(async (fileId: string) => ({ fileId, filePath: 'files/report', size: this.fileBuffer.byteLength }));
  downloadFile = vi.fn(async () => this.fileBuffer);
  chatInfo: TelegramChatInfo = { id: '-100123', type: 'supergroup', title: 'Memora', isForum: true };
  chatMember: TelegramChatMemberInfo = { status: 'administrator', canManageTopics: true, isMember: true };
  getMe = vi.fn(async (): Promise<TelegramBotInfo> => ({
    id: '1',
    firstName: 'Memora',
    username: 'memora_bot',
    canReadAllGroupMessages: true,
  }));
  getChat = vi.fn(async (): Promise<TelegramChatInfo> => this.chatInfo);
  getChatMember = vi.fn(async (): Promise<TelegramChatMemberInfo> => this.chatMember);
  createForumTopic = vi.fn(async (
    chatId: string,
    name: string,
    _accountId?: string,
    options?: { iconCustomEmojiId?: string },
  ): Promise<TelegramForumTopic> => {
    const threadId = String(50 + this.createdTopics.length + 1);
    this.createdTopics.push({ chatId, name, threadId });
    if (options?.iconCustomEmojiId) this.appliedIcons.push({ chatId, threadId: Number(threadId), icon: options.iconCustomEmojiId });
    return { threadId, name };
  });
  setForumTopicIcon = vi.fn(async (chatId: string, threadId: number, icon: string): Promise<void> => {
    this.appliedIcons.push({ chatId, threadId, icon });
  });
  getForumTopicIconStickers = vi.fn(async () => [{ customEmojiId: 'check-1', emoji: '✅' }]);
  editForumTopic = vi.fn(async (chatId: string, threadId: number, name: string, _accountId?: string, options?: { iconCustomEmojiId?: string }): Promise<void> => {
    this.editedTopics.push({ chatId, threadId, name });
    if (options?.iconCustomEmojiId) this.appliedIcons.push({ chatId, threadId, icon: options.iconCustomEmojiId });
  });
  getUpdates = vi.fn(async (_accountId: string | undefined, options: { signal?: AbortSignal }): Promise<Array<Record<string, unknown>>> => {
    if (this.updates.length > 0) return this.updates.splice(0);
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 5);
      options.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    return [];
  });
  sendTo = vi.fn(async (chatId: string, text: string, accountId?: string, options?: { parseMode?: 'HTML'; messageThreadId?: number }) => {
    this.sent.push({ chatId, text, accountId, ...(options?.messageThreadId ? { threadId: options.messageThreadId } : {}) });
  });
  sendDocumentTo = vi.fn(async (chatId: string, document: { filename: string }, accountId?: string, options?: { messageThreadId?: number }) => {
    this.documents.push({ chatId, filename: document.filename, accountId, ...(options?.messageThreadId ? { threadId: options.messageThreadId } : {}) });
  });
  sendChatAction = vi.fn(async (chatId: string, _action: string, accountId?: string, options?: { messageThreadId?: number }) => {
    this.typing.push({ chatId, accountId, ...(options?.messageThreadId ? { threadId: options.messageThreadId } : {}) });
  });
}

type Listener = (entry: { seq: number; event: StreamEvent }) => void;

class FakeTurns implements TelegramInboundTurns {
  readonly started: Array<{ turnId: string; sessionId: string; text: string; attachments: ChatAttachmentContext[] }> = [];
  private readonly turns = new Map<string, TelegramInboundTurnInfo>();
  private readonly latest = new Map<string, string>();
  private readonly events = new Map<string, Array<{ seq: number; event: StreamEvent }>>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private seq = 0;
  private counter = 0;

  startTelegram(sessionId: string, text: string, attachments: ChatAttachmentContext[] = []): TelegramInboundTurnInfo {
    return this.start(sessionId, text, attachments);
  }

  start(sessionId: string, text: string, attachments: ChatAttachmentContext[] = []): TelegramInboundTurnInfo {
    const turn: TelegramInboundTurnInfo = {
      turnId: `turn-${++this.counter}`,
      sessionId,
      status: 'queued',
      createdAt: Date.now(),
    };
    this.turns.set(turn.turnId, turn);
    this.latest.set(sessionId, turn.turnId);
    this.started.push({ turnId: turn.turnId, sessionId, text, attachments });
    this.emit(turn.turnId, { type: 'turn_status', sessionId, timestamp: Date.now(), payload: { turnId: turn.turnId, status: 'queued' } });
    return { ...turn };
  }

  subscribe(turnId: string, after: number, listener: Listener): (() => void) | null {
    const events = this.events.get(turnId) ?? [];
    for (const entry of events) if (entry.seq > after) listener(entry);
    const turn = this.turns.get(turnId);
    if (!turn || this.terminal(turn.status)) return () => {};
    let set = this.listeners.get(turnId);
    if (!set) {
      set = new Set();
      this.listeners.set(turnId, set);
    }
    set.add(listener);
    return () => set?.delete(listener);
  }

  getTurn(turnId: string): TelegramInboundTurnInfo | null {
    const turn = this.turns.get(turnId);
    return turn ? { ...turn } : null;
  }

  getCurrent(sessionId: string): TelegramInboundTurnInfo | null {
    const turnId = this.latest.get(sessionId);
    return turnId ? this.getTurn(turnId) : null;
  }

  async abortSession(sessionId: string): Promise<TelegramInboundTurnInfo | null> {
    const turnId = this.latest.get(sessionId);
    return turnId ? this.abort(turnId) : null;
  }

  async abort(turnId: string): Promise<TelegramInboundTurnInfo | null> {
    const turn = this.turns.get(turnId);
    if (!turn) return null;
    if (turn.status === 'queued' || turn.status === 'running') this.complete(turnId, 'aborted');
    return this.getTurn(turnId);
  }

  running(turnId: string): void {
    const turn = this.turns.get(turnId);
    if (!turn) return;
    turn.status = 'running';
    this.emit(turnId, { type: 'turn_status', sessionId: turn.sessionId, timestamp: Date.now(), payload: { turnId, status: 'running' } });
  }

  complete(turnId: string, status: 'completed' | 'failed' | 'aborted' | 'interrupted' = 'completed', text = ''): void {
    const turn = this.turns.get(turnId);
    if (!turn) return;
    turn.status = status;
    if (status === 'completed' && text) {
      this.emit(turnId, {
        type: 'message_update',
        sessionId: turn.sessionId,
        timestamp: Date.now(),
        payload: { assistantMessageEvent: { type: 'text_delta', delta: text } },
      });
    }
    this.emit(turnId, { type: 'turn_complete', sessionId: turn.sessionId, timestamp: Date.now(), payload: { turnId, status } });
  }

  addInterrupted(sessionId: string): string {
    const turn: TelegramInboundTurnInfo = {
      turnId: `turn-${++this.counter}`,
      sessionId,
      status: 'interrupted',
      createdAt: Date.now(),
    };
    this.turns.set(turn.turnId, turn);
    this.latest.set(sessionId, turn.turnId);
    return turn.turnId;
  }

  private emit(turnId: string, event: StreamEvent): void {
    const entry = { seq: ++this.seq, event };
    const list = this.events.get(turnId) ?? [];
    list.push(entry);
    this.events.set(turnId, list);
    for (const listener of this.listeners.get(turnId) ?? []) listener(entry);
    if (event.type === 'turn_complete') this.listeners.delete(turnId);
  }

  private terminal(status: string): boolean {
    return status === 'completed' || status === 'failed' || status === 'aborted' || status === 'interrupted';
  }
}

class FakeSessions implements TelegramInboundSessionService {
  readonly sessions = new Map<string, TelegramInboundSessionInfo>();
  readonly messages = new Map<string, Array<{ role: string; content: string }>>();
  readonly artifacts = new Map<string, TelegramInboundArtifactInfo[]>();
  readonly archived = new Set<string>();
  readonly created: Array<{ projectId?: string; agentProfileId?: string }> = [];
  readonly agentProfiles = new Map<string, string>();
  readonly renames: Array<{ sessionId: string; title: string }> = [];
  private counter = 0;

  addSession(session: Partial<TelegramInboundSessionInfo> & { sessionId: string }): TelegramInboundSessionInfo {
    const value: TelegramInboundSessionInfo = {
      sessionId: session.sessionId,
      name: session.name,
      firstMessage: session.firstMessage ?? 'Primo messaggio',
      messageCount: session.messageCount ?? 1,
      modified: session.modified ?? new Date(),
      ...(session.projectId ? { projectId: session.projectId } : {}),
    };
    this.sessions.set(value.sessionId, value);
    return value;
  }

  async createSession(
    _modelId?: string,
    _provider?: never,
    _reasoningLevel?: never,
    projectId?: string,
    agentProfileId?: string,
  ): Promise<{ sessionId: string }> {
    const sessionId = `sess_${++this.counter}`;
    this.addSession({ sessionId, name: undefined, firstMessage: '', messageCount: 0, modified: new Date(), ...(projectId ? { projectId } : {}) });
    this.created.push({ ...(projectId ? { projectId } : {}), ...(agentProfileId ? { agentProfileId } : {}) });
    if (agentProfileId) this.agentProfiles.set(sessionId, agentProfileId);
    this.messages.set(sessionId, []);
    return { sessionId };
  }

  async hasSession(sessionId: string): Promise<boolean> {
    return this.sessions.has(sessionId);
  }

  async resumeSession(sessionId: string): Promise<unknown> {
    if (!this.sessions.has(sessionId)) throw Object.assign(new Error('not found'), { code: 'session_not_found' });
    return { sessionId };
  }

  async getSessionArchived(sessionId: string): Promise<boolean> {
    return this.archived.has(sessionId);
  }

  async getSessionProjectId(sessionId: string): Promise<string | undefined> {
    return this.sessions.get(sessionId)?.projectId;
  }

  async getSessionAgentProfileId(sessionId: string): Promise<string | undefined> {
    return this.agentProfiles.get(sessionId);
  }

  async listAgentProfiles(): Promise<Array<{ id: string; name: string }>> {
    return [
      { id: 'sviluppatore', name: 'Sviluppatore' },
      { id: 'memo-base', name: 'Memo base' },
    ];
  }

  async listSessions(onlyArchived = false, includeArchived = false): Promise<TelegramInboundSessionInfo[]> {
    const list = [...this.sessions.values()];
    if (includeArchived) return list;
    return list.filter(session => this.archived.has(session.sessionId) === onlyArchived);
  }

  async getSessionMessages(sessionId: string): Promise<Array<{ role: string; content: string }>> {
    return this.messages.get(sessionId) ?? [];
  }

  async renameSession(sessionId: string, name: string): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) throw Object.assign(new Error('not found'), { code: 'session_not_found' });
    if ((this.messages.get(sessionId) ?? []).length === 0) {
      throw Object.assign(new Error('not persisted'), { code: 'session_not_persisted' });
    }
    session.name = name;
    this.renames.push({ sessionId, title: name });
    return { sessionId };
  }

  async listArtifacts(sessionId: string): Promise<TelegramInboundArtifactInfo[]> {
    return this.artifacts.get(sessionId) ?? [];
  }

  async getArtifact(_sessionId: string, artifactId: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
    return {
      name: artifactId === 'art_pdf' ? 'report.pdf' : 'documento.bin',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF'),
    };
  }
}

class FakeAttachments {
  readonly saved: Array<{ sessionId: string; filename: string; size: number }> = [];
  save = vi.fn(async (sessionId: string, input: { filename: string; data: Buffer }): Promise<ChatAttachment> => {
    this.saved.push({ sessionId, filename: input.filename, size: input.data.byteLength });
    return {
      id: 'att_1',
      filename: input.filename,
      mimeType: 'application/pdf',
      size: input.data.byteLength,
      kind: 'text',
    };
  });
  toModelContext = vi.fn(async (attachment: ChatAttachment & { buffer: Buffer }): Promise<ChatAttachmentContext> => ({
    ...attachment,
    text: 'contenuto allegato',
  }));
}

let nextUpdateId = 300;

function groupMessage(input: {
  text?: string;
  userId?: number;
  chatId?: number;
  threadId?: number;
  title?: string;
  isForum?: boolean;
  fromBot?: boolean;
} = {}): Record<string, unknown> {
  nextUpdateId += 1;
  const userId = input.userId ?? 42;
  const chatId = input.chatId ?? -100123;
  return {
    update_id: nextUpdateId,
    message: {
      message_id: nextUpdateId,
      from: { id: userId, is_bot: input.fromBot === true, first_name: 'Luca' },
      chat: {
        id: chatId,
        type: 'supergroup',
        title: input.title ?? 'Memora',
        is_forum: input.isForum !== false,
      },
      ...(input.threadId !== undefined ? { message_thread_id: input.threadId, is_topic_message: true } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
    },
  };
}

function topicCreatedMessage(threadId: number, name: string): Record<string, unknown> {
  nextUpdateId += 1;
  return {
    update_id: nextUpdateId,
    message: {
      message_id: nextUpdateId,
      from: { id: 42, is_bot: false, first_name: 'Luca' },
      chat: { id: -100123, type: 'supergroup', title: 'Memora', is_forum: true },
      message_thread_id: threadId,
      is_topic_message: true,
      forum_topic_created: { name },
    },
  };
}

function documentMessage(threadId: number): Record<string, unknown> {
  nextUpdateId += 1;
  return {
    update_id: nextUpdateId,
    message: {
      message_id: nextUpdateId,
      from: { id: 42, is_bot: false, first_name: 'Luca' },
      chat: { id: -100123, type: 'supergroup', title: 'Memora', is_forum: true },
      message_thread_id: threadId,
      is_topic_message: true,
      document: { file_id: 'doc-1', file_name: 'report.pdf', mime_type: 'application/pdf', file_size: 10 },
    },
  };
}

async function setupGroup(options: { inboundEnabled?: boolean } = {}) {
  const dataDir = await tempDir();
  const accounts = new TelegramStore({ dataDir });
  await accounts.load();
  const account = await accounts.createAccount({ label: 'Bot', chatId: '', token: '123:token' });
  const bindings = new TelegramBindingStore({ dataDir });
  await bindings.load();
  if (options.inboundEnabled !== false) {
    await bindings.update(account.id, {
      enabled: true,
      defaultProjectId: 'memora',
      defaultAgentProfileId: 'sviluppatore',
    });
  }
  const groups = new TelegramGroupStore({ dataDir });
  await groups.load();
  const transport = new FakeTransport();
  const projects = { list: vi.fn(async () => [
    { id: 'memora', name: 'Memora' },
    { id: 'lavoro', name: 'Lavoro' },
    { id: 'casa', name: 'Casa' },
  ]) };
  const sessions = new FakeSessions();
  const turns = new FakeTurns();
  const attachments = new FakeAttachments();
  const reads = { mark: vi.fn(async () => undefined) };
  const service = new TelegramInboundService({
    telegram: transport,
    accounts,
    bindings,
    groups,
    projects,
    turns,
    sessions,
    reads,
    attachments,
    log: vi.fn(),
    pollTimeoutSeconds: 0,
    maxBackoffMs: 50,
  });
  services.push(service);
  return { dataDir, accounts, account, bindings, groups, projects, transport, sessions, turns, attachments, reads, service };
}

async function waitForTurn(ctx: Awaited<ReturnType<typeof setupGroup>>, count = 1) {
  await vi.waitFor(() => expect(ctx.turns.started).toHaveLength(count));
  return ctx.turns.started[count - 1]!;
}

describe('Telegram group and forum topics', () => {
  it('associa il gruppo con un codice scope group senza autorizzare la DM', async () => {
    const ctx = await setupGroup();
    const pairing = await ctx.bindings.createPairingCode(ctx.account.id, 'group');
    ctx.transport.updates.push(groupMessage({ text: `/start ${pairing.code}` }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.groups.get(ctx.account.id, '-100123')).toBeDefined());
    expect(ctx.groups.get(ctx.account.id, '-100123')?.allowedUsers).toEqual(['42']);
    expect(ctx.groups.get(ctx.account.id, '-100123')?.showProjectInTopicTitle).toBe(true);
    expect(ctx.bindings.isAllowed(ctx.account.id, 42)).toBe(false);
    expect(ctx.bindings.get(ctx.account.id).pairing.active).toBe(false);
    expect(ctx.transport.sent.some(item => item.text.includes('Gruppo associato'))).toBe(true);
    await ctx.service.stop();
  });

  it('rifiuta il pairing se il bot non è amministratore con Manage Topics', async () => {
    const ctx = await setupGroup();
    const pairing = await ctx.bindings.createPairingCode(ctx.account.id, 'group');
    ctx.transport.chatMember = { status: 'member', isMember: true };
    ctx.transport.updates.push(groupMessage({ text: `/start ${pairing.code}` }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Manage Topics'))).toBe(true));
    expect(ctx.groups.get(ctx.account.id, '-100123')).toBeUndefined();
    await ctx.service.stop();
  });

  it('rifiuta il pairing se la privacy mode del bot è attiva', async () => {
    const ctx = await setupGroup();
    ctx.transport.getMe.mockResolvedValue({
      id: '1',
      firstName: 'Memora',
      username: 'memora_bot',
      canReadAllGroupMessages: false,
    });
    const pairing = await ctx.bindings.createPairingCode(ctx.account.id, 'group');
    ctx.transport.updates.push(groupMessage({ text: `/start ${pairing.code}` }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('privacy mode'))).toBe(true));
    expect(ctx.groups.get(ctx.account.id, '-100123')).toBeUndefined();
    await ctx.service.stop();
  });

  it('ignora un mittente non autorizzato del gruppo', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['99'],
    });
    ctx.transport.updates.push(groupMessage({ text: 'Ciao', userId: 42 }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.bindings.getOffset(ctx.account.id)).toBeGreaterThan(0));
    expect(ctx.transport.sent).toHaveLength(0);
    expect(ctx.sessions.created).toHaveLength(0);
    await ctx.service.stop();
  });

  it('crea la sessione General al primo messaggio e risponde nel topic corretto', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
    });
    ctx.transport.updates.push(groupMessage({ text: 'Ciao da General' }));
    await ctx.service.start();
    const turn = await waitForTurn(ctx);
    expect(ctx.sessions.created[0]).toMatchObject({ projectId: 'memora', agentProfileId: 'sviluppatore' });
    expect(ctx.groups.get(ctx.account.id, '-100123')?.generalSessionId).toBe(turn.sessionId);
    expect(ctx.groups.get(ctx.account.id, '-100123')?.generalPendingTurnId).toBe(turn.turnId);
    expect(ctx.transport.typing.every(item => item.threadId === undefined)).toBe(true);

    ctx.turns.running(turn.turnId);
    ctx.turns.complete(turn.turnId, 'completed', 'Risposta in General');
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Risposta in General'))).toBe(true));
    expect(ctx.transport.sent.find(item => item.text.includes('Risposta in General'))?.threadId).toBeUndefined();
    await vi.waitFor(() => expect(ctx.groups.get(ctx.account.id, '-100123')?.generalPendingTurnId).toBeUndefined());
    await vi.waitFor(() => expect(ctx.reads.mark).toHaveBeenCalledWith(turn.sessionId, turn.turnId));
    await ctx.service.stop();
  });

  it('tratta il thread_id 1 come General', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
    });
    ctx.transport.updates.push(groupMessage({ text: 'Messaggio in General', threadId: 1 }));
    await ctx.service.start();
    const turn = await waitForTurn(ctx);
    expect(ctx.groups.get(ctx.account.id, '-100123')?.generalSessionId).toBe(turn.sessionId);
    expect(ctx.groups.getTopic(ctx.account.id, '-100123', '1')).toBeUndefined();
    await ctx.service.stop();
  });

  it('recupera il progetto dei topic creati prima del metadata', async () => {
    const ctx = await setupGroup();
    ctx.sessions.addSession({ sessionId: 'sess_legacy', name: 'Legacy', projectId: 'casa' });
    ctx.sessions.agentProfiles.set('sess_legacy', 'sviluppatore');
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
    });
    await ctx.groups.putTopic(ctx.account.id, '-100123', { threadId: '55', sessionId: 'sess_legacy', title: 'Legacy' });
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.groups.getTopic(ctx.account.id, '-100123', '55')?.projectId).toBe('casa'));
    expect(ctx.groups.getTopic(ctx.account.id, '-100123', '55')?.agentProfileId).toBe('sviluppatore');
    await ctx.service.stop();
  });

  it('collega un topic creato manualmente e instrada messaggi, typing e risposta', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
    });
    ctx.transport.updates.push(topicCreatedMessage(55, 'Preventivo'));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.groups.getTopic(ctx.account.id, '-100123', '55')).toBeDefined());
    const topic = ctx.groups.getTopic(ctx.account.id, '-100123', '55');
    expect(topic?.title).toBe('Preventivo');
    expect(ctx.sessions.created).toHaveLength(1);

    ctx.transport.updates.push(groupMessage({ text: 'Prepara il preventivo', threadId: 55 }));
    const turn = await waitForTurn(ctx);
    expect(turn.sessionId).toBe(topic?.sessionId);
    expect(ctx.groups.getTopic(ctx.account.id, '-100123', '55')?.pendingTurnId).toBe(turn.turnId);

    ctx.turns.running(turn.turnId);
    await vi.waitFor(() => expect(ctx.transport.typing.some(item => item.threadId === 55)).toBe(true));
    ctx.turns.complete(turn.turnId, 'completed', 'Preventivo pronto');
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Preventivo pronto') && item.threadId === 55)).toBe(true));
    expect(ctx.transport.sent.some(item => item.text.includes('Preventivo pronto') && item.threadId === undefined)).toBe(false);
    await vi.waitFor(() => expect(ctx.groups.getTopic(ctx.account.id, '-100123', '55')?.pendingTurnId).toBeUndefined());
    await ctx.service.stop();
  });

  it('non risponde ai messaggi di servizio del forum', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
    });
    const update = groupMessage({ threadId: 55 });
    (update.message as Record<string, unknown>).forum_topic_closed = {};
    ctx.transport.updates.push(update);
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.bindings.getOffset(ctx.account.id)).toBeGreaterThan(0));
    expect(ctx.transport.sent).toHaveLength(0);
    await ctx.service.stop();
  });

  it('non rinomina un topic sconosciuto al primo messaggio', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
      showProjectInTopicTitle: true,
    });
    ctx.transport.updates.push(groupMessage({ text: 'Ciao', threadId: 77 }));
    await ctx.service.start();
    await waitForTurn(ctx);
    expect(ctx.groups.getTopic(ctx.account.id, '-100123', '77')).toMatchObject({ title: 'Topic 77', projectId: 'lavoro' });
    expect(ctx.transport.editedTopics.some(item => item.threadId === 77)).toBe(false);
    expect(ctx.transport.appliedIcons).toContainEqual({ chatId: '-100123', threadId: 77, icon: 'check-1' });
    await ctx.service.stop();
  });

  it('crea un nuovo topic e una sessione con /new da General', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
    });
    ctx.transport.updates.push(groupMessage({ text: '/new Preventivo' }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.createForumTopic).toHaveBeenCalledWith('-100123', 'Preventivo', ctx.account.id, { iconCustomEmojiId: 'check-1' }));
    await vi.waitFor(() => expect(ctx.groups.getTopic(ctx.account.id, '-100123', '51')).toBeDefined());
    const topic = ctx.groups.getTopic(ctx.account.id, '-100123', '51');
    expect(topic?.title).toBe('Preventivo');
    expect(ctx.sessions.created).toHaveLength(1);
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Topic creato') && item.threadId === undefined)).toBe(true));
    await ctx.service.stop();
  });

  it('registra il menu comandi nativo per i gruppi', async () => {
    const ctx = await setupGroup();
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.setMyCommands).toHaveBeenCalled());
    const [commands, accountId, options] = ctx.transport.setMyCommands.mock.calls[0] ?? [];
    expect(accountId).toBe(ctx.account.id);
    expect(options).toEqual({ scope: { type: 'all_group_chats' } });
    expect(commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'help' }),
      expect.objectContaining({ command: 'commands' }),
      expect.objectContaining({ command: 'new' }),
      expect.objectContaining({ command: 'projects' }),
      expect.objectContaining({ command: 'agents' }),
    ]));
    await ctx.service.stop();
  });

  it('mostra l’aiuto contestuale in General e in un topic', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
      showProjectInTopicTitle: true,
    });
    await ctx.groups.putTopic(ctx.account.id, '-100123', {
      threadId: '55',
      sessionId: 'sess_topic',
      title: 'Preventivo',
      projectId: 'casa',
    });
    ctx.sessions.addSession({ sessionId: 'sess_topic', name: 'Preventivo', projectId: 'casa' });
    ctx.transport.updates.push(groupMessage({ text: '/help' }), groupMessage({ text: '/commands', threadId: 55 }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Comandi del gruppo') && item.threadId === undefined)).toBe(true));
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Comandi del gruppo') && item.threadId === 55)).toBe(true));
    const general = ctx.transport.sent.find(item => item.text.includes('Comandi del gruppo') && item.threadId === undefined);
    const topic = ctx.transport.sent.find(item => item.text.includes('Comandi del gruppo') && item.threadId === 55);
    expect(general?.text).toContain('Lavoro');
    expect(general?.text).toContain('agents');
    expect(topic?.text).toContain('Preventivo');
    expect(topic?.text).toContain('Casa');
    expect(topic?.text).toContain('solo da General');
    await ctx.service.stop();
  });

  it('elenca i progetti disponibili', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
    });
    ctx.transport.updates.push(groupMessage({ text: '/projects' }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('lavoro') && item.text.includes('Casa'))).toBe(true));
    expect(ctx.transport.sent.some(item => item.text.includes('default'))).toBe(true);
    await ctx.service.stop();
  });

  it('crea un topic nel progetto scelto con /new e applica il prefisso', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
      showProjectInTopicTitle: true,
    });
    ctx.transport.updates.push(groupMessage({ text: '/new *casa Preventivo' }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.createForumTopic).toHaveBeenCalledWith('-100123', '[Casa] Preventivo', ctx.account.id, { iconCustomEmojiId: 'check-1' }));
    const topic = ctx.groups.getTopic(ctx.account.id, '-100123', ctx.transport.createdTopics[0]!.threadId);
    expect(topic).toMatchObject({ title: 'Preventivo', projectId: 'casa' });
    expect(ctx.sessions.created[0]).toMatchObject({ projectId: 'casa', agentProfileId: 'sviluppatore' });
    expect(ctx.groups.getTopic(ctx.account.id, '-100123', ctx.transport.createdTopics[0]!.threadId)?.agentProfileId).toBe('sviluppatore');
    expect(ctx.transport.appliedIcons).toContainEqual({ chatId: '-100123', threadId: Number(ctx.transport.createdTopics[0]!.threadId), icon: 'check-1' });
    expect(ctx.transport.sent.some(item => item.text.includes('Progetto: Casa'))).toBe(true);
    await ctx.service.stop();
  });

  it('crea un topic con progetto e agente espliciti', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
      defaultAgentProfileId: 'memo-base',
      showProjectInTopicTitle: true,
    });
    ctx.transport.updates.push(groupMessage({ text: '/new *casa [Sviluppatore] Preventivo' }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.groups.getTopic(ctx.account.id, '-100123', ctx.transport.createdTopics[0]!.threadId)).toBeDefined());
    const topic = ctx.groups.getTopic(ctx.account.id, '-100123', ctx.transport.createdTopics[0]!.threadId);
    expect(topic).toMatchObject({ title: 'Preventivo', projectId: 'casa', agentProfileId: 'sviluppatore' });
    expect(ctx.sessions.created[0]).toMatchObject({ projectId: 'casa', agentProfileId: 'sviluppatore' });
    expect(ctx.transport.sent.some(item => item.text.includes('Agente: Sviluppatore'))).toBe(true);
    await ctx.service.stop();
  });

  it('sceglie solo l’agente mantenendo il progetto predefinito', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
      defaultAgentProfileId: 'memo-base',
    });
    ctx.transport.updates.push(groupMessage({ text: '/new [Sviluppatore] Preventivo' }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.createdTopics).toHaveLength(1));
    const topic = ctx.groups.getTopic(ctx.account.id, '-100123', ctx.transport.createdTopics[0]!.threadId);
    expect(topic).toMatchObject({ title: 'Preventivo', projectId: 'lavoro', agentProfileId: 'sviluppatore' });
    expect(ctx.sessions.created[0]).toMatchObject({ projectId: 'lavoro', agentProfileId: 'sviluppatore' });
    await ctx.service.stop();
  });

  it('usa il progetto e l’agente predefiniti quando non specificati', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
      defaultAgentProfileId: 'memo-base',
    });
    ctx.transport.updates.push(groupMessage({ text: '/new Preventivo' }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.createdTopics).toHaveLength(1));
    const topic = ctx.groups.getTopic(ctx.account.id, '-100123', ctx.transport.createdTopics[0]!.threadId);
    expect(topic).toMatchObject({ title: 'Preventivo', projectId: 'lavoro', agentProfileId: 'memo-base' });
    expect(ctx.sessions.created[0]).toMatchObject({ projectId: 'lavoro', agentProfileId: 'memo-base' });
    await ctx.service.stop();
  });

  it('elenca i profili agente e rifiuta un agente sconosciuto', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
    });
    ctx.transport.updates.push(groupMessage({ text: '/agents' }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('sviluppatore') && item.text.includes('Sviluppatore'))).toBe(true));

    ctx.transport.updates.push(groupMessage({ text: '/new [Agente inesistente] Titolo' }));
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Profilo agente non trovato'))).toBe(true));
    expect(ctx.transport.createdTopics).toHaveLength(0);
    await ctx.service.stop();
  });

  it('usa il progetto predefinito del gruppo per /new senza progetto', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
      showProjectInTopicTitle: true,
    });
    ctx.transport.updates.push(groupMessage({ text: '/new Preventivo' }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.createForumTopic).toHaveBeenCalledWith('-100123', '[Lavoro] Preventivo', ctx.account.id, { iconCustomEmojiId: 'check-1' }));
    const topic = ctx.groups.getTopic(ctx.account.id, '-100123', ctx.transport.createdTopics[0]!.threadId);
    expect(topic).toMatchObject({ title: 'Preventivo', projectId: 'lavoro' });
    await ctx.service.stop();
  });

  it('non aggiunge il prefisso quando il gruppo lo disabilita', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'casa',
      showProjectInTopicTitle: false,
    });
    ctx.transport.updates.push(groupMessage({ text: '/new Preventivo' }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.createForumTopic).toHaveBeenCalledWith('-100123', 'Preventivo', ctx.account.id, { iconCustomEmojiId: 'check-1' }));
    const topic = ctx.groups.getTopic(ctx.account.id, '-100123', ctx.transport.createdTopics[0]!.threadId);
    expect(topic?.projectId).toBe('casa');
    await ctx.service.stop();
  });

  it('applica il prefisso a un topic creato manualmente', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'casa',
      showProjectInTopicTitle: true,
    });
    ctx.transport.updates.push(topicCreatedMessage(55, 'Spese'));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.editedTopics).toContainEqual({ chatId: '-100123', threadId: 55, name: '[Casa] Spese' }));
    expect(ctx.groups.getTopic(ctx.account.id, '-100123', '55')).toMatchObject({ title: 'Spese', projectId: 'casa' });
    expect(ctx.sessions.created[0]).toMatchObject({ projectId: 'casa', agentProfileId: 'sviluppatore' });
    expect(ctx.groups.getTopic(ctx.account.id, '-100123', '55')?.agentProfileId).toBe('sviluppatore');
    expect(ctx.transport.appliedIcons).toContainEqual({ chatId: '-100123', threadId: 55, icon: 'check-1' });
    await ctx.service.stop();
  });

  it('rimuove il prefisso quando il titolo del topic viene modificato a mano', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'casa',
      showProjectInTopicTitle: true,
    });
    ctx.sessions.addSession({ sessionId: 'sess_topic', name: 'Spese' });
    await ctx.groups.putTopic(ctx.account.id, '-100123', {
      threadId: '55',
      sessionId: 'sess_topic',
      title: 'Spese',
      projectId: 'casa',
    });
    const update = groupMessage({ threadId: 55 });
    (update.message as Record<string, unknown>).forum_topic_edited = { name: '[Casa] Spese nuove' };
    ctx.transport.updates.push(update);
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.groups.getTopic(ctx.account.id, '-100123', '55')?.title).toBe('Spese nuove'));
    await ctx.service.stop();
  });

  it('rinomina sessione e topic mantenendo il prefisso del progetto', async () => {
    const ctx = await setupGroup();
    ctx.sessions.addSession({ sessionId: 'sess_topic', name: 'Vecchio titolo', messageCount: 2 });
    ctx.sessions.messages.set('sess_topic', [{ role: 'user', content: 'Ciao' }]);
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
      showProjectInTopicTitle: true,
    });
    await ctx.groups.putTopic(ctx.account.id, '-100123', {
      threadId: '55',
      sessionId: 'sess_topic',
      title: 'Vecchio titolo',
      projectId: 'casa',
    });
    ctx.transport.updates.push(groupMessage({ text: '/rename Nuovo titolo', threadId: 55 }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.editedTopics).toContainEqual({ chatId: '-100123', threadId: 55, name: '[Casa] Nuovo titolo' }));
    expect(ctx.groups.getTopic(ctx.account.id, '-100123', '55')?.title).toBe('Nuovo titolo');
    expect(ctx.transport.appliedIcons).toContainEqual({ chatId: '-100123', threadId: 55, icon: 'check-1' });
    await ctx.service.stop();
  });

  it('riallinea i titoli dei topic esistenti', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
      showProjectInTopicTitle: true,
    });
    ctx.sessions.addSession({ sessionId: 'sess_lavoro', name: 'Preventivo' });
    ctx.sessions.addSession({ sessionId: 'sess_casa', name: 'Spese' });
    await ctx.groups.putTopic(ctx.account.id, '-100123', { threadId: '55', sessionId: 'sess_lavoro', title: 'Preventivo', projectId: 'lavoro' });
    await ctx.groups.putTopic(ctx.account.id, '-100123', { threadId: '56', sessionId: 'sess_casa', title: 'Spese', projectId: 'casa' });
    await expect(ctx.service.syncGroupTopicTitles(ctx.account.id, '-100123')).resolves.toEqual({ updated: 2, failed: 0 });
    expect(ctx.transport.editedTopics).toEqual([
      { chatId: '-100123', threadId: 55, name: '[Lavoro] Preventivo' },
      { chatId: '-100123', threadId: 56, name: '[Casa] Spese' },
    ]);
    expect(ctx.transport.appliedIcons).toEqual([
      { chatId: '-100123', threadId: 55, icon: 'check-1' },
      { chatId: '-100123', threadId: 56, icon: 'check-1' },
    ]);
    await ctx.service.stop();
  });

  it('rifiuta /new dentro un topic secondario', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
    });
    await ctx.groups.putTopic(ctx.account.id, '-100123', { threadId: '55', sessionId: 'sess_topic', title: 'Topic', titleSource: 'manual' });
    ctx.transport.updates.push(groupMessage({ text: '/new Altro', threadId: 55 }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Crea nuove sessioni') && item.threadId === 55)).toBe(true));
    expect(ctx.transport.createForumTopic).not.toHaveBeenCalled();
    await ctx.service.stop();
  });

  it('rinomina sessione e topic con /rename', async () => {
    const ctx = await setupGroup();
    ctx.sessions.addSession({ sessionId: 'sess_topic', name: 'Vecchio titolo', messageCount: 2 });
    ctx.sessions.messages.set('sess_topic', [{ role: 'user', content: 'Ciao' }]);
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
    });
    await ctx.groups.putTopic(ctx.account.id, '-100123', { threadId: '55', sessionId: 'sess_topic', title: 'Vecchio titolo', titleSource: 'manual' });
    ctx.transport.updates.push(groupMessage({ text: '/rename Nuovo titolo', threadId: 55 }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.editedTopics).toContainEqual({ chatId: '-100123', threadId: 55, name: 'Nuovo titolo' }));
    expect(ctx.sessions.renames).toContainEqual({ sessionId: 'sess_topic', title: 'Nuovo titolo' });
    expect(ctx.groups.getTopic(ctx.account.id, '-100123', '55')?.title).toBe('Nuovo titolo');
    expect(ctx.transport.appliedIcons).toContainEqual({ chatId: '-100123', threadId: 55, icon: 'check-1' });
    await ctx.service.stop();
  });

  it('elenca le sessioni del gruppo e apre il topic con /switch', async () => {
    const ctx = await setupGroup();
    ctx.sessions.addSession({ sessionId: 'sess_general', name: 'General' });
    ctx.sessions.addSession({ sessionId: 'sess_topic', name: 'Preventivo' });
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      generalSessionId: 'sess_general',
    });
    await ctx.groups.putTopic(ctx.account.id, '-100123', { threadId: '55', sessionId: 'sess_topic', title: 'Preventivo', titleSource: 'manual' });
    ctx.transport.updates.push(groupMessage({ text: '/sessions' }), groupMessage({ text: '/switch 2' }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Sessioni del gruppo'))).toBe(true));
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('https://t.me/c/123/55'))).toBe(true));
    await ctx.service.stop();
  });

  it('interrompe il turno del topic con /stop senza rispondere in General', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
    });
    await ctx.groups.putTopic(ctx.account.id, '-100123', { threadId: '55', sessionId: 'sess_topic', title: 'Topic', titleSource: 'manual' });
    ctx.sessions.addSession({ sessionId: 'sess_topic', name: 'Topic' });
    ctx.transport.updates.push(groupMessage({ text: 'Risposta lunga', threadId: 55 }));
    await ctx.service.start();
    const turn = await waitForTurn(ctx);
    ctx.turns.running(turn.turnId);
    await vi.waitFor(() => expect(ctx.transport.typing.some(item => item.threadId === 55)).toBe(true));

    ctx.transport.updates.push(groupMessage({ text: '/stop', threadId: 55 }));
    await vi.waitFor(() => expect(ctx.turns.getTurn(turn.turnId)?.status).toBe('aborted'));
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('interrotta') && item.threadId === 55)).toBe(true));
    await ctx.service.stop();
  });

  it('scarica un allegato nel topic e lo passa al turno', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
    });
    await ctx.groups.putTopic(ctx.account.id, '-100123', { threadId: '55', sessionId: 'sess_topic', title: 'Topic', titleSource: 'manual' });
    ctx.sessions.addSession({ sessionId: 'sess_topic', name: 'Topic' });
    ctx.transport.updates.push(documentMessage(55));
    await ctx.service.start();
    const turn = await waitForTurn(ctx);
    expect(turn.attachments).toHaveLength(1);
    expect(ctx.attachments.saved[0]).toMatchObject({ sessionId: 'sess_topic', filename: 'report.pdf' });
    ctx.turns.running(turn.turnId);
    ctx.turns.complete(turn.turnId, 'completed', 'Documento analizzato');
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Documento analizzato') && item.threadId === 55)).toBe(true));
    await ctx.service.stop();
  });

  it('mantiene il progetto del topic quando la sessione viene sostituita', async () => {
    const ctx = await setupGroup();
    ctx.sessions.addSession({ sessionId: 'sess_archived', name: 'Archiviata' });
    ctx.sessions.archived.add('sess_archived');
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      defaultProjectId: 'lavoro',
      showProjectInTopicTitle: true,
    });
    await ctx.groups.putTopic(ctx.account.id, '-100123', {
      threadId: '55',
      sessionId: 'sess_archived',
      title: 'Spese',
      projectId: 'casa',
    });
    ctx.transport.updates.push(groupMessage({ text: 'Continuiamo', threadId: 55 }));
    await ctx.service.start();
    const turn = await waitForTurn(ctx);
    expect(ctx.sessions.created[0]).toMatchObject({ projectId: 'casa' });
    expect(ctx.groups.getTopic(ctx.account.id, '-100123', '55')).toMatchObject({ sessionId: turn.sessionId, projectId: 'casa' });
    await ctx.service.stop();
  });

  it('invia gli artefatti del turno nel topic', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
    });
    ctx.transport.updates.push(groupMessage({ text: 'Prepara un PDF', threadId: 55 }));
    await ctx.service.start();
    const turn = await waitForTurn(ctx);
    ctx.sessions.artifacts.set(turn.sessionId, [{ id: 'art_pdf', name: 'report.pdf', kind: 'pdf', createdAt: Date.now() }]);
    ctx.turns.running(turn.turnId);
    ctx.turns.complete(turn.turnId, 'completed', 'Documento pronto');
    await vi.waitFor(() => expect(ctx.transport.documents).toHaveLength(1));
    expect(ctx.transport.documents[0]).toMatchObject({ filename: 'report.pdf', threadId: 55 });
    await ctx.service.stop();
  });

  it('avvisa in General un turno interrotto dopo il riavvio', async () => {
    const ctx = await setupGroup();
    ctx.sessions.addSession({ sessionId: 'sess_general', name: 'General' });
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
      generalSessionId: 'sess_general',
    });
    const turnId = ctx.turns.addInterrupted('sess_general');
    await ctx.groups.updateGeneralTurn(ctx.account.id, '-100123', { pendingTurnId: turnId });
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('interrotta da un riavvio') && item.threadId === undefined)).toBe(true));
    expect(ctx.groups.get(ctx.account.id, '-100123')?.generalPendingTurnId).toBeUndefined();
    await ctx.service.stop();
  });

  it('avvisa nel topic un turno interrotto dopo il riavvio', async () => {
    const ctx = await setupGroup();
    await ctx.groups.upsert(ctx.account.id, {
      chatId: '-100123',
      title: 'Memora',
      isForum: true,
      allowedUsers: ['42'],
    });
    await ctx.groups.putTopic(ctx.account.id, '-100123', { threadId: '55', sessionId: 'sess_restart', title: 'Restart', titleSource: 'manual' });
    const turnId = ctx.turns.addInterrupted('sess_restart');
    await ctx.groups.updateTopicTurn(ctx.account.id, '-100123', '55', { pendingTurnId: turnId });
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('interrotta da un riavvio') && item.threadId === 55)).toBe(true));
    expect(ctx.groups.getTopic(ctx.account.id, '-100123', '55')?.pendingTurnId).toBeUndefined();
    await ctx.service.stop();
  });
});
