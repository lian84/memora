const MAX_TELEGRAM_TOPIC_TITLE_LENGTH = 128;
const MAX_PROJECT_LABEL_LENGTH = 48;

function cleanText(value: string): string {
  return [...value]
    .filter(char => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function fit(value: string, maxLength: number): string {
  const chars = [...value];
  if (chars.length <= maxLength) return value;
  if (maxLength <= 1) return '…';
  return `${chars.slice(0, maxLength - 1).join('')}…`;
}

/** Rimuove un prefisso gestito da un titolo già formattato. */
export function stripAnyTelegramTopicPrefix(title: string): string {
  return title.replace(/^\[[^\]]{1,64}\]\s+/, '');
}

/** Prefisso visibile del progetto, senza dipendere dal titolo salvato. */
export function telegramProjectPrefix(projectName?: string | null): string {
  if (!projectName) return '';
  const label = fit(cleanText(projectName).replaceAll('[', '(').replaceAll(']', ')'), MAX_PROJECT_LABEL_LENGTH);
  return label ? `[${label}] ` : '';
}

/** Titolo Telegram completo; il titolo base resta nei metadata. */
export function formatTelegramTopicTitle(
  baseTitle: string,
  projectName?: string | null,
  showProject = false,
): string {
  const cleaned = cleanText(baseTitle) || 'Sessione';
  const base = showProject ? stripAnyTelegramTopicPrefix(cleaned) || 'Sessione' : cleaned;
  const prefix = showProject ? telegramProjectPrefix(projectName) : '';
  return fit(`${prefix}${base}`, MAX_TELEGRAM_TOPIC_TITLE_LENGTH);
}

/** Rimuove il prefisso corrente da un titolo modificato manualmente. */
export function stripTelegramTopicPrefix(title: string, projectName?: string | null): string {
  const prefix = telegramProjectPrefix(projectName);
  if (!prefix) return title;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

export { MAX_TELEGRAM_TOPIC_TITLE_LENGTH, MAX_PROJECT_LABEL_LENGTH };
