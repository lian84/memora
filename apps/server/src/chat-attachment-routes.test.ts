import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fastify from 'fastify';
import type { AgentService } from '@memora/agent';
import { ChatAttachmentStore } from './chat-attachments.js';
import { registerChatAttachmentRoutes } from './chat-attachment-routes.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-chat-attachment-routes-'));
  roots.push(root);
  const app = fastify();
  registerChatAttachmentRoutes(app, {
    store: new ChatAttachmentStore(root),
    agentService: { hasSession: async (id: string) => id === 'session-1', getSessionProjectId: async () => undefined } as unknown as AgentService,
    dataDir: root,
    projects: { get: async () => null } as never,
  });
  return { root, app };
}

describe('chat attachments API', () => {
  it('carica e serve un allegato della sessione', async () => {
    const { app } = await fixture();
    try {
      const uploaded = await app.inject({
        method: 'POST', url: '/api/sessions/session-1/attachments',
        payload: { filename: 'nota.txt', data: Buffer.from('contenuto').toString('base64') },
      });
      expect(uploaded.statusCode).toBe(201);
      const attachment = uploaded.json().attachment;
      expect(attachment).toMatchObject({ filename: 'nota.txt', kind: 'text', mimeType: 'text/plain' });
      const content = await app.inject({ method: 'GET', url: `/api/sessions/session-1/attachments/${attachment.id}` });
      expect(content.statusCode).toBe(200);
      expect(content.body).toBe('contenuto');
      expect(content.headers['x-content-type-options']).toBe('nosniff');
      const deleted = await app.inject({ method: 'DELETE', url: `/api/sessions/session-1/attachments/${attachment.id}` });
      expect(deleted.statusCode).toBe(200);
      const missing = await app.inject({ method: 'GET', url: `/api/sessions/session-1/attachments/${attachment.id}` });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('allega un artefatto della sessione alla chat', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-chat-artifact-attachment-'));
    roots.push(root);
    const app = fastify();
    registerChatAttachmentRoutes(app, {
      store: new ChatAttachmentStore(root),
      agentService: {
        hasSession: async () => true,
        getArtifact: async () => ({ id: 'artifact-1', sessionId: 'session-1', name: 'nota.md', kind: 'markdown', mimeType: 'text/markdown', size: 6, createdAt: 1, updatedAt: 1, version: 1, buffer: Buffer.from('# Nota') }),
      } as unknown as AgentService,
      dataDir: root,
      projects: { get: async () => null } as never,
    });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/sessions/session-1/attachments/from-artifact', payload: { artifactId: 'artifact-1' } });
      expect(response.statusCode).toBe(201);
      expect(response.json().attachment).toMatchObject({ filename: 'nota.md', kind: 'text' });
      const attachment = response.json().attachment;
      const content = await app.inject({ method: 'GET', url: `/api/sessions/session-1/attachments/${attachment.id}` });
      expect(content.body).toBe('# Nota');
    } finally {
      await app.close();
    }
  });

  it('rifiuta sessioni sconosciute', async () => {
    const { app } = await fixture();
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/sessions/other/attachments',
        payload: { filename: 'nota.txt', data: Buffer.from('x').toString('base64') },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

import { ProjectStore } from './projects.js';
import { listProjectFiles } from './project-files.js';

describe('chat attachments to project files', () => {
  it('archivia automaticamente un allegato nella cartella files del progetto', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-chat-project-attachment-'));
    roots.push(root);
    const projectDir = path.join(root, 'projects', 'orione');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, 'project.json'), JSON.stringify({
      version: 1, id: 'orione', name: 'Orione', description: '', status: 'active', prompt: '',
      defaults: {}, retrieval: { includeGlobal: true, includeProjectMemory: true, includeProjectSources: true },
      sources: { include: ['memory.md'], exclude: [] }, createdAt: 1, updatedAt: 1,
    }));
    await fs.writeFile(path.join(projectDir, 'memory.md'), '# Orione\n');
    const app = fastify();
    registerChatAttachmentRoutes(app, {
      store: new ChatAttachmentStore(root),
      agentService: { hasSession: async () => true, getSessionProjectId: async () => 'orione' } as unknown as AgentService,
      dataDir: root,
      projects: new ProjectStore(root),
    });
    try {
      const uploaded = await app.inject({
        method: 'POST', url: '/api/sessions/session-1/attachments',
        payload: { filename: 'nota.txt', data: Buffer.from('contenuto').toString('base64') },
      });
      expect(uploaded.statusCode).toBe(201);
      expect(uploaded.json().attachment.projectPath).toBe('files/nota.txt');
      expect((await listProjectFiles(root, 'orione')).files.some(file => file.path === 'files/nota.txt')).toBe(true);
    } finally {
      await app.close();
    }
  });
});
