import type { AutomationJob, AutomationRun } from '@memora/shared';
import type { AutomationStore } from './automation-store.js';
import type { AutomationRunner } from './automation-runner.js';

export interface AutomationSchedulerOptions {
  store: AutomationStore;
  runner: AutomationRunner;
  intervalMs?: number;
  log?: (event: string, details?: Record<string, unknown>) => void;
  now?: () => number;
}

/** Scheduler in-process: funziona anche senza browser, finché il servizio è attivo. */
export class AutomationScheduler {
  private readonly store: AutomationStore;
  private readonly runner: AutomationRunner;
  private readonly intervalMs: number;
  private readonly log: (event: string, details?: Record<string, unknown>) => void;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  private stopped = true;
  private readonly activeJobs = new Set<string>();

  constructor(options: AutomationSchedulerOptions) {
    this.store = options.store;
    this.runner = options.runner;
    this.intervalMs = options.intervalMs ?? 15_000;
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => { void this.checkNow(); }, this.intervalMs);
    this.timer.unref?.();
    void this.checkNow();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isRunning(jobId: string): boolean {
    return this.activeJobs.has(jobId);
  }

  /** Controlla i job scaduti. Un solo job alla volta per non saturare la macchina. */
  async checkNow(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const due = this.store.listJobs()
        .filter(job => job.enabled && typeof job.nextRunAt === 'number' && job.nextRunAt <= this.now())
        .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0));
      for (const job of due) {
        if (this.activeJobs.has(job.id)) continue;
        await this.executeScheduled(job);
      }
    } catch (error) {
      this.log('automation_scheduler_error', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.checking = false;
    }
  }

  async runNow(jobId: string): Promise<AutomationRun> {
    const job = this.store.getJob(jobId);
    if (!job) throw new AutomationRunError('automation_not_found', 'Automazione non trovata', 404);
    if (this.activeJobs.has(jobId)) throw new AutomationRunError('automation_busy', 'Questa automazione è già in esecuzione', 409);
    return this.execute(job, 'manual');
  }

  /** Avvia subito una run e ritorna senza attendere la fine del turno. */
  startNow(jobId: string): { started: true; jobId: string } {
    const job = this.store.getJob(jobId);
    if (!job) throw new AutomationRunError('automation_not_found', 'Automazione non trovata', 404);
    if (this.activeJobs.has(jobId)) throw new AutomationRunError('automation_busy', 'Questa automazione è già in esecuzione', 409);
    this.activeJobs.add(job.id);
    void this.executeReserved(job, 'manual').catch(error => {
      this.log('automation_execution_error', { jobId: job.id, error: error instanceof Error ? error.message : String(error) });
    });
    return { started: true, jobId };
  }

  private async executeScheduled(job: AutomationJob): Promise<void> {
    if (this.activeJobs.has(job.id)) return;
    this.activeJobs.add(job.id);
    this.log('automation_started', { jobId: job.id, jobName: job.name });
    try {
      const run = await this.runner.run(job, 'schedule');
      await this.store.recordScheduledRun(job.id, run);
      this.log('automation_finished', { jobId: job.id, status: run.status, durationMs: run.durationMs });
    } catch (error) {
      this.log('automation_execution_error', { jobId: job.id, error: error instanceof Error ? error.message : String(error) });
      // Se il runner non riesce nemmeno a creare la run, riprogramma il job
      // per evitare un loop immediato a ogni tick.
      try { await this.store.setEnabled(job.id, job.enabled); } catch { /* job rimosso */ }
    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  private async execute(job: AutomationJob, trigger: 'manual'): Promise<AutomationRun> {
    this.activeJobs.add(job.id);
    return this.executeReserved(job, trigger);
  }

  private async executeReserved(job: AutomationJob, trigger: 'manual'): Promise<AutomationRun> {
    this.log('automation_started', { jobId: job.id, jobName: job.name, trigger });
    try {
      const run = await this.runner.run(job, trigger);
      await this.store.recordManualRun(job.id, run);
      this.log('automation_finished', { jobId: job.id, status: run.status, durationMs: run.durationMs });
      return run;
    } finally {
      this.activeJobs.delete(job.id);
    }
  }
}

export class AutomationRunError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'AutomationRunError';
  }
}
