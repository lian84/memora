import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { AgentsAdminPanel } from './AgentsAdminPanel';

test('mostra il pannello di gestione agenti', () => {
  const markup = renderToStaticMarkup(<AgentsAdminPanel />);
  expect(markup).toContain('Agenti');
  expect(markup).toContain('Nuovo agente');
  expect(markup).toContain('Seleziona un agente dalla lista o creane uno nuovo.');
});
