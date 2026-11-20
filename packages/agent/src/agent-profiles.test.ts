import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentProfileStore } from './agent-profiles.js';

const roots: string[] = [];

async function fixture(): Promise<{ root: string; store: AgentProfileStore }> {
  const root = await mkdtemp(join(tmpdir(), 'memora-agent-profiles-'));
  roots.push(root);
  return { root, store: new AgentProfileStore(root) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('AgentProfileStore', () => {
  it('inizializza i profili di esempio e carica le competenze on demand', async () => {
    const { store } = await fixture();
    const profiles = await store.list();
    expect(profiles.map(profile => profile.id)).toEqual(['brainstorming', 'commercialista', 'social-media', 'sviluppatore']);

    const commercialista = await store.get('commercialista');
    expect(commercialista?.name).toBe('Commercialista');
    expect(commercialista?.color).toBe('#0f8a6a');
    expect(commercialista?.icon).toBe('calculator');
    expect(commercialista?.prompt).toContain('modalità Commercialista');
    expect(commercialista?.skills.map(skill => skill.name)).toContain('iva');

    const iva = await store.loadSkill('commercialista', 'iva');
    expect(iva).toContain('# IVA');
  });

  it('non ricrea i profili se la directory esiste già', async () => {
    const { root, store } = await fixture();
    await store.initialize();
    const extra = join(root, 'agents', 'custom');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(join(extra, 'skills'), { recursive: true }));
    await writeFile(join(extra, 'agent.json'), JSON.stringify({ version: 1, id: 'custom', name: 'Custom', description: 'Test', icon: 'code' }));
    await writeFile(join(extra, 'PROMPT.md'), 'Istruzioni custom');
    const profiles = await store.list();
    expect(profiles.map(profile => profile.id)).toContain('custom');
    expect(profiles.find(profile => profile.id === 'custom')?.color).toBe('#2563eb');
    expect(profiles.some(profile => profile.id === 'commercialista')).toBe(true);
  });

  it('rifiuta path traversal e competenze inesistenti', async () => {
    const { store } = await fixture();
    await expect(store.loadSkill('commercialista', '../../secret')).rejects.toMatchObject({ code: 'invalid_agent_skill' });
    await expect(store.loadSkill('commercialista', 'inesistente')).rejects.toMatchObject({ code: 'agent_profile_not_found' });
  });
});
