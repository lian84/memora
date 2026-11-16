import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ArtifactsPanel } from './ArtifactsPanel';

test('elenca gli artefatti della chat', () => {
  const markup = renderToStaticMarkup(
    <ArtifactsPanel
      sessionId="session-1"
      artifacts={[{ id: 'a1', sessionId: 'session-1', name: 'riepilogo.md', kind: 'markdown', mimeType: 'text/markdown; charset=utf-8', size: 128, createdAt: 1, updatedAt: 1, version: 1 }]}
      onAttachArtifact={() => undefined}
    />,
  );
  expect(markup).toContain('riepilogo.md');
  expect(markup).toContain('1 artefatti');
  expect(markup).toContain('Scarica riepilogo.md');
  expect(markup).toContain('Elimina riepilogo.md');
  expect(markup).toContain('Allega riepilogo.md');
});
