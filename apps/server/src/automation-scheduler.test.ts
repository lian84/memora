import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutomationRun } from '@memora/shared';
import { AutomationStore } from './automation-store.js';
import { AutomationScheduler, AutomationRunError } from './automation-scheduler.js';
import type { AutomationRunner } from './automation-runner.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-scheduler-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

const base = {
  name: 'Job', prompt: 'Fai qualcosa', cron: '0 9 * * *', timezone: 'Europe/Rome',
  enabled: true, notifyTelegram: false, timeoutMinutes: 10, maxAttempts: 1, mcp: { enabled: [] },
};

function completedRun(jobId: string): AutomationRun {
  return { id: `run_${Date.now()}`, jobId, trigger: 'schedule', status: 'completed', startedAt: Date.now(), finishedAt: Date.now(), output: 'fatto' };
}

describe('AutomationScheduler', () => {
  it('esegue un job scaduto una volta e riprogramma il successivo', async () => {
    const dataDir = await tempDir();
    let now = Date.now();
    const store = new AutomationStore({ dataDir, now: () => now });
    await store.load();
    const job = await store.createJob(base);
    now = (job.nextRunAt ?? now) + 1;
    const run = vi.fn(async (current: { id: string }) => completedRun(current.id));
    const scheduler = new AutomationScheduler({ store, runner: { run } as unknown as AutomationRunner, now: () => now });
    await scheduler.checkNow();
    expect(run).toHaveBeenCalledTimes(1);
    const updated = store.getJob(job.id);
    expect(updated?.lastRunStatus).toBe('completed');
    expect(updated?.nextRunAt).toBeGreaterThan(now);
    await scheduler.checkNow();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('non esegue job disabilitati', async () => {
    const dataDir = await tempDir();
    const store = new AutomationStore({ dataDir });
    await store.load();
    const job = await store.createJob({ ...base, enabled: false });
    const run = vi.fn();
    const scheduler = new AutomationScheduler({ store, runner: { run } as unknown as AutomationRunner });
    await scheduler.checkNow();
    expect(run).not.toHaveBeenCalled();
    expect(store.getJob(job.id)?.nextRunAt).toBeUndefined();
  });

  it('avvia una run manuale in background e impedisce il doppio avvio', async () => {
    const dataDir = await tempDir();
    const store = new AutomationStore({ dataDir });
    await store.load();
    const job = await store.createJob(base);
    let finish!: (run: AutomationRun) => void;
    const run = vi.fn(() => new Promise<AutomationRun>(resolve => { finish = resolve; }));
    const scheduler = new AutomationScheduler({ store, runner: { run } as unknown as AutomationRunner });
    expect(scheduler.startNow(job.id)).toEqual({ started: true, jobId: job.id });
    expect(() => scheduler.startNow(job.id)).toThrow(AutomationRunError);
    finish(completedRun(job.id));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.getJob(job.id)?.lastRunStatus).toBe('completed');
  });
});
