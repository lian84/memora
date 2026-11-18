import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { WebSourcesPanel } from './WebSourcesPanel';

test('numera le fonti web in modo stabile', () => {
  const markup = renderToStaticMarkup(
    <WebSourcesPanel
      sources={[
        { id: 'https://example.com', number: 7, url: 'https://example.com', title: 'Example', domain: 'example.com', kind: 'search', fetchedAt: 1, status: 'ok' },
      ]}
    />,
  );
  expect(markup).toContain('[7]');
  expect(markup).toContain('example.com');
  expect(markup).toContain('Example');
  expect(markup).toContain('Ricerca');
  expect(markup).toContain('trovata nella ricerca');
});
