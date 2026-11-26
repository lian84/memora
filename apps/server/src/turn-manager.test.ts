import { describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@memora/shared';
import { TurnManager } from './turn-manager.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function event(type: string, sessionId: string): StreamEvent {
  return { type, sessionId, timestamp: Date.now(), payload: {} };
}

describe('TurnManager', () => {
  it('distingue la sorgente e notifica il testo finale', async () => {
    const completions: Array<{ source: string; text: string }> = [];
    const manager = new TurnManager({
      maxConcurrent: 1,
      onTurnComplete: completion => {
        completions.push({ source: completion.turn.source, text: completion.text });
      },
      agentService: {
        sendMessage: vi.fn(async (sessionId: string, _text: string, onEvent: (event: StreamEvent) => void) => {
          onEvent({ type: 'message_update', sessionId, timestamp: Date.now(), payload: { assistantMessageEvent: { type: 'text_delta', delta: 'Risposta' } } });
        }),
        abort: vi.fn(async () => undefined),
      },
    });
    manager.start('s1', 'web');
    manager.startTelegram('s2', 'telegram');
    await vi.waitFor(() => expect(completions).toHaveLength(2));
    expect(completions).toEqual([
      { source: 'web', text: 'Risposta' },
      { source: 'telegram', text: 'Risposta' },
    ]);
  });

  it('esegue al massimo due turni e accoda gli altri', async () => {
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const calls: string[] = [];
    const manager = new TurnManager({
      maxConcurrent: 2,
      agentService: {
        sendMessage: vi.fn(async (sessionId: string, _text: string, onEvent: (event: StreamEvent) => void) => {
          calls.push(sessionId);
          const gate = deferred();
          gates.set(sessionId, gate);
          onEvent(event('message_start', sessionId));
          await gate.promise;
        }),
        abort: vi.fn(async () => undefined),
      },
    });
    const first = manager.start('s1', 'a');
    const second = manager.start('s2', 'b');
    const third = manager.start('s3', 'c');
    await vi.waitFor(() => expect(calls).toEqual(['s1', 's2']));
    expect(first.status).toBe('running');
    expect(second.status).toBe('running');
    expect(third.status).toBe('queued');
    gates.get('s1')!.resolve();
    await vi.waitFor(() => expect(calls).toEqual(['s1', 's2', 's3']));
    expect(manager.getCurrent('s1')?.status).toBe('completed');
    gates.get('s2')!.resolve();
    gates.get('s3')!.resolve();
  });

  it('accoda i messaggi della stessa sessione senza avviarli in parallelo', async () => {
    const gate = deferred();
    const calls: string[] = [];
    const manager = new TurnManager({
      maxConcurrent: 2,
      agentService: {
        sendMessage: vi.fn(async (sessionId: string) => {
          calls.push(sessionId);
          await gate.promise;
        }),
        abort: vi.fn(async () => undefined),
      },
    });
    const first = manager.start('s1', 'prima');
    const second = manager.start('s1', 'seconda');
    await vi.waitFor(() => expect(calls).toEqual(['s1']));
    expect(first.status).toBe('running');
    expect(second.status).toBe('queued');
    expect(manager.getCurrent('s1')?.turnId).toBe(first.turnId);
    gate.resolve();
    await vi.waitFor(() => expect(calls).toEqual(['s1', 's1']));
  });


  it('aumenta la concorrenza a runtime senza interrompere i turni attivi', async () => {
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const calls: string[] = [];
    const manager = new TurnManager({
      maxConcurrent: 1,
      agentService: {
        sendMessage: vi.fn(async (sessionId: string) => {
          calls.push(sessionId);
          const gate = deferred();
          gates.set(sessionId, gate);
          await gate.promise;
        }),
        abort: vi.fn(async () => undefined),
      },
    });
    manager.start('s1', 'uno');
    manager.start('s2', 'due');
    manager.start('s3', 'tre');
    await vi.waitFor(() => expect(calls).toEqual(['s1']));
    manager.setMaxConcurrent(3);
    await vi.waitFor(() => expect(calls).toEqual(['s1', 's2', 's3']));
    expect(manager.getMaxConcurrent()).toBe(3);
    gates.get('s1')!.resolve();
    gates.get('s2')!.resolve();
    gates.get('s3')!.resolve();
  });

  it('espone il testo della richiesta per i turni in coda e lo mantiene nel replay', async () => {
    const gate = deferred();
    const manager = new TurnManager({
      maxConcurrent: 1,
      agentService: {
        sendMessage: vi.fn(async (sessionId: string, _text: string, onEvent: (event: StreamEvent) => void) => {
          onEvent(event('message_start', sessionId));
          await gate.promise;
        }),
        abort: vi.fn(async () => undefined),
      },
    });
    const running = manager.start('s1', 'prima');
    const queued = manager.start('s2', 'seconda');
    await vi.waitFor(() => expect(manager.getTurn(running.turnId)?.status).toBe('running'));
    expect(manager.getTurn(queued.turnId)).toMatchObject({ status: 'queued', text: 'seconda' });
    const received: Array<{ seq: number; event: StreamEvent }> = [];
    manager.subscribe(running.turnId, 1, entry => received.push(entry));
    expect(received.some(entry => entry.event.type === 'turn_status')).toBe(true);
    gate.resolve();
    await vi.waitFor(() => expect(manager.getTurn(running.turnId)?.status).toBe('completed'));
  });
  it('permette di rileggere gli eventi da una sequenza', async () => {
    const manager = new TurnManager({
      maxConcurrent: 1,
      agentService: {
        sendMessage: vi.fn(async (sessionId: string, _text: string, onEvent: (event: StreamEvent) => void) => {
          onEvent(event('message_start', sessionId));
          onEvent(event('message_end', sessionId));
        }),
        abort: vi.fn(async () => undefined),
      },
    });
    const turn = manager.start('s1', 'ciao');
    await vi.waitFor(() => expect(manager.getTurn(turn.turnId)?.status).toBe('completed'));
    const received: number[] = [];
    manager.subscribe(turn.turnId, 1, entry => received.push(entry.seq));
    expect(received.length).toBeGreaterThan(0);
    expect(received[0]).toBeGreaterThan(1);
  });

  it('annulla un turno in coda e uno in esecuzione', async () => {
    const gate = deferred();
    const abort = vi.fn(async () => undefined);
    const manager = new TurnManager({
      maxConcurrent: 1,
      agentService: {
        sendMessage: vi.fn(async () => { await gate.promise; }),
        abort,
      },
    });
    const running = manager.start('s1', 'uno');
    const queued = manager.start('s2', 'due');
    await vi.waitFor(() => expect(manager.getTurn(running.turnId)?.status).toBe('running'));
    expect(manager.getTurn(queued.turnId)?.status).toBe('queued');
    await manager.abort(queued.turnId);
    expect(manager.getTurn(queued.turnId)?.status).toBe('aborted');
    await manager.abort(running.turnId);
    expect(abort).toHaveBeenCalledWith('s1');
    gate.resolve();
    await vi.waitFor(() => expect(manager.getTurn(running.turnId)?.status).toBe('aborted'));
  });
});

describe('TurnManager persistence', () => {
  it('marca come interrotto un turno rimasto in esecuzione dopo un riavvio', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-turns-'));
    const persistencePath = path.join(root, 'config', 'turns.json');
    const gate = deferred();
    const first = new TurnManager({
      persistencePath,
      agentService: {
        sendMessage: vi.fn(async () => { await gate.promise; }),
        abort: vi.fn(async () => undefined),
      },
    });
    await first.load();
    const turn = first.start('s1', 'risposta interrotta');
    await vi.waitFor(() => expect(first.getTurn(turn.turnId)?.status).toBe('running'));
    await vi.waitFor(async () => expect(await fs.readFile(persistencePath, 'utf8')).toContain('running'));
    expect(await fs.readFile(persistencePath, 'utf8')).not.toContain('risposta interrotta');
    const second = new TurnManager({
      persistencePath,
      agentService: { sendMessage: vi.fn(), abort: vi.fn(async () => undefined) },
    });
    await second.load();
    expect(second.getCurrent('s1')).toMatchObject({ turnId: turn.turnId, status: 'interrupted', error: 'server_restart' });
    gate.resolve();
    await fs.rm(root, { recursive: true, force: true });
  });
});
