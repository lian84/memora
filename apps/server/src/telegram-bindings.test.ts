import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TELEGRAM_INBOUND_SETTINGS, TELEGRAM_PAIRING_TTL_MS } from '@memora/shared';
import { TelegramBindingStore, TelegramInboundError } from './telegram-bindings.js';

const ACCOUNT = 'acc_tg_test';
const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-telegram-inbound-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function loadStore(dataDir: string, options: {
  now?: () => number;
  warn?: (message: string) => void;
  pairingTtlMs?: number;
  maxAllowedUsers?: number;
  maxPairingAttempts?: number;
} = {}): Promise<TelegramBindingStore> {
  const store = new TelegramBindingStore({ dataDir, ...options });
  await store.load();
  return store;
}

async function enabledStore(dataDir?: string, options: Parameters<typeof loadStore>[1] = {}): Promise<TelegramBindingStore> {
  const store = await loadStore(dataDir ?? await tempDir(), options);
  await store.update(ACCOUNT, { enabled: true });
  return store;
}

describe('TelegramBindingStore', () => {
  it('parte da uno stato disabilitato e vuoto', async () => {
    const store = await loadStore(await tempDir());
    const view = store.get(ACCOUNT);
    expect(view).toEqual({
      accountId: ACCOUNT,
      enabled: false,
      allowedUsers: [],
      bindings: [],
      settings: { ...DEFAULT_TELEGRAM_INBOUND_SETTINGS },
      pairing: { active: false },
      offset: 0,
    });
    expect(store.getOffset(ACCOUNT)).toBe(0);
    expect(store.isAllowed(ACCOUNT, '42')).toBe(false);
  });

  it('salva impostazioni e permessi con file 0600 e directory 0700', async () => {
    const dataDir = await tempDir();
    const store = await enabledStore(dataDir);
    await store.update(ACCOUNT, {
      replyMode: 'progress',
      maxQueuedMessages: 3,
      defaultProjectId: 'memora',
      defaultAgentProfileId: 'sviluppatore',
    });

    const reloaded = await loadStore(dataDir);
    expect(reloaded.get(ACCOUNT)).toMatchObject({
      enabled: true,
      settings: {
        replyMode: 'progress',
        maxQueuedMessages: 3,
        defaultProjectId: 'memora',
        defaultAgentProfileId: 'sviluppatore',
      },
    });
    expect((await fs.stat(store.filePath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(store.filePath))).mode & 0o777).toBe(0o700);
  });

  it('crea un codice, non lo salva in chiaro e lo consuma una sola volta', async () => {
    const store = await enabledStore();
    const pairing = await store.createPairingCode(ACCOUNT);
    expect(pairing.code).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(pairing.expiresAt).toBeGreaterThan(Date.now());

    const raw = await fs.readFile(store.filePath, 'utf8');
    expect(raw).not.toContain(pairing.code);
    expect(store.get(ACCOUNT).pairing).toMatchObject({ active: true, expiresAt: pairing.expiresAt });

    const user = await store.pair(ACCOUNT, { code: pairing.code, userId: 123456, label: 'iPhone' });
    expect(user).toMatchObject({ id: '123456', label: 'iPhone' });
    expect(store.get(ACCOUNT).pairing.active).toBe(false);
    expect(store.isAllowed(ACCOUNT, '123456')).toBe(true);

    await expect(store.pair(ACCOUNT, { code: pairing.code, userId: '999999' })).rejects.toMatchObject({
      code: 'invalid_telegram_pairing_code',
    });
    expect(store.isAllowed(ACCOUNT, '999999')).toBe(false);
  });

  it('richiede che il canale sia abilitato per generare un codice', async () => {
    const store = await loadStore(await tempDir());
    await expect(store.createPairingCode(ACCOUNT)).rejects.toMatchObject({ code: 'telegram_inbound_disabled' });
  });

  it('non consuma il codice con un ID utente non valido', async () => {
    const store = await enabledStore();
    const { code } = await store.createPairingCode(ACCOUNT);

    await expect(store.pair(ACCOUNT, { code, userId: '@username' })).rejects.toBeInstanceOf(TelegramInboundError);
    expect(store.get(ACCOUNT).pairing.active).toBe(true);

    const user = await store.pair(ACCOUNT, { code, userId: '42' });
    expect(user.id).toBe('42');
  });

  it('limita i tentativi per utente senza invalidare il codice per gli altri', async () => {
    const now = 1_000_000;
    const store = await enabledStore(await tempDir(), { now: () => now, maxPairingAttempts: 3 });
    const { code } = await store.createPairingCode(ACCOUNT);

    await expect(store.pair(ACCOUNT, { code: 'A'.repeat(22), userId: '1' })).rejects.toMatchObject({
      code: 'invalid_telegram_pairing_code',
    });
    expect(store.get(ACCOUNT).pairing.active).toBe(true);

    await expect(store.pair(ACCOUNT, { code: 'B'.repeat(22), userId: '1' })).rejects.toMatchObject({
      code: 'invalid_telegram_pairing_code',
    });
    await expect(store.pair(ACCOUNT, { code: 'C'.repeat(22), userId: '1' })).rejects.toMatchObject({
      code: 'telegram_pairing_attempts',
    });
    expect(store.get(ACCOUNT).pairing.active).toBe(true);

    await expect(store.pair(ACCOUNT, { code, userId: '1' })).rejects.toMatchObject({
      code: 'telegram_pairing_attempts',
    });
    expect(store.isAllowed(ACCOUNT, '1')).toBe(false);

    const user = await store.pair(ACCOUNT, { code, userId: '2' });
    expect(user.id).toBe('2');
    expect(store.get(ACCOUNT).pairing.active).toBe(false);
  });

  it('fa scadere il codice dopo il TTL', async () => {
    let now = 1_000_000;
    const store = await enabledStore(await tempDir(), { now: () => now });
    const next = await store.createPairingCode(ACCOUNT);
    now += TELEGRAM_PAIRING_TTL_MS + 1;
    await expect(store.pair(ACCOUNT, { code: next.code, userId: '2' })).rejects.toMatchObject({
      code: 'telegram_pairing_expired',
    });
    expect(store.get(ACCOUNT).pairing.active).toBe(false);
  });

  it('gestisce la allowlist manuale, aggiorna l’etichetta e revoca il collegamento', async () => {
    const store = await enabledStore();
    await store.addAllowedUser(ACCOUNT, { id: 42, label: 'Primo' });
    await store.addAllowedUser(ACCOUNT, { id: '42', label: 'Secondo' });
    expect(store.getAllowedUser(ACCOUNT, 42)).toMatchObject({ id: '42', label: 'Secondo' });

    await store.setBinding(ACCOUNT, { userId: '42', chatId: '42', sessionId: 'sess_one' });
    expect(store.getBinding(ACCOUNT, 42)?.sessionId).toBe('sess_one');

    await store.removeAllowedUser(ACCOUNT, '42');
    expect(store.isAllowed(ACCOUNT, 42)).toBe(false);
    expect(store.getBinding(ACCOUNT, 42)).toBeUndefined();
  });

  it('rifiuta utenti non autorizzati e sessioni non valide', async () => {
    const store = await enabledStore();
    await expect(store.setBinding(ACCOUNT, { userId: '42', chatId: '42', sessionId: 'sess_one' })).rejects.toMatchObject({
      code: 'telegram_user_not_allowed',
    });

    await store.addAllowedUser(ACCOUNT, { id: 42 });
    await expect(store.setBinding(ACCOUNT, { userId: '42', chatId: '42', sessionId: '../bad' })).rejects.toMatchObject({
      code: 'invalid_telegram_session_id',
    });
    await expect(store.setBinding(ACCOUNT, { userId: '42', chatId: 'chat', sessionId: 'sess_one' })).rejects.toMatchObject({
      code: 'invalid_telegram_chat_id',
    });
  });

  it('persiste il collegamento e non trascina i turni su una nuova sessione', async () => {
    const dataDir = await tempDir();
    const store = await enabledStore(dataDir);
    await store.addAllowedUser(ACCOUNT, { id: 42, label: 'Telefono' });
    await store.setBinding(ACCOUNT, {
      userId: '42',
      chatId: '42',
      sessionId: 'sess_one',
      projectId: 'memora',
      agentProfileId: 'sviluppatore',
    });
    await store.updateBinding(ACCOUNT, '42', { lastTurnId: 'turn-old', pendingTurnId: 'turn-old' });

    const reloaded = await loadStore(dataDir);
    expect(reloaded.getBinding(ACCOUNT, '42')).toMatchObject({
      chatId: '42',
      userId: '42',
      sessionId: 'sess_one',
      projectId: 'memora',
      agentProfileId: 'sviluppatore',
      lastTurnId: 'turn-old',
      pendingTurnId: 'turn-old',
    });

    const next = await reloaded.setBinding(ACCOUNT, { userId: '42', chatId: '42', sessionId: 'sess_two' });
    expect(next.sessionId).toBe('sess_two');
    expect(next.lastTurnId).toBeUndefined();
    expect(next.pendingTurnId).toBeUndefined();

    await reloaded.updateBinding(ACCOUNT, '42', { pendingTurnId: null });
    expect(reloaded.getBinding(ACCOUNT, '42')?.pendingTurnId).toBeUndefined();
    expect(await reloaded.removeBinding(ACCOUNT, '42')).toBe(true);
    expect(await reloaded.removeBinding(ACCOUNT, '42')).toBe(false);
  });

  it('limita il numero di utenti autorizzati', async () => {
    const store = await enabledStore(await tempDir(), { maxAllowedUsers: 2 });
    await store.addAllowedUser(ACCOUNT, { id: 1 });
    await store.addAllowedUser(ACCOUNT, { id: 2 });
    await expect(store.addAllowedUser(ACCOUNT, { id: 3 })).rejects.toMatchObject({ code: 'telegram_too_many_users' });
  });

  it('mantiene l’offset monotono e lo persiste', async () => {
    const dataDir = await tempDir();
    const store = await enabledStore(dataDir);
    expect(await store.setOffset(ACCOUNT, 10)).toBe(10);
    expect(await store.setOffset(ACCOUNT, 5)).toBe(10);
    expect(await store.setOffset(ACCOUNT, 11)).toBe(11);
    await expect(store.setOffset(ACCOUNT, -1)).rejects.toMatchObject({ code: 'invalid_telegram_offset' });

    const reloaded = await loadStore(dataDir);
    expect(reloaded.getOffset(ACCOUNT)).toBe(11);
  });

  it('aggiorna l’ultimo accesso e isola più account', async () => {
    let now = 500;
    const store = await enabledStore(await tempDir(), { now: () => now });
    await store.update('acc_tg_other', { enabled: true });
    await store.addAllowedUser(ACCOUNT, { id: 42 });
    await store.addAllowedUser('acc_tg_other', { id: 7 });
    expect(store.isAllowed(ACCOUNT, 7)).toBe(false);
    expect(store.isAllowed('acc_tg_other', 7)).toBe(true);

    now = 900;
    await store.touchAllowedUser(ACCOUNT, 42);
    expect(store.getAllowedUser(ACCOUNT, 42)?.lastSeenAt).toBe(900);

    expect(await store.removeAccount('acc_tg_other')).toBe(true);
    expect(store.listAccountIds()).toEqual([ACCOUNT]);
  });

  it('ignora un file corrotto e riparte dallo stato vuoto', async () => {
    const dataDir = await tempDir();
    await fs.mkdir(path.join(dataDir, 'config'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'config', 'telegram-inbound.json'), '{not json');
    const warn = vi.fn();
    const store = await loadStore(dataDir, { warn });
    expect(warn).toHaveBeenCalled();
    expect(store.listAccountIds()).toEqual([]);
    expect(store.get(ACCOUNT).enabled).toBe(false);
  });

  it('scarta utenti, collegamenti e pairing non validi dal file', async () => {
    const dataDir = await tempDir();
    await fs.mkdir(path.join(dataDir, 'config'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'config', 'telegram-inbound.json'), JSON.stringify({
      version: 1,
      accounts: {
        [ACCOUNT]: {
          enabled: true,
          offset: 3,
          allowedUsers: [
            { id: '42', label: 'Valido', pairedAt: 1 },
            { id: '@non-valido', label: 'Ignorato', pairedAt: 1 },
            { id: '42', label: 'Duplicato', pairedAt: 1 },
          ],
          bindings: {
            '42': { userId: '42', chatId: '42', sessionId: 'sess_one', createdAt: 1, updatedAt: 2 },
            '99': { userId: '99', chatId: '-100', sessionId: 'sess_two', createdAt: 1, updatedAt: 2 },
          },
          pairing: { codeHash: 'non-un-hash', salt: 'corto', createdAt: 1, expiresAt: 2, attempts: 0 },
          settings: { replyMode: 'sbagliato', maxQueuedMessages: 99 },
        },
      },
    }));

    const store = await loadStore(dataDir);
    const view = store.get(ACCOUNT);
    expect(view.allowedUsers).toHaveLength(1);
    expect(view.allowedUsers[0]?.id).toBe('42');
    expect(view.bindings).toHaveLength(1);
    expect(view.bindings[0]?.sessionId).toBe('sess_one');
    expect(view.pairing).toEqual({ active: false });
    expect(view.settings.replyMode).toBe(DEFAULT_TELEGRAM_INBOUND_SETTINGS.replyMode);
    expect(view.settings.maxQueuedMessages).toBe(DEFAULT_TELEGRAM_INBOUND_SETTINGS.maxQueuedMessages);
  });
});
