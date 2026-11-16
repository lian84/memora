import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { HtmlPreview } from './HtmlPreview';

test('renderizza HTML in sandbox con toolbar e CSP', () => {
  const markup = renderToStaticMarkup(<HtmlPreview title="deck" html="<h1>Presentazione</h1>" />);
  expect(markup).toContain('Auto');
  expect(markup).toContain('Desktop');
  expect(markup).toContain('Tablet');
  expect(markup).toContain('Mobile');
  expect(markup).toContain('sandbox=""');
  expect(markup).toContain('Content-Security-Policy');
  expect(markup).toContain('Presentazione');
});

test('anteprima URL aggiunge il parametro di refresh', () => {
  const markup = renderToStaticMarkup(<HtmlPreview title="file" url="http://localhost/preview.html" />);
  expect(markup).toContain('preview_refresh=0');
  expect(markup).toContain('Apri file originale');
});
