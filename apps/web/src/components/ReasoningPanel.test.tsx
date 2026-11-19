import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ReasoningPanel } from './ReasoningPanel';

test('mostra un riepilogo chiuso del ragionamento', () => {
  const markup = renderToStaticMarkup(
    <ReasoningPanel text={'Primo passaggio.\nUltimo passaggio visibile.'} />,
  );
  expect(markup).toContain('Ragionamento');
  expect(markup).toContain('Ultimo passaggio visibile.');
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).not.toContain('class="reasoning-body"');
});

test('non mostra nulla senza testo di ragionamento', () => {
  expect(renderToStaticMarkup(<ReasoningPanel text="   " />)).toBe('');
});
