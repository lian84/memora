const MAX_TITLE_CHARS = 60;

export const TITLE_SYSTEM_PROMPT = `Genera un titolo breve per una chat, basandoti solo sul primo messaggio dell'utente.

Regole:
- usa la stessa lingua del messaggio;
- descrivi l'argomento o l'obiettivo, non ripetere la domanda;
- 3-7 parole, massimo 60 caratteri;
- niente virgolette, emoji, Markdown, prefissi come "Titolo:", URL o punto finale;
- non includere dati personali non necessari;
- rispondi soltanto con il titolo.`;

/** Titolo locale deterministico, disponibile anche senza LLM. */
export function fallbackSessionTitle(text: string): string {
  const cleaned = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\[[\d,\s]+\]/g, ' ')
    .replace(/[#>*_~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:,!?]+$/g, '')
    .trim();
  if (!cleaned) return 'Nuova chat';
  const truncated = cleaned.length > MAX_TITLE_CHARS
    ? `${cleaned.slice(0, MAX_TITLE_CHARS).replace(/\s+\S*$/, '').trim()}…`
    : cleaned;
  return `${truncated.charAt(0).toLocaleUpperCase()}${truncated.slice(1)}`;
}

/** Normalizza e limita il titolo prodotto dal modello. */
export function sanitizeSessionTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let title = raw.replace(/```/g, '').split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? '';
  title = title
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .replace(/^(?:titolo|title|títol|titre)\s*:\s*/i, '')
    .replace(/[*_#`]+/g, ' ')
    .replace(/\[[\d,\s]+\]/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:,!?]+$/g, '')
    .trim();
  if (!title) return null;
  if (title.length > MAX_TITLE_CHARS) {
    title = title.slice(0, MAX_TITLE_CHARS).replace(/\s+\S*$/, '').trim();
  }
  return title || null;
}
