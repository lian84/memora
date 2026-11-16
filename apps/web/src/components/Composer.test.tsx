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
