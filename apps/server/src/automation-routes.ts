import type { FastifyReply } from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { AutomationStore } from './automation-store.js';
import { AutomationStoreError } from './automation-store.js';
import type { AutomationScheduler } from './automation-scheduler.js';
import { AutomationRunError } from './automation-scheduler.js';
import { AutomationScheduleError } from './automation-schedule.js';
import { TelegramError, type TelegramService, type TelegramStore } from './telegram.js';

export interface AutomationRoutesDeps {
  store: AutomationStore;
  scheduler: AutomationScheduler;
  telegramStore: TelegramStore;
  telegram: TelegramService;
  log: (event: string, details?: Record<string, unknown>) => void;
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AutomationStoreError || error instanceof AutomationRunError || error instanceof AutomationScheduleError || error instanceof TelegramError) {
    return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}

export function registerAutomationRoutes(app: FastifyInstance, deps: AutomationRoutesDeps): void {
  app.get('/api/admin/automations', async (_request, reply) => {
    return reply.send({
      jobs: deps.store.listJobs().sort((a, b) => (a.nextRunAt ?? Number.MAX_SAFE_INTEGER) - (b.nextRunAt ?? Number.MAX_SAFE_INTEGER)),
    });
  });

  app.get<{ Querystring: { limit?: string } }>('/api/admin/automations/runs', async (request, reply) => {
    const limit = Math.min(200, Math.max(1, Number(request.query.limit ?? 50) || 50));
    return reply.send({ runs: await deps.store.listRuns(undefined, limit) });
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/admin/automations/:id/runs', async (request, reply) => {
    const limit = Math.min(200, Math.max(1, Number(request.query.limit ?? 50) || 50));
    return reply.send({ runs: await deps.store.listRuns(request.params.id, limit) });
  });

  app.post<{ Body: Record<string, unknown> | undefined }>('/api/admin/automations', async (request, reply) => {
    try {
      const job = await deps.store.createJob(request.body as never);
      return reply.status(201).send({ job });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> | undefined }>('/api/admin/automations/:id', async (request, reply) => {
    try {
      return reply.send({ job: await deps.store.updateJob(request.params.id, request.body ?? {}) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string }; Querystring: { confirm?: string } }>('/api/admin/automations/:id', async (request, reply) => {
    try {
      if (request.query.confirm !== request.params.id) return reply.status(400).send({ error: 'invalid_automation_confirmation' });
      return reply.send(await deps.store.deleteJob(request.params.id));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/admin/automations/:id/run', async (request, reply) => {
    try {
      return reply.status(202).send(deps.scheduler.startNow(request.params.id));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/api/admin/telegram/accounts', async (_request, reply) => {
    return reply.send({ accounts: deps.telegramStore.listAccounts() });
  });

  app.post<{ Body: Record<string, unknown> | undefined }>('/api/admin/telegram/accounts', async (request, reply) => {
    try {
      const account = await deps.telegramStore.createAccount((request.body ?? {}) as never);
      return reply.status(201).send({ account });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> | undefined }>('/api/admin/telegram/accounts/:id', async (request, reply) => {
    try {
      const account = await deps.telegramStore.updateAccount(request.params.id, (request.body ?? {}) as never);
      return reply.send({ account });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string }; Querystring: { confirm?: string } }>('/api/admin/telegram/accounts/:id', async (request, reply) => {
    try {
      if (request.query.confirm !== request.params.id) return reply.status(400).send({ error: 'invalid_telegram_account_confirmation' });
      return reply.send(await deps.telegramStore.deleteAccount(request.params.id));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/admin/telegram/accounts/:id/test', async (request, reply) => {
    try {
      await deps.telegram.test(request.params.id);
      return reply.send({ ok: true });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/admin/telegram/accounts/:id/discover', async (request, reply) => {
    try {
      return reply.send({ chats: await deps.telegram.discoverChats(request.params.id) });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
