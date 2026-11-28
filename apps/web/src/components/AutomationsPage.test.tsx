import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { AutomationsPage } from './AutomationsPage';

test('mostra il nuovo header delle automazioni e le azioni principali', () => {
  const markup = renderToStaticMarkup(<AutomationsPage onClose={() => undefined} />);
  expect(markup).toContain('automation-page-header');
  expect(markup).toContain('Le tue automazioni');
  expect(markup).toContain('Nuova automazione');
  expect(markup).toContain('Torna alla chat');
});
