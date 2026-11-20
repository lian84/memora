import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpAccountStore } from './mcp-accounts.js';

const roots: string[] = [];
async function fixture(): Promise<McpAccountStore> {
  const root = await mkdtemp(join(tmpdir(), 'memora-mcp-accounts-'));
  roots.push(root);
  return new McpAccountStore(root);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('McpAccountStore', () => {
  it('gestisce account globali, predefiniti e account project-scoped', async () => {
    const store = await fixture();
    const personal = await store.create({
      scope: 'global', serverId: 'notion', label: 'Personale', secretRef: 'env:NOTION_PERSONAL', defaultForServer: true,
    });
    const work = await store.create({
      scope: 'global', serverId: 'notion', label: 'Lavoro', secretRef: 'env:NOTION_WORK', defaultForServer: true,
    });
    expect(personal.id).toMatch(/^acc_notion_/);
    expect((await store.list()).find(account => account.id === personal.id)?.defaultForServer).toBe(false);
    expect((await store.list()).find(account => account.id === work.id)?.defaultForServer).toBe(true);

    const projectAccount = await store.create({
      scope: 'project', projectId: 'orione', serverId: 'todoist', label: 'Team Orione', secretRef: 'secret:mcp:todoist:orione',
    });
    expect(projectAccount.projectId).toBe('orione');
    expect((await store.list('orione')).map(account => account.id)).toContain(projectAccount.id);
    expect((await store.list('altro')).map(account => account.id)).not.toContain(projectAccount.id);

    const updated = await store.update(projectAccount.id, { label: 'Team Orione 2' });
    expect(updated.label).toBe('Team Orione 2');
    await store.delete(projectAccount.id, projectAccount.id);
    expect((await store.list('orione')).map(account => account.id)).not.toContain(projectAccount.id);
  });

  it('rifiuta segreti in chiaro e conferme errate', async () => {
    const store = await fixture();
    await expect(store.create({ scope: 'global', serverId: 'notion', label: 'X', secretRef: 'ntn_segreto' })).rejects.toMatchObject({ code: 'invalid_mcp_secret_ref' });
    const account = await store.create({ scope: 'global', serverId: 'todoist', label: 'X', secretRef: 'env:TODOIST_TOKEN' });
    await expect(store.delete(account.id, 'wrong')).rejects.toMatchObject({ code: 'invalid_mcp_account_confirmation' });
  });
});
