import { describe, expect, it } from 'vitest';
import { renderDocxFromMarkdown } from '@memora/agent';
import { renderDocxPreviewHtml } from './docx-preview.js';

describe('DOCX preview', () => {
  it('converte un DOCX valido in HTML', async () => {
    const buffer = await renderDocxFromMarkdown('# Titolo\n\nTesto con **grassetto**.');
    const html = await renderDocxPreviewHtml(buffer);
    expect(html).toContain('<h1>Titolo</h1>');
    expect(html).toContain('<strong>grassetto</strong>');
    expect(html).toContain('font-family:Georgia');
  });

  it('rifiuta un DOCX malformato senza crash del processo', async () => {
    await expect(renderDocxPreviewHtml(Buffer.from('not-a-docx'))).rejects.toBeTruthy();
  });
});
