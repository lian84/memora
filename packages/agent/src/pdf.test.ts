import { describe, expect, it } from 'vitest';
import { renderHtmlPdf, renderMarkdownPdf, renderPdfPreviewImage } from './pdf.js';

describe('renderMarkdownPdf', () => {
  it('genera un PDF valido da Markdown con titolo, elenco e codice', async () => {
    const result = await renderMarkdownPdf({
      title: 'Riepilogo progetto',
      markdown: '# Sezione\n\n- Primo punto\n- Secondo punto\n\n```ts\nconst x = 1;\n```\n',
    });
    expect(result.pages).toBeGreaterThan(0);
    expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.buffer.byteLength).toBeGreaterThan(500);
  });

  it('rifiuta documenti vuoti o troppo grandi', async () => {
    await expect(renderMarkdownPdf({ title: 'X', markdown: '   ' })).rejects.toThrow('empty_markdown');
    await expect(renderMarkdownPdf({ title: 'X', markdown: 'x'.repeat(30_001) })).rejects.toThrow('markdown_too_large');
  });
});


describe('renderHtmlPdf', () => {
  it('converte HTML con CSS inline in un PDF valido', async () => {
    const result = await renderHtmlPdf({
      title: 'Report',
      html: '<html><head><style>.cover{background:#2563eb;color:white;padding:20px}.title{font-size:28px;font-weight:bold}</style></head><body><div class="cover"><div class="title">Rapporto</div><div>ACME</div></div><table><tr><th>Voce</th><th>Valore</th></tr><tr><td>Uno</td><td>10</td></tr></table></body></html>',
    });
    expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.buffer.byteLength).toBeGreaterThan(500);
  });

  it('accetta introduzione e HTML in code fence e normalizza font non disponibili', async () => {
    const result = await renderHtmlPdf({
      title: 'Ricetta',
      html: 'Ecco il documento completo:\n\n```html\n<html><head><style>body{font-family:"Helvetica Neue", Arial, sans-serif}</style></head><body><h1>Carbonara</h1></body></html>\n```\n\nSpero sia utile.',
    });
    expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('rimuove script e rifiuta HTML vuoto', async () => {
    await expect(renderHtmlPdf({ title: 'X', html: '<script>alert(1)</script>' })).rejects.toThrow('empty_html');
  });
});


describe('renderPdfPreviewImage', () => {
  it('rende la prima pagina PDF in PNG per la revisione visuale', async () => {
    const pdf = await renderMarkdownPdf({ title: 'Anteprima', markdown: '# Titolo\n\nContenuto visibile.' });
    const image = await renderPdfPreviewImage(pdf.buffer);
    expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(image.byteLength).toBeGreaterThan(1000);
  });
});
