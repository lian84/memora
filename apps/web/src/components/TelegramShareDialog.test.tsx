import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { TelegramShareView } from '@memora/shared';
import { TelegramShareDialog } from './TelegramShareDialog';

const view: TelegramShareView = {
  share: {
    sessionId: 'sess_1',
    accountId: 'acc_tg_test',
    userId: '42',
    chatId: '42',
    mode: 'answers',
    includeArtifacts: true,
    createdAt: 1,
    updatedAt: 1,
  },
  targets: [{
    accountId: 'acc_tg_test',
    accountLabel: 'Bot',
    userId: '42',
    userLabel: 'Luca',
    chatId: '42',
    botUsername: 'memora_bot',
  }],
};

test('mostra la condivisione Telegram e la destinazione', () => {
  const markup = renderToStaticMarkup(<TelegramShareDialog view={view} onClose={() => undefined} onSave={() => undefined} />);
  expect(markup).toContain('Condivisione Telegram');
  expect(markup).toContain('Invia su Telegram');
  expect(markup).toContain('Luca');
  expect(markup).toContain('Solo risposte');
  expect(markup).toContain('Includi PDF e documenti Office');
});

test('spiega quando non ci sono chat collegate', () => {
  const markup = renderToStaticMarkup(<TelegramShareDialog view={{ share: null, targets: [] }} onClose={() => undefined} onSave={() => undefined} />);
  expect(markup).toContain('Nessuna chat Telegram collegata');
});
