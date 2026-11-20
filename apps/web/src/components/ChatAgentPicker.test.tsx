import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { Chat } from './Chat';

const props = {
  sessionId: 'session-test',
  messages: [],
  onStartTurn: () => undefined,
  onStreamingUpdate: () => undefined,
  agentProfiles: [{ id: 'commercialista', name: 'Commercialista', description: 'Contabilità', icon: 'calculator' as const, color: '#0f8a6a', skills: ['iva'] }],
  agent: null,
};

test('mostra i profili nella bozza prima del primo messaggio', () => {
  const markup = renderToStaticMarkup(<Chat {...props} allowAgentPicker />);
  expect(markup).toContain('Agente per questa chat');
  expect(markup).toContain('Commercialista');
});

test('non mostra i profili in una chat già avviata', () => {
  const markup = renderToStaticMarkup(<Chat {...props} allowAgentPicker={false} />);
  expect(markup).not.toContain('Agente per questa chat');
});
