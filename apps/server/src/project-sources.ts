import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AgentService } from '@memora/agent';
import type { MemoryService } from '@memora/memory';
import { ProjectError, type ProjectStore } from './projects.js';
import { ProjectFileError, importProjectFile } from './project-files.js';

interface ProjectSourceDependencies {
  projects: ProjectStore;
  memory: MemoryService;
  writer?: { markCandidatesPurgedForPath(path: string): Promise<number> };
  agentService: AgentService;
  dataDir: string;
}

function statusFor(error: unknown): number {
  if (error instanceof ProjectError || error instanceof ProjectFileError) return error.statusCode;
  if (typeof error === 'object' && error && 'code' in error) {
    const code = String((error as { code?: unknown }).code);
    if (code === 'source_not_found' || code === 'artifact_not_found') return 404;
    if (code === 'invalid_source_content' || code === 'invalid_target_path' || code === 'source_already_exists' || code === 'invalid_artifact_id' || code === 'invalid_session_id') return 400;
    if (code === 'artifact_forbidden') return 403;
  }
  return 500;
}

function errorBody(error: unknown) {
  if (error instanceof ProjectError) return { error: error.code, message: error.message };
  if (error && typeof error === 'object' && 'code' in error) {
    return { error: String((error as { code?: unknown }).code), message: error instanceof Error ? error.message : 'Errore fonte' };
  }
  return { error: 'project_source_failed' };
}

export function registerProjectSourceRoutes(app: FastifyInstance, deps: ProjectSourceDependencies): void {
  app.get<{ Params: { id: string } }>('/api/projects/:id/sources', async (request, reply) => {
    try {
      await deps.projects.get(request.params.id);
      const sources = (await deps.memory.listSources()).filter(source => source.projectId === request.params.id);
      return reply.send({ sources });
    } catch (error) {
      return reply.status(statusFor(error)).send(errorBody(error));
    }
  });

  app.post<{ Params: { id: string }; Body: { relativePath?: string; content?: string } }>(
    '/api/projects/:id/sources',
    async (request, reply) => {
      try {
        const project = await deps.projects.get(request.params.id);
        if (!project) return reply.status(404).send({ error: 'project_not_found' });
        const relativePath = request.body?.relativePath?.trim() ?? '';
        const prefix = `projects/${request.params.id}/sources/`;
        if (!relativePath.startsWith(prefix) || (!relativePath.endsWith('.md') && !relativePath.endsWith('.txt')) || relativePath.includes('..')) {
          return reply.status(400).send({ error: 'invalid_source_path' });
        }
        if (!(await deps.projects.matchesSource(request.params.id, relativePath))) {
          return reply.status(400).send({ error: 'source_excluded_by_project' });
        }
        const content = typeof request.body?.content === 'string' ? request.body.content : '';
        const source = await deps.memory.createSource(relativePath, content);
        return reply.status(201).send({ source });
      } catch (error) {
        return reply.status(statusFor(error)).send(errorBody(error));
      }
    },
  );

  app.get<{ Params: { id: string; sourceId: string } }>(
    '/api/projects/:id/sources/:sourceId',
    async (request, reply) => {
      try {
        const source = await deps.memory.getSourceContent(request.params.sourceId);
        if (source.projectId !== request.params.id) return reply.status(404).send({ error: 'source_not_found' });
        return reply.send({ source });
      } catch (error) {
        return reply.status(statusFor(error)).send(errorBody(error));
      }
    },
  );

  app.patch<{ Params: { id: string; sourceId: string }; Body: { content?: string } }>(
    '/api/projects/:id/sources/:sourceId',
    async (request, reply) => {
      try {
        const before = await deps.memory.getSourceContent(request.params.sourceId);
        if (before.projectId !== request.params.id) return reply.status(404).send({ error: 'source_not_found' });
        if (typeof request.body?.content !== 'string') return reply.status(400).send({ error: 'invalid_source_content' });
        const source = await deps.memory.updateSourceContent(request.params.sourceId, request.body.content);
        return reply.send({ source });
      } catch (error) {
        return reply.status(statusFor(error)).send(errorBody(error));
      }
    },
  );

  app.delete<{ Params: { id: string; sourceId: string } }>(
    '/api/projects/:id/sources/:sourceId',
    async (request, reply) => {
      try {
        const source = await deps.memory.getSourceContent(request.params.sourceId);
        if (source.projectId !== request.params.id) return reply.status(404).send({ error: 'source_not_found' });
        const result = await deps.memory.deleteSource(request.params.sourceId);
        const purgedCandidates = await deps.writer?.markCandidatesPurgedForPath(result.relativePath) ?? 0;
        return reply.send({ ...result, deleted: true, purgedCandidates });
      } catch (error) {
        return reply.status(statusFor(error)).send(errorBody(error));
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { sessionId?: string; artifactId?: string } }>('/api/projects/:id/artifacts', async (request, reply) => {
    try {
      const project = await deps.projects.get(request.params.id);
      if (!project) return reply.status(404).send({ error: 'project_not_found' });
      const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId : '';
      const artifactId = typeof request.body?.artifactId === 'string' ? request.body.artifactId : '';
      if (!sessionId || !artifactId) return reply.status(400).send({ error: 'invalid_artifact_import' });
      const artifact = await deps.agentService.getArtifact(sessionId, artifactId);
      if (artifact.kind === 'markdown' || artifact.kind === 'text') {
        const extension = artifact.kind === 'markdown' ? '.md' : '.txt';
        const base = path.basename(artifact.name).normalize('NFKC').trim()
          .replace(/[^\p{L}\p{N}._ -]+/gu, '_')
          .replace(/^\.+/, '_');
        const stem = base.toLowerCase().endsWith(extension) ? base.slice(0, -extension.length) : base;
        const safeStem = stem || `artifact-${artifact.id.slice(0, 8)}`;
        const existing = new Set((await deps.memory.listSources()).map(source => source.relativePath));
        let relativePath = '';
        for (let attempt = 0; attempt < 100; attempt++) {
          const candidate = `projects/${project.id}/sources/${attempt === 0 ? safeStem : `${safeStem}-${attempt}`}${extension}`;
          if (!existing.has(candidate)) { relativePath = candidate; break; }
        }
        if (!relativePath) return reply.status(409).send({ error: 'project_source_name_exhausted' });
        if (!(await deps.projects.matchesSource(project.id, relativePath))) return reply.status(400).send({ error: 'project_source_excluded' });
        const source = await deps.memory.createSource(relativePath, artifact.buffer.toString('utf8'));
        return reply.status(201).send({ destination: 'source', relativePath: source.relativePath, indexed: true });
      }
      const file = await importProjectFile(deps.dataDir, project.id, artifact.name, artifact.buffer);
      return reply.status(201).send({ destination: 'file', relativePath: file.path, indexed: false });
    } catch (error) {
      return reply.status(statusFor(error)).send(errorBody(error));
    }
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/export', async (request, reply) => {
    try {
      const project = await deps.projects.get(request.params.id);
      if (!project) return reply.status(404).send({ error: 'project_not_found' });
      const sources = (await deps.memory.listSources()).filter(source => source.projectId === request.params.id);
      const exported = await Promise.all(sources.map(async source => {
        const detail = await deps.memory.getSourceContent(source.id);
        return { relativePath: detail.relativePath, content: detail.content };
      }));
      return reply.send({
        schemaVersion: 1,
        project,
        sources: exported,
      });
    } catch (error) {
      return reply.status(statusFor(error)).send(errorBody(error));
    }
  });

  app.delete<{ Params: { id: string }; Body?: { confirm?: string } }>('/api/projects/:id', async (request, reply) => {
    try {
      const project = await deps.projects.get(request.params.id);
      if (!project) return reply.status(404).send({ error: 'project_not_found' });
      if (request.body?.confirm !== request.params.id) return reply.status(400).send({ error: 'invalid_project_confirmation' });
      const sources = (await deps.memory.listSources()).filter(source => source.projectId === request.params.id);
      const result = await deps.projects.purge(request.params.id, request.body.confirm);
      for (const source of sources) await deps.writer?.markCandidatesPurgedForPath(source.relativePath);
      await deps.memory.reindex();
      return reply.send({ ...result, deleted: true, sources: sources.length });
    } catch (error) {
      return reply.status(statusFor(error)).send(errorBody(error));
    }
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/reindex', async (request, reply) => {
    try {
      await deps.projects.get(request.params.id);
      await deps.memory.reindex();
      return reply.send({ ok: true });
    } catch (error) {
      return reply.status(statusFor(error)).send(errorBody(error));
    }
  });
}
