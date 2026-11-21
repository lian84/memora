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
    expect(profiles.map(profile => profile.id)).toEqual(['avvocato', 'brainstorming', 'business', 'chef', 'commercialista', 'designer', 'finanza', 'marketing', 'ricercatore', 'scrittore', 'social-media', 'suno-songwriter', 'sviluppatore', 'traduttore', 'tutor', 'viaggi']);

    const commercialista = await store.get('commercialista');
    expect(commercialista?.name).toBe('Commercialista');
    expect(commercialista?.color).toBe('#0f8a6a');
    expect(commercialista?.icon).toBe('calculator');
    expect(commercialista?.prompt).toContain('modalità Commercialista');
    expect(commercialista?.skills.map(skill => skill.name)).toContain('iva');

    const iva = await store.loadSkill('commercialista', 'iva');
    expect(iva).toContain('# IVA');

    const suno = await store.getDetail('suno-songwriter');
    expect(suno?.name).toBe('Suno Songwriter');
    expect(suno?.icon).toBe('music');
    expect(suno?.prompt).toContain('FORMATO DI RISPOSTA');
    expect(suno?.skills.map(skill => skill.name)).toEqual(['production-prompt', 'song-craft', 'suno-format']);
  });

  it('su una data directory già alla versione 2 aggiunge solo il nuovo profilo Suno', async () => {
    const { root, store } = await fixture();
    await import('node:fs/promises').then(({ mkdir }) => mkdir(join(root, 'agents'), { recursive: true }));
    await writeFile(join(root, 'agents', '.defaults-version'), '2\n');
    const profiles = await store.list();
    expect(profiles.map(profile => profile.id)).toContain('suno-songwriter');
    expect(profiles.map(profile => profile.id)).not.toContain('commercialista');
    expect(await store.loadSkill('suno-songwriter', 'suno-format')).toContain('# Formato Suno');
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

  it('crea, aggiorna, aggiunge competenze e sposta nel cestino', async () => {
    const { root, store } = await fixture();
    const created = await store.create({
      id: 'custom',
      name: 'Custom',
      description: 'Profilo di test',
      icon: 'terminal',
      color: '#123456',
      prompt: 'Istruzioni custom.',
    });
    expect(created.color).toBe('#123456');
    expect(created.skills).toEqual([]);

    const updated = await store.update('custom', { name: 'Custom aggiornato', prompt: 'Nuove istruzioni.' });
    expect(updated.name).toBe('Custom aggiornato');
    expect((await store.getDetail('custom'))?.prompt).toBe('Nuove istruzioni.');

    const withSkill = await store.saveSkill('custom', {
      name: 'checklist',
      description: 'Checklist di test',
      content: '# Checklist\n\n- Uno\n- Due',
    });
    expect(withSkill.skills[0]).toMatchObject({ name: 'checklist', description: 'Checklist di test' });
    expect(withSkill.skills[0]?.content).toContain('# Checklist');
    expect(withSkill.skills[0]?.content).not.toContain('name: checklist');

    const deletedSkill = await store.deleteSkill('custom', 'checklist', 'checklist');
    expect(deletedSkill.trashPath).toContain('.trash/agents');
    expect((await store.getDetail('custom'))?.skills).toEqual([]);

    const deleted = await store.purge('custom', 'custom');
    expect(deleted.trashPath).toContain('.trash/agents');
    expect(await store.getDetail('custom')).toBeNull();
    expect(root).toBeTruthy();
  });
});
