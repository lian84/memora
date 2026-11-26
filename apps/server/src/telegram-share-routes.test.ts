import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import { TelegramStore } from './telegram.js';
import { TelegramBindingStore } from './telegram-bindings.js';
import { TelegramShareStore } from './telegram-shares.js';
import { registerTelegramShareRoutes } from './telegram-share-routes.js';
import type { TelegramInboundService } from './telegram-inbound.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-telegram-share-routes-'));
  dirs.push(dataDir);
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
  const inbound = { getStatus: vi.fn(() => ({ accountId: account.id, enabled: true, status: 'running', botUsername: 'memora_bot' })) } as unknown as TelegramInboundService;
  const app = fastify();
  registerTelegramShareRoutes(app, {
    accounts,
    bindings,
    shares,
    inbound,
    sessions: { hasSession: async (sessionId: string) => sessionId === 'sess_1' },
  });
  return { app, account, accounts, bindings, shares };
}

describe('telegram share routes', () => {
  it('restituisce i target e crea la condivisione', async () => {
    const { app, account, bindings, shares } = await fixture();
    const initial = await app.inject({ method: 'GET', url: '/api/sessions/sess_1/telegram-share' });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({
      share: null,
      targets: [{ accountId: account.id, userId: '42', userLabel: 'Luca', chatId: '42', botUsername: 'memora_bot' }],
    });

    await bindings.setBinding(account.id, { userId: '42', chatId: '42', sessionId: 'sess_old' });
    const saved = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/sess_1/telegram-share',
      payload: { enabled: true, accountId: account.id, userId: '42', mode: 'full', includeArtifacts: false },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().share).toMatchObject({ sessionId: 'sess_1', accountId: account.id, userId: '42', chatId: '42', mode: 'full', includeArtifacts: false });
    expect(shares.get('sess_1')).toBeDefined();
    expect(bindings.getBinding(account.id, 42)?.sessionId).toBe('sess_1');

    const disabled = await app.inject({ method: 'PATCH', url: '/api/sessions/sess_1/telegram-share', payload: { enabled: false } });
    expect(disabled.statusCode).toBe(200);
    expect(shares.get('sess_1')).toBeUndefined();
    await app.close();
  });

  it('rifiuta sessione o target non validi', async () => {
    const { app, account } = await fixture();
    const missing = await app.inject({ method: 'GET', url: '/api/sessions/sess_missing/telegram-share' });
    expect(missing.statusCode).toBe(404);

    const noTarget = await app.inject({ method: 'PATCH', url: '/api/sessions/sess_1/telegram-share', payload: { enabled: true } });
    expect(noTarget.statusCode).toBe(400);

    const wrongUser = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/sess_1/telegram-share',
      payload: { enabled: true, accountId: account.id, userId: '99' },
    });
    expect(wrongUser.statusCode).toBe(403);
    await app.close();
  });
});
