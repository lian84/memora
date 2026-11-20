import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentService } from '@memora/agent';
import type { AutomationJob } from '@memora/shared';
import { AutomationStore } from './automation-store.js';
import { AutomationRunner } from './automation-runner.js';
import type { TelegramService } from './telegram.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-runner-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

const base = {
  name: 'Riepilogo', prompt: 'Fai il riepilogo', cron: '0 9 * * *', timezone: 'Europe/Rome',
  enabled: true, notifyTelegram: false, timeoutMinutes: 10, maxAttempts: 1, mcp: { enabled: [] },
};

function fakeAgent(overrides: Record<string, unknown> = {}): AgentService {
  return {
    createSession: vi.fn(async () => ({ sessionId: 'session-1' })),
    setSessionMcp: vi.fn(async () => ({ enabled: [], accounts: {} })),
    sendMessage: vi.fn(async () => ({ sourcesUsed: [], memoryCandidatesCreated: [] })),
    getSessionMessages: vi.fn(async () => [
      { entryId: 'u1', role: 'user', content: 'Fai il riepilogo', timestamp: Date.now() },
      { entryId: 'a1', role: 'assistant', content: 'Risultato finale', timestamp: Date.now() },
    ]),
    renameSession: vi.fn(async () => ({})),
    setSessionArchived: vi.fn(async () => ({})),
    abort: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as AgentService;
}

function fakeTelegram(overrides: Record<string, unknown> = {}): TelegramService {
  return {
    configured: true,
    getSettings: () => ({ enabled: true, chatId: '42', tokenConfigured: true, tokenSource: 'secret', tokenEditable: true }),
    send: vi.fn(async () => 1),
    ...overrides,
  } as unknown as TelegramService;
}

async function setup(): Promise<{ store: AutomationStore; job: AutomationJob }> {
  const store = new AutomationStore({ dataDir: await tempDir() });
  await store.load();
  const job = await store.createJob(base);
  return { store, job };
}

describe('AutomationRunner', () => {
  it('esegue il prompt, salva l’output e archivia la sessione', async () => {
    const { store, job } = await setup();
    const agent = fakeAgent();
    const runner = new AutomationRunner({ store, agentService: agent, telegram: fakeTelegram() });
    const run = await runner.run(job, 'schedule');
    expect(run.status).toBe('completed');
    expect(run.output).toBe('Risultato finale');
    expect(agent.createSession).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, undefined, { autoTitle: false });
    expect(agent.sendMessage).toHaveBeenCalledWith('session-1', job.prompt, expect.any(Function));
    expect(agent.setSessionArchived).toHaveBeenCalledWith('session-1', true);
    expect((await store.getRun(run.id))?.output).toBe('Risultato finale');
  });

  it('attiva MCP con le impostazioni del job', async () => {
    const { store, job } = await setup();
    const updated = await store.updateJob(job.id, { mcp: { enabled: ['notion'], allowWrites: true } });
    const agent = fakeAgent();
    const runner = new AutomationRunner({ store, agentService: agent, telegram: fakeTelegram() });
    const run = await runner.run(updated, 'manual');
    expect(run.status).toBe('completed');
    expect(agent.setSessionMcp).toHaveBeenCalledWith('session-1', ['notion'], true);
  });

  it('registra un errore del provider senza perdere la run', async () => {
    const { store, job } = await setup();
    const agent = fakeAgent({ sendMessage: vi.fn(async () => { throw new Error('provider down'); }) });
    const runner = new AutomationRunner({ store, agentService: agent, telegram: fakeTelegram() });
    const run = await runner.run(job, 'manual');
    expect(run.status).toBe('failed');
    expect(run.error).toContain('provider down');
    expect(agent.setSessionArchived).toHaveBeenCalled();
  });

  it('invia il risultato a Telegram quando richiesto', async () => {
    const { store, job } = await setup();
    const withTelegram = await store.updateJob(job.id, { notifyTelegram: true });
    const telegram = fakeTelegram();
    const runner = new AutomationRunner({ store, agentService: fakeAgent(), telegram });
    const run = await runner.run(withTelegram, 'schedule');
    expect(run.status).toBe('completed');
    expect(run.telegramStatus).toBe('sent');
    expect(telegram.send).toHaveBeenCalledWith(expect.stringContaining('Risultato finale'));
    expect((await store.getRun(run.id))?.telegramStatus).toBe('sent');
  });

  it('non fa fallire la run se Telegram è spento', async () => {
    const { store, job } = await setup();
    const withTelegram = await store.updateJob(job.id, { notifyTelegram: true });
    const telegram = fakeTelegram({ configured: false, getSettings: () => ({ enabled: false, chatId: '', tokenConfigured: false, tokenSource: 'none', tokenEditable: true }) });
    const runner = new AutomationRunner({ store, agentService: fakeAgent(), telegram });
    const run = await runner.run(withTelegram, 'schedule');
    expect(run.status).toBe('completed');
    expect(run.telegramStatus).toBe('skipped');
  });
});
