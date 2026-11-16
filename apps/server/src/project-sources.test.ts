import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fastify from 'fastify';
import { MemoryService } from '@memora/memory';
import { ProjectStore } from './projects.js';
import { registerProjectSourceRoutes } from './project-sources.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function fixture(artifact?: { id: string; name: string; kind: 'markdown' | 'html'; buffer: Buffer }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-project-sources-'));
  roots.push(root);
  const dir = path.join(root, 'projects', 'orione');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({
    version: 1, id: 'orione', name: 'Orione', description: '', status: 'active', prompt: '',
    defaults: {}, retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
    sources: { include: ['memory.md', 'sources/**/*.md', 'sources/**/*.txt'], exclude: ['sources/private/**'] },
    createdAt: 1, updatedAt: 1,
  }));
  await fs.writeFile(path.join(dir, 'memory.md'), '# Orione\n\n## Note\n\n- Orione usa PostgreSQL.\n');
  const projects = new ProjectStore(root);
  const memory = new MemoryService(root, {
    searchMode: 'lexical',
    sourceFilter: (relativePath, projectId) => projectId ? projects.matchesSource(projectId, relativePath) : true,
  });
  await memory.initialize();
  await memory.reindex();
  const app = fastify();
  registerProjectSourceRoutes(app, { projects, memory, agentService: { getArtifact: async () => artifact } as never, dataDir: root });
  return { root, projects, memory, app };
}

describe('project sources API', () => {
  it('crea, legge, modifica, reindicizza ed elimina una fonte', async () => {
    const { root, memory, app } = await fixture();
    try {
      const created = await app.inject({
        method: 'POST', url: '/api/projects/orione/sources',
        payload: { relativePath: 'projects/orione/sources/architecture.md', content: '# Architettura\n\n- Usa PostgreSQL.\n' },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().source).toMatchObject({ projectId: 'orione', relativePath: 'projects/orione/sources/architecture.md' });
      const sourceId = created.json().source.id as string;
      expect((await fs.stat(path.join(root, 'projects/orione/sources/architecture.md'))).mode & 0o777).toBe(0o600);

      const list = await app.inject({ method: 'GET', url: '/api/projects/orione/sources' });
      expect(list.statusCode).toBe(200);
      expect(list.json().sources).toHaveLength(2);

      const updated = await app.inject({ method: 'PATCH', url: `/api/projects/orione/sources/${sourceId}`, payload: { content: '# Architettura\n\n- Usa MySQL.\n' } });
      expect(updated.statusCode).toBe(200);
      expect((await memory.search('MySQL', { projectId: 'orione' })).length).toBeGreaterThan(0);

      const deleted = await app.inject({ method: 'DELETE', url: `/api/projects/orione/sources/${sourceId}` });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json()).toMatchObject({ deleted: true, relativePath: 'projects/orione/sources/architecture.md' });
      expect((await app.inject({ method: 'GET', url: '/api/projects/orione/sources' })).json().sources).toHaveLength(1);
    } finally {
      await app.close();
      await memory.close();
    }
  });

  it('importa un artefatto Markdown nelle fonti indicizzate del progetto', async () => {
    const artifact = { id: 'artifact-1', name: 'decisioni.md', kind: 'markdown' as const, buffer: Buffer.from('# Decisioni\n\n- Il progetto usa Redis.\n') };
    const { memory, app } = await fixture(artifact);
    try {
      const imported = await app.inject({ method: 'POST', url: '/api/projects/orione/artifacts', payload: { sessionId: 'session-1', artifactId: 'artifact-1' } });
      expect(imported.statusCode).toBe(201);
      expect(imported.json()).toMatchObject({ destination: 'source', relativePath: 'projects/orione/sources/decisioni.md', indexed: true });
      expect((await memory.search('Redis', { projectId: 'orione' })).length).toBeGreaterThan(0);
    } finally {
      await app.close();
      await memory.close();
    }
  });

  it('elimina un progetto solo con la conferma esplicita', async () => {
    const { root, app, memory } = await fixture();
    try {
      const rejected = await app.inject({ method: 'DELETE', url: '/api/projects/orione', payload: { confirm: 'sbagliato' } });
      expect(rejected.statusCode).toBe(400);
      const deleted = await app.inject({ method: 'DELETE', url: '/api/projects/orione', payload: { confirm: 'orione' } });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json()).toMatchObject({ deleted: true, id: 'orione' });
      await expect(fs.stat(path.join(root, 'projects', 'orione'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await app.close();
      await memory.close();
    }
  });

  it('esporta progetto e fonti in JSON', async () => {
    const { memory, app } = await fixture();
    try {
      const exported = await app.inject({ method: 'GET', url: '/api/projects/orione/export' });
      expect(exported.statusCode).toBe(200);
      expect(exported.json()).toMatchObject({ schemaVersion: 1, project: { id: 'orione' } });
      expect(exported.json().sources).toHaveLength(1);
      expect(exported.json().sources[0].relativePath).toBe('projects/orione/memory.md');
    } finally {
      await app.close();
      await memory.close();
    }
  });

  it('carica e indicizza una fonte .txt', async () => {
    const { memory, app } = await fixture();
    try {
      const created = await app.inject({
        method: 'POST', url: '/api/projects/orione/sources',
        payload: { relativePath: 'projects/orione/sources/notes.txt', content: 'Orione usa Redis per la cache.' },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().source).toMatchObject({ projectId: 'orione', relativePath: 'projects/orione/sources/notes.txt' });
      expect((await memory.search('Redis', { projectId: 'orione' })).some(result => result.content.includes('Redis'))).toBe(true);
    } finally {
      await app.close();
      await memory.close();
    }
  });

  it('rifiuta path fuori dalla directory sources del progetto', async () => {
    const { memory, app } = await fixture();
    try {
      const result = await app.inject({
        method: 'POST', url: '/api/projects/orione/sources',
        payload: { relativePath: 'projects/orione/secret.md', content: 'no' },
      });
      expect(result.statusCode).toBe(400);
      expect(result.json().error).toBe('invalid_source_path');
    } finally {
      await app.close();
      await memory.close();
    }
  });
});
