/**
 * Renderer Markdown minimale, senza dipendenze esterne.
 * Supporta: titoli, grassetto, corsivo, codice inline, blocchi codice, elenchi puntati, paragrafi.
 */
export function renderMarkdown(text: string): string {
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
    let p = escapeHtml(buf.join(' '));
    p = p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    p = p.replace(/\*(.+?)\*/g, '<em>$1</em>');
    p = p.replace(/`(.+?)`/g, '<code>$1</code>');
    htmlParts.push(`<p>${p}</p>`);
    buf.length = 0;
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
      const headingText = escapeHtml(hMatch[2])
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
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
        let itemText = escapeHtml(m[1])
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/`(.+?)`/g, '<code>$1</code>');
        listItems.push(`<li>${itemText}</li>`);
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
