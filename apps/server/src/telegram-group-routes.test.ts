import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import { TelegramStore } from './telegram.js';
import { TelegramBindingStore } from './telegram-bindings.js';
import { TelegramGroupStore } from './telegram-groups.js';
import { registerTelegramGroupRoutes } from './telegram-group-routes.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-telegram-group-routes-'));
  dirs.push(dataDir);
  const accounts = new TelegramStore({ dataDir });
  await accounts.load();
  const account = await accounts.createAccount({ label: 'Bot', chatId: '42', token: '123:token' });
  const bindings = new TelegramBindingStore({ dataDir });
  await bindings.load();
  await bindings.update(account.id, { enabled: true });
  await bindings.addAllowedUser(account.id, { id: 42, label: 'Luca' });
  const groups = new TelegramGroupStore({ dataDir });
  await groups.load();
  const inbound = { syncGroupTopicTitles: vi.fn(async () => ({ updated: 1, failed: 0, closed: 0, deleted: 0, items: [{ threadId: '55', title: 'Topic', status: 'updated' as const }] })) };
  const app = fastify();
  registerTelegramGroupRoutes(app, { accounts, bindings, groups, inbound });
  return { app, account, groups, inbound };
}

describe('telegram group routes', () => {
  it('elenca i gruppi e genera un codice con scope group', async () => {
    const { app, account, groups } = await fixture();
    await groups.upsert(account.id, { chatId: '-100123', title: 'Memora', isForum: true, allowedUsers: ['42'] });
    const list = await app.inject({ method: 'GET', url: `/api/admin/telegram/accounts/${account.id}/groups` });
    expect(list.statusCode).toBe(200);
    expect(list.json().groups).toHaveLength(1);
    expect(list.json().groups[0]).toMatchObject({ chatId: '-100123', title: 'Memora', isForum: true });

    const pairing = await app.inject({ method: 'POST', url: `/api/admin/telegram/accounts/${account.id}/groups/pairing` });
    expect(pairing.statusCode).toBe(201);
    expect(pairing.json().pairing.code).toMatch(/^[A-Za-z0-9_-]{16,128}$/);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/admin/telegram/accounts/${account.id}/groups/-100123`,
      payload: { defaultProjectId: 'lavoro', showProjectInTopicTitle: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().group).toMatchObject({ defaultProjectId: 'lavoro', showProjectInTopicTitle: true });

    const invalid = await app.inject({
      method: 'PATCH',
      url: `/api/admin/telegram/accounts/${account.id}/groups/-100123`,
      payload: { defaultProjectId: 'Non Valido' },
    });
    expect(invalid.statusCode).toBe(400);

    const resync = await app.inject({ method: 'POST', url: `/api/admin/telegram/accounts/${account.id}/groups/-100123/topics/resync` });
    expect(resync.statusCode).toBe(200);
    expect(resync.json()).toEqual({ updated: 1, failed: 0, closed: 0, deleted: 0, items: [{ threadId: '55', title: 'Topic', status: 'updated' }] });

    const removed = await app.inject({ method: 'DELETE', url: `/api/admin/telegram/accounts/${account.id}/groups/-100123` });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ removed: true });
    await app.close();
  });

  it('rifiuta un account inesistente', async () => {
    const { app } = await fixture();
    const response = await app.inject({ method: 'GET', url: '/api/admin/telegram/accounts/acc_tg_missing/groups' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
