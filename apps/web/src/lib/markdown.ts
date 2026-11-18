/**
 * Renderer Markdown minimale, senza dipendenze esterne.
 * Supporta: titoli, grassetto, corsivo, codice inline, blocchi codice, elenchi puntati, paragrafi.
 */
export interface MarkdownOptions {
  /** Mappa numero fonte → URL, usata per rendere cliccabili le citazioni [n]. */
  citations?: Map<number, string>;
}

export function renderMarkdown(text: string, options: MarkdownOptions = {}): string {
  const escapeHtml = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const withoutMetadata = text.replace(/<!--[\s\S]*?-->/g, '');
  const lines = withoutMetadata.split('\n');
  const htmlParts: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]): void => {
    if (buf.length === 0) return;
    htmlParts.push(`<p>${formatInline(buf.join(' '))}</p>`);
    buf.length = 0;
  };

  const citationUrl = (value: string): string | null => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
    } catch {
      return null;
    }
  };

  const formatInline = (value: string): string => {
    const placeholders: string[] = [];
    let inline = escapeHtml(value).replace(/`(.+?)`/g, (_match, code: string) => {
      const index = placeholders.push(`<code>${code}</code>`) - 1;
      return `\u0000${index}\u0000`;
    });
    inline = inline.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    inline = inline.replace(/\*(.+?)\*/g, '<em>$1</em>');
    if (options.citations) {
      inline = inline.replace(/\[(\d{1,3})\]/g, (match, raw: string) => {
        const number = Number(raw);
        const url = options.citations?.get(number);
        const href = url ? citationUrl(url) : null;
        return href
          ? `<a class="message-citation" href="${escapeHtml(href)}" target="_blank" rel="noreferrer" title="Fonte ${number}">[${number}]</a>`
          : match;
      });
    }
    return inline.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => placeholders[Number(index)] ?? '');
  };

  let paraBuf: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // Blocco codice
    if (line.startsWith('```')) {
      flushParagraph(paraBuf);
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // salta la ``` di chiusura
      htmlParts.push(
        `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(
          codeLines.join('\n'),
        )}</code></pre>`,
      );
      continue;
    }

    // Titolo
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      flushParagraph(paraBuf);
      const level = hMatch[1].length;
      const headingText = formatInline(hMatch[2]);
      htmlParts.push(`<h${level}>${headingText}</h${level}>`);
      i++;
      continue;
    }

    // Elenco puntato
    const liMatch = line.match(/^[-*+]\s+(.+)$/);
    if (liMatch) {
      flushParagraph(paraBuf);
      const listItems: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^[-*+]\s+(.+)$/);
        if (!m) break;
        listItems.push(`<li>${formatInline(m[1])}</li>`);
        i++;
      }
      htmlParts.push(`<ul>${listItems.join('')}</ul>`);
      continue;
    }

    // Linea vuota = fine paragrafo
    if (line.trim() === '') {
      flushParagraph(paraBuf);
      i++;
      continue;
    }

    paraBuf.push(line);
    i++;
  }
  flushParagraph(paraBuf);

  return htmlParts.join('\n');
}
