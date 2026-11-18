import { afterEach, describe, expect, it, vi } from 'vitest';
import fastify from 'fastify';
import type { StreamEvent } from '@memora/shared';
import { TurnManager } from './turn-manager.js';
import { registerTurnRoutes } from './turn-routes.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('turn SSE end-to-end', () => {
  let app: Awaited<ReturnType<typeof fastify>> | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('serve due client SSE indipendenti e chiude entrambi al completamento', async () => {
    app = fastify();
    const gate = deferred();
    const manager = new TurnManager({
      maxConcurrent: 2,
      agentService: {
        sendMessage: vi.fn(async (sessionId: string, _text: string, onEvent: (event: StreamEvent) => void) => {
          onEvent({ type: 'message_update', sessionId, timestamp: Date.now(), payload: { assistantMessageEvent: { type: 'text_delta', delta: 'Ciao' } } });
          await gate.promise;
          onEvent({ type: 'message_update', sessionId, timestamp: Date.now(), payload: { assistantMessageEvent: { type: 'text_delta', delta: ' mondo' } } });
        }),
        abort: vi.fn(async () => undefined),
      },
    });
    registerTurnRoutes(app, {
      turns: manager,
      hasSession: async () => true,
      chatAttachmentStore: { loadMany: async () => [], toModelContext: async attachment => attachment as never },
      reads: { getAll: () => ({}), mark: async () => undefined } as never,
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const base = `http://127.0.0.1:${address.port}`;

    const started = await fetch(`${base}/api/sessions/s1/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'ciao' }),
    });
    expect(started.status).toBe(202);
    const turn = (await started.json() as { turn: { turnId: string } }).turn;
    const first = await fetch(`${base}/api/sessions/s1/turns/${turn.turnId}/events?after=0`);
    const second = await fetch(`${base}/api/sessions/s1/turns/${turn.turnId}/events?after=0`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    gate.resolve();
    const [firstBody, secondBody] = await Promise.all([first.text(), second.text()]);
    expect(firstBody).toContain('Ciao');
    expect(firstBody).toContain(' mondo');
    expect(firstBody).toContain('turn_complete');
    expect(secondBody).toBe(firstBody);
    expect(manager.getTurn(turn.turnId)?.status).toBe('completed');
  });

  it('permette a un secondo client di rileggere un turno già completato', async () => {
    app = fastify();
    const manager = new TurnManager({
      maxConcurrent: 1,
      agentService: {
        sendMessage: vi.fn(async (sessionId: string, _text: string, onEvent: (event: StreamEvent) => void) => {
          onEvent({ type: 'message_update', sessionId, timestamp: Date.now(), payload: { assistantMessageEvent: { type: 'text_delta', delta: 'persistito' } } });
        }),
        abort: vi.fn(async () => undefined),
      },
    });
    registerTurnRoutes(app, {
      turns: manager,
      hasSession: async () => true,
      chatAttachmentStore: { loadMany: async () => [], toModelContext: async attachment => attachment as never },
      reads: { getAll: () => ({}), mark: async () => undefined } as never,
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const base = `http://127.0.0.1:${address.port}`;
    const started = await fetch(`${base}/api/sessions/s1/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'ciao' }),
    });
    const turn = (await started.json() as { turn: { turnId: string } }).turn;
    await vi.waitFor(() => expect(manager.getTurn(turn.turnId)?.status).toBe('completed'));
    const replay = await fetch(`${base}/api/sessions/s1/turns/${turn.turnId}/events?after=1`);
    const body = await replay.text();
    expect(body).toContain('persistito');
    expect(body).not.toContain('"seq":1');
  });
});
