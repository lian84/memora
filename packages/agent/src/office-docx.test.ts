import { describe, expect, it } from 'vitest';
import { renderDocxFromMarkdown } from './office-docx.js';

describe('DOCX generation', () => {
  it('genera un documento Word valido da Markdown', async () => {
    const buffer = await renderDocxFromMarkdown('# Titolo\n\nTesto **in grassetto**.\n\n- Uno\n- Due\n\n| Nome | Valore |\n| --- | --- |\n| A | 1 |\n', { title: 'Titolo' });
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(buffer.byteLength).toBeGreaterThan(200);
  });

  it('non fallisce con Markdown vuoto', async () => {
    const buffer = await renderDocxFromMarkdown('');
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });
});
