import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { BackupService } from './backup.js';
import { BackupError } from './backup.js';
import { RcloneError } from './rclone.js';
import type { RcloneService } from './rclone.js';

export interface BackupRoutesDeps {
  backups: BackupService;
  remote: RcloneService;
}

function sendBackupError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof BackupError || error instanceof RcloneError) return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  throw error;
}

export function registerBackupRoutes(app: FastifyInstance, deps: BackupRoutesDeps): void {
  app.get('/api/admin/backup', async (_request, reply) => {
    return reply.send({ status: deps.backups.getStatus() });
  });

  app.post('/api/admin/backup', async (_request, reply) => {
    try {
      const record = await deps.backups.createBackup('manual');
      return reply.send({ record, status: deps.backups.getStatus() });
    } catch (error) {
      return sendBackupError(reply, error);
    }
  });

  app.put<{ Body: { password?: unknown } | undefined }>('/api/admin/backup/password', async (request, reply) => {
    try {
      await deps.backups.setPassword(request.body?.password);
      return reply.send({ status: deps.backups.getStatus() });
    } catch (error) {
      return sendBackupError(reply, error);
    }
  });

  app.patch<{ Body: Record<string, unknown> | undefined }>('/api/admin/backup/schedule', async (request, reply) => {
    try {
      await deps.backups.updateSchedule(request.body ?? {});
      return reply.send({ status: deps.backups.getStatus() });
    } catch (error) {
      return sendBackupError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>('/api/admin/backup/:id/download', async (request, reply) => {
    try {
      const file = deps.backups.getBackupFile(request.params.id);
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', `attachment; filename="${request.params.id}.mbackup"`)
        .send(createReadStream(file));
    } catch (error) {
      return sendBackupError(reply, error);
    }
  });

  app.get('/api/admin/backup/remote', async (_request, reply) => {
    return reply.send({ status: await deps.remote.status() });
  });

  app.put<{ Body: Record<string, unknown> | undefined }>('/api/admin/backup/remote', async (request, reply) => {
    try {
      const body = request.body ?? {};
      return reply.send({ status: await deps.remote.configure({
        remoteName: body.remoteName as string,
        email: body.email as string,
        password: body.password as string,
        folder: body.folder as string,
        ...(typeof body.twoFactor === 'string' ? { twoFactor: body.twoFactor } : {}),
        autoUpload: body.autoUpload === true,
      }) });
    } catch (error) {
      return sendBackupError(reply, error);
    }
  });

  app.patch<{ Body: { autoUpload?: unknown } | undefined }>('/api/admin/backup/remote', async (request, reply) => {
    try {
      return reply.send({ status: await deps.remote.updateAutoUpload(request.body?.autoUpload === true) });
    } catch (error) {
      return sendBackupError(reply, error);
    }
  });

  app.post('/api/admin/backup/remote/upload', async (_request, reply) => {
    try {
      return reply.send({ status: await deps.remote.uploadLatest() });
    } catch (error) {
      return sendBackupError(reply, error);
    }
  });

  app.delete<{ Querystring: { confirm?: string } }>('/api/admin/backup/remote', async (request, reply) => {
    try {
      if (request.query.confirm !== 'remote') return reply.status(400).send({ error: 'invalid_remote_confirmation' });
      return reply.send({ status: await deps.remote.disconnect() });
    } catch (error) {
      return sendBackupError(reply, error);
    }
  });

  app.delete<{ Params: { id: string }; Querystring: { confirm?: string } }>('/api/admin/backup/:id', async (request, reply) => {
    try {
      if (request.query.confirm !== request.params.id) return reply.status(400).send({ error: 'invalid_backup_confirmation' });
      return reply.send(await deps.backups.deleteBackup(request.params.id));
    } catch (error) {
      return sendBackupError(reply, error);
    }
  });
}
