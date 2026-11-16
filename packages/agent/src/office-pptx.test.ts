import { describe, expect, it } from 'vitest';
import { renderPptxFromMarkdown } from './office-pptx.js';

describe('PPTX generation', () => {
  it('converte un deck HTML in PPTX e preview', async () => {
    const html = `<div class="pi-deck">
<section class="slide"><h1>Roadmap</h1><p>Obiettivi del trimestre.</p><ul><li>Prima cosa</li><li>Seconda cosa</li></ul></section>
<section class="slide"><h2>Dati</h2><table><tr><th>Voce</th><th>Valore</th></tr><tr><td>Uno</td><td>10</td></tr></table></section>
</div>`;
    const result = await renderPptxFromMarkdown({ markdown: '```html\n' + html + '\n```', title: 'Roadmap' });
    expect(result.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(result.slides).toBe(2);
    expect(result.previewHtml).toContain('class="slide"');
    expect(result.previewHtml).toContain('Roadmap');
    expect(result.previewHtml).not.toContain('<script');
  });

  it('rimuove script e URL esterni dalla preview', async () => {
    const result = await renderPptxFromMarkdown({ markdown: '<section class="slide"><h1>Sicuro</h1><script>alert(1)</script><img src="https://example.com/a.png"></section>' });
    expect(result.previewHtml).not.toContain('<script');
    expect(result.previewHtml).not.toContain('https://example.com');
  });

  it('incorpora immagini data URI nel PPTX', async () => {
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const result = await renderPptxFromMarkdown({ markdown: `<section class="slide"><h1>Immagine</h1><img src="${pixel}"></section>` });
    expect(result.slides).toBe(1);
    expect(result.buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('usa un fallback Markdown senza slide HTML', async () => {
    const result = await renderPptxFromMarkdown({ markdown: '# Titolo\n\n- Uno\n- Due\n\n---\n\n## Seconda\n\nTesto.' });
    expect(result.slides).toBe(2);
    expect(result.previewHtml).toContain('Titolo');
    expect(result.previewHtml).toContain('Seconda');
  });
});
