import { afterEach, describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import type { StreamEvent } from '@memora/shared';
import { TurnManager } from './turn-manager.js';
import { registerTurnRoutes } from './turn-routes.js';

describe('turn routes', () => {
  let app: Awaited<ReturnType<typeof fastify>> | null = null;
  afterEach(async () => { if (app) await app.close(); app = null; });

  it('restituisce lo stream di un turno e chiude al completamento', async () => {
    app = fastify();
    const manager = new TurnManager({
      maxConcurrent: 1,
      agentService: {
        sendMessage: vi.fn(async (sessionId: string, _text: string, onEvent: (event: StreamEvent) => void) => {
          onEvent({ type: 'message_start', sessionId, timestamp: Date.now(), payload: {} });
          onEvent({ type: 'message_update', sessionId, timestamp: Date.now(), payload: { assistantMessageEvent: { type: 'text_delta', delta: 'Ciao' } } });
        }),
        abort: vi.fn(async () => undefined),
      },
    });
    registerTurnRoutes(app, {
      turns: manager,
      hasSession: async () => true,
      chatAttachmentStore: { loadMany: async () => [], toModelContext: async attachment => attachment as never },
    });
    const started = await app.inject({ method: 'POST', url: '/api/sessions/s1/turns', payload: { text: 'ciao' } });
    expect(started.statusCode).toBe(202);
    const turn = started.json().turn;
    await vi.waitFor(() => expect(manager.getTurn(turn.turnId)?.status).toBe('completed'));
    const events = await app.inject({ method: 'GET', url: `/api/sessions/s1/turns/${turn.turnId}/events` });
    expect(events.statusCode).toBe(200);
    expect(events.body).toContain('message_update');
    expect(events.body).toContain('turn_complete');
    expect(events.body).toContain('"seq"');
  });

  it('accoda due richieste della stessa sessione e le espone in /api/turns', async () => {
    app = fastify();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const manager = new TurnManager({
      maxConcurrent: 1,
      agentService: {
        sendMessage: vi.fn(async () => { await gate; }),
        abort: vi.fn(async () => undefined),
      },
    });
    registerTurnRoutes(app, {
      turns: manager,
      hasSession: async () => true,
      chatAttachmentStore: { loadMany: async () => [], toModelContext: async attachment => attachment as never },
    });
    const first = await app.inject({ method: 'POST', url: '/api/sessions/s1/turns', payload: { text: 'prima' } });
    const second = await app.inject({ method: 'POST', url: '/api/sessions/s1/turns', payload: { text: 'seconda' } });
    expect(second.json().turn.status).toBe('queued');
    const list = await app.inject({ method: 'GET', url: '/api/turns' });
    expect(list.json().turns).toEqual(expect.arrayContaining([expect.objectContaining({ turnId: first.json().turn.turnId, status: 'running' })]));
    release();
  });
});
