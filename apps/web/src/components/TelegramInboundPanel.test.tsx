import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { TelegramAccountView } from '@memora/shared';
import { TelegramInboundPanel } from './TelegramInboundPanel';

const account: TelegramAccountView = {
  id: 'acc_tg_test',
  label: 'Bot di prova',
  chatId: '',
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  tokenConfigured: true,
  tokenSource: 'secret',
};

test('mostra il pannello di ingresso Telegram', () => {
  const markup = renderToStaticMarkup(<TelegramInboundPanel account={account} onClose={() => undefined} />);
  expect(markup).toContain('Ingresso Telegram');
  expect(markup).toContain('nessuna porta pubblica');
  expect(markup).toContain('Caricamento');
});
