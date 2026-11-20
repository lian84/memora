import fs from 'node:fs';
import { tmpdir } from 'node:os';
import PDFDocument from 'pdfkit';
import { createCanvas, DOMMatrix as CanvasDOMMatrix, ImageData as CanvasImageData, Path2D as CanvasPath2D } from '@napi-rs/canvas';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import inlineCss from 'inline-css';
import { JSDOM } from 'jsdom';
import { memoraEnv } from './env.js';
import htmlToPdfmake from 'html-to-pdfmake';
import pdfMake from 'pdfmake';

export interface PdfRenderInput {
  title: string;
  markdown: string;
  author?: string;
}

export interface PdfRenderResult {
  buffer: Buffer;
  pages?: number;
}

export interface HtmlPdfRenderInput {
  title: string;
  html: string;
  author?: string;
  /** Data dir usata per trovare le librerie browser locali. */
  dataDir?: string;
}

const MAX_MARKDOWN_CHARS = 30_000;
const MAX_HTML_CHARS = 60_000;
const MAX_PAGES = 30;
const MAX_PDF_BYTES = 5 * 1024 * 1024;

function stripControlChars(value: string): string {
  return [...value].filter(char => {
    const code = char.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join('');
}

function cleanInline(value: string): string {
  return stripControlChars(value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\\([\\`*_[\]{}()#+.!-])/g, '$1'));
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cleanInline(cell.trim()));
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

export async function renderMarkdownPdf(input: PdfRenderInput): Promise<PdfRenderResult> {
  const title = (cleanInline(input.title).trim() || 'Documento').slice(0, 200);
  const markdown = input.markdown.replace(/\r\n/g, '\n').trim();
  if (!markdown) throw new Error('empty_markdown');
  if (markdown.length > MAX_MARKDOWN_CHARS) throw new Error('markdown_too_large');

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 54, right: 52, bottom: 52, left: 52 },
    bufferPages: true,
    info: { Title: title, Author: input.author ?? 'Memora', Creator: 'Memora' },
  });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.font('Helvetica-Bold').fontSize(21).fillColor('#111827').text(title, { lineGap: 2 });
  doc.moveDown(0.6);
  doc.strokeColor('#c9dcf8').lineWidth(1).moveTo(52, doc.y).lineTo(543, doc.y).stroke();
  doc.moveDown(0.9);

  const lines = markdown.split('\n');
  let inCode = false;
  const codeLines: string[] = [];

  const flushCode = () => {
    if (codeLines.length === 0) return;
    doc.font('Courier').fontSize(8.5).fillColor('#263449');
    doc.text(codeLines.join('\n'), { lineGap: 1, indent: 8 });
    doc.moveDown(0.55);
    codeLines.length = 0;
  };

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    if (raw.startsWith('```')) {
      if (inCode) { flushCode(); inCode = false; }
      else { inCode = true; codeLines.length = 0; }
      continue;
    }
    if (inCode) { codeLines.push(raw); continue; }

    if (isTableRow(raw) && index + 1 < lines.length && isSeparatorRow(lines[index + 1]!)) {
      const tableHeader = tableCells(raw);
      index++;
      const rows: string[][] = [];
      while (index + 1 < lines.length && isTableRow(lines[index + 1]!)) rows.push(tableCells(lines[++index]!));
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#263449');
      doc.text(tableHeader.join('   ·   '), { indent: 0, lineGap: 2 });
      doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
      for (const row of rows) doc.text(row.join('   ·   '), { indent: 0, lineGap: 2 });
      doc.moveDown(0.55);
      continue;
    }

    if (raw.trim() === '') { doc.moveDown(0.45); continue; }

    const heading = raw.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1]!.length;
      const size = level === 1 ? 16 : level === 2 ? 13 : level === 3 ? 11.5 : 10.5;
      doc.font('Helvetica-Bold').fontSize(size).fillColor('#111827').text(cleanInline(heading[2]!), { lineGap: 2 });
      doc.moveDown(0.35);
      continue;
    }

    const bullet = raw.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) {
      doc.font('Helvetica').fontSize(10.5).fillColor('#263449').text(`•  ${cleanInline(bullet[1]!)}`, { indent: 12, lineGap: 3 });
      continue;
    }

    const ordered = raw.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      doc.font('Helvetica').fontSize(10.5).fillColor('#263449').text(`${ordered[1]}.  ${cleanInline(ordered[2]!)}`, { indent: 12, lineGap: 3 });
      continue;
    }

    if (/^>\s?/.test(raw)) {
      doc.font('Helvetica-Oblique').fontSize(10).fillColor('#526174').text(cleanInline(raw.replace(/^>\s?/, '')), { indent: 12, lineGap: 3 });
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(raw)) {
      doc.moveDown(0.25);
      doc.strokeColor('#e2e9f2').lineWidth(0.7).moveTo(52, doc.y).lineTo(543, doc.y).stroke();
      doc.moveDown(0.45);
      continue;
    }

    doc.font('Helvetica').fontSize(10.5).fillColor('#263449').text(cleanInline(raw), { lineGap: 3 });
  }
  flushCode();

  const range = doc.bufferedPageRange();
  if (range.count > MAX_PAGES) throw new Error('pdf_too_many_pages');
  for (let page = range.start; page < range.start + range.count; page++) {
    doc.switchToPage(page);
    doc.font('Helvetica').fontSize(8).fillColor('#718096');
    doc.text(`Memora · ${page + 1} / ${range.count}`, 52, doc.page.height - 34, { align: 'center', width: 491, lineBreak: false });
  }
  doc.end();
  const buffer = await completed;
  return { buffer, pages: range.count };
}


function stripHtmlFence(input: string): string {
  const trimmed = input.trim();
  const fenced = trimmed.match(/```(?:html|htm)?\s*\n([\s\S]*?)```/i);
  if (fenced) return fenced[1]!.trim();
  const start = trimmed.search(/<!doctype\s+html|<html\b/i);
  return start >= 0 ? trimmed.slice(start) : trimmed;
}

function sanitizeHtmlForPdf(input: string): string {
  return stripControlChars(stripHtmlFence(input))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/@import\s+[^;]+;?/gi, '')
    .replace(/javascript\s*:/gi, '');
}

const PRINT_PAGINATION_CSS = `<style id="memora-print-pagination">
@media print {
  body { overflow-wrap: break-word; orphans: 3; widows: 3; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid-page; page-break-after: avoid; }
  p, li, blockquote, pre, figure, img { break-inside: avoid-page; page-break-inside: avoid; }
  table { break-inside: avoid-page; page-break-inside: avoid; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { break-inside: avoid-page; page-break-inside: avoid; }
  div[style*="background-color"][style*="border"] { break-inside: avoid-page; page-break-inside: avoid; }
  .card, .box, .callout, .panel, .notice, .tip { break-inside: avoid-page; page-break-inside: avoid; }
}
</style>`;

/** Inserisce regole di paginazione senza alterare il layout a schermo. */
function injectPrintPaginationCss(html: string): string {
  const head = html.search(/<\/head\s*>/i);
  if (head >= 0) return `${html.slice(0, head)}${PRINT_PAGINATION_CSS}${html.slice(head)}`;
  const body = html.search(/<body\b[^>]*>/i);
  if (body >= 0) {
    const end = html.indexOf('>', body) + 1;
    return `${html.slice(0, end)}${PRINT_PAGINATION_CSS}${html.slice(end)}`;
  }
  return `${PRINT_PAGINATION_CSS}${html}`;
}

let browserQueue: Promise<unknown> = Promise.resolve();

function withBrowserQueue<T>(task: () => Promise<T>): Promise<T> {
  const next = browserQueue.then(task, task);
  browserQueue = next.then(() => undefined, () => undefined);
  return next;
}

export interface PreviewImageOptions {
  /** Larghezza massima in pixel CSS. */
  maxWidth?: number;
  /** Altezza massima dello screenshot HTML. */
  maxHeight?: number;
  /** Data dir per le librerie Chromium locali. */
  dataDir?: string;
}

let pdfPreviewQueue: Promise<unknown> = Promise.resolve();

function withPdfPreviewQueue<T>(task: () => Promise<T>): Promise<T> {
  const next = pdfPreviewQueue.then(task, task);
  pdfPreviewQueue = next.then(() => undefined, () => undefined);
  return next;
}

interface PdfPreviewGlobals {
  Path2D?: unknown;
  DOMMatrix?: unknown;
  ImageData?: unknown;
  pdfjsWorker?: unknown;
}

/**
 * Isola il render PDF.js da altri consumatori di PDF nel processo.
 *
 * `pdf-parse` usa PDF.js 5 e una versione diversa di `@napi-rs/canvas`; quando
 * viene usato prima della preview lascia su `globalThis` un `Path2D`
 * incompatibile e un fake worker 5.x. PDF.js 6 accetta il contesto canvas solo
 * con la propria classe `Path2D` e rifiuta un worker di versione diversa.
 */
async function withIsolatedPdfGlobals<T>(task: (pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs')) => Promise<T>): Promise<T> {
  const runtime = globalThis as PdfPreviewGlobals;
  const previous = {
    Path2D: runtime.Path2D,
    DOMMatrix: runtime.DOMMatrix,
    ImageData: runtime.ImageData,
    pdfjsWorker: runtime.pdfjsWorker,
  };
  runtime.Path2D = CanvasPath2D;
  runtime.DOMMatrix = CanvasDOMMatrix;
  runtime.ImageData = CanvasImageData;
  delete runtime.pdfjsWorker;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return await task(pdfjs);
  } finally {
    if (previous.Path2D === undefined) delete runtime.Path2D;
    else runtime.Path2D = previous.Path2D;
    if (previous.DOMMatrix === undefined) delete runtime.DOMMatrix;
    else runtime.DOMMatrix = previous.DOMMatrix;
    if (previous.ImageData === undefined) delete runtime.ImageData;
    else runtime.ImageData = previous.ImageData;
    if (previous.pdfjsWorker === undefined) delete runtime.pdfjsWorker;
    else runtime.pdfjsWorker = previous.pdfjsWorker;
  }
}

/** Rende la prima pagina di un PDF in PNG, senza dipendere da un browser. */
export function renderPdfPreviewImage(buffer: Buffer, pageNumber = 1): Promise<Buffer> {
  return withPdfPreviewQueue(() => {
    if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) throw new Error('empty_pdf');
    return withIsolatedPdfGlobals(async (pdfjs) => {
      const task = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        disableFontFace: true,
        useSystemFonts: false,
      });
      const pdf = await task.promise;
      try {
        if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) throw new Error('invalid_pdf_page');
        const page = await pdf.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1200 / base.width);
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context as never, viewport, canvas: canvas as never }).promise;
        return canvas.toBuffer('image/png');
      } finally {
        await task.destroy().catch(() => undefined);
      }
    });
  });
}

async function launchPreviewBrowser(dataDir?: string) {
  const libs = memoraEnv('PDF_BROWSER_LIBS') ?? `${dataDir ?? memoraEnv('DATA_DIR') ?? 'data'}/browser-libs/usr/lib/x86_64-linux-gnu`;
  const executablePath = memoraEnv('PDF_BROWSER_PATH') ?? await chromium.executablePath();
  const env = {
    ...process.env,
    ...(fs.existsSync(libs) ? { LD_LIBRARY_PATH: [libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : {}),
    FONTCONFIG_PATH: process.env.FONTCONFIG_PATH ?? `${tmpdir()}/fonts`,
    HOME: process.env.HOME ?? tmpdir(),
  };
  return puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true,
    env,
  });
}

/** Rende un frammento HTML in PNG per la revisione visuale dell'artefatto. */
export async function renderHtmlPreviewImage(html: string, options: PreviewImageOptions = {}): Promise<Buffer> {
  const cleaned = sanitizeHtmlForPdf(html).trim();
  if (!cleaned) throw new Error('empty_html');
  if (cleaned.length > MAX_HTML_CHARS) throw new Error('html_too_large');
  const width = Math.min(Math.max(options.maxWidth ?? 1200, 320), 1600);
  const height = Math.min(Math.max(options.maxHeight ?? 1600, 320), 2400);
  const browser = await launchPreviewBrowser(options.dataDir);
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', request => { void request.abort(); });
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(cleaned, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.emulateMediaType('screen');
    const image = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } });
    if (image.length > 4 * 1024 * 1024) throw new Error('preview_image_too_large');
    return Buffer.from(image);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Converte HTML in PDF con Chromium headless; fallback a pdfmake se il browser non è disponibile. */
export async function renderHtmlPdf(input: HtmlPdfRenderInput): Promise<PdfRenderResult> {
  try {
    return await withBrowserQueue(() => renderHtmlPdfBrowser(input));
  } catch {
    return renderHtmlPdfFallback(input);
  }
}

async function renderHtmlPdfBrowser(input: HtmlPdfRenderInput): Promise<PdfRenderResult> {
  const html = sanitizeHtmlForPdf(input.html).trim();
  if (!html) throw new Error('empty_html');
  if (html.length > MAX_HTML_CHARS) throw new Error('html_too_large');
  const printableHtml = injectPrintPaginationCss(html);

  const browser = await launchPreviewBrowser(input.dataDir);
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', request => { void request.abort(); });
    await page.setContent(printableHtml, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '18mm', right: '16mm', bottom: '18mm', left: '16mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;font-size:7px;color:#999;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      timeout: 20_000,
    });
    if (pdf.length > MAX_PDF_BYTES) throw new Error('pdf_too_large');
    return { buffer: Buffer.from(pdf) };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function renderHtmlPdfFallback(input: HtmlPdfRenderInput): Promise<PdfRenderResult> {
  const title = (cleanInline(input.title).trim() || 'Documento').slice(0, 200);
  const html = sanitizeHtmlForPdf(input.html).trim();
  if (!html) throw new Error('empty_html');
  if (html.length > MAX_HTML_CHARS) throw new Error('html_too_large');

  const inlined = (await inlineCss(html, {
    url: 'http://localhost',
    removeStyleTags: true,
    preserveMediaQueries: false,
    applyStyleTags: true,
    removeHtmlSelectors: true,
  })).replace(/(font-family\s*:\s*)[^;]+/gi, '$1Helvetica');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const content = htmlToPdfmake(inlined, { window: dom.window });
  if (!Array.isArray(content) || content.length === 0) throw new Error('empty_html');

  const helvetica = { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' };
  pdfMake.fonts = {
    Helvetica: helvetica,
    HelveticaNeue: helvetica,
    Arial: helvetica,
    'sans-serif': helvetica,
    Roboto: helvetica,
    'Segoe UI': helvetica,
    Inter: helvetica,
  };
  pdfMake.setUrlAccessPolicy(() => false);
  pdfMake.setLocalAccessPolicy(value => /^(Helvetica|Courier|Times|Symbol|ZapfDingbats)/.test(value));

  const pdf = pdfMake.createPdf({
    content,
    defaultStyle: { font: 'Helvetica', fontSize: 9.5, color: '#263449' },
    pageSize: 'A4',
    pageMargins: [42, 48, 42, 48],
    info: { title, author: input.author ?? 'Memora', creator: 'Memora' },
  });
  const buffer = await pdf.getBuffer();
  return { buffer: Buffer.from(buffer) };
}
