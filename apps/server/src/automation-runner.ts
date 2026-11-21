import { randomUUID } from 'node:crypto';
import type { AgentService } from '@memora/agent';
import type { AutomationJob, AutomationRun } from '@memora/shared';
import type { AutomationStore } from './automation-store.js';
import { formatAutomationTelegramMessage, type TelegramService } from './telegram.js';

export interface AutomationRunnerDeps {
  store: AutomationStore;
  agentService: AgentService;
  telegram: TelegramService;
  log?: (event: string, details?: Record<string, unknown>) => void;
  now?: () => number;
}

function lastAssistantText(messages: Array<{ role: string; content: string }>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.content.trim()) return message.content.trim();
  }
  return '';
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 4_000);
}

/** Esegue un job in una sessione Pi headless e salva il risultato nella cronologia. */
export class AutomationRunner {
  private readonly store: AutomationStore;
  private readonly agentService: AgentService;
  private readonly telegram: TelegramService;
  private readonly log: (event: string, details?: Record<string, unknown>) => void;
  private readonly now: () => number;

  constructor(deps: AutomationRunnerDeps) {
    this.store = deps.store;
    this.agentService = deps.agentService;
    this.telegram = deps.telegram;
    this.log = deps.log ?? (() => undefined);
    this.now = deps.now ?? Date.now;
  }

  async run(job: AutomationJob, trigger: AutomationRun['trigger']): Promise<AutomationRun> {
    const run: AutomationRun = {
      id: `run_${randomUUID()}`,
      jobId: job.id,
      trigger,
      status: 'running',
      startedAt: this.now(),
    };
    await this.store.saveRun(run);
    let sessionId: string | undefined;

    const finish = async (patch: Partial<AutomationRun>): Promise<AutomationRun> => {
      const finishedAt = this.now();
      const completed: AutomationRun = {
        ...run,
        ...patch,
        status: patch.status ?? 'failed',
        finishedAt,
        durationMs: finishedAt - run.startedAt,
        ...(sessionId ? { sessionId } : {}),
      };
      await this.store.saveRun(completed);
      if (job.notifyTelegram) await this.notify(job, completed);
      return completed;
    };

    try {
      for (let attempt = 1; attempt <= job.maxAttempts; attempt += 1) {
        try {
          const created = await this.agentService.createSession(
            undefined,
            undefined,
            undefined,
            job.projectId,
            job.agentProfileId,
            { autoTitle: false },
          );
          sessionId = created.sessionId;
          const current: AutomationRun = { ...run, ...(sessionId ? { sessionId } : {}) };
          await this.store.saveRun(current);

          if (job.mcp.enabled.length > 0) {
            await this.agentService.setSessionMcp(sessionId, job.mcp.enabled, job.mcp.allowWrites === true);
          }

          const timeoutMs = job.timeoutMinutes * 60_000;
          let timedOut = false;
          let timeoutHandle: NodeJS.Timeout | undefined;
          const timeout = new Promise<'timeout'>((resolve) => {
            timeoutHandle = setTimeout(() => {
              timedOut = true;
              void this.agentService.abort(sessionId!).catch(() => undefined);
              resolve('timeout');
            }, timeoutMs);
          });
          const completed = this.agentService.sendMessage(sessionId, job.prompt, () => undefined)
            .then(() => 'completed' as const)
            .catch((error: unknown) => {
              if (timedOut) return 'timeout' as const;
              throw error;
            });
          let outcome: 'completed' | 'timeout';
          try {
            outcome = await Promise.race([completed, timeout]);
          } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
          }
          if (outcome === 'timeout') {
            const output = await this.getOutput(sessionId);
            const result = await finish({
              status: 'timeout',
              error: `Timeout dopo ${job.timeoutMinutes} minuti`,
              ...(output ? { output } : {}),
            });
            await this.archiveSession(sessionId, job);
            return result;
          }

          const output = await this.getOutput(sessionId);
          const result = await finish({ status: 'completed', output });
          await this.archiveSession(sessionId, job);
          return result;
        } catch (error) {
          if (attempt < job.maxAttempts) {
            this.log('automation_retry', { jobId: job.id, attempt });
            await new Promise(resolve => setTimeout(resolve, 1_000));
            continue;
          }
          const output = sessionId ? await this.getOutput(sessionId) : '';
          if (sessionId) await this.archiveSession(sessionId, job);
          return finish({
            status: 'failed',
            error: safeError(error),
            ...(output ? { output } : {}),
          });
        }
      }
      return finish({ status: 'failed', error: 'Nessun tentativo eseguito' });
    } catch (error) {
      this.log('automation_run_failed', { jobId: job.id, error: safeError(error) });
      return finish({ status: 'failed', error: safeError(error) });
    }
  }

  private async getOutput(sessionId: string): Promise<string> {
    try {
      const messages = await this.agentService.getSessionMessages(sessionId);
      return lastAssistantText(messages);
    } catch {
      return '';
    }
  }

  private async archiveSession(sessionId: string, job: AutomationJob): Promise<void> {
    try {
      await this.agentService.renameSession(sessionId, `🤖 ${job.name}`.slice(0, 120));
      await this.agentService.setSessionArchived(sessionId, true);
    } catch {
      // La cronologia della run è già salvata: l'archiviazione è solo pulizia.
    }
  }

  private async notify(job: AutomationJob, run: AutomationRun): Promise<void> {
    try {
      const account = this.telegram.resolveAccount(job.telegramAccountId);
      if (!account || !account.enabled || !account.chatId || !account.tokenConfigured) {
        run.telegramStatus = 'skipped';
        if (account) run.telegramAccountId = account.id;
        await this.store.saveRun(run);
        return;
      }
      const status = run.status === 'completed' ? 'completed' : run.status === 'timeout' ? 'timeout' : 'failed';
      const message = formatAutomationTelegramMessage({
        jobName: job.name,
        status,
        output: run.output,
        error: run.error,
        finishedAt: run.finishedAt ?? this.now(),
        timezone: job.timezone,
      });
      await this.telegram.send(message, account.id);
      run.telegramAccountId = account.id;
      run.telegramStatus = 'sent';
    } catch (error) {
      run.telegramStatus = 'failed';
      run.telegramError = safeError(error);
      this.log('automation_telegram_failed', { jobId: job.id, error: run.telegramError });
    }
    await this.store.saveRun(run);
  }
}
