/**
 * Renderer Markdown minimale, senza dipendenze esterne.
 * Supporta: titoli, grassetto, corsivo, codice inline, blocchi codice, elenchi puntati,
 * tabelle GFM, interruzioni <br> sicure e paragrafi.
 */
export interface MarkdownCitation {
  url: string;
  domain?: string;
  title?: string;
  snippet?: string;
}

export interface MarkdownOptions {
  /** Mappa numero fonte → metadati, usata per rendere cliccabili le citazioni [n]. */
  citations?: Map<number, MarkdownCitation>;
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
    inline = inline.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    inline = inline.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    inline = inline.replace(/\*(.+?)\*/g, '<em>$1</em>');
    if (options.citations) {
      inline = inline.replace(/\[(\d{1,3})\]/g, (match, raw: string) => {
        const number = Number(raw);
        const citation = options.citations?.get(number);
        if (!citation) return match;
        const href = citationUrl(citation.url);
        if (!href) return match;
        const domain = citation.domain || (() => {
          try { return new URL(href).hostname; } catch { return ''; }
        })();
        const title = citation.title || domain || href;
        const rawSnippet = (citation.snippet ?? '').replace(/\s+/g, ' ').trim();
        const snippet = rawSnippet.slice(0, 220);
        const label = [domain, title, snippet].filter(Boolean).join(' — ');
        const tooltip = `<span class="citation-tooltip" role="tooltip"><span class="citation-tooltip-domain">${escapeHtml(domain || href)}</span><span class="citation-tooltip-title">${escapeHtml(title)}</span>${snippet ? `<span class="citation-tooltip-snippet">${escapeHtml(snippet)}${rawSnippet.length > snippet.length ? '…' : ''}</span>` : ''}</span>`;
        return `<a class="message-citation" href="${escapeHtml(href)}" target="_blank" rel="noreferrer" aria-label="${escapeHtml(label)}">[${number}]${tooltip}</a>`;
      });
    }
    return inline.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => placeholders[Number(index)] ?? '');
  };

  const splitTableRow = (line: string): string[] => {
    let value = line.trim();
    if (value.startsWith('|')) value = value.slice(1);
    if (value.endsWith('|')) value = value.slice(0, -1);
    return value.split('|').map(cell => cell.trim());
  };

  const isTableSeparator = (line: string): boolean => {
    if (!line.includes('|')) return false;
    const cells = splitTableRow(line);
    return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
  };

  const isTableStart = (line: string, nextLine: string | undefined): boolean => {
    if (!nextLine || !line.includes('|') || !isTableSeparator(nextLine)) return false;
    return splitTableRow(line).length === splitTableRow(nextLine).length;
  };

  const renderTable = (headerLine: string, separatorLine: string, rows: string[][]): string => {
    const headers = splitTableRow(headerLine);
    const aligns = splitTableRow(separatorLine).map(cell =>
      cell.startsWith(':') && cell.endsWith(':') ? 'center'
        : cell.endsWith(':') ? 'right'
          : cell.startsWith(':') ? 'left'
            : ''
    );
    const head = headers.map((cell, index) => {
      const align = aligns[index];
      return `<th${align ? ` style="text-align:${align}"` : ''}>${formatInline(cell)}</th>`;
    }).join('');
    const body = rows.map(row => {
      const cells = Array.from({ length: headers.length }, (_, index) => row[index] ?? '');
      return `<tr>${cells.map((cell, index) => {
        const align = aligns[index];
        return `<td${align ? ` style="text-align:${align}"` : ''}>${formatInline(cell)}</td>`;
      }).join('')}</tr>`;
    }).join('');
    return `<div class="markdown-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
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

    // Tabella GFM
    if (isTableStart(line, lines[i + 1])) {
      flushParagraph(paraBuf);
      const headerLine = line;
      const separatorLine = lines[i + 1]!;
      const headerCount = splitTableRow(headerLine).length;
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        const cells = splitTableRow(lines[i]!);
        rows.push(Array.from({ length: headerCount }, (_, index) => cells[index] ?? ''));
        i++;
      }
      htmlParts.push(renderTable(headerLine, separatorLine, rows));
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
