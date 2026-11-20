import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { AgentProfilePicker } from './AgentProfilePicker';

const profiles = [
  { id: 'commercialista', name: 'Commercialista', description: 'Contabilità', icon: 'calculator' as const, color: '#0f8a6a', skills: ['iva'] },
  { id: 'sviluppatore', name: 'Sviluppatore', description: 'Codice', icon: 'terminal' as const, color: '#2563eb', skills: ['debugging'] },
];

test('mostra Memo base selezionato e i profili disponibili', () => {
  const markup = renderToStaticMarkup(
    <AgentProfilePicker profiles={profiles} selected={null} onSelect={() => undefined} />,
  );
  expect(markup).toContain('Agente per questa chat');
  expect(markup).toContain('Memo base');
  expect(markup).toContain('Commercialista');
  expect(markup).toContain('Sviluppatore');
  expect(markup).toContain('aria-pressed="true"');
});

test('evidenzia il profilo selezionato', () => {
  const markup = renderToStaticMarkup(
    <AgentProfilePicker profiles={profiles} selected={{ id: 'sviluppatore', name: 'Sviluppatore', icon: 'terminal', color: '#2563eb' }} onSelect={() => undefined} />,
  );
  expect(markup).toContain('aria-pressed="true"');
  expect(markup).toContain('Sviluppatore');
});
