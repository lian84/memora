import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelegramBotInfo } from './telegram.js';
import { TelegramError, TelegramStore } from './telegram.js';
import { TelegramBindingStore } from './telegram-bindings.js';
import { TelegramInboundService, type TelegramInboundTransport } from './telegram-inbound.js';

const dirs: string[] = [];
const services: TelegramInboundService[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-telegram-inbound-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.stop()));
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

class FakeTransport implements TelegramInboundTransport {
  updates: Array<Record<string, unknown>> = [];
  sent: Array<{ chatId: string; text: string; accountId?: string; parseMode?: string }> = [];
  documents: Array<{ chatId: string; filename: string; accountId?: string }> = [];
  getMe = vi.fn(async (): Promise<TelegramBotInfo> => ({ id: '1', firstName: 'Memora', username: 'memora_bot' }));
  getUpdates = vi.fn(async (
    _accountId: string | undefined,
    options: { signal?: AbortSignal },
  ): Promise<Array<Record<string, unknown>>> => {
    if (this.updates.length > 0) return this.updates.splice(0);
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 5);
      options.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    return [];
  });
  sendTo = vi.fn(async (chatId: string, text: string, accountId?: string, options?: { parseMode?: 'HTML' }) => {
    this.sent.push({ chatId, text, accountId, ...(options?.parseMode ? { parseMode: options.parseMode } : {}) });
  });
  sendDocumentTo = vi.fn(async (chatId: string, document: { filename: string }, accountId?: string) => {
    this.documents.push({ chatId, filename: document.filename, accountId });
  });
}

let nextUpdateId = 100;

function messageUpdate(input: {
  text?: string;
  userId?: number;
  chatId?: number;
  type?: string;
  firstName?: string;
  isBot?: boolean;
  username?: string;
} = {}): Record<string, unknown> {
  nextUpdateId += 1;
  const userId = input.userId ?? 42;
  const chatId = input.chatId ?? userId;
  return {
    update_id: nextUpdateId,
    message: {
      message_id: nextUpdateId,
      from: {
        id: userId,
        is_bot: input.isBot === true,
        first_name: input.firstName ?? 'Luca',
        ...(input.username ? { username: input.username } : {}),
      },
      chat: {
        id: chatId,
        type: input.type ?? 'private',
        first_name: input.firstName ?? 'Luca',
      },
      ...(input.text !== undefined ? { text: input.text } : {}),
    },
  };
}

function updateId(update: Record<string, unknown>): number {
  return Number(update.update_id);
}

async function setup(options: {
  inboundEnabled?: boolean;
  incomingLimit?: number;
  canProcess?: () => boolean;
  now?: () => number;
} = {}) {
  const dataDir = await tempDir();
  const accounts = new TelegramStore({ dataDir });
  await accounts.load();
  const account = await accounts.createAccount({ label: 'Bot', chatId: '', token: '123:token' });
  const bindings = new TelegramBindingStore({ dataDir, ...(options.now ? { now: options.now } : {}) });
  await bindings.load();
  if (options.inboundEnabled !== false) await bindings.update(account.id, { enabled: true });
  const transport = new FakeTransport();
  const service = new TelegramInboundService({
    telegram: transport,
    accounts,
    bindings,
    log: vi.fn(),
    canProcess: options.canProcess ?? (() => true),
    now: options.now ?? Date.now,
    incomingLimit: options.incomingLimit ?? 30,
    incomingWindowMs: 60_000,
    pollTimeoutSeconds: 0,
    maxBackoffMs: 50,
  });
  services.push(service);
  return { dataDir, accounts, account, bindings, transport, service };
}

describe('TelegramInboundService', () => {
  it('non avvia il polling con il canale disabilitato', async () => {
    const { service, transport, account, bindings } = await setup({ inboundEnabled: false });
    await service.start();
    expect(service.getStatus(account.id)).toMatchObject({ enabled: false, status: 'disabled' });
    expect(transport.getUpdates).not.toHaveBeenCalled();
    await bindings.update(account.id, { enabled: true });
    await service.refreshAccount(account.id);
    await vi.waitFor(() => expect(transport.getUpdates).toHaveBeenCalled());
    await service.stop();
  });

  it('completa il pairing con il codice monouso e imposta la chat di notifica', async () => {
    const { service, transport, bindings, accounts, account } = await setup();
    const pairing = await service.createPairingCode(account.id);
    expect(pairing.deepLink).toContain('t.me/memora_bot');
    expect(pairing.deepLink).toContain(encodeURIComponent(pairing.code));

    const update = messageUpdate({ text: `/start ${pairing.code}` });
    transport.updates.push(update);
    await service.start();
    await vi.waitFor(() => expect(bindings.isAllowed(account.id, '42')).toBe(true));
    await vi.waitFor(() => expect(transport.sent.some(item => item.text.includes('Benvenuto'))).toBe(true));
    expect(bindings.getOffset(account.id)).toBe(updateId(update) + 1);
    await vi.waitFor(() => expect(accounts.getAccount(account.id)?.chatId).toBe('42'));
    await service.stop();
  });

  it('chiede il codice a un utente non autorizzato e non crea sessioni', async () => {
    const { service, transport, bindings, account } = await setup();
    const update = messageUpdate({ text: '/start' });
    transport.updates.push(update);
    await service.start();
    await vi.waitFor(() => expect(transport.sent.some(item => item.text.includes('genera un codice'))).toBe(true));
    expect(bindings.isAllowed(account.id, '42')).toBe(false);
    expect(bindings.getBinding(account.id, '42')).toBeUndefined();
    await vi.waitFor(() => expect(bindings.getOffset(account.id)).toBe(updateId(update) + 1));
    await service.stop();
  });

  it('risponde ai comandi di un utente autorizzato', async () => {
    const { service, transport, bindings, account } = await setup();
    await bindings.addAllowedUser(account.id, { id: 42, label: 'Luca' });
    transport.updates.push(
      messageUpdate({ text: '/ping' }),
      messageUpdate({ text: '/help@memora_bot' }),
      messageUpdate({ text: '/status' }),
    );
    await service.start();
    await vi.waitFor(() => expect(transport.sent.some(item => item.text.includes('pong'))).toBe(true));
    await vi.waitFor(() => expect(transport.sent.some(item => item.text.includes('Comandi disponibili'))).toBe(true));
    await vi.waitFor(() => expect(transport.sent.some(item => item.text.includes('Utenti autorizzati'))).toBe(true));
    expect(transport.sent.every(item => item.parseMode === 'HTML')).toBe(true);
    await service.stop();
  });

  it('ignora un update duplicato già confermato', async () => {
    const { service, transport, bindings, account } = await setup();
    await bindings.addAllowedUser(account.id, { id: 42, label: 'Luca' });
    const update = messageUpdate({ text: '/ping' });
    transport.updates.push(update, update);
    await service.start();
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(transport.sent).toHaveLength(1);
    expect(bindings.getOffset(account.id)).toBe(updateId(update) + 1);
    await service.stop();
  });

  it('applica il rate limit per utente', async () => {
    const { service, transport, bindings, account } = await setup({ incomingLimit: 1 });
    await bindings.addAllowedUser(account.id, { id: 42, label: 'Luca' });
    transport.updates.push(messageUpdate({ text: '/ping' }), messageUpdate({ text: '/ping' }));
    await service.start();
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(transport.sent).toHaveLength(1);
    await service.stop();
  });

  it('ignora gruppi e messaggi inviati da altri bot', async () => {
    const { service, transport, bindings, account } = await setup();
    const group = messageUpdate({ text: '/ping', type: 'group', chatId: -100 });
    const fromBot = messageUpdate({ text: '/ping', isBot: true });
    transport.updates.push(group, fromBot);
    await service.start();
    await vi.waitFor(() => expect(bindings.getOffset(account.id)).toBe(updateId(fromBot) + 1));
    expect(transport.sent).toHaveLength(0);
    await service.stop();
  });

  it('osserva le chat anche quando l’utente non è autorizzato', async () => {
    const { service, transport, account } = await setup();
    transport.updates.push(messageUpdate({ text: 'ciao', firstName: 'Luca' }));
    await service.start();
    await vi.waitFor(() => expect(service.listObservedChats(account.id)).toHaveLength(1));
    expect(service.listObservedChats(account.id)[0]).toMatchObject({ id: '42', label: 'Luca', type: 'private' });
    await service.stop();
  });

  it('sospende il polling durante il maintenance', async () => {
    const { service, transport, account } = await setup({ canProcess: () => false });
    await service.start();
    await vi.waitFor(() => expect(service.getStatus(account.id).status).toBe('paused'));
    expect(transport.getUpdates).not.toHaveBeenCalled();
    await service.stop();
  });

  it('si ferma su conflitto webhook e su token non autorizzato', async () => {
    const { service, transport, account } = await setup();
    transport.getUpdates.mockRejectedValueOnce(new TelegramError('telegram_conflict', 'Conflict', 409));
    await service.start();
    await vi.waitFor(() => expect(service.getStatus(account.id).status).toBe('conflict'));
    expect(service.getStatus(account.id).lastError).toContain('Conflict');
    await service.stop();

    const second = await setup();
    second.transport.getUpdates.mockRejectedValueOnce(new TelegramError('telegram_unauthorized', 'Unauthorized', 401));
    await second.service.start();
    await vi.waitFor(() => expect(second.service.getStatus(second.account.id).status).toBe('error'));
    await second.service.stop();
  });

  it('riparte dall’offset persistito dopo un riavvio', async () => {
    const { accounts, account, bindings, transport, service } = await setup();
    await bindings.addAllowedUser(account.id, { id: 42, label: 'Luca' });
    const update = messageUpdate({ text: '/ping' });
    transport.updates.push(update);
    await service.start();
    await vi.waitFor(() => expect(transport.sent.some(item => item.text.includes('pong'))).toBe(true));
    await vi.waitFor(() => expect(bindings.getOffset(account.id)).toBe(updateId(update) + 1));
    await service.stop();

    const secondTransport = new FakeTransport();
    const second = new TelegramInboundService({
      telegram: secondTransport,
      accounts,
      bindings,
      log: vi.fn(),
      pollTimeoutSeconds: 0,
    });
    services.push(second);
    await second.start();
    await vi.waitFor(() => expect(secondTransport.getUpdates).toHaveBeenCalled());
    const options = secondTransport.getUpdates.mock.calls[0]?.[1] as { offset?: number } | undefined;
    expect(options?.offset).toBe(updateId(update) + 1);
    await second.stop();
  });

  it('rimuove lo stato quando l’account viene eliminato', async () => {
    const { service, transport, bindings, accounts, account } = await setup();
    await bindings.addAllowedUser(account.id, { id: 42 });
    await service.start();
    await vi.waitFor(() => expect(transport.getUpdates).toHaveBeenCalled());
    await service.removeAccount(account.id);
    expect(bindings.get(account.id).enabled).toBe(false);
    expect(bindings.isAllowed(account.id, 42)).toBe(false);
    expect(accounts.getAccount(account.id)).toBeDefined();
    await service.stop();
  });
});
