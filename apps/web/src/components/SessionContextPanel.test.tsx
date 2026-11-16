import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { SessionContextPanel } from './SessionContextPanel';

test('mostra le fonti attivabili per la chat', () => {
  const markup = renderToStaticMarkup(
    <SessionContextPanel
      embedded
      context={{ includeGlobalMemory: true, includeProjectMemory: false, includeProjectSources: true }}
      onChange={() => undefined}
    />,
  );
  expect(markup).toContain('Memoria globale');
  expect(markup).toContain('Memoria del progetto');
  expect(markup).toContain('Fonti del progetto');
  expect(markup).toContain('checked');
});
