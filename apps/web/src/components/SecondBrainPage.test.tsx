import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { SecondBrainPage } from './SecondBrainPage';

test('mostra la pagina unica del Second Brain', () => {
  const markup = renderToStaticMarkup(<SecondBrainPage projects={[]} />);
  expect(markup).toContain('Second Brain');
  expect(markup).toContain('Tutte le memorie');
  expect(markup).toContain('Cerca per file');
});
