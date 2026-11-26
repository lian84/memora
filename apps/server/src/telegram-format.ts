/**
 * Conversione Markdown → HTML Telegram e suddivisione sicura dei messaggi.
 *
 * Telegram non è un browser: interpreta un sottoinsieme di HTML, ha un limite
 * di 4.096 caratteri e non capisce le tabelle GFM. Questo modulo produce solo
 * tag supportati, converte le tabelle in elenchi e non lascia mai passare HTML
 * grezzo proveniente dal modello.
 */

export const TELEGRAM_MESSAGE_LIMIT = 4_000;
export const TELEGRAM_MAX_REPLY_CHUNKS = 3;

export interface TelegramReplyDocument {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface PreparedTelegramReply {
  /** Blocchi HTML pronti per `sendMessage` con `parse_mode: 'HTML'`. */
  chunks: string[];
  /** Versione Markdown completa, presente solo quando i blocchi sono troppi. */
  document?: TelegramReplyDocument;
}

const PLACEHOLDER = '\uE000';
const INLINE_CODE = /`([^`\n]+)`/g;
const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const LINK = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const BOLD_STAR = /\*\*([^\n]+?)\*\*/g;
const BOLD_UNDERSCORE = /__([^\n_]+?)__/g;
const ITALIC_STAR = /(^|[^*])\*([^*\n]+)\*(?!\*)/g;
const ITALIC_UNDERSCORE = /(^|[^\w])_([^_\n]+)_(?!\w)/g;
const STRIKE = /~~([^\n]+?)~~/g;

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Escapa testo dinamico destinato a un messaggio HTML Telegram. */
export function escapeTelegramHtml(value: string): string {
  return escapeHtml(value);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

function decodeHtml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (_match, entity: string) => {
    switch (entity) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case '#39': return "'";
      default: return _match;
    }
  });
}

function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function safeUrl(value: string): string | null {
  const raw = decodeHtml(value.trim());
  if (!raw || raw.length > 2_000 || hasControlChars(raw)) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Rimuove i tag generati dal formatter e ripristina le entità di base. */
export function stripTelegramHtml(html: string): string {
  return decodeHtml(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<(?:blockquote|pre)>/gi, '\n')
      .replace(/<\/(?:blockquote|pre|p)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

function formatInline(input: string): string {
  const placeholders: string[] = [];
  const stash = (html: string): string => {
    const index = placeholders.push(html) - 1;
    return `${PLACEHOLDER}${index}${PLACEHOLDER}`;
  };
  let value = escapeHtml(input.replaceAll(PLACEHOLDER, ''));

  value = value.replace(INLINE_CODE, (_match, code: string) => stash(`<code>${code}</code>`));

  value = value.replace(IMAGE, (_match, alt: string, url: string) => {
    const target = safeUrl(url);
    const label = alt.trim() || 'immagine';
    return target
      ? stash(`🖼 <a href="${escapeAttribute(target)}">${formatInline(label)}</a>`)
      : `🖼 ${formatInline(label)}`;
  });

  value = value.replace(LINK, (_match, label: string, url: string) => {
    const target = safeUrl(url);
    return target
      ? stash(`<a href="${escapeAttribute(target)}">${formatInline(label)}</a>`)
      : formatInline(label);
  });

  value = value.replace(BOLD_STAR, '<b>$1</b>');
  value = value.replace(BOLD_UNDERSCORE, '<b>$1</b>');
  value = value.replace(ITALIC_STAR, '$1<i>$2</i>');
  value = value.replace(ITALIC_UNDERSCORE, '$1<i>$2</i>');
  value = value.replace(STRIKE, '<s>$1</s>');

  return value.replace(/\uE000(\d+)\uE000/g, (_match, index: string) => placeholders[Number(index)] ?? '');
}

function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  return value.split('|').map(cell => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function formatTable(header: string, rows: string[]): string {
  const headers = splitTableRow(header);
  const lines: string[] = [];
  for (const row of rows) {
    const cells = splitTableRow(row);
    if (cells.every(cell => !cell)) continue;
    const parts: string[] = [];
    const columns = Math.max(headers.length, cells.length);
    for (let index = 0; index < columns; index += 1) {
      const cell = cells[index] ?? '';
      if (!cell) continue;
      const label = headers[index] || `Colonna ${index + 1}`;
      parts.push(`<b>${formatInline(label)}</b>: ${formatInline(cell)}`);
    }
    if (parts.length > 0) lines.push(`• ${parts.join(' · ')}`);
  }
  return lines.join('\n');
}

function isBlockStart(line: string, next: string | undefined): boolean {
  if (/^\s*(?:```+|~~~+)/.test(line)) return true;
  if (/^\s{0,3}#{1,6}\s+/.test(line)) return true;
  if (/^\s*>\s?/.test(line)) return true;
  if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) return true;
  if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) return true;
  return line.includes('|') && next !== undefined && isTableSeparator(next);
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function formatListItem(line: string): string | null {
  const match = LIST_ITEM.exec(line);
  if (!match) return null;
  const indentation = '  '.repeat(Math.min(3, Math.floor((match[1]?.length ?? 0) / 2)));
  const marker = match[2] ?? '';
  const rest = match[3] ?? '';
  const task = /^\[([ xX])\]\s+(.*)$/.exec(rest);
  if (task) {
    return `${indentation}${task[1]?.toLowerCase() === 'x' ? '☑' : '☐'} ${formatInline(task[2] ?? '')}`;
  }
  if (/^\d/.test(marker)) {
    return `${indentation}${marker.replace(/[.)]$/, '.')} ${formatInline(rest)}`;
  }
  return `${indentation}• ${formatInline(rest)}`;
}

/** Converte Markdown/Gfm in HTML compatibile con Telegram. */
export function formatTelegramHtml(markdown: string): string {
  const source = markdown.replace(/\r\n?/g, '\n').replaceAll(PLACEHOLDER, '').trim();
  if (!source) return '';
  const lines = source.split('\n');
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+-]{0,20})\s*$/.exec(line);
    if (fence) {
      const fenceChar = fence[1]?.[0] ?? '`';
      const fenceLength = fence[1]?.length ?? 3;
      const language = fence[2] ?? '';
      const closing = new RegExp(`^\\s*${fenceChar}{${fenceLength},}\\s*$`);
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !closing.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      const languageClass = /^[A-Za-z0-9_+-]{1,20}$/.test(language)
        ? ` class="language-${language.toLowerCase()}"`
        : '';
      blocks.push(`<pre><code${languageClass}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const next = lines[index + 1];
    if (line.includes('|') && next !== undefined && isTableSeparator(next)) {
      const header = line;
      index += 2;
      const rows: string[] = [];
      while (index < lines.length && (lines[index] ?? '').trim() && (lines[index] ?? '').includes('|')) {
        rows.push(lines[index] ?? '');
        index += 1;
      }
      const table = formatTable(header, rows);
      if (table) blocks.push(table);
      continue;
    }

    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push(`<b>${formatInline(heading[1] ?? '')}</b>`);
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote>${quote.map(formatInline).join('\n')}</blockquote>`);
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push('────────');
      index += 1;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = formatListItem(lines[index] ?? '');
        if (item === null) break;
        items.push(item);
        index += 1;
      }
      if (items.length > 0) blocks.push(items.join('\n'));
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (!current.trim()) break;
      if (paragraph.length > 0 && isBlockStart(current, lines[index + 1])) break;
      paragraph.push(current);
      index += 1;
    }
    if (paragraph.length > 0) blocks.push(paragraph.map(formatInline).join('\n'));
  }

  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

interface HtmlTagToken {
  type: 'tag';
  value: string;
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

interface HtmlTextToken {
  type: 'text';
  value: string;
}

type HtmlToken = HtmlTagToken | HtmlTextToken;

function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const matcher = /<[^>]+>|[^<]+/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(html)) !== null) {
    const value = match[0];
    if (!value.startsWith('<')) {
      tokens.push({ type: 'text', value });
      continue;
    }
    const closing = /^<\//.test(value);
    const name = /^<\/?([a-zA-Z0-9-]+)/.exec(value)?.[1]?.toLowerCase() ?? '';
    const selfClosing = /\/>$/.test(value) || ['br', 'hr'].includes(name);
    tokens.push({ type: 'tag', value, name, closing, selfClosing });
  }
  return tokens;
}

function hasVisibleText(html: string): boolean {
  return stripTelegramHtml(html).replace(/\s+/g, '').length > 0;
}

function safeCut(text: string, max: number): number {
  if (text.length <= max) return text.length;
  const window = text.slice(0, max);
  const whitespace = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\n'), window.lastIndexOf('\t'));
  let cut = whitespace >= Math.floor(max * 0.5) ? whitespace + 1 : max;
  const ampersand = text.lastIndexOf('&', cut - 1);
  if (ampersand >= 0) {
    const semicolon = text.indexOf(';', ampersand + 1);
    if (semicolon >= cut && semicolon - ampersand <= 12) cut = ampersand;
  }
  if (cut > 0 && cut < text.length) {
    const code = text.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  }
  return Math.max(1, Math.min(text.length, cut));
}

/**
 * Divide HTML Telegram in blocchi entro il limite, chiudendo e riaprendo i tag
 * aperti ai confini. Non taglia mai un tag a metà.
 */
export function splitTelegramHtml(html: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  if (!html.trim()) return [];
  const max = Math.max(64, Math.floor(limit));
  const tokens = tokenizeHtml(html);
  const chunks: string[] = [];
  const open: Array<{ name: string; value: string }> = [];
  let current = '';

  const closingTags = (): string => open.slice().reverse().map(tag => `</${tag.name}>`).join('');
  const reopeningTags = (): string => open.map(tag => tag.value).join('');

  const flush = (): void => {
    const content = `${current}${closingTags()}`;
    if (hasVisibleText(content)) chunks.push(content.trim());
    current = reopeningTags();
  };

  const appendText = (text: string): void => {
    let remaining = text;
    while (remaining.length > 0) {
      const available = max - current.length - closingTags().length;
      if (available <= 0) {
        if (hasVisibleText(current)) {
          flush();
          continue;
        }
        const fallback = Math.max(1, Math.min(remaining.length, max - reopeningTags().length));
        current += remaining.slice(0, fallback);
        remaining = remaining.slice(fallback);
        flush();
        continue;
      }
      if (remaining.length <= available) {
        current += remaining;
        return;
      }
      const cut = safeCut(remaining, available);
      current += remaining.slice(0, cut);
      remaining = remaining.slice(cut);
      flush();
    }
  };

  for (const token of tokens) {
    if (token.type === 'text') {
      appendText(token.value);
      continue;
    }
    if (token.closing) {
      current += token.value;
      const position = open.map(tag => tag.name).lastIndexOf(token.name);
      if (position >= 0) open.splice(position, 1);
      continue;
    }
    const projectedClosing = `${closingTags()}</${token.name}>`;
    if (current.length + token.value.length + projectedClosing.length > max && hasVisibleText(current)) {
      flush();
    }
    current += token.value;
    if (!token.selfClosing) open.push({ name: token.name, value: token.value });
  }

  const finalContent = `${current}${closingTags()}`;
  if (hasVisibleText(finalContent)) chunks.push(finalContent.trim());
  return chunks;
}

function markdownFilename(value?: string): string {
  const base = (value ?? 'risposta')
    .normalize('NFKC')
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'risposta'}.md`;
}

/**
 * Prepara la risposta per Telegram. Se i blocchi superano il massimo, restituisce
 * solo i primi e allega il Markdown completo come documento.
 */
export function prepareTelegramReply(
  markdown: string,
  options: { limit?: number; maxChunks?: number; filename?: string } = {},
): PreparedTelegramReply {
  const html = formatTelegramHtml(markdown);
  const chunks = splitTelegramHtml(html, options.limit ?? TELEGRAM_MESSAGE_LIMIT);
  if (chunks.length === 0) return { chunks: [] };
  const maxChunks = Math.max(1, Math.floor(options.maxChunks ?? TELEGRAM_MAX_REPLY_CHUNKS));
  if (chunks.length <= maxChunks) return { chunks };
  return {
    chunks: chunks.slice(0, maxChunks),
    document: {
      filename: markdownFilename(options.filename),
      mimeType: 'text/markdown',
      buffer: Buffer.from(markdown.trim(), 'utf8'),
    },
  };
}
