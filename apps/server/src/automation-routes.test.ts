import { afterEach, describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import { registerAutomationRoutes } from './automation-routes.js';

describe('automation telegram discover', () => {
  let app: Awaited<ReturnType<typeof fastify>> | null = null;
  afterEach(async () => { if (app) await app.close(); app = null; });

  it('usa la cache del poller quando l’ingresso è attivo', async () => {
    app = fastify();
    const telegram = { discoverChats: vi.fn(async () => [{ id: 'from-api', label: 'API', type: 'private' }]) };
    const inbound = {
      isInboundEnabled: vi.fn(() => true),
      listObservedChats: vi.fn(() => [{ id: '42', label: 'Luca', type: 'private' }]),
    };
    registerAutomationRoutes(app, {
      store: {} as never,
      scheduler: {} as never,
      telegramStore: {} as never,
      telegram: telegram as never,
      inbound: inbound as never,
      log: vi.fn(),
    });
    const response = await app.inject({ method: 'POST', url: '/api/admin/telegram/accounts/acc_tg_test/discover' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ chats: [{ id: '42', label: 'Luca', type: 'private' }] });
    expect(telegram.discoverChats).not.toHaveBeenCalled();
  });

  it('usa getUpdates quando l’ingresso è disattivato', async () => {
    app = fastify();
    const telegram = { discoverChats: vi.fn(async () => [{ id: 'from-api', label: 'API', type: 'private' }]) };
    const inbound = { isInboundEnabled: vi.fn(() => false), listObservedChats: vi.fn(() => []) };
    registerAutomationRoutes(app, {
      store: {} as never,
      scheduler: {} as never,
      telegramStore: {} as never,
      telegram: telegram as never,
      inbound: inbound as never,
      log: vi.fn(),
    });
    const response = await app.inject({ method: 'POST', url: '/api/admin/telegram/accounts/acc_tg_test/discover' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ chats: [{ id: 'from-api', label: 'API', type: 'private' }] });
    expect(telegram.discoverChats).toHaveBeenCalledWith('acc_tg_test');
  });
});
