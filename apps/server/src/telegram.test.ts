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
  it('salva token e chat ID separatamente, senza esporre il token', async () => {
    const dataDir = await tempDir();
    const store = new TelegramStore({ dataDir });
    await store.load();
    await store.setToken('123456:abcdefghijklmnopqrstuvwxyz');
    const settings = await store.update({ enabled: true, chatId: '-1001234567890' });
    expect(settings).toMatchObject({ enabled: true, chatId: '-1001234567890', tokenConfigured: true, tokenSource: 'secret', tokenEditable: true });
    const raw = await fs.readFile(path.join(dataDir, 'config', 'telegram-secrets.json'), 'utf8');
    expect(raw).toContain('123456:');
    expect(settings).not.toHaveProperty('token');
    const mode = (await fs.stat(path.join(dataDir, 'config', 'telegram-secrets.json'))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('rifiuta chat ID non numerici', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    await expect(store.update({ chatId: '@canale' })).rejects.toBeInstanceOf(TelegramError);
  });

  it('usa il token environment e non lo rende modificabile', async () => {
    const store = new TelegramStore({ dataDir: await tempDir(), env: { MEMORA_TELEGRAM_BOT_TOKEN: '123:env' } });
    await store.load();
    expect(store.getSettings()).toMatchObject({ tokenConfigured: true, tokenSource: 'environment', tokenEditable: false });
    await expect(store.setToken('123:other')).rejects.toMatchObject({ code: 'telegram_token_managed_by_environment' });
  });
});

describe('TelegramService', () => {
  it('invia messaggi spezzati e usa il token solo nell’URL API', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    await store.setToken('123:token');
    await store.update({ enabled: true, chatId: '42' });
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => { void args; return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }); });
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    const text = 'x'.repeat(9_000);
    await expect(service.send(text)).resolves.toBe(3);
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
    await store.setToken('123:token');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: [
      { message: { chat: { id: 42, type: 'private', first_name: 'Memo' } } },
      { message: { chat: { id: 42, type: 'private', first_name: 'Memo' } } },
      { channel_post: { chat: { id: -100, type: 'channel', title: 'Note' } } },
    ] }), { status: 200 }));
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.discoverChats()).resolves.toEqual([
      { id: '42', label: 'Memo', type: 'private' },
      { id: '-100', label: 'Note', type: 'channel' },
    ]);
  });

  it('propaga gli errori API senza esporre il token', async () => {
    const store = new TelegramStore({ dataDir: await tempDir() });
    await store.load();
    await store.setToken('123:secret-token');
    await store.update({ chatId: '42' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 400 }));
    const service = new TelegramService(store, fetchMock as unknown as typeof fetch);
    await expect(service.send('test')).rejects.toMatchObject({ code: 'telegram_api_error' });
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
