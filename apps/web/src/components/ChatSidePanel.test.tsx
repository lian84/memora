import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ChatSidePanel } from './ChatSidePanel';

test('mostra le quattro aree del pannello con i contatori', () => {
  const markup = renderToStaticMarkup(
    <ChatSidePanel
      title="Orione"
      eyebrow="Progetto"
      ariaLabel="Pannello della chat"
      hasFiles
      activeTab="artifacts"
      onTabChange={() => undefined}
      artifactsCount={2}
      webSourcesCount={3}
      onClose={() => undefined}
    >
      <div>contenuto</div>
    </ChatSidePanel>
  );
  expect(markup).toContain('Orione');
  expect(markup).toContain('File');
  expect(markup).toContain('Contesto');
  expect(markup).toContain('Artefatti');
  expect(markup).toContain('Fonti');
  expect(markup).toContain('>2<');
  expect(markup).toContain('>3<');
  expect(markup).toContain('contenuto');
});

test('senza progetto non mostra la tab File', () => {
  const markup = renderToStaticMarkup(
    <ChatSidePanel
      title="Chat"
      eyebrow="Chat"
      ariaLabel="Pannello della chat"
      hasFiles={false}
      activeTab="context"
      onTabChange={() => undefined}
    >
      <div>contesto</div>
    </ChatSidePanel>
  );
  expect(markup).not.toContain('chat-panel-tab-files');
  expect(markup).toContain('chat-panel-tab-context');
  expect(markup).toContain('chat-panel-tab-artifacts');
  expect(markup).toContain('chat-panel-tab-web');
});
