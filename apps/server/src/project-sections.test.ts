import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectStore, registerProjectRoutes } from './projects.js';
import { ProjectSectionStore, registerProjectSectionRoutes } from './project-sections.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-sections-'));
  const app = fastify();
  const projects = new ProjectStore(root);
  const sections = new ProjectSectionStore(root);
  registerProjectRoutes(app, { projects, sections });
  registerProjectSectionRoutes(app, { projects, sections });
  return { root, app, projects, sections };
}

describe('project sections API', () => {
  let root: string | null = null;
  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = null;
  });

  it('crea, elenca e modifica una sezione con icona', async () => {
    const fixtureState = await fixture();
    root = fixtureState.root;
    try {
      const created = await fixtureState.app.inject({ method: 'POST', url: '/api/project-sections', payload: { name: 'Lavoro', icon: 'briefcase' } });
      expect(created.statusCode).toBe(201);
      const section = created.json().section;
      expect(section).toMatchObject({ id: 'lavoro', name: 'Lavoro', icon: 'briefcase' });

      const list = await fixtureState.app.inject({ method: 'GET', url: '/api/project-sections' });
      expect(list.json().sections).toHaveLength(1);

      const updated = await fixtureState.app.inject({ method: 'PATCH', url: `/api/project-sections/${section.id}`, payload: { name: 'Lavoro e studio', icon: 'book' } });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().section).toMatchObject({ name: 'Lavoro e studio', icon: 'book' });

      const file = path.join(root, 'config', 'project-sections.json');
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    } finally {
      await fixtureState.app.close();
    }
  });

  it('assegna un progetto a una sezione e impedisce di cancellarla se non è vuota', async () => {
    const fixtureState = await fixture();
    root = fixtureState.root;
    try {
      const section = (await fixtureState.app.inject({ method: 'POST', url: '/api/project-sections', payload: { name: 'Lavoro', icon: 'briefcase' } })).json().section;
      const project = await fixtureState.app.inject({ method: 'POST', url: '/api/projects', payload: { id: 'orione', name: 'Orione', sectionId: section.id, icon: 'rocket' } });
      expect(project.statusCode).toBe(201);
      expect(project.json().project).toMatchObject({ sectionId: 'lavoro', icon: 'rocket' });

      const blocked = await fixtureState.app.inject({ method: 'DELETE', url: `/api/project-sections/${section.id}` });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toBe('section_not_empty');

      const cleared = await fixtureState.app.inject({ method: 'PATCH', url: '/api/projects/orione', payload: { sectionId: null } });
      expect(cleared.json().project.sectionId).toBeUndefined();

      const deleted = await fixtureState.app.inject({ method: 'DELETE', url: `/api/project-sections/${section.id}` });
      expect(deleted.statusCode).toBe(200);
    } finally {
      await fixtureState.app.close();
    }
  });

  it('rifiuta icone e sezioni inesistenti', async () => {
    const fixtureState = await fixture();
    root = fixtureState.root;
    try {
      const invalidIcon = await fixtureState.app.inject({ method: 'POST', url: '/api/project-sections', payload: { name: 'Lavoro', icon: 'not-an-icon' } });
      expect(invalidIcon.statusCode).toBe(400);
      const project = await fixtureState.app.inject({ method: 'POST', url: '/api/projects', payload: { id: 'orione', name: 'Orione', sectionId: 'missing' } });
      expect(project.statusCode).toBe(400);
      expect(project.json().error).toBe('project_section_not_found');
    } finally {
      await fixtureState.app.close();
    }
  });
});
