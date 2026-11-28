import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment, ChatAttachmentContext, StreamEvent } from '@memora/shared';
import type { TelegramBotInfo } from './telegram.js';
import { TelegramError, TelegramStore } from './telegram.js';
import { TelegramBindingStore } from './telegram-bindings.js';
import { TurnManager } from './turn-manager.js';
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-telegram-chat-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.stop()));
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

class FakeTransport implements TelegramInboundTransport {
  updates: Array<Record<string, unknown>> = [];
  sent: Array<{ chatId: string; text: string; accountId?: string }> = [];
  documents: Array<{ chatId: string; filename: string; accountId?: string }> = [];
  typing: Array<{ chatId: string; accountId?: string }> = [];
  fileBuffer = Buffer.from('file-content');
  getFile = vi.fn(async (fileId: string) => ({ fileId, filePath: 'files/allegato', size: this.fileBuffer.byteLength }));
  downloadFile = vi.fn(async () => this.fileBuffer);
  getMe = vi.fn(async (): Promise<TelegramBotInfo> => ({ id: '1', firstName: 'Memora', username: 'memora_bot' }));
  getUpdates = vi.fn(async (_accountId: string | undefined, options: { signal?: AbortSignal }): Promise<Array<Record<string, unknown>>> => {
    if (this.updates.length > 0) return this.updates.splice(0);
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 5);
      options.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    return [];
  });
  sendTo = vi.fn(async (chatId: string, text: string, accountId?: string) => {
    this.sent.push({ chatId, text, accountId });
  });
  sendDocumentTo = vi.fn(async (chatId: string, document: { filename: string }, accountId?: string) => {
    this.documents.push({ chatId, filename: document.filename, accountId });
  });
  sendChatAction = vi.fn(async (chatId: string, _action: string, accountId?: string) => {
    this.typing.push({ chatId, accountId });
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
    if (status === 'failed') turn.error = 'Errore simulato';
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
    return { sessionId, name };
  }

  async listArtifacts(sessionId: string): Promise<TelegramInboundArtifactInfo[]> {
    return this.artifacts.get(sessionId) ?? [];
  }

  async getArtifact(sessionId: string, artifactId: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
    void sessionId;
    const artifact = (this.artifacts.get(sessionId) ?? []).find(item => item.id === artifactId);
    return {
      name: artifact?.name ?? 'report.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF'),
    };
  }
}

class FakeAttachments {
  readonly saved: Array<{ sessionId: string; filename: string; size: number }> = [];
  save = vi.fn(async (sessionId: string, input: { filename: string; data: Buffer }): Promise<ChatAttachment> => {
    this.saved.push({ sessionId, filename: input.filename, size: input.data.byteLength });
    const image = /\.(png|jpe?g|webp|gif|svg)$/i.test(input.filename);
    return {
      id: 'att_1',
      filename: input.filename,
      mimeType: image ? 'image/jpeg' : 'application/octet-stream',
      size: input.data.byteLength,
      kind: image ? 'image' : 'text',
    };
  });
  toModelContext = vi.fn(async (attachment: ChatAttachment & { buffer: Buffer }): Promise<ChatAttachmentContext> => ({
    ...attachment,
    ...(attachment.kind === 'image' ? { imageData: 'aW1tYWdpbmU=' } : { text: 'contenuto allegato' }),
  }));
}

let nextUpdateId = 200;

function messageUpdate(text: string): Record<string, unknown> {
  nextUpdateId += 1;
  return {
    update_id: nextUpdateId,
    message: {
      message_id: nextUpdateId,
      from: { id: 42, is_bot: false, first_name: 'Luca' },
      chat: { id: 42, type: 'private', first_name: 'Luca' },
      text,
    },
  };
}

function updateId(update: Record<string, unknown>): number {
  return Number(update.update_id);
}

function baseMessage(extra: Record<string, unknown>): Record<string, unknown> {
  nextUpdateId += 1;
  return {
    update_id: nextUpdateId,
    message: {
      message_id: nextUpdateId,
      from: { id: 42, is_bot: false, first_name: 'Luca' },
      chat: { id: 42, type: 'private', first_name: 'Luca' },
      ...extra,
    },
  };
}

function photoMessage(caption?: string): Record<string, unknown> {
  return baseMessage({
    photo: [{ file_id: 'photo-1', file_unique_id: 'u1', width: 800, height: 600, file_size: 12 }],
    ...(caption ? { caption } : {}),
  });
}

function documentMessage(input: {
  fileName: string;
  mimeType?: string;
  fileSize?: number;
  caption?: string;
}): Record<string, unknown> {
  return baseMessage({
    document: {
      file_id: 'document-1',
      file_unique_id: 'u2',
      file_name: input.fileName,
      mime_type: input.mimeType ?? 'application/pdf',
      ...(input.fileSize !== undefined ? { file_size: input.fileSize } : {}),
    },
    ...(input.caption ? { caption: input.caption } : {}),
  });
}

function voiceMessage(): Record<string, unknown> {
  return baseMessage({ voice: { file_id: 'voice-1', duration: 3 } });
}

async function setupConversation(options: { turns?: TelegramInboundTurns } = {}) {
  const dataDir = await tempDir();
  const accounts = new TelegramStore({ dataDir });
  await accounts.load();
  const account = await accounts.createAccount({ label: 'Bot', chatId: '', token: '123:token' });
  const bindings = new TelegramBindingStore({ dataDir });
  await bindings.load();
  await bindings.update(account.id, {
    enabled: true,
    defaultProjectId: 'memora',
    defaultAgentProfileId: 'sviluppatore',
  });
  await bindings.addAllowedUser(account.id, { id: 42, label: 'Luca' });
  const transport = new FakeTransport();
  const sessions = new FakeSessions();
  const turns = new FakeTurns();
  const serviceTurns = options.turns ?? turns;
  const attachments = new FakeAttachments();
  const reads = { mark: vi.fn(async () => undefined) };
  const service = new TelegramInboundService({
    telegram: transport,
    accounts,
    bindings,
    turns: serviceTurns,
    sessions,
    reads,
    attachments,
    log: vi.fn(),
    pollTimeoutSeconds: 0,
    maxBackoffMs: 50,
  });
  services.push(service);
  return { dataDir, account, accounts, bindings, transport, sessions, turns, attachments, reads, service };
}

async function waitForTurn(ctx: Awaited<ReturnType<typeof setupConversation>>, count = 1) {
  await vi.waitFor(() => expect(ctx.turns.started).toHaveLength(count));
  return ctx.turns.started[count - 1]!;
}

describe('Telegram conversation bridge', () => {
  it('usa il TurnManager reale con la stessa sessione', async () => {
    const manager = new TurnManager({
      maxConcurrent: 1,
      agentService: {
        sendMessage: async (sessionId: string, _text: string, onEvent) => {
          onEvent({ type: 'message_start', sessionId, timestamp: Date.now(), payload: {} });
          onEvent({
            type: 'message_update',
            sessionId,
            timestamp: Date.now(),
            payload: { assistantMessageEvent: { type: 'text_delta', delta: 'Risposta dal TurnManager' } },
          });
        },
        abort: async () => undefined,
      },
    });
    const ctx = await setupConversation({ turns: manager });
    ctx.transport.updates.push(messageUpdate('Ciao'));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('TurnManager'))).toBe(true));
    await vi.waitFor(() => expect(ctx.reads.mark).toHaveBeenCalled());
    await ctx.service.stop();
  });

  it('crea una sessione con i default e invia la risposta finale', async () => {
    const ctx = await setupConversation();
    const update = messageUpdate('Ciao');
    ctx.transport.updates.push(update);
    await ctx.service.start();
    const turn = await waitForTurn(ctx);
    expect(ctx.sessions.created[0]).toMatchObject({ projectId: 'memora', agentProfileId: 'sviluppatore' });
    expect(ctx.bindings.getBinding(ctx.account.id, 42)?.sessionId).toBe(turn.sessionId);
    await vi.waitFor(() => expect(ctx.bindings.getBinding(ctx.account.id, 42)?.pendingTurnId).toBe(turn.turnId));
    expect(ctx.service.isIdle()).toBe(false);

    ctx.turns.running(turn.turnId);
    await vi.waitFor(() => expect(ctx.transport.typing.length).toBeGreaterThan(0));
    ctx.turns.complete(turn.turnId, 'completed', 'Ecco la **risposta**.');

    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('risposta'))).toBe(true));
    await vi.waitFor(() => expect(ctx.reads.mark).toHaveBeenCalledWith(turn.sessionId, turn.turnId));
    await vi.waitFor(() => expect(ctx.bindings.getBinding(ctx.account.id, 42)?.pendingTurnId).toBeUndefined());
    await vi.waitFor(() => expect(ctx.service.isIdle()).toBe(true));
    await vi.waitFor(() => expect(ctx.bindings.getOffset(ctx.account.id)).toBe(updateId(update) + 1));
    await ctx.service.stop();
  });

  it('crea una nuova sessione con /new e applica il titolo dopo il primo turno', async () => {
    const ctx = await setupConversation();
    ctx.transport.updates.push(messageUpdate('/new Titolo personalizzato'));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.sessions.created).toHaveLength(1));
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Nuova sessione'))).toBe(true));
    const sessionId = [...ctx.sessions.sessions.keys()][0]!;

    ctx.transport.updates.push(messageUpdate('Primo messaggio'));
    await vi.waitFor(() => expect(ctx.turns.started).toHaveLength(1));
    const turn = ctx.turns.started[0]!;
    ctx.sessions.messages.set(turn.sessionId, [
      { role: 'user', content: 'Primo messaggio' },
      { role: 'assistant', content: 'Risposta' },
    ]);
    ctx.turns.running(turn.turnId);
    ctx.turns.complete(turn.turnId, 'completed', 'Risposta');
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Risposta'))).toBe(true));
    await vi.waitFor(() => expect(ctx.sessions.renames).toContainEqual({ sessionId, title: 'Titolo personalizzato' }));
    await ctx.service.stop();
  });

  it('elenca le sessioni e cambia sessione con /switch', async () => {
    const ctx = await setupConversation();
    ctx.sessions.addSession({ sessionId: 'sess_old', name: 'Vecchia', messageCount: 3, modified: new Date(1_000) });
    ctx.sessions.addSession({ sessionId: 'sess_new', name: 'Nuova', messageCount: 7, modified: new Date(2_000) });
    await ctx.bindings.setBinding(ctx.account.id, { userId: '42', chatId: '42', sessionId: 'sess_old' });
    ctx.transport.updates.push(messageUpdate('/sessions'));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Vecchia'))).toBe(true));

    ctx.transport.updates.push(messageUpdate('/switch 1'));
    await vi.waitFor(() => expect(ctx.bindings.getBinding(ctx.account.id, 42)?.sessionId).toBe('sess_new'));
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Sessione attiva'))).toBe(true));
    await ctx.service.stop();
  });

  it('interrompe un turno con /stop', async () => {
    const ctx = await setupConversation();
    ctx.transport.updates.push(messageUpdate('Risposta lunga'));
    await ctx.service.start();
    const turn = await waitForTurn(ctx);
    ctx.turns.running(turn.turnId);
    await vi.waitFor(() => expect(ctx.transport.typing.length).toBeGreaterThan(0));

    ctx.transport.updates.push(messageUpdate('/stop'));
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('interrotta'))).toBe(true));
    expect(ctx.turns.getTurn(turn.turnId)?.status).toBe('aborted');
    await ctx.service.stop();
  });

  it('mostra e rinomina la sessione corrente', async () => {
    const ctx = await setupConversation();
    ctx.sessions.addSession({ sessionId: 'sess_current', name: 'Titolo attuale', messageCount: 2 });
    ctx.sessions.messages.set('sess_current', [
      { role: 'user', content: 'Ciao' },
      { role: 'assistant', content: 'Risposta' },
    ]);
    await ctx.bindings.setBinding(ctx.account.id, { userId: '42', chatId: '42', sessionId: 'sess_current' });

    ctx.transport.updates.push(messageUpdate('/current'));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Titolo attuale'))).toBe(true));

    ctx.transport.updates.push(messageUpdate('/rename Titolo nuovo'));
    await vi.waitFor(() => expect(ctx.sessions.renames).toContainEqual({ sessionId: 'sess_current', title: 'Titolo nuovo' }));
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Sessione rinominata'))).toBe(true));
    await ctx.service.stop();
  });

  it('scarica una foto e la passa al turno', async () => {
    const ctx = await setupConversation();
    ctx.transport.fileBuffer = Buffer.from('jpeg-bytes');
    ctx.transport.updates.push(photoMessage('Cosa vedi?'));
    await ctx.service.start();
    const turn = await waitForTurn(ctx);
    expect(turn.text).toBe('Cosa vedi?');
    expect(turn.attachments).toHaveLength(1);
    expect(turn.attachments[0]).toMatchObject({ kind: 'image' });
    expect(ctx.attachments.saved[0]).toMatchObject({ sessionId: turn.sessionId });
    expect(ctx.attachments.saved[0]?.filename).toMatch(/^foto-.*\.jpg$/);
    ctx.turns.running(turn.turnId);
    ctx.turns.complete(turn.turnId, 'completed', 'Ho visto l’immagine.');
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('immagine'))).toBe(true));
    await ctx.service.stop();
  });

  it('allega un PDF e usa un prompt predefinito senza didascalia', async () => {
    const ctx = await setupConversation();
    ctx.transport.updates.push(documentMessage({ fileName: 'report.pdf' }));
    await ctx.service.start();
    const turn = await waitForTurn(ctx);
    expect(turn.text).toBe('Analizza il documento allegato.');
    expect(turn.attachments).toHaveLength(1);
    expect(ctx.attachments.saved[0]).toMatchObject({ sessionId: turn.sessionId, filename: 'report.pdf' });
    await ctx.service.stop();
  });

  it('rifiuta un formato non supportato senza creare sessioni', async () => {
    const ctx = await setupConversation();
    ctx.transport.updates.push(documentMessage({ fileName: 'report.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Formato non supportato'))).toBe(true));
    expect(ctx.sessions.created).toHaveLength(0);
    expect(ctx.turns.started).toHaveLength(0);
    await ctx.service.stop();
  });

  it('rifiuta un allegato oltre 15 MB prima del download', async () => {
    const ctx = await setupConversation();
    ctx.transport.updates.push(documentMessage({ fileName: 'report.pdf', fileSize: 16 * 1024 * 1024 }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('15 MB'))).toBe(true));
    expect(ctx.transport.getFile).not.toHaveBeenCalled();
    expect(ctx.sessions.created).toHaveLength(0);
    await ctx.service.stop();
  });

  it('rifiuta vocali e video con una spiegazione', async () => {
    const ctx = await setupConversation();
    ctx.transport.updates.push(voiceMessage());
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Vocali'))).toBe(true));
    expect(ctx.sessions.created).toHaveLength(0);
    await ctx.service.stop();
  });

  it('gestisce un errore di download senza avviare il turno', async () => {
    const ctx = await setupConversation();
    ctx.transport.downloadFile.mockRejectedValueOnce(new TelegramError('telegram_file_download_failed', 'download failed', 502));
    ctx.transport.updates.push(documentMessage({ fileName: 'report.pdf' }));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('scaricare'))).toBe(true));
    expect(ctx.turns.started).toHaveLength(0);
    expect(ctx.sessions.created).toHaveLength(0);
    await ctx.service.stop();
  });

  it('avvisa una volta dopo un riavvio di un turno interrotto', async () => {
    const ctx = await setupConversation();
    ctx.sessions.addSession({ sessionId: 'sess_restart', name: 'Ripresa' });
    const turnId = ctx.turns.addInterrupted('sess_restart');
    await ctx.bindings.setBinding(ctx.account.id, { userId: '42', chatId: '42', sessionId: 'sess_restart' });
    await ctx.bindings.updateBinding(ctx.account.id, 42, { pendingTurnId: turnId });

    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('interrotta da un riavvio'))).toBe(true));
    expect(ctx.bindings.getBinding(ctx.account.id, 42)?.pendingTurnId).toBeUndefined();
    await ctx.service.stop();
  });

  it('blocca una sessione archiviata senza crearne una nuova', async () => {
    const ctx = await setupConversation();
    ctx.sessions.addSession({ sessionId: 'sess_archived', name: 'Archiviata' });
    ctx.sessions.archived.add('sess_archived');
    await ctx.bindings.setBinding(ctx.account.id, { userId: '42', chatId: '42', sessionId: 'sess_archived' });

    ctx.transport.updates.push(messageUpdate('Continuiamo'));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('archiviata'))).toBe(true));
    expect(ctx.sessions.created).toHaveLength(0);
    expect(ctx.turns.started).toHaveLength(0);
    expect(ctx.bindings.getBinding(ctx.account.id, 42)?.sessionId).toBe('sess_archived');
    await ctx.service.stop();
  });

  it('invia gli artefatti creati nel turno e segna la risposta come letta', async () => {
    const ctx = await setupConversation();
    ctx.transport.updates.push(messageUpdate('Prepara un PDF'));
    await ctx.service.start();
    const turn = await waitForTurn(ctx);
    ctx.sessions.artifacts.set(turn.sessionId, [{ id: 'art_1', name: 'report.pdf', kind: 'pdf', createdAt: Date.now() }]);
    ctx.turns.running(turn.turnId);
    ctx.turns.complete(turn.turnId, 'completed', 'Documento pronto.');
    await vi.waitFor(() => expect(ctx.transport.documents).toHaveLength(1));
    expect(ctx.transport.documents[0]).toMatchObject({ filename: 'report.pdf' });
    await vi.waitFor(() => expect(ctx.reads.mark).toHaveBeenCalledWith(turn.sessionId, turn.turnId));
    await ctx.service.stop();
  });

  it('non segna come letta una risposta fallita', async () => {
    const ctx = await setupConversation();
    ctx.transport.updates.push(messageUpdate('Errore'));
    await ctx.service.start();
    const turn = await waitForTurn(ctx);
    ctx.turns.running(turn.turnId);
    ctx.turns.complete(turn.turnId, 'failed');
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('non completata'))).toBe(true));
    expect(ctx.reads.mark).not.toHaveBeenCalled();
    await ctx.service.stop();
  });

  it('chiede di inviare un messaggio prima di rinominare una bozza', async () => {
    const ctx = await setupConversation();
    ctx.sessions.addSession({ sessionId: 'sess_draft', firstMessage: '', messageCount: 0 });
    await ctx.bindings.setBinding(ctx.account.id, { userId: '42', chatId: '42', sessionId: 'sess_draft' });
    ctx.transport.updates.push(messageUpdate('/rename Nuovo titolo'));
    await ctx.service.start();
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Invia prima un messaggio'))).toBe(true));
    await ctx.service.stop();
  });
});
