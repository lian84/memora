import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArtifactStore } from './artifacts.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-artifacts-'));
  roots.push(root);
  return { root, store: new ArtifactStore(root) };
}

describe('ArtifactStore', () => {
  it('crea, elenca e legge un artefatto markdown', async () => {
    const { root, store } = await fixture();
    const saved = await store.save('session-1', { name: 'riepilogo', kind: 'markdown', content: '# Riepilogo\n\nTesto.' });
    expect(saved).toMatchObject({ name: 'riepilogo.md', kind: 'markdown', sessionId: 'session-1', version: 1 });
    expect((await store.list('session-1'))).toHaveLength(1);
    const updated = await store.save('session-1', { name: 'riepilogo.md', kind: 'markdown', content: '# Riepilogo\n\nTesto aggiornato.' });
    expect(updated).toMatchObject({ name: 'riepilogo.md', id: saved.id, version: 2 });
    expect((await store.list('session-1'))).toHaveLength(1);
    expect((await store.get('session-1', saved.id)).buffer.toString('utf8')).toContain('Testo aggiornato.');
    expect(await store.listVersions('session-1', saved.id)).toEqual([
      expect.objectContaining({ version: 1, current: false }),
      expect.objectContaining({ version: 2, current: true }),
    ]);
    expect((await store.getVersion('session-1', saved.id, 1)).buffer.toString('utf8')).toContain('Testo.');
    const loaded = await store.get('session-1', saved.id);
    expect(loaded.buffer.toString('utf8')).toContain('Testo aggiornato.');
    expect((await fs.stat(path.join(root, 'artifacts', 'session-1'))).mode & 0o777).toBe(0o700);
  });

  it('salva artefatti Office e la preview HTML sidecar', async () => {
    const { store } = await fixture();
    const docx = await store.save('session-1', { name: 'documento.docx', kind: 'docx', content: Buffer.from('docx') });
    const xlsx = await store.save('session-1', { name: 'foglio.xlsx', kind: 'xlsx', content: Buffer.from('xlsx') });
    const pptx = await store.save('session-1', { name: 'deck.pptx', kind: 'pptx', content: Buffer.from('pptx') });
    expect(docx).toMatchObject({ kind: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(xlsx).toMatchObject({ kind: 'xlsx' });
    expect(pptx).toMatchObject({ kind: 'pptx' });
    await store.savePreview('session-1', pptx.id, '<section class="slide">Ciao</section>');
    expect(await store.getPreview('session-1', pptx.id)).toContain('Ciao');
    await store.save('session-1', { name: 'deck.pptx', kind: 'pptx', content: Buffer.from('pptx-2') });
    expect(await store.getPreview('session-1', pptx.id)).toBeNull();
    await store.remove('session-1', pptx.id);
    expect(await store.getPreview('session-1', pptx.id)).toBeNull();
  });

  it('elimina un artefatto e tutte le sue versioni', async () => {
    const { store } = await fixture();
    const saved = await store.save('session-1', { name: 'riepilogo.md', kind: 'markdown', content: 'v1' });
    await store.save('session-1', { name: 'riepilogo.md', kind: 'markdown', content: 'v2' });
    expect((await store.listVersions('session-1', saved.id))).toHaveLength(2);
    await store.remove('session-1', saved.id);
    expect(await store.list('session-1')).toEqual([]);
    await expect(store.get('session-1', saved.id)).rejects.toMatchObject({ code: 'artifact_not_found' });
    await expect(store.remove('session-1', saved.id)).rejects.toMatchObject({ code: 'artifact_not_found' });
  });

  it('valida nome, tipo e dimensione', async () => {
    const { store } = await fixture();
    await expect(store.save('session-1', { name: 'x', kind: 'html', content: '' })).rejects.toMatchObject({ code: 'empty_artifact' });
    await expect(store.save('session-1', { name: 'x', kind: 'exe' as never, content: 'x' })).rejects.toMatchObject({ code: 'invalid_artifact_kind' });
    await expect(store.save('session-1', { name: '../x.md', kind: 'markdown', content: 'x' })).resolves.toMatchObject({ name: 'x.md' });
  });
});
