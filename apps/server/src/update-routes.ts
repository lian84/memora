import type { FastifyInstance } from 'fastify';
import type { UpdateSettings } from '@memora/shared';
import type { UpdateService } from './update-check.js';

export function registerUpdateRoutes(app: FastifyInstance, deps: { updates: UpdateService }): void {
  app.get('/api/admin/update', async (_request, reply) => {
    return reply.send({ status: await deps.updates.getStatus(false) });
  });

  app.post('/api/admin/update/check', async (_request, reply) => {
    return reply.send({ status: await deps.updates.getStatus(true) });
  });

  app.patch<{ Body: { enabled?: unknown; notifyTelegram?: unknown } | undefined }>('/api/admin/update', async (request, reply) => {
    const current = await deps.updates.getStatus(false);
    const settings: UpdateSettings = {
      enabled: typeof request.body?.enabled === 'boolean' ? request.body.enabled : current.enabled,
      notifyTelegram: typeof request.body?.notifyTelegram === 'boolean' ? request.body.notifyTelegram : current.notifyTelegram,
    };
    return reply.send({ status: await deps.updates.updateSettings(settings) });
  });
}
