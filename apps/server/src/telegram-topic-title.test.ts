import { describe, expect, it } from 'vitest';
import {
  formatTelegramTopicTitle,
  MAX_TELEGRAM_TOPIC_TITLE_LENGTH,
  stripTelegramTopicPrefix,
  stripAnyTelegramTopicPrefix,
  telegramProjectPrefix,
} from './telegram-topic-title.js';

describe('telegram topic title', () => {
  it('aggiunge e rimuove il prefisso del progetto', () => {
    expect(telegramProjectPrefix('Lavoro')).toBe('[Lavoro] ');
    expect(formatTelegramTopicTitle('Preventivo', 'Lavoro', true)).toBe('[Lavoro] Preventivo');
    expect(formatTelegramTopicTitle('Preventivo', 'Lavoro', false)).toBe('Preventivo');
    expect(stripTelegramTopicPrefix('[Lavoro] Preventivo', 'Lavoro')).toBe('Preventivo');
    expect(stripTelegramTopicPrefix('Preventivo', 'Lavoro')).toBe('Preventivo');
  });

  it('normalizza parentesi e spazi nel nome progetto', () => {
    expect(telegramProjectPrefix('  Casa [privata]  ')).toBe('[Casa (privata)] ');
    expect(formatTelegramTopicTitle('  Spese   varie ', 'Casa', true)).toBe('[Casa] Spese varie');
    expect(formatTelegramTopicTitle('[Vecchio] Spese', 'Casa', true)).toBe('[Casa] Spese');
    expect(stripAnyTelegramTopicPrefix('[Vecchio] Spese')).toBe('Spese');
  });

  it('rispetta il limite Telegram di 128 caratteri', () => {
    const title = 'x'.repeat(200);
    const formatted = formatTelegramTopicTitle(title, 'Lavoro', true);
    expect([...formatted]).toHaveLength(MAX_TELEGRAM_TOPIC_TITLE_LENGTH);
    expect(formatted.startsWith('[Lavoro] ')).toBe(true);
    expect(formatted.endsWith('…')).toBe(true);
  });

  it('non crea un prefisso se il progetto non ha un nome', () => {
    expect(formatTelegramTopicTitle('Titolo', undefined, true)).toBe('Titolo');
    expect(formatTelegramTopicTitle('', 'Lavoro', true)).toBe('[Lavoro] Sessione');
  });
});
