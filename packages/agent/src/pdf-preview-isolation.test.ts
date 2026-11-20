import { expect, it } from 'vitest';
import { renderMarkdownPdf } from './pdf.js';
import { renderPdfPreviewImage } from './pdf.js';

it('rende la preview anche dopo pdf-parse ha lasciato i suoi globals PDF.js', async () => {
  const pdf = await renderMarkdownPdf({
    title: 'Isolamento PDF',
    markdown: '# Titolo\n\nTesto con **grassetto** e una tabella:\n\n| Voce | Valore |\n| --- | --- |\n| Uno | 1 |\n',
  });

  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(pdf.buffer) });
  try {
    await parser.getText();
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  const image = await renderPdfPreviewImage(pdf.buffer);
  expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(image.byteLength).toBeGreaterThan(1000);
});
