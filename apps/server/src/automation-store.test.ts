import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationStore } from './automation-store.js';
import { AutomationScheduleError } from './automation-schedule.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-automation-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

const base = {
  name: 'Riepilogo',
  prompt: 'Prepara il riepilogo',
  cron: '0 9 * * *',
  timezone: 'Europe/Rome',
  enabled: true,
  notifyTelegram: false,
  timeoutMinutes: 10,
  maxAttempts: 1,
  mcp: { enabled: [] },
};

describe('AutomationStore', () => {
  it('crea, persiste e ricarica i job con il prossimo run', async () => {
    const dataDir = await tempDir();
    const fixedNow = new Date('2026-01-05T08:00:00Z').getTime();
    const store = new AutomationStore({ dataDir, now: () => fixedNow });
    await store.load();
    const job = await store.createJob(base);
    expect(job.id).toMatch(/^job_/);
    expect(job.nextRunAt).toBeGreaterThan(fixedNow);
    const reloaded = new AutomationStore({ dataDir, now: () => fixedNow });
    await reloaded.load();
    expect(reloaded.getJob(job.id)?.name).toBe('Riepilogo');
    const mode = (await fs.stat(store.jobsPath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('disattiva il job e rimuove il prossimo run', async () => {
    const dataDir = await tempDir();
    const store = new AutomationStore({ dataDir });
    await store.load();
    const job = await store.createJob(base);
    const disabled = await store.updateJob(job.id, { enabled: false });
    expect(disabled.enabled).toBe(false);
    expect(disabled.nextRunAt).toBeUndefined();
  });

  it('rifiuta cron e timezone invalidi', async () => {
    const dataDir = await tempDir();
    const store = new AutomationStore({ dataDir });
    await store.load();
    await expect(store.createJob({ ...base, cron: '* * *' })).rejects.toBeInstanceOf(AutomationScheduleError);
    await expect(store.createJob({ ...base, timezone: 'Non/Valida' })).rejects.toBeInstanceOf(AutomationScheduleError);
  });

  it('salva la cronologia e la elimina con il job', async () => {
    const dataDir = await tempDir();
    const store = new AutomationStore({ dataDir });
    await store.load();
    const job = await store.createJob(base);
    await store.saveRun({ id: 'run_test', jobId: job.id, trigger: 'manual', status: 'completed', startedAt: Date.now(), finishedAt: Date.now(), output: 'ok' });
    expect(await store.listRuns(job.id)).toHaveLength(1);
    await store.deleteJob(job.id);
    expect(await store.listRuns(job.id)).toHaveLength(0);
    expect(store.getJob(job.id)).toBeUndefined();
  });
});
