import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fastify from 'fastify';
import { renderXlsxFromMarkdown } from '@memora/agent';
import { ProjectStore } from './projects.js';
import { importProjectFile, listProjectFiles, registerProjectFileRoutes, resolveProjectFilePath } from './project-files.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-project-files-'));
  roots.push(root);
  const dir = path.join(root, 'projects', 'orione');
  await fs.mkdir(path.join(dir, 'sources'), { recursive: true });
  await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify({
    version: 1, id: 'orione', name: 'Orione', description: '', status: 'active', prompt: '',
    defaults: {}, retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
    sources: { include: ['memory.md', 'sources/**/*.md', 'sources/**/*.txt'], exclude: [] },
    createdAt: 1, updatedAt: 1,
  }));
  await fs.writeFile(path.join(dir, 'memory.md'), '# Orione\n\nTesto memoria.\n');
  await fs.writeFile(path.join(dir, 'sources', 'note.txt'), 'Nota progetto.');
  await fs.writeFile(path.join(dir, 'docs', 'report.pdf'), Buffer.from('%PDF-1.4 test'));
  await fs.writeFile(path.join(dir, '.env'), 'SECRET=no');
  await fs.symlink(path.join(dir, 'memory.md'), path.join(dir, 'link.md'));
  const projects = new ProjectStore(root);
  const app = fastify();
  registerProjectFileRoutes(app, { dataDir: root, projects });
  return { root, dir, projects, app };
}

describe('project files API', () => {
  it('elenca i file del progetto senza symlink o file nascosti', async () => {
    const { root, app } = await fixture();
    try {
      const result = await listProjectFiles(root, 'orione');
      expect(result.files.map(file => file.path)).toEqual([
        'docs/report.pdf', 'memory.md', 'project.json', 'sources/note.txt',
      ]);
      expect(result.files.find(file => file.path === 'docs/report.pdf')?.kind).toBe('pdf');
      expect(result.directories).toEqual(expect.arrayContaining(['docs', 'sources']));
      const response = await app.inject({ method: 'GET', url: '/api/projects/orione/files' });
      expect(response.statusCode).toBe(200);
      expect(response.json().files).toHaveLength(4);
      const missing = await app.inject({ method: 'GET', url: '/api/projects/missing/files' });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('serve il contenuto e rifiuta path traversal', async () => {
    const { app } = await fixture();
    try {
      const content = await app.inject({ method: 'GET', url: '/api/projects/orione/files/content?path=memory.md' });
      expect(content.statusCode).toBe(200);
      expect(content.headers['content-type']).toContain('text/markdown');
      expect(content.body).toContain('Testo memoria');
      const traversal = await app.inject({ method: 'GET', url: '/api/projects/orione/files/content?path=../project.json' });
      expect(traversal.statusCode).toBeGreaterThanOrEqual(400);
      expect(traversal.statusCode).toBeLessThan(500);
    } finally {
      await app.close();
    }
  });

  it('riconosce e archivia file Excel e PowerPoint', async () => {
    const { root } = await fixture();
    const xlsx = await importProjectFile(root, 'orione', 'budget.xlsx', Buffer.from('xlsx'));
    const pptx = await importProjectFile(root, 'orione', 'deck.pptx', Buffer.from('pptx'));
    expect(xlsx).toMatchObject({ kind: 'xlsx', path: 'files/budget.xlsx' });
    expect(pptx).toMatchObject({ kind: 'pptx', path: 'files/deck.pptx' });
  });

  it('genera la preview Excel e rifiuta i PPTX caricati', async () => {
    const { dir, app } = await fixture();
    try {
      await fs.writeFile(path.join(dir, 'docs', 'budget.xlsx'), await renderXlsxFromMarkdown('# Budget\n\n| Voce | Importo |\n| --- | --- |\n| Hosting | 20 |\n'));
      const xlsx = await app.inject({ method: 'GET', url: '/api/projects/orione/files/preview?path=docs/budget.xlsx' });
      expect(xlsx.statusCode).toBe(200);
      expect(xlsx.json()).toMatchObject({ kind: 'xlsx', spreadsheet: { kind: 'xlsx', sheets: [{ name: 'Budget' }] } });
      await fs.writeFile(path.join(dir, 'docs', 'deck.pptx'), Buffer.from('pptx'));
      const pptx = await app.inject({ method: 'GET', url: '/api/projects/orione/files/preview?path=docs/deck.pptx' });
      expect(pptx.statusCode).toBe(415);
    } finally {
      await app.close();
    }
  });

  it('archivia gli allegati in files/ e deduplica per contenuto', async () => {
    const { root, projects } = await fixture();
    const first = await importProjectFile(root, 'orione', 'nota.md', Buffer.from('# Nota\nContenuto'));
    expect(first.path).toBe('files/nota.md');
    const duplicate = await importProjectFile(root, 'orione', 'nota.md', Buffer.from('# Nota\nContenuto'));
    expect(duplicate.path).toBe(first.path);
    const collision = await importProjectFile(root, 'orione', 'nota.md', Buffer.from('# Nota\nDiverso'));
    expect(collision.path).toBe('files/nota-1.md');
    expect(await projects.matchesSource('orione', 'projects/orione/files/nota.md')).toBe(false);
    expect((await listProjectFiles(root, 'orione')).files.some(file => file.path === 'files/nota.md')).toBe(true);
  });

  it('risolve solo file reali dentro il progetto', async () => {
    const { root, app } = await fixture();
    try {
      await expect(resolveProjectFilePath(root, 'orione', 'memory.md')).resolves.toMatchObject({ relativePath: 'memory.md' });
      await expect(resolveProjectFilePath(root, 'orione', 'link.md')).rejects.toMatchObject({ code: 'project_file_forbidden' });
      await expect(resolveProjectFilePath(root, 'orione', '../project.json')).rejects.toMatchObject({ code: 'invalid_project_file_path' });
      const preview = await app.inject({ method: 'GET', url: '/api/projects/orione/files/preview?path=memory.md' });
      expect(preview.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
