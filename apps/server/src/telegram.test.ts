import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { splitTelegramText, TelegramError, TelegramService, TelegramStore } from './telegram.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-telegram-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('TelegramStore', () => {
  it('salva più account separatamente dai token', async () => {
    const dataDir = await tempDir();
    const store = new TelegramStore({ dataDir });
    await store.load();
    const first = await store.createAccount({ label: 'Personale', chatId: '42', token: '123456:abcdefghijklmnopqrstuvwxyz' });
    const second = await store.createAccount({ label: 'Lavoro', chatId: '-100123', token: '654321:zyxwvutsrqponmlkjihgfedcba' });
    expect(first.id).toMatch(/^acc_tg_/);
    expect(second.id).not.toBe(first.id);
    expect(store.listAccounts()).toHaveLength(2);
    expect(store.listAccounts()[0]).toMatchObject({ label: 'Personale', tokenConfigured: true, tokenSource: 'secret' });
    const accountsRaw = await fs.readFile(path.join(dataDir, 'config', 'telegram-accounts.json'), 'utf8');
    expect(accountsRaw).not.toContain('abcdefghijklmnopqrstuvwxyz');
    const secretsRaw = await fs.readFile(path.join(dataDir, 'config', 'telegram-secrets.json'), 'utf8');
    expect(secretsRaw).toContain(first.id);
    const mode = (await fs.stat(path.join(dataDir, 'config', 'telegram-secrets.json'))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('aggiorna ed elimina un account senza toccare gli altri', async () => {
    const dataDir = await tempDir();
    const store = new TelegramStore({ dataDir });
    await store.load();
    const first = await store.createAccount({ label: 'A', chatId: '1', token: 'a-token' });
    const second = await store.createAccount({ label: 'B', chatId: '2', token: 'b-token' });
    await store.updateAccount(first.id, { label: 'A2', chatId: '3', enabled: false });
    expect(store.getAccount(first.id)).toMatchObject({ label: 'A2', chatId: '3', enabled: false, tokenConfigured: true });
    await store.deleteAccount(first.id);
    expect(store.getAccount(first.id)).toBeUndefined();
    expect(store.getAccount(second.id)).toBeDefined();
  });

  it('rifiuta chat ID non numerici', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    await expect(store.createAccount({ label: 'A', chatId: '@canale', token: 'token' })).rejects.toBeInstanceOf(TelegramError);
  });

  it('usa il token environment per l’account predefinito', async () => {
    const store = new TelegramStore({ dataDir: await tempDir(), env: { MEMORA_TELEGRAM_BOT_TOKEN: '123:env' } });
    await store.load();
    expect(store.listAccounts()[0]).toMatchObject({ id: 'acc_tg_default', tokenConfigured: true, tokenSource: 'environment' });
    expect(store.getToken('acc_tg_default')).toBe('123:env');
  });

  it('migra la vecchia configurazione a token singolo', async () => {
    const dataDir = await tempDir();
    await fs.mkdir(path.join(dataDir, 'config'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'config', 'telegram.json'), JSON.stringify({ version: 1, enabled: true, chatId: '42' }));
    await fs.writeFile(path.join(dataDir, 'config', 'telegram-secrets.json'), JSON.stringify({ version: 1, botToken: 'old-token' }));
    const store = new TelegramStore({ dataDir });
    await store.load();
    expect(store.listAccounts()[0]).toMatchObject({ id: 'acc_tg_default', enabled: true, chatId: '42', tokenConfigured: true });
    expect((await fs.stat(path.join(dataDir, 'config', 'telegram-accounts.json'))).mode & 0o777).toBe(0o600);
  });
});

describe('TelegramService', () => {
  it('invia messaggi spezzati usando l’account richiesto', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:token' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => { void args; return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }); });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.send('x'.repeat(9_000), account.id)).resolves.toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(firstUrl).toContain('/bot123:token/sendMessage');
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.chat_id).toBe('42');
    expect(body.text).toHaveLength(4_000);
  });

  it('scopre le chat dagli update e ignora duplicati', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '', token: '123:token' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: [
      { message: { chat: { id: 42, type: 'private', first_name: 'Memo' } } },
      { message: { chat: { id: 42, type: 'private', first_name: 'Memo' } } },
      { channel_post: { chat: { id: -100, type: 'channel', title: 'Note' } } },
    ] }), { status: 200 }));
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.discoverChats(account.id)).resolves.toEqual([
      { id: '42', label: 'Memo', type: 'private' },
      { id: '-100', label: 'Note', type: 'channel' },
    ]);
  });

  it('propaga gli errori API senza esporre il token', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    const account = await store.createAccount({ label: 'Test', chatId: '42', token: '123:secret-token' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 400 }));
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.send('test', account.id)).rejects.toMatchObject({ code: 'telegram_api_error' });
  });
});

describe('splitTelegramText', () => {
  it('preferisce gli a capo e non produce chunk vuoti', () => {
    const chunks = splitTelegramText(`${'a'.repeat(3000)}\n${'b'.repeat(3000)}`, 4000);
    expect(chunks).toHaveLength(2);
    expect(chunks.join('')).toContain('bbbb');
    expect(splitTelegramText('   ')).toEqual([]);
  });
});
