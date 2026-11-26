import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramStore } from './telegram.js';
import { TelegramBindingStore } from './telegram-bindings.js';
import { TelegramShareStore } from './telegram-shares.js';
import { TelegramMirrorService, type TelegramMirrorSessionService } from './telegram-mirror.js';
import type { TurnCompletion } from './turn-manager.js';

const dirs: string[] = [];
const mirrors: TelegramMirrorService[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-telegram-mirror-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(mirrors.splice(0).map(mirror => mirror.stop()));
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

class FakeTransport {
  sent: Array<{ chatId: string; text: string; accountId?: string }> = [];
  documents: Array<{ chatId: string; filename: string; accountId?: string }> = [];
  sendTo = vi.fn(async (chatId: string, text: string, accountId?: string) => {
    this.sent.push({ chatId, text, accountId });
  });
  sendDocumentTo = vi.fn(async (chatId: string, document: { filename: string }, accountId?: string) => {
    this.documents.push({ chatId, filename: document.filename, accountId });
  });
}

class FakeSessions implements TelegramMirrorSessionService {
  messages = new Map<string, Array<{ role: string; content: string }>>();
  artifacts = new Map<string, Array<{ id: string; name: string; kind: string; createdAt: number }>>();
  async getSessionMessages(sessionId: string) { return this.messages.get(sessionId) ?? []; }
  async listArtifacts(sessionId: string) { return this.artifacts.get(sessionId) ?? []; }
  async getArtifact(sessionId: string, artifactId: string) {
    const artifact = (this.artifacts.get(sessionId) ?? []).find(item => item.id === artifactId);
    return { name: artifact?.name ?? 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') };
  }
}

function completion(input: {
  sessionId?: string;
  turnId?: string;
  source?: 'web' | 'telegram';
  status?: 'completed' | 'failed' | 'aborted' | 'interrupted';
  text?: string;
  request?: string;
  createdAt?: number;
  error?: string;
} = {}): TurnCompletion {
  const createdAt = input.createdAt ?? Date.now();
  return {
    turn: {
      turnId: input.turnId ?? 'turn-1',
      sessionId: input.sessionId ?? 'sess_1',
      status: input.status ?? 'completed',
      createdAt,
      updatedAt: createdAt,
      firstSeq: 1,
      lastSeq: 1,
      source: input.source ?? 'web',
      text: input.request ?? 'Ciao',
      ...(input.error ? { error: input.error } : {}),
    },
    text: input.text ?? 'Risposta finale',
  };
}

async function setup() {
  const dataDir = await tempDir();
  const accounts = new TelegramStore({ dataDir });
  await accounts.load();
  const account = await accounts.createAccount({ label: 'Bot', chatId: '42', token: '123:token' });
  const bindings = new TelegramBindingStore({ dataDir });
  await bindings.load();
  await bindings.update(account.id, { enabled: true });
  await bindings.addAllowedUser(account.id, { id: 42, label: 'Luca' });
  await bindings.setBinding(account.id, { userId: '42', chatId: '42', sessionId: 'sess_1' });
  const shares = new TelegramShareStore({ dataDir });
  await shares.load();
  await shares.set('sess_1', { accountId: account.id, userId: '42', chatId: '42', mode: 'answers' });
  const transport = new FakeTransport();
  const sessions = new FakeSessions();
  const reads = { mark: vi.fn(async () => undefined) };
  const mirror = new TelegramMirrorService({ telegram: transport, shares, sessions, accounts, bindings, reads, log: vi.fn() });
  mirrors.push(mirror);
  return { dataDir, account, accounts, bindings, shares, transport, sessions, reads, mirror };
}

async function waitIdle(mirror: TelegramMirrorService): Promise<void> {
  await vi.waitFor(() => expect(mirror.isIdle()).toBe(true));
}

describe('TelegramMirrorService', () => {
  it('invia la risposta finale di un turno web e marca il turno letto', async () => {
    const ctx = await setup();
    ctx.mirror.onTurnComplete(completion());
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Risposta finale'))).toBe(true));
    await waitIdle(ctx.mirror);
    expect(ctx.reads.mark).toHaveBeenCalledWith('sess_1', 'turn-1');
    expect(ctx.shares.get('sess_1')?.lastDeliveredTurnId).toBe('turn-1');
  });

  it('ignora i turni nati da Telegram', async () => {
    const ctx = await setup();
    ctx.mirror.onTurnComplete(completion({ source: 'telegram' }));
    await waitIdle(ctx.mirror);
    expect(ctx.transport.sent).toHaveLength(0);
  });

  it('in modalità completa invia anche il messaggio web', async () => {
    const ctx = await setup();
    await ctx.shares.set('sess_1', { accountId: ctx.account.id, userId: '42', chatId: '42', mode: 'full' });
    ctx.mirror.onTurnComplete(completion({ request: 'Domanda dalla web' }));
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Messaggio dalla web UI'))).toBe(true));
    expect(ctx.transport.sent.some(item => item.text.includes('Domanda dalla web'))).toBe(true);
    expect(ctx.transport.sent.some(item => item.text.includes('Risposta finale'))).toBe(true);
  });

  it('invia una notifica per un turno fallito e non duplica la stessa consegna', async () => {
    const ctx = await setup();
    ctx.mirror.onTurnComplete(completion({ status: 'failed', error: 'provider failure' }));
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('non è stata completata'))).toBe(true));
    await waitIdle(ctx.mirror);
    expect(ctx.transport.sent.some(item => item.text.includes('provider failure'))).toBe(true);
    const sent = ctx.transport.sent.length;
    ctx.mirror.onTurnComplete(completion({ status: 'failed', error: 'provider failure' }));
    await waitIdle(ctx.mirror);
    expect(ctx.transport.sent).toHaveLength(sent);
  });

  it('invia gli artefatti PDF solo quando richiesto', async () => {
    const ctx = await setup();
    ctx.sessions.artifacts.set('sess_1', [{ id: 'art_1', name: 'report.pdf', kind: 'pdf', createdAt: Date.now() }]);
    ctx.mirror.onTurnComplete(completion());
    await vi.waitFor(() => expect(ctx.transport.documents).toHaveLength(1));
    expect(ctx.transport.documents[0]).toMatchObject({ filename: 'report.pdf' });
    await waitIdle(ctx.mirror);

    await ctx.shares.set('sess_1', { accountId: ctx.account.id, userId: '42', chatId: '42', includeArtifacts: false });
    ctx.mirror.onTurnComplete(completion({ turnId: 'turn-2' }));
    await vi.waitFor(() => expect(ctx.transport.sent.some(item => item.text.includes('Risposta finale'))).toBe(true));
    await waitIdle(ctx.mirror);
    expect(ctx.transport.documents).toHaveLength(1);
  });

  it('segnala un target non più autorizzato', async () => {
    const ctx = await setup();
    await ctx.bindings.removeAllowedUser(ctx.account.id, 42);
    ctx.mirror.onTurnComplete(completion());
    await waitIdle(ctx.mirror);
    expect(ctx.transport.sent).toHaveLength(0);
    expect(ctx.shares.get('sess_1')?.lastError).toContain('non più autorizzato');
  });

  it('rimuove le condivisioni quando l’account viene eliminato', async () => {
    const ctx = await setup();
    await ctx.mirror.removeAccount(ctx.account.id);
    expect(ctx.shares.get('sess_1')).toBeUndefined();
  });
});
