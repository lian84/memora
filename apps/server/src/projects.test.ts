import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fastify from 'fastify';
import { ProjectStore, registerProjectRoutes } from './projects.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-projects-'));
  roots.push(root);
  return root;
}

function config(id: string, overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    id,
    name: 'Progetto Orione',
    description: 'Progetto di test',
    status: 'active',
    prompt: 'Dai priorità alle decisioni tecniche.',
    defaults: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningLevel: 'low' },
    retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
    sources: { include: ['memory.md', 'sources/**/*.md'], exclude: [] },
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

async function writeProject(root: string, id: string, value: unknown, memory = true) {
  const directory = path.join(root, 'projects', id);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'project.json'), JSON.stringify(value));
  if (memory) await fs.writeFile(path.join(directory, 'memory.md'), '# Memoria\n');
}

describe('ProjectStore', () => {
  it('legge project.json e scopre progetti legacy', async () => {
    const root = await fixture();
    await writeProject(root, 'orione', config('orione'));
    await fs.mkdir(path.join(root, 'projects', 'legacy'), { recursive: true });
    await fs.writeFile(path.join(root, 'projects', 'legacy', 'memory.md'), '# Legacy\n');
    const store = new ProjectStore(root);
    const projects = await store.list();
    expect(projects.map(project => [project.id, project.source])).toEqual([
      ['legacy', 'legacy'],
      ['orione', 'file'],
    ]);
    expect(projects[1]).toMatchObject({ name: 'Progetto Orione', prompt: 'Dai priorità alle decisioni tecniche.' });
  });

  it('rifiuta segreti, id incoerenti e pattern con traversal', async () => {
    const root = await fixture();
    const warnings: string[] = [];
    await writeProject(root, 'orione', config('orione', { apiKey: 'secret' }));
    await writeProject(root, 'bad-id', config('another', { sources: { include: ['../escape.md'], exclude: [] } }));
    const store = new ProjectStore(root, message => warnings.push(message));
    const orione = await store.get('orione');
    expect(orione?.source).toBe('legacy');
    expect(orione?.warning).toContain('legacy');
    expect((await store.get('bad-id'))?.source).toBe('legacy');
    expect(warnings.join(' ')).not.toContain('secret');
    await expect(store.get('../escape')).rejects.toMatchObject({ code: 'invalid_project_id' });
  });

  it('migra solo progetti legacy in dry-run/apply', async () => {
    const root = await fixture();
    await writeProject(root, 'orione', config('orione'));
    await fs.mkdir(path.join(root, 'projects', 'legacy'), { recursive: true });
    await fs.writeFile(path.join(root, 'projects', 'legacy', 'memory.md'), '# Legacy\n');
    const store = new ProjectStore(root);
    expect(await store.migrateLegacy(false)).toMatchObject({ total: 2, migrated: 0, skipped: 1 });
    await expect(fs.stat(path.join(root, 'projects', 'legacy', 'project.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store.migrateLegacy(true)).toMatchObject({ total: 2, migrated: 1, skipped: 1 });
    const stat = await fs.stat(path.join(root, 'projects', 'legacy', 'project.json'));
    expect(stat.mode & 0o777).toBe(0o600);
    expect((await store.get('legacy'))?.source).toBe('file');
  });

  it('aggiorna nome, prompt e retrieval in modo atomico', async () => {
    const root = await fixture();
    await writeProject(root, 'orione', config('orione'));
    const store = new ProjectStore(root);
    const updated = await store.update('orione', { name: 'Orione nuovo', prompt: 'Prompt aggiornato.', retrieval: { includeGlobal: false } });
    expect(updated).toMatchObject({ name: 'Orione nuovo', prompt: 'Prompt aggiornato.', retrieval: { includeGlobal: false, includeProjectMemory: true } });
    expect((await store.get('orione'))?.name).toBe('Orione nuovo');
    await expect(store.update('orione', { id: 'altro' })).rejects.toMatchObject({ code: 'unknown_project_field' });
  });

  it('crea e archivia un progetto, poi lo sposta nel trash con conferma', async () => {
    const root = await fixture();
    const store = new ProjectStore(root);
    const created = await store.create({ id: 'nuovo', name: 'Nuovo progetto' });
    expect(created).toMatchObject({ id: 'nuovo', source: 'file', name: 'Nuovo progetto' });
    expect((await store.get('nuovo'))?.source).toBe('file');
    await store.update('nuovo', { status: 'archived' });
    expect((await store.get('nuovo'))?.status).toBe('archived');
    await expect(store.purge('nuovo', 'wrong')).rejects.toMatchObject({ code: 'invalid_project_confirmation' });
    const purged = await store.purge('nuovo', 'nuovo');
    expect(purged.id).toBe('nuovo');
    await expect(store.get('nuovo')).resolves.toBeNull();
    expect(purged.trashPath).toContain(`${path.sep}.trash${path.sep}projects${path.sep}`);
  });

  it('espone le API read-only', async () => {
    const root = await fixture();
    await writeProject(root, 'orione', config('orione'));
    const app = fastify();
    registerProjectRoutes(app, { projects: new ProjectStore(root) });
    const list = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(list.statusCode).toBe(200);
    expect(list.json().projects).toHaveLength(1);
    const detail = await app.inject({ method: 'GET', url: '/api/projects/orione' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().project.id).toBe('orione');
    const missing = await app.inject({ method: 'GET', url: '/api/projects/missing' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
