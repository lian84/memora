import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AgentService } from '@memora/agent';
import { AgentServiceError } from '@memora/shared';
import { ChatAttachmentError, type ChatAttachmentStore } from './chat-attachments.js';
import { ProjectFileError, importProjectFile, readProjectFile } from './project-files.js';
import type { ProjectStore } from './projects.js';

interface ChatAttachmentDependencies {
  store: ChatAttachmentStore;
  agentService: AgentService;
  dataDir: string;
  projects: ProjectStore;
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof ChatAttachmentError) return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  if (error instanceof ProjectFileError) return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  return reply.status(500).send({ error: 'chat_attachment_failed' });
}

export function registerChatAttachmentRoutes(app: FastifyInstance, deps: ChatAttachmentDependencies): void {
  app.post<{ Params: { id: string }; Body: { filename?: string; data?: string } }>(
    '/api/sessions/:id/attachments',
    { bodyLimit: 22 * 1024 * 1024 },
    async (request, reply) => {
      try {
        if (!(await deps.agentService.hasSession(request.params.id))) return reply.status(404).send({ error: 'session_not_found' });
        if (typeof request.body?.filename !== 'string' || typeof request.body?.data !== 'string') {
          return reply.status(400).send({ error: 'invalid_attachment' });
        }
        const buffer = Buffer.from(request.body.data, 'base64');
        const attachment = await deps.store.save(request.params.id, { filename: request.body.filename, data: buffer });
        const projectId = await deps.agentService.getSessionProjectId(request.params.id);
        const projectPath = projectId && await deps.projects.get(projectId)
          ? (await importProjectFile(deps.dataDir, projectId, request.body.filename, buffer)).path
          : undefined;
        return reply.status(201).send({ attachment: { ...attachment, ...(projectPath ? { projectPath } : {}) } });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { projectId?: string; path?: string } }>(
    '/api/sessions/:id/attachments/from-project',
    async (request, reply) => {
      try {
        if (!(await deps.agentService.hasSession(request.params.id))) return reply.status(404).send({ error: 'session_not_found' });
        if (typeof request.body?.projectId !== 'string' || typeof request.body?.path !== 'string') {
          return reply.status(400).send({ error: 'invalid_project_attachment' });
        }
        if (!(await deps.projects.get(request.body.projectId))) return reply.status(404).send({ error: 'project_not_found' });
        const file = await readProjectFile(deps.dataDir, request.body.projectId, request.body.path);
        const attachment = await deps.store.save(request.params.id, { filename: file.filename, data: file.buffer });
        return reply.status(201).send({ attachment: { ...attachment, projectPath: request.body.path } });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { artifactId?: string } }>(
    '/api/sessions/:id/attachments/from-artifact',
    async (request, reply) => {
      try {
        if (!(await deps.agentService.hasSession(request.params.id))) return reply.status(404).send({ error: 'session_not_found' });
        if (typeof request.body?.artifactId !== 'string' || !request.body.artifactId) {
          return reply.status(400).send({ error: 'invalid_artifact_attachment' });
        }
        const artifact = await deps.agentService.getArtifact(request.params.id, request.body.artifactId);
        const attachment = await deps.store.save(request.params.id, { filename: artifact.name, data: artifact.buffer });
        return reply.status(201).send({ attachment });
      } catch (error) {
        if (error instanceof AgentServiceError && error.code === 'artifact_not_found') return reply.status(404).send({ error: error.code });
        if (error && typeof error === 'object' && 'code' in error) {
          const code = String((error as { code?: unknown }).code);
          if (code === 'artifact_not_found') return reply.status(404).send({ error: code });
        }
        return sendError(reply, error);
      }
    },
  );

  app.delete<{ Params: { id: string; attachmentId: string } }>(
    '/api/sessions/:id/attachments/:attachmentId',
    async (request, reply) => {
      try {
        if (!(await deps.agentService.hasSession(request.params.id))) return reply.status(404).send({ error: 'session_not_found' });
        await deps.store.remove(request.params.id, request.params.attachmentId);
        return reply.send({ deleted: true });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.get<{ Params: { id: string; attachmentId: string } }>(
    '/api/sessions/:id/attachments/:attachmentId',
    async (request, reply) => {
      try {
        if (!(await deps.agentService.hasSession(request.params.id))) return reply.status(404).send({ error: 'session_not_found' });
        const attachment = await deps.store.get(request.params.id, request.params.attachmentId);
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Cache-Control', 'private, max-age=60');
        reply.header('Content-Disposition', `${attachment.mimeType === 'text/html' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(attachment.filename)}"`);
        if (attachment.mimeType === 'text/html' || attachment.mimeType === 'image/svg+xml') reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
        return reply.type(attachment.mimeType).send(attachment.buffer);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
