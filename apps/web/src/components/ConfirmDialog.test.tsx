import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

test('mostra una modale di conferma dedicata', () => {
  const markup = renderToStaticMarkup(
    <ConfirmDialog title="Eliminare “nota.md”?" confirmLabel="Elimina artefatto" onClose={() => undefined} onConfirm={() => undefined}>
      <p>Verranno eliminate anche le versioni.</p>
    </ConfirmDialog>,
  );
  expect(markup).toContain('Eliminare “nota.md”?');
  expect(markup).toContain('Verranno eliminate anche le versioni.');
  expect(markup).toContain('Elimina artefatto');
  expect(markup).not.toContain('window.confirm');
});
