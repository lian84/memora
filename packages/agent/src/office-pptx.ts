import { JSDOM } from 'jsdom';
import PptxGenJS from 'pptxgenjs';

const MAX_HTML_CHARS = 120_000;
const MAX_SLIDES = 50;
const MAX_BULLETS = 14;
const MAX_TABLE_ROWS = 12;

export interface PptxRenderInput {
  markdown: string;
  title?: string;
}

export interface PptxRenderResult {
  buffer: Buffer;
  previewHtml: string;
  slides: number;
}

interface SlideContent {
  title: string;
  paragraphs: string[];
  bullets: string[];
  table: string[][];
  images: string[];
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function extractHtml(markdown: string): string | null {
  const trimmed = markdown.trim();
  const fenced = trimmed.match(/```(?:html|htm)?\s*\n([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  if (candidate.length > MAX_HTML_CHARS) throw new Error('pptx_html_too_large');
  return /<section\b[^>]*class=["'][^"']*\bslide\b/i.test(candidate) || /<div\b[^>]*class=["'][^"']*\bslide\b/i.test(candidate)
    ? candidate
    : null;
}

function sanitizeSection(section: Element): Element {
  const clone = section.cloneNode(true) as Element;
  clone.querySelectorAll('script, iframe, object, embed, link, base, form, meta').forEach(node => node.remove());
  clone.querySelectorAll('*').forEach(element => {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || attribute.name === 'href' || attribute.name === 'formaction') {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (attribute.name === 'src' && !/^data:image\//i.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return clone;
}

function collectSections(document: Document): Element[] {
  return [...document.querySelectorAll('section.slide, .slide')]
    .filter(element => !element.parentElement?.closest('.slide'))
    .slice(0, MAX_SLIDES);
}

function buildPreviewHtml(sections: string[], styles: string[]): string {
  const safeStyles = styles.join('\n').replace(/<\/style/gi, '<\\/style');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box}
body{margin:0;padding:24px;background:#e5e7eb;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.pi-deck{display:flex;flex-direction:column;align-items:center;gap:24px}
.pi-deck .slide{width:1280px;height:720px;flex:0 0 auto;padding:64px;overflow:hidden;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.18);position:relative}
.pi-deck .slide h1{margin:0 0 20px;font-size:48px;line-height:1.1}
.pi-deck .slide h2{margin:0 0 18px;font-size:34px;line-height:1.2}
.pi-deck .slide p,.pi-deck .slide li{font-size:22px;line-height:1.45}
.pi-deck .slide ul{padding-left:28px}
.pi-deck .slide table{border-collapse:collapse;width:100%;margin-top:12px}
.pi-deck .slide th,.pi-deck .slide td{border:1px solid #cbd5e1;padding:8px 12px;text-align:left;font-size:18px}
.pi-deck .slide th{background:#f1f5f9}
@media(max-width:1360px){body{padding:16px}.pi-deck .slide{zoom:.72}}
</style>
${safeStyles ? `<style>${safeStyles}</style>` : ''}
</head>
<body><div class="pi-deck">${sections.join('\n')}</div></body>
</html>`;
}

function contentFromSection(section: Element): SlideContent {
  const titleElement = section.querySelector('h1, h2, h3');
  const title = cleanText(titleElement?.textContent) || 'Slide';
  const paragraphs = [...section.querySelectorAll('p')]
    .filter(element => !element.closest('table'))
    .map(element => cleanText(element.textContent))
    .filter(Boolean);
  const bullets = [...section.querySelectorAll('li')]
    .map(element => cleanText(element.textContent))
    .filter(Boolean);
  const tableRows = [...section.querySelectorAll('table tr')]
    .slice(0, MAX_TABLE_ROWS)
    .map(row => [...row.querySelectorAll('th, td')].map(cell => cleanText(cell.textContent)));
  const images = [...section.querySelectorAll('img')]
    .map(image => image.getAttribute('src') ?? '')
    .filter(src => /^data:image\//i.test(src))
    .slice(0, 3);
  return { title, paragraphs, bullets, table: tableRows, images };
}

function fallbackSlides(markdown: string): SlideContent[] {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const slides: SlideContent[] = [];
  let title = '';
  let body: string[] = [];
  const flush = () => {
    if (!title && body.length === 0) return;
    slides.push({
      title: title || 'Presentazione',
      paragraphs: body.filter(line => !/^\s*[-*+]\s+/.test(line)).map(line => cleanText(line.replace(/^#+\s*/, ''))).filter(Boolean),
      bullets: body.filter(line => /^\s*[-*+]\s+/.test(line)).map(line => cleanText(line.replace(/^\s*[-*+]\s+/, ''))).filter(Boolean),
      table: [],
      images: [],
    });
    title = '';
    body = [];
  };
  for (const line of lines) {
    const heading = line.trim().match(/^#{1,2}\s+(.+)$/);
    if (heading) {
      flush();
      title = cleanText(heading[1]);
      continue;
    }
    if (line.trim() === '---') { flush(); continue; }
    if (line.trim()) body.push(line.trim());
    if (slides.length >= MAX_SLIDES) break;
  }
  flush();
  return slides.slice(0, MAX_SLIDES).length > 0 ? slides.slice(0, MAX_SLIDES) : [{ title: 'Presentazione', paragraphs: ['Contenuto non disponibile.'], bullets: [], table: [], images: [] }];
}

function addSlideContent(pptx: PptxGenJS, content: SlideContent, slideNumber: number): void {
  const slide = pptx.addSlide();
  slide.addText(content.title, {
    x: 0.7, y: 0.4, w: 11.9, h: 0.9,
    fontSize: 30, bold: true, color: '111827', fit: 'shrink',
  });
  const hasTable = content.table.length > 0;
  const hasImages = content.images.length > 0;
  const body = content.bullets.length > 0 ? content.bullets : content.paragraphs;
  if (body.length > 0) {
    slide.addText(body.slice(0, MAX_BULLETS).map((text, index) => ({
      text,
      options: { bullet: content.bullets.length > 0, breakLine: index < Math.min(body.length, MAX_BULLETS) - 1, fontSize: 18, color: '334155' },
    })), {
      x: 0.8, y: 1.55, w: hasTable || hasImages ? 5.8 : 11.8, h: 4.8, valign: 'top', fit: 'shrink',
    });
  }
  if (hasTable) {
    slide.addTable(content.table.map((row, rowIndex) => row.map(cell => ({
      text: cell,
      options: { fontSize: 12, bold: rowIndex === 0, color: '1F2937' },
    }))), {
      x: body.length > 0 ? 6.9 : 0.8,
      y: 1.55,
      w: body.length > 0 ? 5.6 : 11.8,
      h: 4.7,
      fontFace: 'Arial',
      border: { type: 'solid', pt: 1, color: 'CBD5E1' },
      valign: 'top',
    });
  }
  if (hasImages && !hasTable) {
    slide.addImage({ data: content.images[0]!, x: 7.3, y: 1.55, w: 5.2, h: 4.8, sizing: { type: 'contain', w: 5.2, h: 4.8 } });
  }
  slide.addText(String(slideNumber), { x: 12.3, y: 7.05, w: 0.5, h: 0.25, fontSize: 10, color: '64748B', align: 'right' });
}

/** Crea una preview HTML e un PPTX a partire dal deck HTML finale o da Markdown. */
export async function renderPptxFromMarkdown(input: PptxRenderInput): Promise<PptxRenderResult> {
  const html = extractHtml(input.markdown);
  let sections: string[] = [];
  let styles: string[] = [];
  let contents: SlideContent[] = [];

  if (html) {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const found = collectSections(document);
    if (found.length > 0) {
      styles = [...document.querySelectorAll('style')].map(style => style.textContent ?? '');
      sections = found.map(section => sanitizeSection(section).outerHTML);
      contents = found.map(contentFromSection);
    }
  }

  if (contents.length === 0) {
    contents = fallbackSlides(input.markdown);
    sections = contents.map(content => {
      const paragraphs = content.paragraphs.map(text => `<p>${escapeHtml(text)}</p>`).join('');
      const bullets = content.bullets.length > 0 ? `<ul>${content.bullets.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul>` : '';
      return `<section class="slide"><h1>${escapeHtml(content.title)}</h1>${paragraphs}${bullets}</section>`;
    });
  }

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Memora';
  pptx.title = input.title?.trim() || contents[0]?.title || 'Presentazione';
  contents.forEach((content, index) => addSlideContent(pptx, content, index + 1));
  const output = await pptx.write({ outputType: 'nodebuffer' });
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output as Uint8Array);
  return { buffer, previewHtml: buildPreviewHtml(sections, styles), slides: contents.length };
}
