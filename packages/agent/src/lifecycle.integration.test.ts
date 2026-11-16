import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { AgentService } from './index';
import type { AgentServiceConfig } from '@memora/shared';

const roots: string[] = [];

async function createFixtureSession(root: string, sessionId: string, archived = false): Promise<void> {
  const sessionDir = join(root, 'pi-sessions');
  const manager = SessionManager.create(root, sessionDir, { id: sessionId });
  manager.appendMessage({
    role: 'user',
    content: 'Fixture session',
    timestamp: Date.now(),
  } as Parameters<typeof manager.appendMessage>[0]);
  if (archived) manager.appendCustomEntry('memora.session-meta', { archived: true });
}

function createConfig(root: string): AgentServiceConfig {
  return {
    dataDir: root,
    cwd: root,
    openRouterApiKey: '',
    openRouterModel: 'openrouter/auto',
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('session lifecycle senza OpenRouter', () => {
  it('mostra subito una nuova chat in memoria e la elimina come bozza', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memora-draft-'));
    roots.push(root);
    const service = new AgentService(createConfig(root));

    const created = await service.createSession('openrouter/auto');
    expect(created.sessionFile).toBeDefined();
    await expect(access(created.sessionFile as string)).rejects.toThrow();

    await expect(service.listSessions()).resolves.toEqual([
      expect.objectContaining({
        sessionId: created.sessionId,
        draft: true,
        archived: false,
        messageCount: 0,
      }),
    ]);
    await expect(service.listSessions(true)).resolves.toEqual([]);
    await expect(service.resumeSession(created.sessionId)).resolves.toEqual({
      sessionId: created.sessionId,
      modelId: 'openrouter/auto',
      provider: 'openrouter',
      reasoningLevel: 'medium',
    });
    await expect(service.getSessionMessages(created.sessionId)).resolves.toEqual([]);
    await expect(service.renameSession(created.sessionId, 'Bozza')).rejects.toMatchObject({
      code: 'session_not_persisted',
    });
    await expect(service.setSessionArchived(created.sessionId, true)).rejects.toMatchObject({
      code: 'session_not_persisted',
    });

    await expect(service.deleteSession(created.sessionId)).resolves.toEqual({
      sessionId: created.sessionId,
    });
    await expect(service.listSessions()).resolves.toEqual([]);
    service.disposeAll();
  });

  it('crea un artefatto PDF da Markdown senza passare dal modello', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memora-pdf-'));
    roots.push(root);
    const service = new AgentService(createConfig(root));
    const created = await service.createSession('openrouter/auto');
    const artifact = await service.createPdfArtifact(created.sessionId, {
      title: 'Riepilogo', markdown: '# Titolo\n\n- punto uno\n- punto due',
    });
    expect(artifact).toMatchObject({ kind: 'pdf', name: 'Riepilogo.pdf' });
    const loaded = await service.getArtifact(created.sessionId, artifact.id);
    expect(loaded.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await service.listArtifacts(created.sessionId)).toHaveLength(1);
    await expect(service.createPdfArtifact(created.sessionId, { title: 'X', markdown: '   ' })).rejects.toThrow('empty_markdown');
    service.disposeAll();
  });

  it('salva e rilegge il contesto della sessione senza toccare il progetto', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memora-context-'));
    roots.push(root);
    await createFixtureSession(root, 'context-lifecycle');
    const service = new AgentService(createConfig(root));
    expect(await service.getSessionContext('context-lifecycle')).toEqual({
      includeGlobalMemory: true, includeProjectMemory: true, includeProjectSources: true,
    });
    const updated = await service.setSessionContext('context-lifecycle', { includeGlobalMemory: false, includeProjectSources: false });
    expect(updated).toEqual({ includeGlobalMemory: false, includeProjectMemory: true, includeProjectSources: false });
    service.disposeAll();

    const reloaded = new AgentService(createConfig(root));
    await expect(reloaded.getSessionContext('context-lifecycle')).resolves.toEqual(updated);
    await expect(reloaded.setSessionContext('context-lifecycle', { unknown: true } as never)).rejects.toMatchObject({ code: 'invalid_session_context' });
    reloaded.disposeAll();
  });

  it('lista, elimina il JSONL e restituisce 404 al secondo DELETE', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memora-delete-'));
    roots.push(root);
    await createFixtureSession(root, 'delete-lifecycle');
    const service = new AgentService(createConfig(root));

    const before = await service.listSessions();
    expect(before.map((session) => session.sessionId)).toEqual(['delete-lifecycle']);
    const sessionFile = before[0]?.sessionFile;
    expect(sessionFile).toBeDefined();

    await expect(service.deleteSession('delete-lifecycle')).resolves.toEqual({
      sessionId: 'delete-lifecycle',
    });
    await expect(access(sessionFile as string)).rejects.toThrow();
    await expect(service.listSessions()).resolves.toEqual([]);
    await expect(service.deleteSession('delete-lifecycle')).rejects.toMatchObject({
      code: 'session_not_found',
    });
  });

  it('separa attive/archiviate e verifica archive/restore con più sessioni', async () => {
    const root = await mkdtemp(join(tmpdir(), 'memora-archive-'));
    roots.push(root);
    await createFixtureSession(root, 'active-lifecycle');
    await createFixtureSession(root, 'archived-lifecycle', true);
    const service = new AgentService(createConfig(root));

    expect((await service.listSessions()).map((session) => session.sessionId)).toEqual(['active-lifecycle']);
    expect((await service.listSessions(true)).map((session) => session.sessionId)).toEqual(['archived-lifecycle']);

    await service.setSessionArchived('active-lifecycle', true);
    await expect(service.listSessions()).resolves.toEqual([]);
    expect((await service.listSessions(true)).map((session) => session.sessionId).sort()).toEqual([
      'active-lifecycle',
      'archived-lifecycle',
    ]);

    await service.setSessionArchived('archived-lifecycle', false);
    expect((await service.listSessions()).map((session) => session.sessionId).sort()).toEqual([
      'archived-lifecycle',
    ]);
    expect((await service.listSessions(true)).map((session) => session.sessionId)).toEqual(['active-lifecycle']);
  });
});
