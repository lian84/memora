import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { Message } from './Message';

test('mostra gli allegati del messaggio con un link al file', () => {
  const markup = renderToStaticMarkup(
    <Message
      role="user"
      content="Guarda questo file"
      timestamp={1}
      sessionId="session-1"
      attachments={[{ id: 'abc', filename: 'note.md', mimeType: 'text/markdown', size: 1200, kind: 'text' }]}
    />,
  );
  expect(markup).toContain('note.md');
  expect(markup).toContain('/api/sessions/session-1/attachments/abc');
  expect(markup).toContain('1.2 KB');
});

test('nasconde il codice HTML quando esiste un artefatto', () => {
  const markup = renderToStaticMarkup(
    <Message
      role="assistant"
      content={'Ecco il documento:\n\n```html\n<html><body><h1>Ricetta</h1></body></html>\n```'}
      timestamp={1}
      hideHtmlCode
    />,
  );
  expect(markup).toContain('Documento generato');
  expect(markup).not.toContain('&lt;html&gt;');
});

test('espone il salvataggio esplicito della risposta come memoria', () => {
  const markup = renderToStaticMarkup(
    <Message role="assistant" content="Risposta" timestamp={1} onSaveMemory={() => undefined} />,
  );
  expect(markup).toContain('Memoria');
  expect(markup).toContain('Salva risposta come memoria');
});

test('collega le citazioni numeriche alle fonti web', () => {
  const markup = renderToStaticMarkup(
    <Message
      role="assistant"
      content="Il fatto è riportato [1]."
      timestamp={1}
      webSources={[
        { id: 'https://example.com', number: 1, url: 'https://example.com', title: 'Example title', domain: 'example.com', kind: 'search', snippet: 'Breve descrizione della fonte.', fetchedAt: 1, status: 'ok' },
      ]}
    />,
  );
  expect(markup).toContain('class="message-citation"');
  expect(markup).toContain('href="https://example.com"');
  expect(markup).toContain('[1]');
  expect(markup).toContain('citation-tooltip');
  expect(markup).toContain('example.com');
  expect(markup).toContain('Example title');
  expect(markup).toContain('Breve descrizione della fonte.');
});
