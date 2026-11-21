import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AUTOMATION_LIMITS,
  isMcpServerId,
  type AutomationJob,
  type AutomationJobInput,
  type AutomationMcpSettings,
  type AutomationRun,
} from '@memora/shared';
import { nextRunAt, validateCron, validateTimezone } from './automation-schedule.js';

interface JobsFile {
  version: 1;
  jobs: AutomationJob[];
}

export class AutomationStoreError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'AutomationStoreError';
  }
}

export interface AutomationStoreOptions {
  dataDir: string;
  warn?: (message: string) => void;
  now?: () => number;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new AutomationStoreError('invalid_automation', `${field} non valido`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new AutomationStoreError('invalid_automation', `${field} non valido`);
  return trimmed;
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 160 || !/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new AutomationStoreError('invalid_automation', `${field} non valido`);
  }
  return value;
}

function normalizeMcp(value: unknown): AutomationMcpSettings {
  if (value === undefined || value === null) return { enabled: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AutomationStoreError('invalid_automation', 'Configurazione MCP non valida');
  const data = value as { enabled?: unknown; allowWrites?: unknown };
  if (data.enabled !== undefined && !Array.isArray(data.enabled)) throw new AutomationStoreError('invalid_automation', 'Configurazione MCP non valida');
  const enabled = Array.isArray(data.enabled) ? [...new Set(data.enabled)] : [];
  if (enabled.some(server => !isMcpServerId(server))) throw new AutomationStoreError('invalid_automation', 'Server MCP non valido');
  return { enabled: enabled as AutomationMcpSettings['enabled'], ...(data.allowWrites === true ? { allowWrites: true } : {}) };
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number, field: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new AutomationStoreError('invalid_automation', `${field} non valido`);
  }
  return value;
}

function normalizeJob(input: unknown, previous?: AutomationJob, now = Date.now()): AutomationJob {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AutomationStoreError('invalid_automation', 'Automazione non valida');
  const body = input as Record<string, unknown>;
  const name = body.name === undefined && previous ? previous.name : text(body.name, 'Nome', AUTOMATION_LIMITS.nameMax);
  const prompt = body.prompt === undefined && previous ? previous.prompt : text(body.prompt, 'Prompt', AUTOMATION_LIMITS.promptMax);
  const cron = body.cron === undefined && previous ? previous.cron : text(body.cron, 'Cron', AUTOMATION_LIMITS.cronMax);
  const timezone = body.timezone === undefined && previous
    ? previous.timezone
    : validateTimezone(typeof body.timezone === 'string' ? body.timezone : '');
  validateCron(cron, timezone);

  const enabled = body.enabled === undefined ? previous?.enabled ?? true : body.enabled === true;
  const projectId = body.projectId === undefined ? previous?.projectId : optionalId(body.projectId, 'Progetto');
  const agentProfileId = body.agentProfileId === undefined ? previous?.agentProfileId : optionalId(body.agentProfileId, 'Profilo agente');
  const mcp = body.mcp === undefined ? previous?.mcp ?? { enabled: [] } : normalizeMcp(body.mcp);
  const notifyTelegram = body.notifyTelegram === undefined ? previous?.notifyTelegram ?? false : body.notifyTelegram === true;
  const webEnabled = body.webEnabled === undefined ? previous?.webEnabled ?? false : body.webEnabled === true;
  const telegramAccountId = body.telegramAccountId === undefined ? previous?.telegramAccountId : optionalId(body.telegramAccountId, 'Account Telegram');
  const timeoutMinutes = boundedNumber(
    body.timeoutMinutes,
    previous?.timeoutMinutes ?? AUTOMATION_LIMITS.defaultTimeoutMinutes,
    AUTOMATION_LIMITS.timeoutMinutesMin,
    AUTOMATION_LIMITS.timeoutMinutesMax,
    'Timeout',
  );
  const maxAttempts = boundedNumber(body.maxAttempts, previous?.maxAttempts ?? 1, 1, AUTOMATION_LIMITS.maxAttemptsMax, 'Tentativi');
  const inputId = typeof body.id === 'string' && /^job_[a-zA-Z0-9-]+$/.test(body.id) ? body.id : undefined;
  const inputCreatedAt = typeof body.createdAt === 'number' && Number.isFinite(body.createdAt) ? body.createdAt : now;
  const base = previous ?? {
    id: inputId ?? `job_${randomUUID()}`,
    createdAt: inputCreatedAt,
    updatedAt: now,
  };
  const scheduleChanged = !previous || previous.cron !== cron || previous.timezone !== timezone || previous.enabled !== enabled;
  const next = enabled
    ? scheduleChanged || !previous?.nextRunAt
      ? nextRunAt(cron, timezone, now)
      : previous.nextRunAt
    : undefined;
  return {
    ...base,
    name,
    prompt,
    cron,
    timezone,
    enabled,
    ...(projectId ? { projectId } : {}),
    ...(agentProfileId ? { agentProfileId } : {}),
    mcp,
    notifyTelegram,
    webEnabled,
    ...(telegramAccountId ? { telegramAccountId } : {}),
    timeoutMinutes,
    maxAttempts,
    updatedAt: now,
    nextRunAt: next,
  };
}

/** Store file-based delle automazioni e della cronologia delle esecuzioni. */
export class AutomationStore {
  readonly jobsPath: string;
  readonly runsDir: string;
  private readonly configDir: string;
  private readonly warn: (message: string) => void;
  private readonly now: () => number;
  private jobs: AutomationJob[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: AutomationStoreOptions) {
    this.configDir = path.join(options.dataDir, 'automations');
    this.jobsPath = path.join(this.configDir, 'jobs.json');
    this.runsDir = path.join(this.configDir, 'runs');
    this.warn = options.warn ?? (() => {});
    this.now = options.now ?? Date.now;
  }

  async load(): Promise<void> {
    this.jobs = [];
    try {
      const raw = JSON.parse(await fs.readFile(this.jobsPath, 'utf8')) as unknown;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid');
      const data = raw as Partial<JobsFile>;
      if (data.version !== 1 || !Array.isArray(data.jobs)) throw new Error('invalid');
      for (const value of data.jobs) {
        try {
          const raw = value as Partial<AutomationJob>;
          const job = normalizeJob(value, undefined, this.now());
          const storedNext = typeof raw.nextRunAt === 'number' && Number.isFinite(raw.nextRunAt) ? raw.nextRunAt : job.nextRunAt;
          // Conserva il prossimo run persistito: dopo un riavvio il job scaduto
          // viene recuperato una sola volta dallo scheduler.
          this.jobs.push(job.enabled ? { ...job, ...(storedNext !== undefined ? { nextRunAt: storedNext } : {}) } : { ...job, nextRunAt: undefined });
        } catch {
          this.warn('automation ignored: invalid job');
        }
      }
      await fs.chmod(this.jobsPath, 0o600).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warn('automations file ignored: invalid or unreadable format');
    }
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.runsDir, { recursive: true, mode: 0o700 });
  }

  listJobs(): AutomationJob[] {
    return this.jobs.map(job => structuredClone(job));
  }

  getJob(id: string): AutomationJob | undefined {
    const job = this.jobs.find(item => item.id === id);
    return job ? structuredClone(job) : undefined;
  }

  async createJob(input: AutomationJobInput): Promise<AutomationJob> {
    const job = normalizeJob(input, undefined, this.now());
    this.jobs.push(job);
    await this.persist();
    return structuredClone(job);
  }

  async updateJob(id: string, input: unknown): Promise<AutomationJob> {
    const index = this.jobs.findIndex(item => item.id === id);
    if (index < 0) throw new AutomationStoreError('automation_not_found', 'Automazione non trovata', 404);
    const updated = normalizeJob(input, this.jobs[index], this.now());
    this.jobs[index] = updated;
    await this.persist();
    return structuredClone(updated);
  }

  async setEnabled(id: string, enabled: boolean): Promise<AutomationJob> {
    const index = this.jobs.findIndex(item => item.id === id);
    if (index < 0) throw new AutomationStoreError('automation_not_found', 'Automazione non trovata', 404);
    const current = this.jobs[index];
    const next = enabled ? nextRunAt(current.cron, current.timezone, this.now()) : undefined;
    const updated: AutomationJob = {
      ...current,
      enabled,
      updatedAt: this.now(),
      ...(next !== undefined ? { nextRunAt: next } : { nextRunAt: undefined }),
    };
    this.jobs[index] = updated;
    await this.persist();
    return structuredClone(updated);
  }

  async recordScheduledRun(id: string, run: AutomationRun): Promise<AutomationJob> {
    const index = this.jobs.findIndex(item => item.id === id);
    if (index < 0) throw new AutomationStoreError('automation_not_found', 'Automazione non trovata', 404);
    const current = this.jobs[index];
    const next = current.enabled ? nextRunAt(current.cron, current.timezone, this.now()) : undefined;
    const updated: AutomationJob = {
      ...current,
      lastRunAt: run.startedAt,
      lastRunId: run.id,
      lastRunStatus: run.status,
      ...(next !== undefined ? { nextRunAt: next } : { nextRunAt: undefined }),
    };
    this.jobs[index] = updated;
    await this.persist();
    return structuredClone(updated);
  }

  async recordManualRun(id: string, run: AutomationRun): Promise<AutomationJob> {
    const index = this.jobs.findIndex(item => item.id === id);
    if (index < 0) throw new AutomationStoreError('automation_not_found', 'Automazione non trovata', 404);
    const updated: AutomationJob = {
      ...this.jobs[index],
      lastRunAt: run.startedAt,
      lastRunId: run.id,
      lastRunStatus: run.status,
    };
    this.jobs[index] = updated;
    await this.persist();
    return structuredClone(updated);
  }

  async deleteJob(id: string): Promise<{ id: string }> {
    const index = this.jobs.findIndex(item => item.id === id);
    if (index < 0) throw new AutomationStoreError('automation_not_found', 'Automazione non trovata', 404);
    this.jobs.splice(index, 1);
    await this.persist();
    await this.deleteRuns(id);
    return { id };
  }

  async saveRun(run: AutomationRun): Promise<void> {
    await fs.mkdir(this.runsDir, { recursive: true, mode: 0o700 });
    const file = path.join(this.runsDir, `${run.id}.json`);
    const temporary = path.join(this.runsDir, `.run.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600).catch(() => undefined);
    await this.pruneRuns(run.jobId);
  }

  async listRuns(jobId?: string, limit: number = AUTOMATION_LIMITS.runHistoryLimit): Promise<AutomationRun[]> {
    const names = await fs.readdir(this.runsDir).catch(() => [] as string[]);
    const runs: AutomationRun[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const value = JSON.parse(await fs.readFile(path.join(this.runsDir, name), 'utf8')) as AutomationRun;
        if (value && typeof value.id === 'string' && typeof value.jobId === 'string' && typeof value.startedAt === 'number' && (!jobId || value.jobId === jobId)) {
          runs.push(value);
        }
      } catch {
        // Una run corrotta non deve bloccare la cronologia.
      }
    }
    return runs.sort((a, b) => b.startedAt - a.startedAt).slice(0, Math.max(1, limit));
  }

  /** Marca come interrotte le run rimaste `running` dopo un riavvio del servizio. */
  async recoverInterruptedRuns(): Promise<number> {
    const names = await fs.readdir(this.runsDir).catch(() => [] as string[]);
    let recovered = 0;
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const file = path.join(this.runsDir, name);
        const run = JSON.parse(await fs.readFile(file, 'utf8')) as AutomationRun;
        if (run.status !== 'running') continue;
        const updated: AutomationRun = {
          ...run,
          status: 'interrupted',
          finishedAt: this.now(),
          durationMs: this.now() - run.startedAt,
          error: 'Servizio riavviato durante l’esecuzione',
        };
        await fs.writeFile(file, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
        recovered += 1;
      } catch {
        // Ignora run corrotte.
      }
    }
    return recovered;
  }

  async getRun(id: string): Promise<AutomationRun | undefined> {
    if (!/^run_[a-zA-Z0-9-]+$/.test(id)) return undefined;
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.runsDir, `${id}.json`), 'utf8')) as AutomationRun;
      return value && typeof value.id === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private async pruneRuns(jobId: string): Promise<void> {
    const runs = await this.listRuns(jobId, 10_000);
    for (const run of runs.slice(100)) {
      await fs.unlink(path.join(this.runsDir, `${run.id}.json`)).catch(() => undefined);
    }
  }

  private async deleteRuns(jobId: string): Promise<void> {
    const runs = await this.listRuns(jobId, 10_000);
    for (const run of runs) await fs.unlink(path.join(this.runsDir, `${run.id}.json`)).catch(() => undefined);
  }

  private persist(): Promise<void> {
    // Snapshot immediato: aggiornamenti concorrenti (scheduler + UI) non devono
    // sovrascriversi a vicenda.
    const payload = JSON.stringify({ version: 1, jobs: this.jobs } satisfies JobsFile, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
      const temporary = path.join(this.configDir, `.jobs.${process.pid}.${Date.now()}.tmp`);
      await fs.writeFile(temporary, `${payload}\n`, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.jobsPath);
      await fs.chmod(this.jobsPath, 0o600);
    });
    return this.writeChain;
  }
}
