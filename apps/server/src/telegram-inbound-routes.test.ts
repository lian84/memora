import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import { TelegramStore } from './telegram.js';
import { TelegramBindingStore } from './telegram-bindings.js';
import { registerTelegramInboundRoutes } from './telegram-inbound-routes.js';
import type { TelegramInboundService } from './telegram-inbound.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-telegram-routes-'));
  dirs.push(dataDir);
  const accounts = new TelegramStore({ dataDir });
  await accounts.load();
  const account = await accounts.createAccount({ label: 'Bot', chatId: '', token: '123:token' });
  const bindings = new TelegramBindingStore({ dataDir });
  await bindings.load();
  const status = { accountId: account.id, enabled: false, status: 'disabled' as const };
  const inbound = {
    getStatus: vi.fn(() => status),
    refreshAccount: vi.fn(async () => undefined),
    createPairingCode: vi.fn(async () => ({ code: 'codice-di-prova', expiresAt: 10, deepLink: 'https://t.me/memora_bot?start=codice-di-prova' })),
    clearPairingCode: vi.fn(async () => undefined),
    removeAccount: vi.fn(async () => undefined),
    isInboundEnabled: vi.fn(() => true),
    listObservedChats: vi.fn(() => [{ id: '42', label: 'Luca', type: 'private' }]),
  } as unknown as TelegramInboundService;
  const app = fastify();
  registerTelegramInboundRoutes(app, { accounts, bindings, inbound });
  return { app, accounts, account, bindings, inbound };
}

describe('telegram inbound routes', () => {
  it('restituisce e aggiorna la configurazione in ingresso', async () => {
    const { app, account, bindings, inbound } = await fixture();
    const initial = await app.inject({ method: 'GET', url: `/api/admin/telegram/accounts/${account.id}/inbound` });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      inbound: { accountId: account.id, enabled: false, settings: { replyMode: 'final' } },
      status: { enabled: false, status: 'disabled' },
    });

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/admin/telegram/accounts/${account.id}/inbound`,
      payload: {
        enabled: true,
        replyMode: 'progress',
        defaultProjectId: 'memora',
        defaultAgentProfileId: 'sviluppatore',
        maxQueuedMessages: 2,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(inbound.refreshAccount).toHaveBeenCalledWith(account.id);
    expect(bindings.get(account.id)).toMatchObject({
      enabled: true,
      settings: {
        replyMode: 'progress',
        defaultProjectId: 'memora',
        defaultAgentProfileId: 'sviluppatore',
        maxQueuedMessages: 2,
      },
    });

    const invalid = await app.inject({
      method: 'PATCH',
      url: `/api/admin/telegram/accounts/${account.id}/inbound`,
      payload: { defaultProjectId: 'Non Valido' },
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });

  it('gestisce codice di pairing, allowlist e binding', async () => {
    const { app, account, bindings, inbound } = await fixture();
    const pairing = await app.inject({ method: 'POST', url: `/api/admin/telegram/accounts/${account.id}/inbound/pairing` });
    expect(pairing.statusCode).toBe(201);
    expect(pairing.json()).toMatchObject({
      pairing: { code: 'codice-di-prova', deepLink: expect.stringContaining('t.me/memora_bot') },
    });
    expect(inbound.createPairingCode).toHaveBeenCalledWith(account.id);

    const user = await app.inject({
      method: 'POST',
      url: `/api/admin/telegram/accounts/${account.id}/inbound/users`,
      payload: { id: 42, label: 'Luca' },
    });
    expect(user.statusCode).toBe(201);
    expect(bindings.isAllowed(account.id, 42)).toBe(true);

    await bindings.setBinding(account.id, { userId: '42', chatId: '42', sessionId: 'sess_one' });
    expect(bindings.getBinding(account.id, 42)?.sessionId).toBe('sess_one');

    const unlinked = await app.inject({
      method: 'DELETE',
      url: `/api/admin/telegram/accounts/${account.id}/inbound/bindings/42`,
    });
    expect(unlinked.statusCode).toBe(200);
    expect(unlinked.json()).toEqual({ removed: true });
    expect(bindings.getBinding(account.id, 42)).toBeUndefined();

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/admin/telegram/accounts/${account.id}/inbound/users/42`,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ removed: true });
    expect(bindings.isAllowed(account.id, 42)).toBe(false);
    await app.close();
  });

  it('restituisce 404 per un account inesistente', async () => {
    const { app } = await fixture();
    const response = await app.inject({ method: 'GET', url: '/api/admin/telegram/accounts/acc_tg_missing/inbound' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
