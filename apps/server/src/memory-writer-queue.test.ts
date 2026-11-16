import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryWriterQueue } from './memory-writer-queue.js';
import type { MemoryTurnInput } from '@memora/shared';

const turn = (userText: string, turnId?: string): MemoryTurnInput => ({ sessionId: 'test', userText, turnId });
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('MemoryWriterQueue', () => {
  it('returns before slow processing, runs serially and drains on close', async () => {
    let active = 0, maxActive = 0;
    const done: string[] = [];
    const writer = { processTurn: vi.fn(async (input: MemoryTurnInput) => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 100));
      done.push(input.userText); active--; return { created: [] };
    }) };
    const events: string[] = [];
    const queue = new MemoryWriterQueue(writer, event => events.push(event));
    const start = performance.now();
    await queue.processTurn(turn('first'));
    await queue.processTurn(turn('second'));
    expect(performance.now() - start).toBeLessThan(80);
    expect(writer.processTurn).not.toHaveBeenCalled();
    await queue.close();
    expect(done).toEqual(['first', 'second']);
    expect(maxActive).toBe(1);
    expect(events.filter(event => event === 'completed')).toHaveLength(2);
    await queue.processTurn(turn('late'));
    expect(events).toContain('rejected');
  });

  it('reports failures without leaking error contents and continues', async () => {
    const writer = { processTurn: vi.fn().mockRejectedValueOnce(new Error('private data')).mockResolvedValueOnce({ created: [] }) };
    const events: unknown[] = [];
    const queue = new MemoryWriterQueue(writer, (...event) => events.push(event), { maxAttempts: 1 });
    await queue.processTurn(turn('first')); await queue.processTurn(turn('second'));
    await queue.close();
    expect(writer.processTurn).toHaveBeenCalledTimes(2);
    expect(events.some(event => JSON.stringify(event).includes('failed'))).toBe(true);
    expect(JSON.stringify(events)).not.toContain('private data');
  });
});


describe('durable MemoryWriterQueue', () => {
  it('riprende i job persistiti dopo un riavvio', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-queue-'));
    dirs.push(dir);
    const firstWriter = { processTurn: vi.fn(async () => ({ created: [] })) };
    const first = new MemoryWriterQueue(firstWriter, () => {}, { dataDir: dir, retryDelayMs: 0 });
    await first.initialize();
    await first.processTurn(turn('persisted', 'turn-persisted'));
    await first.close();
    expect(firstWriter.processTurn).not.toHaveBeenCalled();

    const secondWriter = { processTurn: vi.fn(async () => ({ created: [] })) };
    const second = new MemoryWriterQueue(secondWriter, () => {}, { dataDir: dir, retryDelayMs: 0 });
    await second.initialize();
    await second.waitForIdle();
    expect(secondWriter.processTurn).toHaveBeenCalledWith(expect.objectContaining({ userText: 'persisted', turnId: 'turn-persisted' }));
    await second.close();
  });

  it('è idempotente sullo stesso turnId', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memora-queue-'));
    dirs.push(dir);
    const writer = { processTurn: vi.fn(async () => ({ created: [] })) };
    const queue = new MemoryWriterQueue(writer, () => {}, { dataDir: dir, retryDelayMs: 0 });
    await queue.initialize();
    await queue.processTurn(turn('same', 'turn-same'));
    await queue.processTurn(turn('same', 'turn-same'));
    await queue.waitForIdle();
    expect(writer.processTurn).toHaveBeenCalledTimes(1);
    await queue.close();
  });

  it('ritenta un job fallito e poi lo completa', async () => {
    const writer = {
      processTurn: vi.fn()
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValueOnce({ created: [] }),
    };
    const events: string[] = [];
    const queue = new MemoryWriterQueue(writer, (event) => events.push(event), { maxAttempts: 2, retryDelayMs: 0 });
    await queue.processTurn(turn('retry', 'turn-retry'));
    await queue.waitForIdle();
    expect(writer.processTurn).toHaveBeenCalledTimes(2);
    expect(queue.getStats()).toMatchObject({ completed: 1, failed: 0, attempts: 2 });
    expect(events).toContain('failed');
    expect(events).toContain('completed');
    await queue.close();
  });
});
