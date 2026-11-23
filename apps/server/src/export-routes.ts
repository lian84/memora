import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { DataExportService } from './export-data.js';
import { DataExportError } from './export-data.js';

function sendExportError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof DataExportError) return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  throw error;
}

export function registerExportRoutes(app: FastifyInstance, deps: { exports: DataExportService }): void {
  app.get('/api/admin/export', async (_request, reply) => {
    return reply.send({ status: await deps.exports.getStatus() });
  });

  app.post('/api/admin/export', async (_request, reply) => {
    try { return reply.send({ record: await deps.exports.create(), status: await deps.exports.getStatus() }); }
    catch (error) { return sendExportError(reply, error); }
  });

  app.get<{ Params: { id: string } }>('/api/admin/export/:id/download', async (request, reply) => {
    try {
      return reply
        .header('content-type', 'application/gzip')
        .header('content-disposition', `attachment; filename="${request.params.id}.tar.gz"`)
        .send(createReadStream(deps.exports.getFile(request.params.id)));
    } catch (error) { return sendExportError(reply, error); }
  });

  app.delete<{ Params: { id: string }; Querystring: { confirm?: string } }>('/api/admin/export/:id', async (request, reply) => {
    try {
      if (request.query.confirm !== request.params.id) return reply.status(400).send({ error: 'invalid_export_confirmation' });
      return reply.send(await deps.exports.delete(request.params.id));
    } catch (error) { return sendExportError(reply, error); }
  });
}
