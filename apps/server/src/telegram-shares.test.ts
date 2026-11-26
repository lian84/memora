import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramShareError, TelegramShareStore } from './telegram-shares.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-telegram-shares-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function storeAt(dataDir: string, options: { now?: () => number } = {}): Promise<TelegramShareStore> {
  const store = new TelegramShareStore({ dataDir, ...options });
  await store.load();
  return store;
}

describe('TelegramShareStore', () => {
  it('salva una condivisione per sessione con permessi 0600', async () => {
    const dataDir = await tempDir();
    const store = await storeAt(dataDir);
    const share = await store.set('sess_1', { accountId: 'acc_tg_test', userId: '42', chatId: '42', mode: 'answers' });
    expect(share).toMatchObject({ sessionId: 'sess_1', accountId: 'acc_tg_test', userId: '42', chatId: '42', mode: 'answers', includeArtifacts: true });
    expect((await fs.stat(store.filePath)).mode & 0o777).toBe(0o600);
    const reloaded = await storeAt(dataDir);
    expect(reloaded.get('sess_1')).toMatchObject({ mode: 'answers', includeArtifacts: true });
  });

  it('aggiorna modalità e artefatti senza perdere createdAt', async () => {
    let now = 100;
    const store = await storeAt(await tempDir(), { now: () => now });
    await store.set('sess_1', { accountId: 'acc_tg_test', userId: '42', chatId: '42' });
    now = 200;
    const updated = await store.set('sess_1', { accountId: 'acc_tg_test', userId: '42', chatId: '42', mode: 'full', includeArtifacts: false });
    expect(updated).toMatchObject({ mode: 'full', includeArtifacts: false, createdAt: 100, updatedAt: 200 });
  });

  it('registra consegna, errore e rimozione per account', async () => {
    const store = await storeAt(await tempDir());
    await store.set('sess_1', { accountId: 'acc_tg_a', userId: '42', chatId: '42' });
    await store.set('sess_2', { accountId: 'acc_tg_b', userId: '7', chatId: '7' });
    await store.markDelivered('sess_1', 'turn-1');
    expect(store.get('sess_1')).toMatchObject({ lastDeliveredTurnId: 'turn-1' });
    await store.setError('sess_1', 'telegram_unreachable');
    expect(store.get('sess_1')?.lastError).toBe('telegram_unreachable');
    await store.markDelivered('sess_1', 'turn-2');
    expect(store.get('sess_1')?.lastError).toBeUndefined();
    expect(await store.removeForUser('acc_tg_a', '42')).toBe(1);
    expect(store.get('sess_1')).toBeUndefined();
    await store.set('sess_1', { accountId: 'acc_tg_a', userId: '42', chatId: '42' });
    expect(await store.removeForAccount('acc_tg_a')).toBe(1);
    expect(store.get('sess_1')).toBeUndefined();
    expect(store.get('sess_2')).toBeDefined();
    expect(await store.remove('sess_2')).toBe(true);
    expect(store.list()).toEqual([]);
  });

  it('valida i dati prima di scrivere', async () => {
    const store = await storeAt(await tempDir());
    await expect(store.set('sess_1', { accountId: 'acc_tg_test', userId: '@user', chatId: '42' })).rejects.toBeInstanceOf(TelegramShareError);
    await expect(store.set('sess_1', { accountId: 'acc_tg_test', userId: '42', chatId: 'chat' })).rejects.toMatchObject({ code: 'invalid_telegram_share_chat' });
    await expect(store.set('sess_1', { accountId: 'acc_tg_test', userId: '42', chatId: '42', mode: 'bad' as never })).rejects.toMatchObject({ code: 'invalid_telegram_share_mode' });
  });

  it('ignora un file corrotto', async () => {
    const dataDir = await tempDir();
    await fs.mkdir(path.join(dataDir, 'config'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'config', 'telegram-shares.json'), '{bad');
    const warn = vi.fn();
    const store = new TelegramShareStore({ dataDir, warn });
    await store.load();
    expect(warn).toHaveBeenCalled();
    expect(store.list()).toEqual([]);
  });
});
