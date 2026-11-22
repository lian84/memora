import type { FastifyInstance } from 'fastify';
import type { MonitorService } from './monitor.js';

export function registerMonitorRoutes(app: FastifyInstance, deps: { monitor: MonitorService }): void {
  app.get('/api/admin/monitor', async (_request, reply) => {
    return reply.send({ status: await deps.monitor.getStatus(false) });
  });

  app.post('/api/admin/monitor/check', async (_request, reply) => {
    return reply.send({ status: await deps.monitor.getStatus(true) });
  });

  app.patch<{ Body: Record<string, unknown> | undefined }>('/api/admin/monitor', async (request, reply) => {
    return reply.send({ status: await deps.monitor.updateSettings({ ...(request.body ?? {}) }) });
  });
}
