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

test('le azioni del messaggio sono in fondo, dopo il contenuto', () => {
  const markup = renderToStaticMarkup(
    <Message
      role="assistant"
      content="Risposta di prova"
      timestamp={1}
      onSaveMemory={() => undefined}
      onRegenerate={() => undefined}
      onExportPdf={() => undefined}
    />,
  );
  const content = markup.indexOf('class="message-content"');
  const footer = markup.indexOf('class="message-footer"');
  const memory = markup.indexOf('>Memoria<');
  expect(content).toBeGreaterThan(-1);
  expect(footer).toBeGreaterThan(content);
  expect(memory).toBeGreaterThan(footer);
});

test('anche modifica e copia della domanda sono in fondo', () => {
  const markup = renderToStaticMarkup(
    <Message role="user" content="Domanda" timestamp={1} onEditText={() => undefined} />,
  );
  const content = markup.indexOf('class="message-content"');
  const footer = markup.indexOf('class="message-footer"');
  expect(footer).toBeGreaterThan(content);
  expect(markup.indexOf('Modifica domanda')).toBeGreaterThan(footer);
  expect(markup.indexOf('Copia domanda in testo')).toBeGreaterThan(footer);
});

test('mostra il download degli artefatti dentro la risposta', () => {
  const markup = renderToStaticMarkup(
    <Message
      role="assistant"
      content="Ecco il report."
      timestamp={1}
      sessionId="session-1"
      artifacts={[{
        id: 'artifact-1',
        sessionId: 'session-1',
        name: 'report.pdf',
        kind: 'pdf',
        mimeType: 'application/pdf',
        size: 245_000,
        createdAt: 1,
        updatedAt: 1,
        version: 2,
        sourceMessageId: 'message-1',
      }]}
    />,
  );
  expect(markup).toContain('report.pdf');
  expect(markup).toContain('v2');
  expect(markup).toContain('/api/sessions/session-1/artifacts/artifact-1');
  expect(markup).toContain('download="report.pdf"');
  expect(markup).toContain('Scarica');
});
