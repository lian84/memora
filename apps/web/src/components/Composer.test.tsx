import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { Composer } from './Composer';

test('mostra gli allegati in attesa e il pulsante di caricamento', () => {
  const markup = renderToStaticMarkup(
    <Composer
      onSend={() => undefined}
      onAbort={() => undefined}
      attachments={[{ id: 'a1', filename: 'nota.md', mimeType: 'text/markdown', size: 10, kind: 'text' }]}
      onFilesSelected={() => undefined}
      onRemoveAttachment={() => undefined}
    />,
  );
  expect(markup).toContain('nota.md');
  expect(markup).toContain('Aggiungi allegati');
  expect(markup).toContain('Rimuovi nota.md');
});

test('mostra l’icona non interattiva del profilo agente vicino agli strumenti', () => {
  const markup = renderToStaticMarkup(
    <Composer onSend={() => undefined} onAbort={() => undefined} agent={{ id: 'commercialista', name: 'Commercialista', icon: 'calculator', color: '#0f8a6a' }} />,
  );
  expect(markup).toContain('Chat con Commercialista');
  expect(markup).toContain('composer-agent');
  expect(markup).not.toContain('aria-label="Chat con Commercialista" role="button"');
});

test('mostra il pulsante di condivisione Telegram accanto agli strumenti', () => {
  const markup = renderToStaticMarkup(
    <Composer onSend={() => undefined} onAbort={() => undefined} onToggleWeb={() => undefined} onTelegramShare={() => undefined} telegramShareActive />,
  );
  expect(markup).toContain('telegram-share-toggle is-active');
  expect(markup).toContain('Condivisione Telegram attiva');
});
