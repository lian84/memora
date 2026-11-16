export interface Chunk {
  chunkIndex: number;
  heading: string | null;
  startLine: number;
  endLine: number;
  content: string;
}

/**
 * Lunghezza massima di un singolo chunk in caratteri.
 * Se un paragrafo supera questo limite, viene spezzato.
 */
const MAX_CHUNK_CHARS = 2000;

/**
 * Esegue lo chunking di un file Markdown in modo deterministico.
 *
 * Strategia:
 * 1. Dividi per heading Markdown (# ## ### etc.).
 * 2. Ogni heading apre un nuovo chunk che include il contenuto fino al prossimo heading.
 * 3. I paragrafi all'interno di un chunk che superano MAX_CHUNK_CHARS vengono spezzati.
 * 4. Ogni chunk mantiene heading, startLine, endLine, content.
 *
 * Il chunking è deterministico: stesso input → stessi chunk.
 */
export function chunkMarkdown(content: string, options: { splitStandaloneBullets?: boolean } = {}): Chunk[] {
  const lines = content.split('\n');
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  let currentHeading: string | null = null;
  let currentChunkLines: string[] = [];
  let currentStartLine = 1;

  const flushChunk = (): void => {
    if (currentChunkLines.length === 0) return;

    const fullContent = currentChunkLines.join('\n').trim();
    if (!fullContent) {
      currentChunkLines = [];
      return;
    }

    // Solo sezioni composte interamente da bullet autonomi su una riga.
    // Liste annidate, multilinea, prose e blocchi di codice mantengono il
    // chunking normale: non si deve separare accidentalmente il loro contesto.
    const headingLine = currentChunkLines[0];
    if (options.splitStandaloneBullets && headingLine && /^#{1,6}\s+/.test(headingLine)) {
      const lines = currentChunkLines.slice(1);
      const items = lines.map((line, index) => ({ line, index })).filter(item => item.line.trim());
      if (items.length >= 2 && items.every(item => /^[-*+]\s+\S/.test(item.line) && headingLine.length + item.line.length + 1 <= MAX_CHUNK_CHARS)) {
        for (const item of items) {
          const lineNumber = currentStartLine + item.index + 1;
          chunks.push({
            chunkIndex: chunkIndex++,
            heading: currentHeading,
            startLine: lineNumber,
            endLine: lineNumber,
            content: `${headingLine}\n${item.line}`,
          });
        }
        currentChunkLines = [];
        return;
      }
    }

    // Spezzetta in sott-chunk se supera MAX_CHUNK_CHARS
    const subChunks = splitContentBySize(fullContent, MAX_CHUNK_CHARS);
    const endLine = currentStartLine + currentChunkLines.length - 1;

    for (let i = 0; i < subChunks.length; i++) {
      chunks.push({
        chunkIndex: chunkIndex++,
        heading: currentHeading,
        startLine: currentStartLine,
        endLine,
        content: subChunks[i],
      });
    }

    currentChunkLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // Chiudi il chunk precedente
      flushChunk();
      currentHeading = headingMatch[2].trim();
      currentStartLine = lineNumber;
      currentChunkLines = [line];
    } else {
      currentChunkLines.push(line);
    }
  }

  // Chiudi l'ultimo chunk
  flushChunk();

  return chunks;
}

/**
 * Spezzetta un testo in sott-chunk di dimensione massima maxChars,
 * cercando di spezzare su confini di paragrafo o frase.
 */
function splitContentBySize(content: string, maxChars: number): string[] {
  if (content.length <= maxChars) return [content];

  const parts: string[] = [];
  let remaining = content;

  while (remaining.length > maxChars) {
    // Cerca un punto di spezzatura: prima doppia newline, poi newline singola, poi spazio
    const splitIndex = remaining.lastIndexOf('\n\n', maxChars);
    if (splitIndex > 0 && splitIndex < remaining.length - 1) {
      parts.push(remaining.slice(0, splitIndex).trim());
      remaining = remaining.slice(splitIndex + 2).trim();
    } else {
      const nlIndex = remaining.lastIndexOf('\n', maxChars);
      if (nlIndex > 0 && nlIndex < remaining.length - 1) {
        parts.push(remaining.slice(0, nlIndex).trim());
        remaining = remaining.slice(nlIndex + 1).trim();
      } else {
        const spaceIndex = remaining.lastIndexOf(' ', maxChars);
        if (spaceIndex > 0) {
          parts.push(remaining.slice(0, spaceIndex).trim());
          remaining = remaining.slice(spaceIndex + 1).trim();
        } else {
          parts.push(remaining.slice(0, maxChars).trim());
          remaining = remaining.slice(maxChars).trim();
        }
      }
    }
  }

  if (remaining.trim()) {
    parts.push(remaining.trim());
  }

  return parts;
}
