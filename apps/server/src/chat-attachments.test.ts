import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChatAttachmentStore } from './chat-attachments.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memora-chat-attachments-'));
  roots.push(root);
  return { root, store: new ChatAttachmentStore(root) };
}

describe('ChatAttachmentStore', () => {
  it('salva, rilegge ed estrae il testo di un allegato', async () => {
    const { root, store } = await fixture();
    const saved = await store.save('session-1', { filename: 'note.md', data: Buffer.from('# Nota\nContenuto allegato.') });
    expect(saved).toMatchObject({ filename: 'note.md', kind: 'text', mimeType: 'text/markdown' });
    const loaded = await store.get('session-1', saved.id);
    expect(loaded.filename).toBe('note.md');
    expect(loaded.buffer.toString('utf8')).toContain('Contenuto allegato');
    const context = await store.toModelContext(loaded);
    expect(context.text).toContain('Contenuto allegato');
    expect((await fs.stat(path.join(root, 'chat-attachments', 'session-1'))).mode & 0o777).toBe(0o700);
  });

  it('rimuove gli allegati quando la sessione viene eliminata', async () => {
    const { root, store } = await fixture();
    const saved = await store.save('session-1', { filename: 'nota.txt', data: Buffer.from('ok') });
    await store.removeSession('session-1');
    await expect(store.get('session-1', saved.id)).rejects.toMatchObject({ code: 'attachment_not_found' });
    await expect(fs.stat(path.join(root, 'chat-attachments', 'session-1'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rifiuta estensioni non supportate e nomi pericolosi', async () => {
    const { store } = await fixture();
    await expect(store.save('session-1', { filename: 'script.exe', data: Buffer.from('no') })).rejects.toMatchObject({ code: 'unsupported_attachment_type' });
    const saved = await store.save('session-1', { filename: '../nota.txt', data: Buffer.from('ok') });
    expect(saved.filename).toBe('nota.txt');
  });
});
